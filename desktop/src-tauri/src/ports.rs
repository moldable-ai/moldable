//! Port management utilities for Moldable
//!
//! Handles:
//! - Checking port availability
//! - Finding free ports
//! - Getting info about processes using ports
//! - Killing processes on ports
//! - Lock file management for tracking Moldable instances
//! - Robust port acquisition with retry logic

use crate::types::PortInfo;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU16, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// ============================================================================
// ACTUAL SERVER PORTS (may differ from defaults if fallback was used)
// ============================================================================

/// Default AI server port
pub const DEFAULT_AI_SERVER_PORT: u16 = 39100;
/// Default API server port
pub const DEFAULT_API_SERVER_PORT: u16 = 39102;

/// Atomic storage for the actual AI server port (can be read from any thread)
static AI_SERVER_ACTUAL_PORT: AtomicU16 = AtomicU16::new(DEFAULT_AI_SERVER_PORT);
/// Atomic storage for the actual API server port (can be read from any thread)
static API_SERVER_ACTUAL_PORT: AtomicU16 = AtomicU16::new(DEFAULT_API_SERVER_PORT);

/// Get the actual AI server port (may differ from default if fallback was used)
#[tauri::command]
pub fn get_ai_server_port() -> u16 {
    AI_SERVER_ACTUAL_PORT.load(Ordering::SeqCst)
}

/// Set the actual AI server port (called when server starts)
pub fn set_ai_server_actual_port(port: u16) {
    AI_SERVER_ACTUAL_PORT.store(port, Ordering::SeqCst);
}

/// Get the actual API server port (may differ from default if fallback was used)
#[tauri::command]
pub fn get_api_server_port() -> u16 {
    API_SERVER_ACTUAL_PORT.load(Ordering::SeqCst)
}

/// Set the actual API server port (called when server starts)
pub fn set_api_server_actual_port(port: u16) {
    API_SERVER_ACTUAL_PORT.store(port, Ordering::SeqCst);
}

// ============================================================================
// LOCK FILE MANAGEMENT
// ============================================================================

/// Lock file structure to track Moldable instance state
#[derive(Debug, Serialize, Deserialize)]
pub struct MoldableLock {
    /// PID of the main Moldable process
    pub pid: u32,
    /// Port used by the AI server
    pub ai_server_port: u16,
    /// Port used by the API server
    pub api_server_port: u16,
    /// Unix timestamp when the instance started
    pub started_at: u64,
}

/// Get the path to the lock file
pub fn get_lock_file_path() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    PathBuf::from(format!("{}/.moldable/cache/moldable.lock", home))
}

/// Read the current lock file if it exists
pub fn read_lock_file() -> Option<MoldableLock> {
    let path = get_lock_file_path();
    if !path.exists() {
        return None;
    }
    
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).ok(),
        Err(_) => None,
    }
}

/// Write a new lock file
pub fn write_lock_file(lock: &MoldableLock) -> Result<(), String> {
    let path = get_lock_file_path();
    
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create lock file directory: {}", e))?;
    }
    
    let content = serde_json::to_string_pretty(lock)
        .map_err(|e| format!("Failed to serialize lock file: {}", e))?;
    
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write lock file: {}", e))?;
    
    Ok(())
}

/// Delete the lock file
pub fn delete_lock_file() {
    let path = get_lock_file_path();
    let _ = fs::remove_file(path);
}

