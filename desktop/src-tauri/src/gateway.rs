//! Gateway sidecar management for Moldable
//!
//! Handles starting, stopping, and configuring the Moldable Gateway daemon.

use crate::paths::{get_gateway_config_path as get_gateway_config_path_internal, get_gateway_root};
use crate::ports::{
    get_port_info,
    is_port_listening,
    is_process_running,
    kill_port_aggressive,
    kill_process_tree,
};
use crate::sidecar::{
    cleanup_sidecar,
    is_sidecar_running,
    start_sidecar,
    stop_sidecar,
    RestartFlags,
    RestartPolicy,
    SidecarRuntime,
};
use log::{info, warn};
use serde_json::Value;
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{
    atomic::AtomicBool,
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const DEFAULT_GATEWAY_PORT: u16 = 19789;
const DEFAULT_GATEWAY_HTTP_PORT: u16 = 19790;
const GATEWAY_STARTUP_TIMEOUT_MS: u64 = 3500;
const GATEWAY_PORT_MAX_RETRIES: u32 = 6;
const GATEWAY_PORT_INITIAL_DELAY_MS: u64 = 200;
const GATEWAY_PORT_MAX_DELAY_MS: u64 = 2000;
const GATEWAY_RESTART_MIN_DELAY_MS: u64 = 5000;
const GATEWAY_RESTART_MAX_DELAY_MS: u64 = 10000;

static GATEWAY_RESTART_DISABLED: AtomicBool = AtomicBool::new(false);
static GATEWAY_RESTART_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

fn gateway_runtime() -> SidecarRuntime {
    SidecarRuntime {
        log_prefix: "[Gateway]",
        restart_policy: RestartPolicy {
            min_delay_ms: GATEWAY_RESTART_MIN_DELAY_MS,
            max_delay_ms: GATEWAY_RESTART_MAX_DELAY_MS,
        },
        restart_flags: RestartFlags {
            disabled: &GATEWAY_RESTART_DISABLED,
            in_progress: &GATEWAY_RESTART_IN_PROGRESS,
        },
    }
}

// ============================================================================
// STATE
// ============================================================================

/// State for the gateway sidecar
pub struct GatewayState(pub Arc<Mutex<Option<CommandChild>>>);

// ============================================================================
// CONFIG HELPERS
// ============================================================================

fn read_gateway_config_value() -> Result<Value, String> {
    let config_path = get_gateway_config_path_internal()?;

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read gateway config: {}", e))?;

    json5::from_str(&content).map_err(|e| format!("Failed to parse gateway config: {}", e))
}

fn resolve_gateway_http_port(config: &Value) -> u16 {
    config
        .get("gateway")
        .and_then(|gateway| gateway.get("http"))
        .and_then(|http| http.get("port"))
        .and_then(|port| port.as_u64())
        .and_then(|port| u16::try_from(port).ok())
        .unwrap_or(DEFAULT_GATEWAY_HTTP_PORT)
}

fn resolve_gateway_port(config: &Value) -> u16 {
    config
        .get("gateway")
        .and_then(|gateway| gateway.get("port"))
        .and_then(|port| port.as_u64())
        .and_then(|port| u16::try_from(port).ok())
        .unwrap_or(DEFAULT_GATEWAY_PORT)
}

fn format_port_blocker(port: u16) -> String {
    if let Some(info) = get_port_info(port) {
        let mut details = Vec::new();
        if let Some(pid) = info.pid {
            details.push(format!("pid {}", pid));
        }
        if let Some(name) = info.process_name {
            details.push(format!("name {}", name));
        }
        if let Some(command) = info.command {
            details.push(format!("cmd {}", command));
        }

        if !details.is_empty() {
            return format!(" ({})", details.join(", "));
        }
    }

    String::new()
}

fn can_bind_loopback(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn acquire_gateway_port(label: &str, port: u16) -> Result<u16, String> {
    let mut delay_ms = GATEWAY_PORT_INITIAL_DELAY_MS;

    for attempt in 0..=GATEWAY_PORT_MAX_RETRIES {
        let listening = is_port_listening(port);
        let bindable = can_bind_loopback(port);
        if !listening && bindable {
            return Ok(port);
        }

        info!(
            "[Gateway] {} port {} is unavailable (listening={}, bindable={}), attempting to free it (attempt {}){}",
            label,
            port,
            listening,
            bindable,
            attempt + 1,
            format_port_blocker(port)
        );
        let _ = kill_port_aggressive(port);

        if attempt < GATEWAY_PORT_MAX_RETRIES {
            std::thread::sleep(Duration::from_millis(delay_ms));
            delay_ms = (delay_ms * 2).min(GATEWAY_PORT_MAX_DELAY_MS);
        }
    }

    Err(format!(
        "Gateway {} port {} is still unavailable{}",
        label,
        port,
        format_port_blocker(port)
    ))
}

fn gateway_lock_path() -> Result<PathBuf, String> {
    Ok(get_gateway_root()?.join("gateway.lock"))
}

fn read_gateway_lock_pid(path: &Path) -> Option<u32> {
    let content = fs::read_to_string(path).ok()?;
    for line in content.lines() {
        if let Some(value) = line.strip_prefix("pid=") {
            if let Ok(pid) = value.trim().parse::<u32>() {
                return Some(pid);
            }
        }
    }
    None
}

fn cleanup_gateway_lock() -> Result<(), String> {
    let path = gateway_lock_path()?;
    if !path.exists() {
        return Ok(());
    }

    let pid = read_gateway_lock_pid(&path);
    if let Some(pid) = pid {
        if is_process_running(pid) {
            warn!("[Gateway] existing gateway process detected (pid {}), stopping", pid);
            kill_process_tree(pid);
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fs::remove_file(&path).map_err(|e| format!("Failed to remove gateway lock: {}", e))?;
    info!("[Gateway] cleared gateway lock ({})", path.display());
    Ok(())
}

/// Kill any stale gateway processes from previous Moldable instances.
///
/// Uses process name matching (similar to AI server cleanup) because the gateway
/// may have been launched via sidecar or the `moldable` CLI.
fn cleanup_stale_gateway_processes() {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = Command::new("tasklist")
            .args(["/FO", "CSV", "/NH"])
            .output()
        {
            if output.status.success() {
                let our_pid = std::process::id();
                let stdout = String::from_utf8_lossy(&output.stdout);

                for line in stdout.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let fields: Vec<&str> =
                        trimmed.trim_matches('"').split("\",\"").collect();
                    if fields.len() < 2 {
                        continue;
                    }

                    let image = fields[0].to_lowercase();
                    if !image.contains("moldable-gateway") {
                        continue;
                    }

                    if let Ok(pid) = fields[1].parse::<u32>() {
                        if pid != our_pid {
                            info!("[Gateway] Killing stale gateway process (pid {})", pid);
                            kill_process_tree(pid);
                        }
                    }
                }
            }
        }
        return;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let our_pid = std::process::id();
        // Include both bundled/CLI process names and dev-mode command patterns.
        // Dev processes may show up as `cargo run -- gateway run --config ...`
        // and won't necessarily include "moldable-gateway" in their command line.
        let patterns: [(&str, &str); 4] = [
            ("moldable-gateway", "bundled sidecar binary"),
            ("moldable gateway run", "moldable CLI gateway run"),
            (
                "gateway run --config .*\\.moldable/gateway",
                "dev/CLI gateway run against Moldable config",
            ),
            (
                "cargo run .*gateway run --config .*\\.moldable/gateway",
                "cargo dev gateway run against Moldable config",
            ),
        ];

        for (pattern, label) in patterns {
            let output = Command::new("pgrep").args(["-f", pattern]).output();
            let Ok(output) = output else {
                continue;
            };

            if !output.status.success() {
                continue;
            }

            let pids = String::from_utf8_lossy(&output.stdout);
            for line in pids.lines() {
                let Ok(pid) = line.trim().parse::<u32>() else {
                    continue;
                };

                if pid == our_pid {
                    continue;
                }

                info!(
                    "[Gateway] Killing stale gateway process (pid {}, match: {})",
                    pid, label
                );
                kill_process_tree(pid);
            }
        }
    }
}

fn wait_for_gateway_health(port: u16, timeout: Duration) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + timeout;

    while Instant::now() < deadline {
        if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(200)) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
            let _ = stream.set_write_timeout(Some(Duration::from_millis(200)));
            let _ = stream.write_all(
                b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
            );

            let mut buf = [0u8; 256];
            if let Ok(read) = stream.read(&mut buf) {
                let response = String::from_utf8_lossy(&buf[..read]);
                if response.contains("200") {
                    return true;
                }
            }
        }

        std::thread::sleep(Duration::from_millis(120));
    }

    false
}

