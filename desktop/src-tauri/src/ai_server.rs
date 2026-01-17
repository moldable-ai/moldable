//! AI server sidecar management for Moldable
//!
//! Handles starting and stopping the AI server sidecar process.

use crate::ports::kill_process_tree;
use log::{error, info, warn};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// ============================================================================
// AI SERVER LIFECYCLE
// ============================================================================

/// Start the AI server sidecar
pub fn start_ai_server(
    app: &AppHandle,
    ai_server_state: Arc<Mutex<Option<CommandChild>>>,
) -> Result<(), Box<dyn std::error::Error>> {
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
