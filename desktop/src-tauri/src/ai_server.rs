//! AI server sidecar management for Moldable
//!
//! Handles starting and stopping the AI server sidecar process.

use crate::ports::{acquire_port, kill_process_tree, PortAcquisitionConfig, PortAcquisitionResult, DEFAULT_AI_SERVER_PORT};
use log::{error, info, warn};
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Default port for the AI server (re-export from ports for external use)
pub const AI_SERVER_PORT: u16 = DEFAULT_AI_SERVER_PORT;

/// Fallback port range for AI server (if default is unavailable)
const AI_SERVER_FALLBACK_START: u16 = DEFAULT_AI_SERVER_PORT + 1;
const AI_SERVER_FALLBACK_END: u16 = DEFAULT_AI_SERVER_PORT + 99;

// ============================================================================
// AI SERVER LIFECYCLE
// ============================================================================

/// Acquire the AI server port using robust retry and fallback logic.
/// Returns the actual port that was acquired.
fn acquire_ai_server_port() -> Result<PortAcquisitionResult, String> {
    let config = PortAcquisitionConfig {
        preferred_port: AI_SERVER_PORT,
        max_retries: 5,
        initial_delay_ms: 200,
        max_delay_ms: 2000,
        allow_fallback: true,
        fallback_range: Some((AI_SERVER_FALLBACK_START, AI_SERVER_FALLBACK_END)),
    };
    
    acquire_port(config)
}

/// Start the AI server sidecar.
/// Returns the actual port the server is running on.
pub fn start_ai_server(
    app: &AppHandle,
    ai_server_state: Arc<Mutex<Option<CommandChild>>>,
) -> Result<u16, Box<dyn std::error::Error>> {
    // Acquire port with retry and fallback logic
    let port_result = acquire_ai_server_port().map_err(|e| {
        error!("Cannot start AI server: {}", e);
        e
    })?;
    
    let actual_port = port_result.port;
    
    if !port_result.is_preferred {
        warn!(
            "AI Server using fallback port {} (preferred {} was unavailable)",
            actual_port, AI_SERVER_PORT
        );
    }

    let shell = app.shell();

    // Get the sidecar command with the actual port
    let sidecar = shell.sidecar("moldable-ai-server")?;
    
    // Pass the port as an environment variable (must match MOLDABLE_AI_PORT in ai-server)
    let sidecar = sidecar.env("MOLDABLE_AI_PORT", actual_port.to_string());

    // Spawn the sidecar
    let (mut rx, child) = sidecar.spawn()?;

    // Store the child handle for cleanup on exit
    if let Ok(mut state) = ai_server_state.lock() {
        *state = Some(child);
    }

    let port_for_log = actual_port;
    
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

    info!("AI Server sidecar started on port {}", port_for_log);
    Ok(actual_port)
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

    // ==================== PORT CONSTANTS TESTS ====================
    
    #[test]
    fn test_ai_server_port_constant() {
        assert_eq!(AI_SERVER_PORT, 39100);
    }
    
    #[test]
    fn test_ai_server_port_matches_default() {
        // AI_SERVER_PORT should equal DEFAULT_AI_SERVER_PORT from ports module
        assert_eq!(AI_SERVER_PORT, DEFAULT_AI_SERVER_PORT);
    }
    
    #[test]
    fn test_ai_server_fallback_range() {
        assert_eq!(AI_SERVER_FALLBACK_START, 39101);
        assert_eq!(AI_SERVER_FALLBACK_END, 39199);
        // Fallback range should be after the main port
        assert!(AI_SERVER_FALLBACK_START > AI_SERVER_PORT);
    }
    
    #[test]
    fn test_ai_server_fallback_range_is_contiguous() {
        // Fallback start should be exactly one more than the main port
        assert_eq!(AI_SERVER_FALLBACK_START, AI_SERVER_PORT + 1);
    }
    
    #[test]
    fn test_ai_server_fallback_range_size() {
        // Should have 99 fallback ports (39101-39199)
        let range_size = AI_SERVER_FALLBACK_END - AI_SERVER_FALLBACK_START + 1;
        assert_eq!(range_size, 99);
    }
    
    #[test]
    fn test_ai_server_port_in_valid_range() {
        // Port should be > 1024 (unprivileged) and < 65536
        assert!(AI_SERVER_PORT > 1024);
        assert!(AI_SERVER_PORT < 65535);
        assert!(AI_SERVER_FALLBACK_END < 65535);
    }

    // ==================== PORT ACQUISITION TESTS ====================

    #[test]
    fn test_acquire_ai_server_port_when_free() {
        use crate::ports::is_port_available;
        
        // If the default port happens to be free, acquisition should succeed
        if is_port_available(AI_SERVER_PORT) {
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
                assert!(acquired.port >= AI_SERVER_PORT);
                assert!(acquired.port <= AI_SERVER_FALLBACK_END);
            }
            Err(msg) => {
                // Error message should be descriptive
                assert!(!msg.is_empty());
            }
        }
    }
    
    #[test]
    fn test_acquire_ai_server_port_result_fields() {
        use crate::ports::is_port_available;
        
        // If acquisition succeeds, verify all fields are set correctly
        if is_port_available(AI_SERVER_PORT) {
            if let Ok(result) = acquire_ai_server_port() {
                // Port should be valid
                assert!(result.port > 0);
                
                // If it's the preferred port, is_preferred should be true
                if result.port == AI_SERVER_PORT {
                    assert!(result.is_preferred);
                }
                
                // retries_used should be reasonable
                assert!(result.retries_used <= 5);
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
}