// ============================================================================
// LIFECYCLE
// ============================================================================

pub fn start_gateway_with_state(
    app: &AppHandle,
    state: Arc<Mutex<Option<CommandChild>>>,
) -> Result<bool, String> {
    let runtime = gateway_runtime();
    if is_sidecar_running(&state) {
        info!("[Gateway] already running");
        return Ok(true);
    }

    info!("[Gateway] =================");
    info!("[Gateway] GATEWAY STARTING");
    info!("[Gateway] =================");

    let config_path = get_gateway_config_path_internal()?;
    if !config_path.exists() {
        return Err("Gateway config not found. Save a config before starting.".to_string());
    }

    let config_value = read_gateway_config_value().unwrap_or_else(|err| {
        warn!("[Gateway] Failed to parse gateway config: {}", err);
        Value::Null
    });
    let gateway_port = resolve_gateway_port(&config_value);
    let http_port = resolve_gateway_http_port(&config_value);
    info!(
        "[Gateway] config loaded (gateway port {}, http port {})",
        gateway_port, http_port
    );

    cleanup_stale_gateway_processes();
    cleanup_gateway_lock()?;
    let _ = acquire_gateway_port("gateway", gateway_port)?;
    if http_port != gateway_port {
        let _ = acquire_gateway_port("http", http_port)?;
    }

    let config_path_str = config_path.to_string_lossy().to_string();
    let app_handle_for_restart = app.clone();
    let gateway_state_for_restart = state.clone();
    let app_handle_for_spawn = app.clone();

    start_sidecar(
        &runtime,
        state.clone(),
        || Ok(()),
        move || {
            let shell = app_handle_for_spawn.shell();
            let mut command = match shell.sidecar("moldable-gateway") {
                Ok(sidecar) => {
                    info!("[Gateway] Using bundled moldable-gateway sidecar");
                    sidecar
                }
                Err(err) => {
                    warn!(
                        "[Gateway] Bundled moldable-gateway sidecar not found ({}); falling back to `moldable` CLI",
                        err
                    );
                    shell.command("moldable")
                }
            };

            info!(
                "[Gateway] command: gateway run --config {} --auto-fix",
                config_path_str
            );
            command = command
                .args(["gateway", "run", "--config", &config_path_str, "--auto-fix"])
                .env("MOLDABLE_GATEWAY", "1");

            command
                .spawn()
                .map_err(|e| format!("Failed to spawn gateway: {}", e))
        },
        move || {
            let ok = wait_for_gateway_health(
                http_port,
                Duration::from_millis(GATEWAY_STARTUP_TIMEOUT_MS),
            );
            if ok {
                info!("[Gateway] health check ok on port {}", http_port);
            }
            ok
        },
        Some(format!("health check timed out on port {}", http_port)),
        format!("Gateway failed to start on http port {}", http_port),
        || Ok(()),
        Some(format!("sidecar started (http port {})", http_port)),
        move || {
            start_gateway_with_state(&app_handle_for_restart, gateway_state_for_restart.clone())
                .map(|_| "Restarted".to_string())
        },
    )
}

