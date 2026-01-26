//! Gateway sidecar management for Moldable
//!
//! Handles starting, stopping, and configuring the Moldable Gateway daemon.

use crate::paths::{get_gateway_config_path as get_gateway_config_path_internal, get_gateway_root};
use crate::ports::{acquire_port, is_process_running, kill_process_tree, PortAcquisitionConfig};
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
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
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

fn acquire_gateway_port(label: &str, port: u16) -> Result<u16, String> {
    let result = acquire_port(PortAcquisitionConfig {
        preferred_port: port,
        max_retries: GATEWAY_PORT_MAX_RETRIES,
        initial_delay_ms: GATEWAY_PORT_INITIAL_DELAY_MS,
        max_delay_ms: GATEWAY_PORT_MAX_DELAY_MS,
        allow_fallback: false,
        fallback_range: None,
    })?;
    if result.port != port || !result.is_preferred {
        return Err(format!(
            "Gateway {} port {} is unavailable (acquired {})",
            label, port, result.port
        ));
    }
    Ok(result.port)
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

fn start_gateway_with_state(
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

            info!("[Gateway] command: gateway run --config {}", config_path_str);
            command = command
                .args(["gateway", "run", "--config", &config_path_str])
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