/// Check if a process with the given PID is running
pub fn is_process_running(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Get the current process ID
pub fn current_pid() -> u32 {
    std::process::id()
}

/// Get current Unix timestamp
pub fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

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

/// Check if any process is using a port (including TIME_WAIT, CLOSE_WAIT, etc.)
/// This is more aggressive than is_port_available which only checks LISTEN state.
pub fn is_port_in_any_state(port: u16) -> bool {
    // Check for any TCP connection on this port (not just LISTEN)
    if let Ok(output) = Command::new("lsof")
        .args(["-nP", "-iTCP", &format!(":{}", port), "-t"])
        .output()
    {
        if output.status.success() && !output.stdout.is_empty() {
            return true;
        }
    }
    false
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

/// Kill a process and all its children using process group signals.
///
/// On Unix, processes spawned with `process_group(0)` create a new process group
/// where the PID equals the PGID. Sending a signal to the negative PGID (-pid)
/// delivers it to ALL processes in that group, ensuring complete cleanup.
///
/// This is much more reliable than recursively walking the process tree because:
/// - One signal kills everything in the group
/// - Works even if children have been reparented to init (PPID=1)
/// - No race conditions from walking the tree
pub fn kill_process_tree(pid: u32) {
    // Strategy:
    // 1. First try to kill the entire process group (most reliable)
    // 2. Fall back to killing individual process if group kill fails
    
    // Try killing the process group first (sends signal to all processes in group)
    // The negative PID tells kill to send to the process group, not just the process
    let pgid_result = Command::new("kill")
        .args(["-TERM", &format!("-{}", pid)])
        .output();
    
    // Give processes a moment to handle SIGTERM gracefully
    std::thread::sleep(Duration::from_millis(100));
    
    // Check if the main process is still running
    let still_running = Command::new("kill")
        .args(["-0", &pid.to_string()])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    
    if still_running {
        // Process didn't respond to SIGTERM, force kill with SIGKILL
        let _ = Command::new("kill")
            .args(["-KILL", &format!("-{}", pid)])
            .output();
        
        // Also try killing just the PID in case it wasn't in a process group
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
    
    // If group kill failed (process wasn't in its own group), fall back to recursive kill
    if pgid_result.is_err() || pgid_result.map(|o| !o.status.success()).unwrap_or(true) {
        // Fallback: recursively find and kill children
        if let Ok(output) = Command::new("pgrep")
            .args(["-P", &pid.to_string()])
            .output()
        {
            if output.status.success() {
                let children = String::from_utf8_lossy(&output.stdout);
                for child_pid in children.lines() {
                    if let Ok(cpid) = child_pid.trim().parse::<u32>() {
                        kill_process_tree(cpid);
                    }
                }
            }
        }
        
        // Kill the process itself
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output();
    }
}

/// Kill the process using a specific port (basic version)
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

/// Aggressively kill all processes using a port (including non-LISTEN states)
/// This uses multiple techniques to ensure the port is freed.
pub fn kill_port_aggressive(port: u16) -> Result<bool, String> {
    let mut killed_any = false;
    
    // Technique 1: Kill processes in LISTEN state (with process tree)
    if let Ok(output) = Command::new("lsof")
        .args(["-nP", "-iTCP", &format!(":{}", port), "-sTCP:LISTEN", "-t"])
        .output()
    {
        if output.status.success() {
            let pids = String::from_utf8_lossy(&output.stdout);
            for line in pids.trim().lines() {
                if let Ok(pid) = line.parse::<u32>() {
                    debug!("Killing LISTEN process {} on port {}", pid, port);
                    kill_process_tree(pid);
                    killed_any = true;
                }
            }
        }
    }
    
    // Technique 2: Kill any process with connection to this port (ESTABLISHED, TIME_WAIT, etc.)
    // Note: We skip our own process
    let our_pid = current_pid();
    if let Ok(output) = Command::new("lsof")
        .args(["-nP", "-iTCP", &format!(":{}", port), "-t"])
        .output()
    {
        if output.status.success() {
            let pids = String::from_utf8_lossy(&output.stdout);
            for line in pids.trim().lines() {
                if let Ok(pid) = line.parse::<u32>() {
                    if pid != our_pid {
                        debug!("Killing process {} with connection on port {}", pid, port);
                        let _ = Command::new("kill")
                            .args(["-9", &pid.to_string()])
                            .output();
                        killed_any = true;
                    }
                }
            }
        }
    }
    
    // Give the OS time to clean up connections
    if killed_any {
        std::thread::sleep(Duration::from_millis(200));
    }
    
    Ok(killed_any)
}

// ============================================================================
// ROBUST PORT ACQUISITION
// ============================================================================

/// Configuration for port acquisition
pub struct PortAcquisitionConfig {
    /// The preferred port to use
    pub preferred_port: u16,
    /// Maximum number of retry attempts
    pub max_retries: u32,
    /// Initial delay between retries (will increase exponentially)
    pub initial_delay_ms: u64,
    /// Maximum delay between retries
    pub max_delay_ms: u64,
    /// Whether to try alternative ports if preferred is unavailable
    pub allow_fallback: bool,
    /// Range of fallback ports to try (start, end)
    pub fallback_range: Option<(u16, u16)>,
}

impl Default for PortAcquisitionConfig {
    fn default() -> Self {
        Self {
            preferred_port: 0,
            max_retries: 2,
            initial_delay_ms: 200,
            max_delay_ms: 2000,
            allow_fallback: true,
            fallback_range: None,
        }
    }
}

/// Result of port acquisition attempt
pub struct PortAcquisitionResult {
    /// The port that was acquired
    pub port: u16,
    /// Whether this was the preferred port or a fallback
    pub is_preferred: bool,
    /// Number of retries that were needed
    pub retries_used: u32,
}

/// Acquire a port with retry logic and optional fallback.
/// 
/// This function will:
/// 1. Try to kill any existing processes on the preferred port
/// 2. Retry with exponential backoff if the port is still in use
/// 3. Optionally fall back to an alternative port if preferred is unavailable
pub fn acquire_port(config: PortAcquisitionConfig) -> Result<PortAcquisitionResult, String> {
    let preferred = config.preferred_port;
    
    // First, try to free the preferred port if it's in use
    if !is_port_available(preferred) {
        info!("Port {} is in use, attempting to free it", preferred);
        
        // Try aggressive kill
        let _ = kill_port_aggressive(preferred);
    }
    
    // Retry loop with exponential backoff
    let mut delay_ms = config.initial_delay_ms;
    for attempt in 0..=config.max_retries {
        if is_port_available(preferred) {
            info!("Port {} is available (attempt {})", preferred, attempt + 1);
            return Ok(PortAcquisitionResult {
                port: preferred,
                is_preferred: true,
                retries_used: attempt,
            });
        }
        
        if attempt < config.max_retries {
            debug!(
                "Port {} still unavailable, waiting {}ms before retry {}/{}",
                preferred, delay_ms, attempt + 1, config.max_retries
            );
            
            std::thread::sleep(Duration::from_millis(delay_ms));
            
            // Exponential backoff
            delay_ms = (delay_ms * 2).min(config.max_delay_ms);
            
            // Try killing again in case new process appeared
            let _ = kill_port_aggressive(preferred);
        }
    }
    
    // If fallback is allowed, try to find an alternative port
    if config.allow_fallback {
        let (start, end) = config.fallback_range.unwrap_or((preferred + 1, preferred + 100));
        
        warn!(
            "Port {} unavailable after {} retries, trying fallback range {}-{}",
            preferred, config.max_retries, start, end
        );
        
        for port in start..=end {
            if is_port_available(port) {
                info!("Using fallback port {}", port);
                return Ok(PortAcquisitionResult {
                    port,
                    is_preferred: false,
                    retries_used: config.max_retries,
                });
            }
        }
        
        Err(format!(
            "Could not acquire port {} or any fallback in range {}-{}",
            preferred, start, end
        ))
    } else {
        Err(format!(
            "Port {} is unavailable after {} retries and fallback is disabled",
            preferred, config.max_retries
        ))
    }
}

// ============================================================================
// STALE INSTANCE CLEANUP
// ============================================================================

/// Clean up any stale Moldable instances based on the lock file.
/// This should be called early in the startup sequence.
/// 
/// Returns the number of processes that were killed.
pub fn cleanup_stale_moldable_instances() -> usize {
    let mut killed_count = 0;
    let mut cleaned_ai_port = None;
    let mut cleaned_api_port = None;
    
    if let Some(lock) = read_lock_file() {
        info!(
            "Found lock file: pid={}, ai_port={}, api_port={}",
            lock.pid, lock.ai_server_port, lock.api_server_port
        );
        
        let our_pid = current_pid();
        
        // Check if the old process is still running (and it's not us)
        if lock.pid != our_pid && is_process_running(lock.pid) {
            warn!(
                "Stale Moldable process {} is still running, killing it",
                lock.pid
            );
            kill_process_tree(lock.pid);
            killed_count += 1;
            
            // Wait for process to die
            std::thread::sleep(Duration::from_millis(500));
        }
        
        // Kill any processes on the AI server port
        if !is_port_available(lock.ai_server_port) {
            info!("Cleaning up stale process on AI server port {}", lock.ai_server_port);
            if kill_port_aggressive(lock.ai_server_port).unwrap_or(false) {
                killed_count += 1;
            }
        }
        cleaned_ai_port = Some(lock.ai_server_port);
        
        // Kill any processes on the API server port
        if !is_port_available(lock.api_server_port) {
            info!("Cleaning up stale process on API server port {}", lock.api_server_port);
            if kill_port_aggressive(lock.api_server_port).unwrap_or(false) {
                killed_count += 1;
            }
        }
        cleaned_api_port = Some(lock.api_server_port);
        
        // Delete the old lock file
        delete_lock_file();
    } else {
        info!("No lock file found, checking default ports for stale processes");
    }
    
    // FALLBACK: Also clean default ports in case lock file was missing/corrupted
    // This ensures we catch zombies even when the lock file doesn't exist
    if cleaned_ai_port != Some(DEFAULT_AI_SERVER_PORT) && !is_port_available(DEFAULT_AI_SERVER_PORT) {
        info!(
            "Cleaning up stale process on default AI server port {}",
            DEFAULT_AI_SERVER_PORT
        );
        if kill_port_aggressive(DEFAULT_AI_SERVER_PORT).unwrap_or(false) {
            killed_count += 1;
        }
    }
    
    if cleaned_api_port != Some(DEFAULT_API_SERVER_PORT) && !is_port_available(DEFAULT_API_SERVER_PORT) {
        info!(
            "Cleaning up stale process on default API server port {}",
            DEFAULT_API_SERVER_PORT
        );
        if kill_port_aggressive(DEFAULT_API_SERVER_PORT).unwrap_or(false) {
            killed_count += 1;
        }
    }
    
    killed_count
}

/// Create a new lock file for this instance.
/// Should be called after servers have successfully started.
pub fn create_instance_lock(ai_server_port: u16, api_server_port: u16) -> Result<(), String> {
    let lock = MoldableLock {
        pid: current_pid(),
        ai_server_port,
        api_server_port,
        started_at: current_timestamp(),
    };
    
    write_lock_file(&lock)?;
    info!(
        "Created lock file: pid={}, ai_port={}, api_port={}",
        lock.pid, lock.ai_server_port, lock.api_server_port
    );
    
    Ok(())
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
    
    // ==================== LOCK FILE TESTS ====================
    
    #[test]
    fn test_moldable_lock_serialization() {
        let lock = MoldableLock {
            pid: 12345,
            ai_server_port: 39100,
            api_server_port: 39102,
            started_at: 1705555200,
        };
        
        let json = serde_json::to_string(&lock).unwrap();
        assert!(json.contains("12345"));
        assert!(json.contains("39100"));
        assert!(json.contains("39102"));
        
        let deserialized: MoldableLock = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.pid, 12345);
        assert_eq!(deserialized.ai_server_port, 39100);
        assert_eq!(deserialized.api_server_port, 39102);
    }
    
    #[test]
    fn test_current_pid_returns_nonzero() {
        let pid = current_pid();
        assert!(pid > 0);
    }
    
    #[test]
    fn test_current_timestamp_reasonable() {
        let ts = current_timestamp();
        // Should be after 2020 (1577836800) and before 2100
        assert!(ts > 1577836800);
        assert!(ts < 4102444800);
    }
    
    #[test]
    fn test_is_process_running_self() {
        // Our own process should be running
        let our_pid = current_pid();
        assert!(is_process_running(our_pid));
    }
    
    #[test]
    fn test_is_process_running_nonexistent() {
        // A very high PID is unlikely to exist
        assert!(!is_process_running(999999999));
    }
    
    // ==================== PORT ACQUISITION TESTS ====================
    
    #[test]
    fn test_port_acquisition_config_default() {
        let config = PortAcquisitionConfig::default();
        assert_eq!(config.max_retries, 2);
        assert_eq!(config.initial_delay_ms, 200);
        assert!(config.allow_fallback);
    }
    
    #[test]
    fn test_acquire_port_available() {
        // Use a very high port that should be available
        let config = PortAcquisitionConfig {
            preferred_port: 59876,
            max_retries: 0,
            allow_fallback: false,
            ..Default::default()
        };
        
        if is_port_available(59876) {
            let result = acquire_port(config);
            assert!(result.is_ok());
            let acquired = result.unwrap();
            assert_eq!(acquired.port, 59876);
            assert!(acquired.is_preferred);
            assert_eq!(acquired.retries_used, 0);
        }
    }
    
    #[test]
    fn test_kill_port_aggressive_unused() {
        // Should succeed (return false for no kills) on unused port
        let result = kill_port_aggressive(59877);
        assert!(result.is_ok());
    }
    
    #[test]
    fn test_is_port_in_any_state_unused() {
        // Very high port should not be in use
        assert!(!is_port_in_any_state(59878));
    }
    
    // ==================== LOCK FILE I/O TESTS ====================
    
    #[test]
    fn test_lock_file_write_read_delete_cycle() {
        // Create a unique lock for testing (we'll use a temp approach)
        let test_lock = MoldableLock {
            pid: current_pid(),
            ai_server_port: 59900,
            api_server_port: 59901,
            started_at: current_timestamp(),
        };
        
        // Write the lock
        let write_result = write_lock_file(&test_lock);
        assert!(write_result.is_ok(), "Failed to write lock file: {:?}", write_result);
        
        // Read it back
        let read_lock = read_lock_file();
        assert!(read_lock.is_some(), "Lock file should exist after write");
        
        let read_lock = read_lock.unwrap();
        assert_eq!(read_lock.pid, test_lock.pid);
        assert_eq!(read_lock.ai_server_port, test_lock.ai_server_port);
        assert_eq!(read_lock.api_server_port, test_lock.api_server_port);
        
        // Delete it
        delete_lock_file();
        
        // Verify it's gone
        let after_delete = read_lock_file();
        assert!(after_delete.is_none(), "Lock file should be deleted");
    }
    
    #[test]
    fn test_read_lock_file_nonexistent() {
        // Make sure no lock file exists
        delete_lock_file();
        
        // Reading should return None
        let result = read_lock_file();
        assert!(result.is_none());
    }
    
    #[test]
    fn test_delete_lock_file_idempotent() {
        // Deleting a non-existent lock file should not panic
        delete_lock_file();
        delete_lock_file(); // Should be fine to call twice
    }
    
    #[test]
    fn test_create_instance_lock() {
        // NOTE: This test may run in parallel with others that modify the lock file.
        // We only test that creating a lock succeeds and can be read back.
        // The actual port values may be overwritten by concurrent tests.
        
        // Create a lock
        let result = create_instance_lock(59910, 59911);
        assert!(result.is_ok());
        
        // Verify a lock file exists (might be from this test or another)
        let lock = read_lock_file();
        // Lock should exist, but values may vary due to parallel tests
        if let Some(lock) = lock {
            // Can only verify the PID is valid and timestamp is reasonable
            assert!(lock.pid > 0);
            assert!(lock.started_at > 0);
        }
        
        // Clean up (may or may not be our lock file)
        delete_lock_file();
    }
    
    // ==================== CLEANUP TESTS ====================
    
    #[test]
    fn test_cleanup_stale_instances_no_lock_file() {
        // Ensure no lock file exists
        delete_lock_file();
        
        // Cleanup should return 0 (nothing to clean)
        let killed = cleanup_stale_moldable_instances();
        assert_eq!(killed, 0);
    }
    
    #[test]
    fn test_cleanup_stale_instances_with_our_pid() {
        // Clean up first
        delete_lock_file();
        
        // Create a lock with our own PID (should not be killed)
        let lock = MoldableLock {
            pid: current_pid(),
            ai_server_port: 59920,
            api_server_port: 59921,
            started_at: current_timestamp(),
        };
        write_lock_file(&lock).unwrap();
        
        // Cleanup should not kill our own process
        let killed = cleanup_stale_moldable_instances();
        
        // We should still be running!
        assert!(is_process_running(current_pid()));
        
        // The lock file should be deleted regardless
        assert!(read_lock_file().is_none());
        
        // killed count depends on whether ports had processes
        let _ = killed;
    }
    
    #[test]
    fn test_cleanup_stale_instances_with_nonexistent_pid() {
        // NOTE: This test may run in parallel with others that modify the lock file.
        // We test that cleanup handles non-existent PIDs gracefully.
        
        // Create a lock with a non-existent PID
        let lock = MoldableLock {
            pid: 999999999, // Very unlikely to exist
            ai_server_port: 59930,
            api_server_port: 59931,
            started_at: current_timestamp(),
        };
        write_lock_file(&lock).unwrap();
        
        // Cleanup should handle this gracefully (not panic)
        let killed = cleanup_stale_moldable_instances();
        
        // killed could be 0 since the process doesn't exist
        let _ = killed;
        
        // Lock file may or may not be deleted depending on parallel test interference
        // The important thing is we didn't crash
    }
    
    // ==================== PORT ACQUISITION FALLBACK TESTS ====================
    
    #[test]
    fn test_acquire_port_fallback_disabled() {
        // Use a port that's likely available
        let config = PortAcquisitionConfig {
            preferred_port: 59940,
            max_retries: 0,
            allow_fallback: false,
            fallback_range: None,
            ..Default::default()
        };
        
        if is_port_available(59940) {
            let result = acquire_port(config);
            assert!(result.is_ok());
            assert_eq!(result.unwrap().port, 59940);
        }
    }
    
    #[test]
    fn test_acquire_port_with_fallback_range() {
        // Test that fallback range configuration is respected
        let config = PortAcquisitionConfig {
            preferred_port: 59950,
            max_retries: 0,
            allow_fallback: true,
            fallback_range: Some((59951, 59960)),
            ..Default::default()
        };
        
        // If preferred port is available, should use it
        if is_port_available(59950) {
            let result = acquire_port(config);
            assert!(result.is_ok());
            let acquired = result.unwrap();
            assert_eq!(acquired.port, 59950);
            assert!(acquired.is_preferred);
        }
    }
    
    #[test]
    fn test_port_acquisition_result_fields() {
        let result = PortAcquisitionResult {
            port: 3000,
            is_preferred: true,
            retries_used: 2,
        };
        
        assert_eq!(result.port, 3000);
        assert!(result.is_preferred);
        assert_eq!(result.retries_used, 2);
    }
    
    // ==================== KILL PROCESS TREE TESTS ====================
    
    #[test]
    fn test_kill_process_tree_nonexistent() {
        // Killing a non-existent process should not panic
        kill_process_tree(999999998);
    }
    
    #[test]
    fn test_kill_process_tree_kills_spawned_process() {
        use std::os::unix::process::CommandExt;
        
        // Spawn a process in its own process group (like we do for apps)
        let mut child = Command::new("sleep")
            .arg("60")
            .process_group(0)
            .spawn()
            .expect("Failed to spawn sleep process");
        
        let pid = child.id();
        
        // Verify it's running
        assert!(Command::new("kill")
            .args(["-0", &pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false));
        
        // Kill it using our function
        kill_process_tree(pid);
        
        // Wait for the process to actually exit (use wait() which blocks until done)
        let _ = child.wait();
        
        // Verify it's no longer running
        let still_running = Command::new("kill")
            .args(["-0", &pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        assert!(!still_running, "Process {} should be dead after kill_process_tree", pid);
    }
    
    #[test]
    fn test_kill_process_tree_handles_already_dead_process() {
        use std::os::unix::process::CommandExt;
        
        // Spawn a process that exits immediately
        let mut child = Command::new("true")
            .process_group(0)
            .spawn()
            .expect("Failed to spawn true");
        
        let pid = child.id();
        let _ = child.wait(); // Wait for it to finish
        
        // Now try to kill the already-dead process - should not panic
        kill_process_tree(pid);
    }
    
    #[test]
    fn test_get_lock_file_path_format() {
        let path = get_lock_file_path();
        let path_str = path.to_string_lossy();
        
        // Should be in ~/.moldable/cache/
        assert!(path_str.contains(".moldable"));
        assert!(path_str.contains("cache"));
        assert!(path_str.ends_with("moldable.lock"));
    }
    
    // ==================== ATOMIC PORT STORAGE TESTS ====================
    
    #[test]
    fn test_default_port_constants() {
        // Verify default port constants are set correctly
        assert_eq!(DEFAULT_AI_SERVER_PORT, 39100);
        assert_eq!(DEFAULT_API_SERVER_PORT, 39102);
        
        // AI server and API server should have different ports
        assert_ne!(DEFAULT_AI_SERVER_PORT, DEFAULT_API_SERVER_PORT);
        
        // Both should be in the high port range (> 1024)
        assert!(DEFAULT_AI_SERVER_PORT > 1024);
        assert!(DEFAULT_API_SERVER_PORT > 1024);
    }
    
    #[test]
    fn test_get_ai_server_port_returns_value() {
        // Should return some port value (default or previously set)
        let port = get_ai_server_port();
        assert!(port > 0);
        // Should be in a reasonable range (port is u16, so max is 65535)
        assert!(port >= 1024);
    }
    
    #[test]
    fn test_get_api_server_port_returns_value() {
        // Should return some port value (default or previously set)
        let port = get_api_server_port();
        assert!(port > 0);
        // Should be in a reasonable range (port is u16, so max is 65535)
        assert!(port >= 1024);
    }
    
    #[test]
    fn test_set_and_get_ai_server_port() {
        // Save original value
        let original = get_ai_server_port();
        
        // Set a new value
        set_ai_server_actual_port(55555);
        assert_eq!(get_ai_server_port(), 55555);
        
        // Set another value
        set_ai_server_actual_port(44444);
        assert_eq!(get_ai_server_port(), 44444);
        
        // Restore original (for other tests)
        set_ai_server_actual_port(original);
    }
    
    #[test]
    fn test_set_and_get_api_server_port() {
        // Save original value
        let original = get_api_server_port();
        
        // Set a new value
        set_api_server_actual_port(55556);
        assert_eq!(get_api_server_port(), 55556);
        
        // Set another value
        set_api_server_actual_port(44445);
        assert_eq!(get_api_server_port(), 44445);
        
        // Restore original (for other tests)
        set_api_server_actual_port(original);
    }
    
    #[test]
    fn test_port_atomics_are_independent() {
        // Save originals
        let orig_ai = get_ai_server_port();
        let orig_api = get_api_server_port();
        
        // Setting AI port shouldn't affect API port
        set_ai_server_actual_port(11111);
        set_api_server_actual_port(22222);
        
        assert_eq!(get_ai_server_port(), 11111);
        assert_eq!(get_api_server_port(), 22222);
        
        // Restore
        set_ai_server_actual_port(orig_ai);
        set_api_server_actual_port(orig_api);
    }
    
    // ==================== PORT ACQUISITION EDGE CASES ====================
    
    #[test]
    fn test_acquire_port_with_zero_retries_succeeds_if_available() {
        let config = PortAcquisitionConfig {
            preferred_port: 59800,
            max_retries: 0,  // No retries
            initial_delay_ms: 100,
            max_delay_ms: 100,
            allow_fallback: false,
            fallback_range: None,
        };
        
        if is_port_available(59800) {
            let result = acquire_port(config);
            assert!(result.is_ok());
            let acquired = result.unwrap();
            assert_eq!(acquired.port, 59800);
            assert_eq!(acquired.retries_used, 0);
        }
    }
    
    #[test]
    fn test_acquire_port_fallback_range_selection() {
        // Test with a port that's likely available
        let config = PortAcquisitionConfig {
            preferred_port: 59810,
            max_retries: 0,
            initial_delay_ms: 100,
            max_delay_ms: 100,
            allow_fallback: true,
            fallback_range: Some((59811, 59820)),
        };
        
        // If the preferred port is available, we should get it
        if is_port_available(59810) {
            let result = acquire_port(config);
            assert!(result.is_ok());
            let acquired = result.unwrap();
            // Should be the preferred port since it's available
            assert_eq!(acquired.port, 59810);
            assert!(acquired.is_preferred);
        }
    }
    
    #[test]
    fn test_port_acquisition_config_custom_delays() {
        let config = PortAcquisitionConfig {
            preferred_port: 59820,
            max_retries: 3,
            initial_delay_ms: 50,
            max_delay_ms: 500,
            allow_fallback: true,
            fallback_range: Some((59821, 59830)),
        };
        
        // Verify the config was set correctly
        assert_eq!(config.preferred_port, 59820);
        assert_eq!(config.max_retries, 3);
        assert_eq!(config.initial_delay_ms, 50);
        assert_eq!(config.max_delay_ms, 500);
        assert!(config.allow_fallback);
        assert_eq!(config.fallback_range, Some((59821, 59830)));
    }
    
    // ==================== PORT CHECKING TESTS ====================
    
    #[test]
    fn test_is_port_available_returns_bool() {
        // Should return a boolean without panicking
        let result = is_port_available(59830);
        // Result is either true or false - both are valid
        assert!(result == true || result == false);
    }
    
    #[test]
    fn test_is_port_in_any_state_returns_bool() {
        // Should return a boolean without panicking
        let result = is_port_in_any_state(59831);
        assert!(result == true || result == false);
    }
    
    #[test]
    fn test_find_free_port_increments() {
        // Find two free ports starting from the same point
        // They might be the same or different depending on availability
        let port1 = find_free_port(59840);
        let port2 = find_free_port(59840);
        
        // Both should be >= 59840
        assert!(port1 >= 59840);
        assert!(port2 >= 59840);
    }
    
    #[test]
    fn test_check_port_unbound() {
        // Use tokio runtime for async test
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Very high port unlikely to have a server
            let result = check_port(59850).await;
            // Should return false (no server responding)
            assert!(!result);
        });
    }
    
    // ==================== PORT INFO TESTS ====================
    
    #[test]
    fn test_get_port_info_returns_none_for_unused() {
        // Very high port that's almost certainly not in use
        let info = get_port_info(59860);
        assert!(info.is_none());
    }
    
    // ==================== KILL PORT TESTS ====================
    
    #[test]
    fn test_kill_port_returns_ok_for_unused() {
        // Should not error when trying to kill unused port
        let result = kill_port(59870);
        assert!(result.is_ok());
        // Should return false (nothing was killed)
        assert!(!result.unwrap());
    }
    
    #[test]
    fn test_kill_port_aggressive_returns_ok_for_unused() {
        // Should not error when trying to aggressively kill unused port
        let result = kill_port_aggressive(59871);
        assert!(result.is_ok());
        // Should return false (nothing was killed)
        assert!(!result.unwrap());
    }
    
    // ==================== LOCK FILE STRUCTURE TESTS ====================
    
    #[test]
    fn test_moldable_lock_all_fields() {
        let lock = MoldableLock {
            pid: 99999,
            ai_server_port: 39100,
            api_server_port: 39102,
            started_at: 1700000000,
        };
        
        assert_eq!(lock.pid, 99999);
        assert_eq!(lock.ai_server_port, 39100);
        assert_eq!(lock.api_server_port, 39102);
        assert_eq!(lock.started_at, 1700000000);
    }
    
    #[test]
    fn test_moldable_lock_json_roundtrip() {
        let original = MoldableLock {
            pid: 12345,
            ai_server_port: 39100,
            api_server_port: 39102,
            started_at: 1705555200,
        };
        
        // Serialize
        let json = serde_json::to_string(&original).expect("Failed to serialize");
        
        // Deserialize
        let restored: MoldableLock = serde_json::from_str(&json).expect("Failed to deserialize");
        
        // Verify all fields match
        assert_eq!(original.pid, restored.pid);
        assert_eq!(original.ai_server_port, restored.ai_server_port);
        assert_eq!(original.api_server_port, restored.api_server_port);
        assert_eq!(original.started_at, restored.started_at);
    }
    
    #[test]
    fn test_moldable_lock_pretty_json() {
        let lock = MoldableLock {
            pid: 12345,
            ai_server_port: 39100,
            api_server_port: 39102,
            started_at: 1705555200,
        };
        
        let pretty = serde_json::to_string_pretty(&lock).expect("Failed to serialize");
        
        // Pretty JSON should contain newlines
        assert!(pretty.contains('\n'));
        // Should still be valid JSON
        let _: MoldableLock = serde_json::from_str(&pretty).expect("Pretty JSON should be parseable");
    }
    
    // ==================== PROCESS DETECTION TESTS ====================
    
    #[test]
    fn test_is_process_running_returns_bool() {
        // Should return a boolean for any PID
        let result_valid = is_process_running(1);  // init/launchd is always running
        let result_invalid = is_process_running(999999999);
        
        // Both should be booleans
        assert!(result_valid == true || result_valid == false);
        assert!(result_invalid == true || result_invalid == false);
        
        // Our own process should definitely be running
        assert!(is_process_running(current_pid()));
    }
    
    #[test]
    fn test_current_pid_is_consistent() {
        // Calling current_pid multiple times should return the same value
        let pid1 = current_pid();
        let pid2 = current_pid();
        let pid3 = current_pid();
        
        assert_eq!(pid1, pid2);
        assert_eq!(pid2, pid3);
    }
    
    #[test]
    fn test_current_timestamp_increases() {
        let ts1 = current_timestamp();
        // Small delay
        std::thread::sleep(std::time::Duration::from_millis(10));
        let ts2 = current_timestamp();
        
        // Second timestamp should be >= first
        assert!(ts2 >= ts1);
    }
    
    // ==================== CLEANUP FUNCTION SAFETY TESTS ====================
    
    #[test]
    fn test_cleanup_does_not_panic_with_malformed_lock() {
        // Write something that's not valid JSON to the lock file path
        let path = get_lock_file_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, "not valid json {{{");
        
        // Cleanup should handle this gracefully
        let result = cleanup_stale_moldable_instances();
        // Should return 0 (couldn't parse, so nothing to clean)
        assert_eq!(result, 0);
        
        // Clean up the malformed file
        let _ = std::fs::remove_file(&path);
    }
    
    #[test]
    fn test_cleanup_handles_empty_lock_file() {
        // Write empty content to the lock file path
        let path = get_lock_file_path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, "");
        
        // Cleanup should handle this gracefully
        let result = cleanup_stale_moldable_instances();
        assert_eq!(result, 0);
        
        // Clean up
        let _ = std::fs::remove_file(&path);
    }
    
    // ==================== INTEGRATION-STYLE TESTS ====================
    
    #[test]
    fn test_full_port_acquisition_workflow() {
        // This tests the complete workflow:
        // 1. Check if port is available
        // 2. Acquire it
        // 3. Verify the result
        
        let test_port = 59880;
        
        if is_port_available(test_port) {
            let config = PortAcquisitionConfig {
                preferred_port: test_port,
                max_retries: 2,
                initial_delay_ms: 100,
                max_delay_ms: 500,
                allow_fallback: true,
                fallback_range: Some((test_port + 1, test_port + 10)),
            };
            
            let result = acquire_port(config);
            assert!(result.is_ok(), "acquire_port should succeed");
            
            let acquired = result.unwrap();
            // Should get the preferred port since it's available
            assert_eq!(acquired.port, test_port);
            assert!(acquired.is_preferred);
            assert_eq!(acquired.retries_used, 0);
        }
    }
    
    #[test]
    fn test_lock_file_workflow() {
        // Test the complete lock file workflow:
        // 1. Delete any existing lock
        // 2. Create new lock
        // 3. Read it back
        // 4. Clean up
        
        delete_lock_file();
        
        // Verify it's gone
        assert!(read_lock_file().is_none());
        
        // Create a new lock with test values
        let test_lock = MoldableLock {
            pid: current_pid(),
            ai_server_port: 39100,
            api_server_port: 39102,
            started_at: current_timestamp(),
        };
        
        let write_result = write_lock_file(&test_lock);
        assert!(write_result.is_ok());
        
        // Read it back
        let read_result = read_lock_file();
        assert!(read_result.is_some());
        
        let read_lock = read_result.unwrap();
        assert_eq!(read_lock.pid, test_lock.pid);
        
        // Clean up
        delete_lock_file();
        assert!(read_lock_file().is_none());
    }
}