fn stop_gateway_with_state(state: &Arc<Mutex<Option<CommandChild>>>) -> Result<bool, String> {
    let runtime = gateway_runtime();
    stop_sidecar(&runtime, state)
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

#[tauri::command]
pub fn is_gateway_running(state: State<'_, GatewayState>) -> bool {
    is_sidecar_running(&state.0)
}

#[tauri::command]
pub fn get_gateway_config() -> Result<Option<Value>, String> {
    let config_path = get_gateway_config_path_internal()?;

    if !config_path.exists() {
        return Ok(None);
    }

    let value = read_gateway_config_value()?;
    Ok(Some(value))
}

#[tauri::command]
pub fn save_gateway_config(config: Value) -> Result<(), String> {
    let config_path = get_gateway_config_path_internal()?;

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create gateway directory: {}", e))?;
    }

    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize gateway config: {}", e))?;
    std::fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write gateway config: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn get_gateway_config_path() -> Result<String, String> {
    get_gateway_config_path_internal().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_gateway_root_path() -> Result<String, String> {
    get_gateway_root().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn start_gateway(app: AppHandle, state: State<'_, GatewayState>) -> Result<bool, String> {
    start_gateway_with_state(&app, state.0.clone())
}

#[tauri::command]
pub fn stop_gateway(state: State<'_, GatewayState>) -> Result<bool, String> {
    stop_gateway_with_state(&state.0)
}

#[tauri::command]
pub fn restart_gateway(app: AppHandle, state: State<'_, GatewayState>) -> Result<bool, String> {
    stop_gateway_with_state(&state.0)?;
    start_gateway_with_state(&app, state.0.clone())
}

pub fn cleanup_gateway(state: &Arc<Mutex<Option<CommandChild>>>) {
    let runtime = gateway_runtime();
    cleanup_sidecar(&runtime, state);
}

/// Approve a pairing request via the gateway WebSocket API
#[tauri::command]
pub async fn approve_pairing(channel: String, code: String) -> Result<(), String> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

    let config = read_gateway_config_value()?;
    let ws_port = resolve_gateway_port(&config);
    let auth_token = config
        .get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());

    let url = format!("ws://127.0.0.1:{}", ws_port);
    let (ws_stream, _) = connect_async(&url)
        .await
        .map_err(|e| format!("Failed to connect to gateway: {}", e))?;

    let (mut write, mut read) = ws_stream.split();

    // Send connect message with auth
    let connect_msg = serde_json::json!({
        "type": "req",
        "id": "connect-1",
        "method": "connect",
        "params": {
            "min_protocol": 1,
            "max_protocol": 1,
            "client": {
                "id": "moldable-desktop",
                "version": env!("CARGO_PKG_VERSION"),
                "platform": std::env::consts::OS
            },
            "auth": auth_token.map(|t| serde_json::json!({ "token": t })),
            "role": "operator"
        }
    });

    write
        .send(Message::Text(connect_msg.to_string().into()))
        .await
        .map_err(|e| format!("Failed to send connect: {}", e))?;

    // Wait for connect response
    let msg = read.next().await
        .ok_or_else(|| "Connection closed".to_string())?
        .map_err(|e| format!("WebSocket error: {}", e))?;

    let response: Value = match msg {
        Message::Text(text) => serde_json::from_str(&text)
            .map_err(|e| format!("Failed to parse response: {}", e))?,
        _ => return Err("Unexpected message type".to_string()),
    };

    if !response.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let error = response.get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("Connect failed: {}", error));
    }

    // Send pair.approve request
    let approve_msg = serde_json::json!({
        "type": "req",
        "id": "approve-1",
        "method": "pair.approve",
        "params": {
            "channel": channel,
            "code": code
        }
    });

    write
        .send(Message::Text(approve_msg.to_string().into()))
        .await
        .map_err(|e| format!("Failed to send pair.approve: {}", e))?;

    let msg = read.next().await
        .ok_or_else(|| "Connection closed".to_string())?
        .map_err(|e| format!("WebSocket error: {}", e))?;

    let approve_response: Value = match msg {
        Message::Text(text) => serde_json::from_str(&text)
            .map_err(|e| format!("Failed to parse response: {}", e))?,
        _ => return Err("Unexpected message type".to_string()),
    };

    if !approve_response.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let error = approve_response.get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("pair.approve failed: {}", error));
    }

    // Send proper close frame
    let _ = write.send(Message::Close(None)).await;
    let _ = write.flush().await;
    info!("[Gateway] Pairing approved for {} code {}", channel, code);
    Ok(())
}

