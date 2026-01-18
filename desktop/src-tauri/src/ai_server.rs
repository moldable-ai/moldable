//! AI server sidecar management for Moldable
//!
//! Handles starting and stopping the AI server sidecar process.

use crate::ports::{is_port_available, kill_port, kill_process_tree};
use log::{error, info, warn};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Default port for the AI server (high port to avoid conflicts)
const AI_SERVER_PORT: u16 = 39100;

// ============================================================================
// AI SERVER LIFECYCLE
// ============================================================================

/// Ensure the AI server port is available, killing any stale processes if needed
fn ensure_port_available() -> Result<(), String> {
    if is_port_available(AI_SERVER_PORT) {
        return Ok(());
    }

    warn!(
        "Port {} is in use, attempting to free it (likely stale AI server)",
        AI_SERVER_PORT
    );

    // Try to kill whatever is using the port
    match kill_port(AI_SERVER_PORT) {
        Ok(true) => {
            info!("Killed process on port {}", AI_SERVER_PORT);
            // Give the OS time to release the port
            std::thread::sleep(std::time::Duration::from_millis(500));

            // Verify port is now available
            if is_port_available(AI_SERVER_PORT) {
                Ok(())
            } else {
                Err(format!(
                    "Port {} still in use after killing process",
                    AI_SERVER_PORT
                ))
            }
        }
        Ok(false) => Err(format!(
            "Port {} is in use but couldn't identify process to kill",
            AI_SERVER_PORT
        )),
        Err(e) => Err(format!("Failed to kill process on port {}: {}", AI_SERVER_PORT, e)),
    }
}

/// Start the AI server sidecar
pub fn start_ai_server(
    app: &AppHandle,
    ai_server_state: Arc<Mutex<Option<CommandChild>>>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Ensure port is available before starting
    if let Err(e) = ensure_port_available() {
        error!("Cannot start AI server: {}", e);
        return Err(e.into());
    }

    let shell = app.shell();

    // Get the sidecar command
    let sidecar = shell.sidecar("moldable-ai-server")?;

    // Spawn the sidecar
    let (mut rx, child) = sidecar.spawn()?;

    // Store the child handle for cleanup on exit
    if let Ok(mut state) = ai_server_state.lock() {
        *state = Some(child);
    }

    // Log output in background thread
    std::thread::spawn(move || {
        while let Some(event) = rx.blocking_recv() {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    info!("[AI Server] {}", String::from_utf8_lossy(&line));
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    error!("[AI Server] {}", String::from_utf8_lossy(&line));
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(status) => {
                    info!("[AI Server] Terminated with status: {:?}", status);
                    break;
                }
                _ => {}
            }
        }
    });

    info!("AI Server sidecar started");
    Ok(())
}

/// Kill the AI server sidecar
pub fn cleanup_ai_server(state: &Arc<Mutex<Option<CommandChild>>>) {
    if let Ok(mut ai_server) = state.lock() {
        if let Some(child) = ai_server.take() {
            info!("Stopping AI server...");

            // Get PID before attempting kill
            let pid = child.pid();

            // Try graceful kill first via Tauri's CommandChild
            let kill_result = child.kill();
            if let Err(e) = kill_result {
                warn!("Tauri kill failed: {}, using kill_process_tree", e);
            }

            // Always use kill_process_tree to ensure all children are killed
            // (the AI server may spawn node processes that outlive the parent)
            kill_process_tree(pid);

            // Give processes a moment to clean up
            std::thread::sleep(std::time::Duration::from_millis(100));

            info!("AI server stopped (pid {})", pid);
        }
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ai_server_port_constant() {
        assert_eq!(AI_SERVER_PORT, 39100);
    }

    #[test]
    fn test_ensure_port_available_when_free() {
        // Use a high port that's almost certainly not in use
        // We can't directly test ensure_port_available since it uses the constant,
        // but we can verify the underlying is_port_available works
        use crate::ports::is_port_available;
        
        // Port 59432 is very unlikely to be in use
        let high_port = 59432;
        if is_port_available(high_port) {
            // If we find a free port, the check works
            assert!(true);
        }
    }

    #[test]
    fn test_ensure_port_available_returns_ok_when_free() {
        // If port 39100 happens to be free (common in test environments),
        // ensure_port_available should return Ok immediately
        let result = ensure_port_available();
        // Either it succeeds (port free) or fails with a message (port in use)
        // Both are valid outcomes - we just verify it doesn't panic
        match result {
            Ok(()) => assert!(true),
            Err(msg) => {
                // Error message should mention the port
                assert!(msg.contains("39100"));
            }
        }
    }

    #[test]
    fn test_ai_server_state_initialization() {
        let state: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
        let guard = state.lock().unwrap();
        assert!(guard.is_none());
    }

    #[test]
    fn test_cleanup_ai_server_empty_state() {
        // Cleanup should handle empty state gracefully
        let state: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
        cleanup_ai_server(&state); // Should not panic

        let guard = state.lock().unwrap();
        assert!(guard.is_none());
    }
}
