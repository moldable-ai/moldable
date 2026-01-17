//! System log utilities for Moldable
//!
//! Provides access to the application log file for debugging.

use tauri::{AppHandle, Manager};

// ============================================================================
// TAURI COMMANDS
// ============================================================================

/// Get the path to the system log file
#[tauri::command]
pub fn get_system_log_path(app_handle: AppHandle) -> Result<String, String> {
    let log_dir = app_handle
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    // The log plugin creates files like "Moldable.log" in the log dir
    let log_file = log_dir.join("Moldable.log");
    Ok(log_file.to_string_lossy().to_string())
}

/// Read system logs from the log file
#[tauri::command]
pub fn get_system_logs(app_handle: AppHandle, max_lines: Option<usize>) -> Result<Vec<String>, String> {
    let log_dir = app_handle
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to get log directory: {}", e))?;

    let log_file = log_dir.join("Moldable.log");

    if !log_file.exists() {
        return Ok(vec!["No logs yet. Logs will appear here as you use the app.".to_string()]);
    }

    let content = std::fs::read_to_string(&log_file)
        .map_err(|e| format!("Failed to read log file: {}", e))?;

    let lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    // Return last N lines (default 1000)
    let max = max_lines.unwrap_or(1000);
    if lines.len() > max {
        Ok(lines[lines.len() - max..].to_vec())
    } else {
        Ok(lines)
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    #[test]
    fn test_log_line_truncation_logic() {
        // Test the truncation logic used in get_system_logs
        let lines: Vec<String> = (0..2000).map(|i| format!("Line {}", i)).collect();
        let max = 1000;
        
        let result = if lines.len() > max {
            lines[lines.len() - max..].to_vec()
        } else {
            lines.clone()
        };
        
        assert_eq!(result.len(), 1000);
        assert_eq!(result[0], "Line 1000");
        assert_eq!(result[999], "Line 1999");
    }

    #[test]
    fn test_log_line_no_truncation() {
        let lines: Vec<String> = (0..500).map(|i| format!("Line {}", i)).collect();
        let max = 1000;
        
        let result = if lines.len() > max {
            lines[lines.len() - max..].to_vec()
        } else {
            lines.clone()
        };
        
        assert_eq!(result.len(), 500);
        assert_eq!(result[0], "Line 0");
        assert_eq!(result[499], "Line 499");
    }
}