/// List pairing requests via the gateway WebSocket API
#[tauri::command]
pub async fn list_pairing() -> Result<Value, String> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

    // Read config to get auth token and port
    let config = read_gateway_config_value()?;
    let ws_port = resolve_gateway_port(&config);
    let auth_token = config
        .get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());

    let url = format!("ws://127.0.0.1:{}", ws_port);
    let (ws_stream, _) = connect_async(&url)
        .await
        .map_err(|e| format!("Failed to connect to gateway: {}", e))?;

    let (mut write, mut read) = ws_stream.split();

    // Send connect message with auth
    let connect_msg = serde_json::json!({
        "type": "req",
        "id": "connect-1",
        "method": "connect",
        "params": {
            "min_protocol": 1,
            "max_protocol": 1,
            "client": {
                "id": "moldable-desktop",
                "version": env!("CARGO_PKG_VERSION"),
                "platform": std::env::consts::OS
            },
            "auth": auth_token.map(|t| serde_json::json!({ "token": t })),
            "role": "operator"
        }
    });

    write
        .send(Message::Text(connect_msg.to_string().into()))
        .await
        .map_err(|e| format!("Failed to send connect: {}", e))?;

    // Wait for connect response
    let msg = read.next().await
        .ok_or_else(|| "Connection closed".to_string())?
        .map_err(|e| format!("WebSocket error: {}", e))?;

    let response: Value = match msg {
        Message::Text(text) => serde_json::from_str(&text)
            .map_err(|e| format!("Failed to parse response: {}", e))?,
        _ => return Err("Unexpected message type".to_string()),
    };

    if !response.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let error = response.get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("Connect failed: {}", error));
    }

    // Send pair.list request
    let list_msg = serde_json::json!({
        "type": "req",
        "id": "list-1",
        "method": "pair.list",
        "params": {}
    });

    write
        .send(Message::Text(list_msg.to_string().into()))
        .await
        .map_err(|e| format!("Failed to send pair.list: {}", e))?;

    let msg = read.next().await
        .ok_or_else(|| "Connection closed".to_string())?
        .map_err(|e| format!("WebSocket error: {}", e))?;

    let list_response: Value = match msg {
        Message::Text(text) => serde_json::from_str(&text)
            .map_err(|e| format!("Failed to parse response: {}", e))?,
        _ => return Err("Unexpected message type".to_string()),
    };

    if !list_response.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let error = list_response.get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("pair.list failed: {}", error));
    }

    // Send proper close frame
    let _ = write.send(Message::Close(None)).await;
    let _ = write.flush().await;

    Ok(list_response.get("payload").cloned().unwrap_or(Value::Null))
}

