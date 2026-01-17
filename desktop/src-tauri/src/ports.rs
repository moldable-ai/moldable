//! Port management utilities for Moldable
//!
//! Handles:
//! - Checking port availability
//! - Finding free ports
//! - Getting info about processes using ports
//! - Killing processes on ports

use crate::types::PortInfo;
use std::net::TcpListener;
use std::process::Command;

// ============================================================================
// PORT AVAILABILITY
// ============================================================================

/// Check if a port is available for binding (not in use).
///
/// IMPORTANT: We intentionally avoid binding `0.0.0.0` here because doing so can
/// trigger the macOS firewall prompt for the Moldable app itself.
#[tauri::command]
pub fn is_port_available(port: u16) -> bool {
    // First, try the most reliable check: ask the OS if anything is LISTENing.
    // This avoids edge cases where bind checks can be misleading across interfaces.
    if let Ok(output) = Command::new("lsof")
        .args([
            "-nP",
            "-iTCP",
            &format!(":{}", port),
            "-sTCP:LISTEN",
            "-t",
        ])
        .output()
    {
        if output.status.success() && !output.stdout.is_empty() {
            return false;
        }
    }

    // Fallback bind checks (loopback only)
    let ipv4_available = TcpListener::bind(format!("127.0.0.1:{}", port)).is_ok();
    let ipv6_available = TcpListener::bind(format!("[::1]:{}", port)).is_ok();

    ipv4_available && ipv6_available
}

/// Find an available port starting from the given port
/// Checks IPv4, IPv6, and all-interfaces to ensure Next.js can bind
#[tauri::command]
pub fn find_free_port(start_port: u16) -> u16 {
    let mut port: u32 = start_port as u32;
    loop {
        if port > u16::MAX as u32 {
            return start_port; // Fallback
        }

        let candidate = port as u16;
        if is_port_available(candidate) {
            return candidate;
        }
        port += 1;
    }
}

/// Check if a port is responding (has a listening server)
#[tauri::command]
pub async fn check_port(port: u16) -> bool {
    use tokio::net::TcpStream;
    use tokio::time::{timeout, Duration};

    let addr = format!("127.0.0.1:{}", port);
    // Use a short timeout (200ms) to avoid blocking
    match timeout(Duration::from_millis(200), TcpStream::connect(&addr)).await {
        Ok(Ok(_)) => true,
        _ => false,
    }
}

// ============================================================================
// PORT INFORMATION
// ============================================================================

/// Get information about what process is using a port
#[tauri::command]
pub fn get_port_info(port: u16) -> Option<PortInfo> {
    // Use lsof to find process using port (macOS/Linux)
    // Don't filter by TCP state to catch all listeners including IPv6
    let output = Command::new("lsof")
        .args(["-i", &format!(":{}", port), "-t"])
        .output()
        .ok()?;

    if !output.status.success() || output.stdout.is_empty() {
        return None;
    }

    let pid_str = String::from_utf8_lossy(&output.stdout);
    let pid: u32 = pid_str.trim().lines().next()?.parse().ok()?;

    // Get process name using ps
    let ps_output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "comm=,args="])
        .output()
        .ok()?;

    let ps_str = String::from_utf8_lossy(&ps_output.stdout);
    let mut parts = ps_str.trim().splitn(2, ' ');
    let process_name = parts.next().map(|s| s.to_string());
    let command = parts.next().map(|s| s.to_string());

    Some(PortInfo {
        port,
        pid: Some(pid),
        process_name,
        command,
    })
}

// ============================================================================
// PROCESS KILLING
// ============================================================================

/// Kill a process and all its children recursively
pub fn kill_process_tree(pid: u32) {
    // First, find and kill all child processes
    // Use pgrep to find children, then kill them recursively
    if let Ok(output) = Command::new("pgrep")
        .args(["-P", &pid.to_string()])
        .output()
    {
        if output.status.success() {
            let children = String::from_utf8_lossy(&output.stdout);
            for child_pid in children.lines() {
                if let Ok(cpid) = child_pid.trim().parse::<u32>() {
                    // Recursively kill children first
                    kill_process_tree(cpid);
                }
            }
        }
    }

    // Now kill this process
    let _ = Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output();
}

/// Kill the process using a specific port
#[tauri::command]
pub fn kill_port(port: u16) -> Result<bool, String> {
    // Use lsof to find process using port
    let output = Command::new("lsof")
        .args(["-i", &format!(":{}", port), "-t", "-sTCP:LISTEN"])
        .output()
        .map_err(|e| format!("Failed to run lsof: {}", e))?;

    if !output.status.success() {
        return Ok(false); // No process found
    }

    let pid_str = String::from_utf8_lossy(&output.stdout);

    // Kill each PID found
    let mut killed_any = false;
    for line in pid_str.trim().lines() {
        if let Ok(pid) = line.parse::<u32>() {
            let kill_result = Command::new("kill")
                .args(["-9", &pid.to_string()])
                .output();

            if kill_result.is_ok() {
                killed_any = true;
            }
        }
    }

    // Give the OS a moment to clean up
    std::thread::sleep(std::time::Duration::from_millis(100));

    Ok(killed_any)
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_port_available_high_port() {
        // Test a very high port that's likely available
        // Use a random high port to minimize conflicts
        let port = 59123;
        let result = is_port_available(port);
        // We can't guarantee the port is available, but the function shouldn't panic
        let _ = result;
    }

    #[test]
    fn test_find_free_port_returns_valid_port() {
        let port = find_free_port(50000);
        assert!(port >= 50000);
        // port is u16, so it's always <= 65535
    }

    #[test]
    fn test_get_port_info_unused_port() {
        // Very high port unlikely to be in use
        let info = get_port_info(59999);
        // Should return None for unused port
        assert!(info.is_none());
    }

    #[test]
    fn test_kill_port_unused() {
        // Should return Ok(false) for unused port
        let result = kill_port(59998);
        assert!(result.is_ok());
        assert!(!result.unwrap());
    }
}
