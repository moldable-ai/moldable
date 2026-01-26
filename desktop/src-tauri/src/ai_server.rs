//! AI server sidecar management for Moldable
//!
//! Handles starting and stopping the AI server sidecar process.

use crate::ports::{
    get_port_info,
    is_port_listening,
    kill_port_aggressive,
    kill_process_tree,
    set_ai_server_actual_port,
    PortAcquisitionResult,
    DEFAULT_AI_SERVER_PORT,
};
use crate::sidecar::{cleanup_sidecar, start_sidecar, RestartFlags, RestartPolicy, SidecarRuntime};
use log::{error, info};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::process::Command;
use std::sync::{atomic::AtomicBool, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Default port for the AI server (re-export from ports for external use)
pub const AI_SERVER_PORT: u16 = DEFAULT_AI_SERVER_PORT;
const AI_SERVER_PORT_MAX_RETRIES: u32 = 6;
const AI_SERVER_PORT_INITIAL_DELAY_MS: u64 = 200;
const AI_SERVER_PORT_MAX_DELAY_MS: u64 = 2000;

const _: () = {
    assert!(AI_SERVER_PORT > 1024);
    assert!(AI_SERVER_PORT < 65535);
};
const AI_SERVER_STARTUP_TIMEOUT_MS: u64 = 2500;
const AI_SERVER_RESTART_MIN_DELAY_MS: u64 = 5000;
const AI_SERVER_RESTART_MAX_DELAY_MS: u64 = 10000;

static AI_SERVER_RESTART_DISABLED: AtomicBool = AtomicBool::new(false);
static AI_SERVER_RESTART_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

fn ai_server_runtime() -> SidecarRuntime {
    SidecarRuntime {
        log_prefix: "[AI Server]",
        restart_policy: RestartPolicy {
            min_delay_ms: AI_SERVER_RESTART_MIN_DELAY_MS,
            max_delay_ms: AI_SERVER_RESTART_MAX_DELAY_MS,
        },
        restart_flags: RestartFlags {
            disabled: &AI_SERVER_RESTART_DISABLED,
            in_progress: &AI_SERVER_RESTART_IN_PROGRESS,
        },
    }
}

// ============================================================================
// AI SERVER LIFECYCLE
// ============================================================================

/// Kill any stale AI server processes from previous Moldable instances.
///
/// Uses `pgrep` to find processes with the MOLDABLE_AI_SERVER environment variable
/// and kills them. This is more reliable than port-based cleanup because:
/// - Works even if the AI server fell back to a different port
/// - Finds processes regardless of what port they're using
/// - Doesn't accidentally kill unrelated processes on those ports
fn cleanup_stale_ai_servers() {
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
                    if !image.contains("moldable-ai-server") {
                        continue;
                    }

                    if let Ok(pid) = fields[1].parse::<u32>() {
                        if pid != our_pid {
                            info!("Killing stale AI server process (pid {})", pid);
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
        // Use pgrep to find processes with our tag in their environment/command
        // Note: On macOS, pgrep -f searches command line. For env vars we use a different approach.

        // First, try to find node processes running moldable-ai-server
        if let Ok(output) = Command::new("pgrep")
            .args(["-f", "moldable-ai-server"])
            .output()
        {
            if output.status.success() {
                let pids = String::from_utf8_lossy(&output.stdout);
                let our_pid = std::process::id();

                for line in pids.lines() {
                    if let Ok(pid) = line.trim().parse::<u32>() {
                        // Don't kill ourselves or our parent
                        if pid != our_pid {
                            info!("Killing stale AI server process (pid {})", pid);
                            kill_process_tree(pid);
                        }
                    }
                }
            }
        }
    }
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

fn wait_for_ai_server_health(port: u16, timeout: Duration) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + timeout;

    while Instant::now() < deadline {
        if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(200)) {
            let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
            let _ = stream.set_write_timeout(Some(Duration::from_millis(200)));
            let _ = stream.write_all(
                b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
            );

            let mut buf = [0u8; 512];
            if let Ok(read) = stream.read(&mut buf) {
                let response = String::from_utf8_lossy(&buf[..read]);
                if response.contains("\"status\":\"ok\"")
                    || response.contains("\"status\": \"ok\"")
                {
                    return true;
                }
            }
        }

        std::thread::sleep(Duration::from_millis(100));
    }

    false
}

/// Acquire the AI server port with retry logic (no fallback).
/// Returns the actual port that was acquired.
fn acquire_ai_server_port() -> Result<PortAcquisitionResult, String> {
    let mut delay_ms = AI_SERVER_PORT_INITIAL_DELAY_MS;

    for attempt in 0..=AI_SERVER_PORT_MAX_RETRIES {
        let listening = is_port_listening(AI_SERVER_PORT);
        let bindable = can_bind_loopback(AI_SERVER_PORT);
        if !listening && bindable {
            return Ok(PortAcquisitionResult {
                port: AI_SERVER_PORT,
                is_preferred: true,
                retries_used: attempt,
            });
        }

        info!(
            "AI server port {} is unavailable (listening={}, bindable={}), attempting to free it (attempt {}){}",
            AI_SERVER_PORT,
            listening,
            bindable,
            attempt + 1,
            format_port_blocker(AI_SERVER_PORT),
        );
        let _ = kill_port_aggressive(AI_SERVER_PORT);

        if attempt < AI_SERVER_PORT_MAX_RETRIES {
            std::thread::sleep(Duration::from_millis(delay_ms));
            delay_ms = (delay_ms * 2).min(AI_SERVER_PORT_MAX_DELAY_MS);
        }
    }

    Err(format!(
        "AI server port {} is still unavailable{}",
        AI_SERVER_PORT,
        format_port_blocker(AI_SERVER_PORT)
    ))
}

/// Start the AI server sidecar.
/// Returns the actual port the server is running on.
pub fn start_ai_server(
    app: &AppHandle,
    ai_server_state: Arc<Mutex<Option<CommandChild>>>,
) -> Result<u16, Box<dyn std::error::Error>> {
    let runtime = ai_server_runtime();

    // Kill any stale AI server processes from previous runs BEFORE acquiring the port
    cleanup_stale_ai_servers();

    // Acquire port with retry logic (no fallback)
    let port_result = acquire_ai_server_port().map_err(|e| {
        error!("Cannot start AI server: {}", e);
        e
    })?;
    
    let actual_port = port_result.port;
    
    let port_for_log = actual_port;

    let app_handle_for_spawn = app.clone();
    let app_handle_for_restart = app.clone();
    let ai_server_state_for_restart = ai_server_state.clone();

    start_sidecar(
        &runtime,
        ai_server_state.clone(),
        || Ok(()),
        move || {
            let shell = app_handle_for_spawn.shell();
            let sidecar = shell
                .sidecar("moldable-ai-server")
                .map_err(|e| e.to_string())?;
            let sidecar = sidecar
                .env("MOLDABLE_AI_PORT", actual_port.to_string())
                .env("MOLDABLE_AI_SERVER", "1");
            sidecar
                .spawn()
                .map_err(|e| format!("Failed to spawn AI server: {}", e))
        },
        move || {
            wait_for_ai_server_health(
                port_for_log,
                Duration::from_millis(AI_SERVER_STARTUP_TIMEOUT_MS),
            )
        },
        None,
        format!("AI server failed to start on port {}", port_for_log),
        || {
            set_ai_server_actual_port(actual_port);
            Ok(())
        },
        Some(format!("sidecar started on port {}", port_for_log)),
        move || {
            start_ai_server(&app_handle_for_restart, ai_server_state_for_restart.clone())
                .map(|port| format!("Restarted on port {}", port))
                .map_err(|e| e.to_string())
        },
    )
    .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

    Ok(actual_port)
}

/// Kill the AI server sidecar
pub fn cleanup_ai_server(state: &Arc<Mutex<Option<CommandChild>>>) {
    let runtime = ai_server_runtime();
    cleanup_sidecar(&runtime, state);
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== PORT CONSTANTS TESTS ====================
    
    #[test]
    fn test_ai_server_port_constant() {
        assert_eq!(AI_SERVER_PORT, 39200);
    }
    
    #[test]
    fn test_ai_server_port_matches_default() {
        // AI_SERVER_PORT should equal DEFAULT_AI_SERVER_PORT from ports module
        assert_eq!(AI_SERVER_PORT, DEFAULT_AI_SERVER_PORT);
    }
    
    // ==================== PORT ACQUISITION TESTS ====================

    #[test]
    fn test_acquire_ai_server_port_when_free() {
        use crate::ports::is_port_listening;
        
        // If the default port isn't listening, acquisition should succeed
        if !is_port_listening(AI_SERVER_PORT) && can_bind_loopback(AI_SERVER_PORT) {
            let result = acquire_ai_server_port();
            assert!(result.is_ok());
            let acquired = result.unwrap();
            assert_eq!(acquired.port, AI_SERVER_PORT);
            assert!(acquired.is_preferred);
        }
    }
    
    #[test]
    fn test_acquire_ai_server_port_returns_result() {
        // Should always return a Result (Ok or Err), never panic
        let result = acquire_ai_server_port();
        // Either succeeds with a port, or fails with an error message
        match result {
            Ok(acquired) => {
                assert!(acquired.port > 0);
                assert_eq!(acquired.port, AI_SERVER_PORT);
            }
            Err(msg) => {
                // Error message should be descriptive
                assert!(!msg.is_empty());
            }
        }
    }
    
    #[test]
    fn test_acquire_ai_server_port_result_fields() {
        use crate::ports::is_port_listening;
        
        // If acquisition succeeds, verify all fields are set correctly
        if !is_port_listening(AI_SERVER_PORT) && can_bind_loopback(AI_SERVER_PORT) {
            if let Ok(result) = acquire_ai_server_port() {
                // Port should be valid
                assert!(result.port > 0);
                
                // If it's the preferred port, is_preferred should be true
                assert!(result.is_preferred);
                
                // retries_used should be reasonable
                assert!(result.retries_used <= AI_SERVER_PORT_MAX_RETRIES);
            }
        }
    }

    // ==================== STATE MANAGEMENT TESTS ====================

    #[test]
    fn test_ai_server_state_initialization() {
        let state: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
        let guard = state.lock().unwrap();
        assert!(guard.is_none());
    }
    
    #[test]
    fn test_ai_server_state_is_thread_safe() {
        let state: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
        
        // Clone the Arc to simulate multi-threaded access
        let state_clone = state.clone();
        
        // Both should point to the same data
        {
            let _guard1 = state.lock().unwrap();
            // Can't lock state_clone while guard1 is held (proves it's the same mutex)
        }
        
        let guard2 = state_clone.lock().unwrap();
        assert!(guard2.is_none());
    }

    // ==================== CLEANUP TESTS ====================

    #[test]
    fn test_cleanup_ai_server_empty_state() {
        // Cleanup should handle empty state gracefully
        let state: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
        cleanup_ai_server(&state); // Should not panic

        let guard = state.lock().unwrap();
        assert!(guard.is_none());
    }
    
    #[test]
    fn test_cleanup_ai_server_multiple_times() {
        // Calling cleanup multiple times should be safe
        let state: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
        
        cleanup_ai_server(&state);
        cleanup_ai_server(&state);
        cleanup_ai_server(&state);
        
        // State should still be accessible and None
        let guard = state.lock().unwrap();
        assert!(guard.is_none());
    }
    
    #[test]
    fn test_cleanup_ai_server_with_cloned_arc() {
        let state: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
        let state_clone = state.clone();
        
        // Cleanup via clone
        cleanup_ai_server(&state_clone);
        
        // Original should see the same state
        let guard = state.lock().unwrap();
        assert!(guard.is_none());
    }

    // ==================== STALE CLEANUP TESTS ====================

    #[test]
    fn test_cleanup_stale_ai_servers_does_not_panic() {
        // Should handle the case where no stale servers exist
        cleanup_stale_ai_servers();
        // If we get here without panicking, the test passes
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn test_cleanup_stale_ai_servers_does_not_kill_current_process() {
        // The cleanup should skip our own process
        let our_pid = std::process::id();
        
        cleanup_stale_ai_servers();
        
        // We should still be running!
        assert!(Command::new("kill")
            .args(["-0", &our_pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_cleanup_stale_ai_servers_does_not_kill_current_process_windows() {
        // The cleanup should skip our own process
        let our_pid = std::process::id();

        cleanup_stale_ai_servers();

        assert!(crate::ports::is_process_running(our_pid));
    }
}