/// Deny a pairing request via the gateway WebSocket API
#[tauri::command]
pub async fn deny_pairing(channel: String, code: String) -> Result<(), String> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

    let config = read_gateway_config_value()?;
    let ws_port = resolve_gateway_port(&config);
    let auth_token = config
        .get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());

    let url = format!("ws://127.0.0.1:{}", ws_port);
    let (ws_stream, _) = connect_async(&url)
        .await
        .map_err(|e| format!("Failed to connect to gateway: {}", e))?;

    let (mut write, mut read) = ws_stream.split();

    // Send connect message with auth
    let connect_msg = serde_json::json!({
        "type": "req",
        "id": "connect-1",
        "method": "connect",
        "params": {
            "min_protocol": 1,
            "max_protocol": 1,
            "client": {
                "id": "moldable-desktop",
                "version": env!("CARGO_PKG_VERSION"),
                "platform": std::env::consts::OS
            },
            "auth": auth_token.map(|t| serde_json::json!({ "token": t })),
            "role": "operator"
        }
    });

    write
        .send(Message::Text(connect_msg.to_string().into()))
        .await
        .map_err(|e| format!("Failed to send connect: {}", e))?;

    // Wait for connect response
    let msg = read.next().await
        .ok_or_else(|| "Connection closed".to_string())?
        .map_err(|e| format!("WebSocket error: {}", e))?;

    let response: Value = match msg {
        Message::Text(text) => serde_json::from_str(&text)
            .map_err(|e| format!("Failed to parse response: {}", e))?,
        _ => return Err("Unexpected message type".to_string()),
    };

    if !response.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let error = response.get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("Connect failed: {}", error));
    }

    // Send pair.reject request
    let reject_msg = serde_json::json!({
        "type": "req",
        "id": "reject-1",
        "method": "pair.reject",
        "params": {
            "channel": channel,
            "code": code
        }
    });

    write
        .send(Message::Text(reject_msg.to_string().into()))
        .await
        .map_err(|e| format!("Failed to send pair.reject: {}", e))?;

    let msg = read.next().await
        .ok_or_else(|| "Connection closed".to_string())?
        .map_err(|e| format!("WebSocket error: {}", e))?;

    let reject_response: Value = match msg {
        Message::Text(text) => serde_json::from_str(&text)
            .map_err(|e| format!("Failed to parse response: {}", e))?,
        _ => return Err("Unexpected message type".to_string()),
    };

    if !reject_response.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let error = reject_response.get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        return Err(format!("pair.reject failed: {}", error));
    }

    // Send proper close frame
    let _ = write.send(Message::Close(None)).await;
    let _ = write.flush().await;
    info!("[Gateway] Pairing denied for {} code {}", channel, code);
    Ok(())
}

