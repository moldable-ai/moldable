//! Audio capture sidecar management for Moldable
//!
//! Handles system audio capture on macOS 14.2+ using Audio Taps.

use log::{error, info};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// ============================================================================
// STATE
// ============================================================================

/// State for the audio capture sidecar
pub struct AudioCaptureState(pub Arc<Mutex<Option<CommandChild>>>);

// ============================================================================
// TAURI COMMANDS
// ============================================================================

/// Check if system audio capture is available (macOS 14.2+)
#[tauri::command]
pub fn is_system_audio_available() -> bool {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        if let Ok(output) = Command::new("sw_vers").arg("-productVersion").output() {
            if let Ok(version) = String::from_utf8(output.stdout) {
                let parts: Vec<&str> = version.trim().split('.').collect();
                if parts.len() >= 2 {
                    if let (Ok(major), Ok(minor)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>())
                    {
                        return major > 14 || (major == 14 && minor >= 2);
                    }
                }
            }
        }
        false
    }
    #[cfg(not(target_os = "macos"))]
    {
        false // System audio capture not yet implemented for other platforms
    }
}

/// Start system audio capture
/// mode: 0 = microphone, 1 = system audio, 2 = both
#[tauri::command]
pub async fn start_audio_capture(
    app: AppHandle,
    mode: u32,
    sample_rate: u32,
    channels: u32,
    state: State<'_, AudioCaptureState>,
) -> Result<bool, String> {
    if !cfg!(target_os = "macos") {
        return Err("System audio capture is only supported on macOS 14.2+".to_string());
    }

    // Check if already running
    {
        let capture_state = state.0.lock().map_err(|e| e.to_string())?;
        if capture_state.is_some() {
            return Err("Audio capture already running".to_string());
        }
    }

    let shell = app.shell();

    // Get the sidecar command
    let sidecar = shell
        .sidecar("moldable-audio-capture")
        .map_err(|e| format!("Failed to get audio capture sidecar: {}", e))?;

    // Spawn the sidecar
    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("Failed to spawn audio capture: {}", e))?;

    // Store the child handle
    {
        let mut capture_state = state.0.lock().map_err(|e| e.to_string())?;
        *capture_state = Some(child);
    }

    // Clone state for the async task
    let state_clone = state.0.clone();
    let app_handle = app.clone();

    // Handle output in background task
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);

                    // Parse JSON message from sidecar
                    if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line_str) {
                        match msg.get("type").and_then(|t| t.as_str()) {
                            Some("ready") => {
                                info!("[AudioCapture] Ready");

                                // Send start command with the specified mode
                                if let Ok(mut capture_state) = state_clone.lock() {
                                    if let Some(ref mut child) = *capture_state {
                                        let cmd = serde_json::json!({
                                            "command": "start",
                                            "mode": mode.to_string(),
                                            "sampleRate": sample_rate.to_string(),
                                            "channels": channels.to_string()
                                        });
                                        let _ = child.write((cmd.to_string() + "\n").as_bytes());
                                    }
                                }
                            }
                            Some("started") => {
                                info!("[AudioCapture] Started capturing");
                                let _ = app_handle.emit("audio-capture-started", ());
                            }
                            Some("stopped") => {
                                info!("[AudioCapture] Stopped");
                                let _ = app_handle.emit("audio-capture-stopped", ());
                            }
                            Some("audio") => {
                                // Forward audio data to frontend
                                if let Some(data) = msg.get("data").and_then(|d| d.as_str()) {
                                    let _ = app_handle.emit("audio-capture-data", data);
                                }
                            }
                            Some("error") => {
                                if let Some(error) = msg.get("error").and_then(|e| e.as_str()) {
                                    error!("[AudioCapture] Error: {}", error);
                                    let _ = app_handle.emit("audio-capture-error", error);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    error!("[AudioCapture] {}", String::from_utf8_lossy(&line));
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(status) => {
                    info!("[AudioCapture] Terminated with status: {:?}", status);
                    let _ = app_handle.emit("audio-capture-stopped", ());

                    // Clear state
                    if let Ok(mut capture_state) = state_clone.lock() {
                        *capture_state = None;
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    info!("Audio capture sidecar started");
    Ok(true)
}

/// Stop audio capture
#[tauri::command]
pub fn stop_audio_capture(state: State<'_, AudioCaptureState>) -> Result<bool, String> {
    let mut capture_state = state.0.lock().map_err(|e| e.to_string())?;

    if let Some(ref mut child) = *capture_state {
        // Send quit command
        let cmd = serde_json::json!({ "command": "quit" });
        let _ = child.write((cmd.to_string() + "\n").as_bytes());
    }

    // Give it a moment then kill
    std::thread::sleep(std::time::Duration::from_millis(100));

    // Take ownership and kill
    if let Some(child) = capture_state.take() {
        let _ = child.kill();
    }

    info!("Audio capture stopped");
    Ok(true)
}

/// Cleanup audio capture on exit
pub fn cleanup_audio_capture(state: &Arc<Mutex<Option<CommandChild>>>) {
    if let Ok(mut capture_state) = state.lock() {
        if let Some(child) = capture_state.take() {
            info!("Stopping audio capture...");
            let _ = child.kill();
            info!("Audio capture stopped");
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
    fn test_is_system_audio_available_returns_bool() {
        // Just verify it returns a boolean without panicking
        let available = is_system_audio_available();
        // On macOS 14.2+, should be true; elsewhere false
        // We can't assert the specific value since it depends on the OS
        assert!(matches!(available, true | false));
    }

    #[test]
    fn test_audio_capture_state_initialization() {
        let state = AudioCaptureState(Arc::new(Mutex::new(None)));
        let guard = state.0.lock().unwrap();
        assert!(guard.is_none());
    }
}