/// Patch gateway config via authenticated WebSocket call.
/// This ensures the gateway handles validation, token generation, and permissions.
#[tauri::command]
pub async fn gateway_config_patch(patch: Value) -> Result<Value, String> {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

    info!("[Gateway] config_patch starting with patch: {:?}", patch);

    // Read config to get auth token and port
    let config = read_gateway_config_value().map_err(|e| {
        warn!("[Gateway] config_patch failed to read config: {}", e);
        e
    })?;
    let ws_port = resolve_gateway_port(&config);
    let auth_token = config
        .get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());

    let url = format!("ws://127.0.0.1:{}", ws_port);
    info!("[Gateway] config_patch connecting to {}", url);

    let (ws_stream, _) = connect_async(&url)
        .await
        .map_err(|e| {
            warn!("[Gateway] config_patch failed to connect: {}", e);
            format!("Failed to connect to gateway: {}", e)
        })?;

    let (mut write, mut read) = ws_stream.split();

    // Send connect message with auth
    let connect_msg = serde_json::json!({
        "type": "req",
        "id": "connect-1",
        "method": "connect",
        "params": {
            "min_protocol": 1,
            "max_protocol": 1,
            "client": {
                "id": "moldable-desktop",
                "version": env!("CARGO_PKG_VERSION"),
                "platform": std::env::consts::OS
            },
            "auth": auth_token.map(|t| serde_json::json!({ "token": t })),
            "role": "operator"
        }
    });

    write
        .send(Message::Text(connect_msg.to_string().into()))
        .await
        .map_err(|e| {
            warn!("[Gateway] config_patch failed to send connect: {}", e);
            format!("Failed to send connect: {}", e)
        })?;

    // Wait for connect response
    let msg = read.next().await
        .ok_or_else(|| {
            warn!("[Gateway] config_patch connection closed before connect response");
            "Connection closed before connect response".to_string()
        })?
        .map_err(|e| {
            warn!("[Gateway] config_patch WebSocket error during connect: {}", e);
            format!("WebSocket error: {}", e)
        })?;

    let response: Value = match msg {
        Message::Text(text) => {
            info!("[Gateway] config_patch connect response: {}", text);
            serde_json::from_str(&text)
                .map_err(|e| format!("Failed to parse response: {}", e))?
        }
        other => {
            warn!("[Gateway] config_patch unexpected message type: {:?}", other);
            return Err("Unexpected message type".to_string());
        }
    };

    if !response.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let error = response.get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        warn!("[Gateway] config_patch connect failed: {}", error);
        return Err(format!("Connect failed: {}", error));
    }

    info!("[Gateway] config_patch connected, getting config hash");

    // Get config to obtain base_hash
    let get_msg = serde_json::json!({
        "type": "req",
        "id": "get-1",
        "method": "config.get",
        "params": {}
    });

    write
        .send(Message::Text(get_msg.to_string().into()))
        .await
        .map_err(|e| {
            warn!("[Gateway] config_patch failed to send config.get: {}", e);
            format!("Failed to send config.get: {}", e)
        })?;

    let msg = read.next().await
        .ok_or_else(|| {
            warn!("[Gateway] config_patch connection closed before config.get response");
            "Connection closed".to_string()
        })?
        .map_err(|e| {
            warn!("[Gateway] config_patch WebSocket error during config.get: {}", e);
            format!("WebSocket error: {}", e)
        })?;

    let get_response: Value = match msg {
        Message::Text(text) => serde_json::from_str(&text)
            .map_err(|e| format!("Failed to parse response: {}", e))?,
        _ => return Err("Unexpected message type".to_string()),
    };

    if !get_response.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let error = get_response.get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        warn!("[Gateway] config_patch config.get failed: {}", error);
        return Err(format!("config.get failed: {}", error));
    }

    let base_hash = get_response
        .get("payload")
        .and_then(|p| p.get("hash"))
        .and_then(|h| h.as_str())
        .ok_or_else(|| {
            warn!("[Gateway] config_patch missing base_hash in response");
            "Missing base_hash in config.get response".to_string()
        })?;

    info!("[Gateway] config_patch got base_hash: {}, sending patch", base_hash);

    // Send config.patch with baseHash (camelCase as gateway expects)
    let patch_msg = serde_json::json!({
        "type": "req",
        "id": "patch-1",
        "method": "config.patch",
        "params": {
            "baseHash": base_hash,
            "raw": serde_json::to_string(&patch).unwrap_or_default()
        }
    });

    write
        .send(Message::Text(patch_msg.to_string().into()))
        .await
        .map_err(|e| {
            warn!("[Gateway] config_patch failed to send config.patch: {}", e);
            format!("Failed to send config.patch: {}", e)
        })?;

    let msg = read.next().await
        .ok_or_else(|| {
            warn!("[Gateway] config_patch connection closed before config.patch response");
            "Connection closed".to_string()
        })?
        .map_err(|e| {
            warn!("[Gateway] config_patch WebSocket error during config.patch: {}", e);
            format!("WebSocket error: {}", e)
        })?;

    let patch_response: Value = match msg {
        Message::Text(text) => {
            info!("[Gateway] config_patch response: {}", text);
            serde_json::from_str(&text)
                .map_err(|e| format!("Failed to parse response: {}", e))?
        }
        _ => return Err("Unexpected message type".to_string()),
    };

    if !patch_response.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let error = patch_response.get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error");
        warn!("[Gateway] config_patch config.patch failed: {}", error);
        return Err(format!("config.patch failed: {}", error));
    }

    info!("[Gateway] config_patch success, closing connection");

    // Send proper WebSocket close frame and flush
    let _ = write.send(Message::Close(None)).await;
    let _ = write.flush().await;

    Ok(patch_response.get("payload").cloned().unwrap_or(Value::Null))
}

// ============================================================================
// HELPERS
// ============================================================================

#[allow(dead_code)]
fn ensure_gateway_dir() -> Result<PathBuf, String> {
    let gateway_dir = get_gateway_root()?;
    std::fs::create_dir_all(&gateway_dir)
        .map_err(|e| format!("Failed to create gateway directory: {}", e))?;
    Ok(gateway_dir)
}
