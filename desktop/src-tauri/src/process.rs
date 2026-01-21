//! App process management for Moldable
//!
//! Handles starting, stopping, and monitoring app processes.

use crate::apps::{get_registered_apps, update_registered_app_port};
use crate::codemods::run_pending_codemods;
use crate::env::get_merged_env_vars;
use crate::install_state::{
    format_install_state_lines, read_install_state, update_install_state_safe,
};
use crate::paths::get_workspaces_config_internal;
use crate::ports::kill_process_tree;
use crate::runtime;
use crate::types::{AppInstance, AppStatus, RegisteredApp};
use log::{info, warn};
use std::collections::{HashMap, HashSet};
use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::State;

// ============================================================================
// STATE TYPES
// ============================================================================

/// Running app process with captured output
pub struct AppProcess {
    pub child: Child,
    pub output_lines: Vec<String>,
    /// The actual port the app is running on (may differ from configured port)
    pub actual_port: Option<u16>,
}

/// Inner state for app process management
pub struct AppStateInner {
    pub processes: HashMap<String, AppProcess>,
    /// Store last error/output for apps that have stopped
    pub last_errors: HashMap<String, Vec<String>>,
    /// Track auto-retry attempts for Next lock errors per app
    pub lock_retry_counts: HashMap<String, u8>,
}

/// Wrap in Arc so it can be shared across threads
pub struct AppState(pub Arc<Mutex<AppStateInner>>);

static START_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
const START_LOCK_FILE: &str = ".moldable.start.lock";
const START_LOCK_STALE_AFTER: Duration = Duration::from_secs(60);
const START_LOCK_TIMEOUT: Duration = Duration::from_secs(10);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const MAX_OUTPUT_LINES: usize = 100;

fn get_start_lock(app_id: &str) -> Arc<Mutex<()>> {
    let locks = START_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = locks
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    guard
        .entry(app_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

struct StartFileLock {
    path: PathBuf,
}

impl Drop for StartFileLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn is_lock_stale(lock_path: &Path, stale_after: Duration) -> bool {
    if let Ok(metadata) = std::fs::metadata(lock_path) {
        if let Ok(modified) = metadata.modified() {
            if let Ok(age) = SystemTime::now().duration_since(modified) {
                return age > stale_after;
            }
        }
    }
    false
}

fn acquire_start_file_lock(working_dir: &Path, app_id: &str) -> Result<StartFileLock, String> {
    let lock_path = working_dir.join(START_LOCK_FILE);
    let start = Instant::now();

    loop {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(mut file) => {
                let _ = writeln!(
                    file,
                    "pid={} started={}",
                    std::process::id(),
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs()
                );
                return Ok(StartFileLock { path: lock_path });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if is_lock_stale(&lock_path, START_LOCK_STALE_AFTER) {
                    warn!("Removing stale start lock for {}", app_id);
                    let _ = std::fs::remove_file(&lock_path);
                    continue;
                }
                if start.elapsed() >= START_LOCK_TIMEOUT {
                    return Err(format!("Timed out waiting for start lock for {}", app_id));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(format!("Failed to create start lock: {}", e)),
        }
    }
}

fn push_output_line(lines: &mut Vec<String>, line: String) {
    if lines.len() >= MAX_OUTPUT_LINES {
        lines.remove(0);
    }
    lines.push(line);
}

fn append_app_logs(state: &AppState, app_id: &str, lines: Vec<String>) {
    if lines.is_empty() {
        return;
    }

    if let Ok(mut app_state) = state.0.lock() {
        if let Some(proc) = app_state.processes.get_mut(app_id) {
            for line in lines {
                push_output_line(&mut proc.output_lines, line);
            }
            return;
        }

        let entry = app_state.last_errors.entry(app_id.to_string()).or_default();
        for line in lines {
            push_output_line(entry, line);
        }
    }
}

pub fn command_basename(command: &str) -> String {
    std::path::Path::new(command)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(command)
        .to_lowercase()
}

pub fn is_package_manager_command(command: &str) -> bool {
    matches!(
        command_basename(command).as_str(),
        "pnpm" | "npm" | "yarn" | "bun"
    )
}

pub fn upsert_flag_value(args: &mut Vec<String>, flags: &[&str], value: String) {
    for (i, arg) in args.iter().enumerate() {
        if flags.iter().any(|f| *f == arg) {
            if i + 1 < args.len() {
                args[i + 1] = value;
                return;
            }
        }
    }

    // Prefer the first flag for insertion
    let flag = flags.first().unwrap_or(&"-p");
    args.push((*flag).to_string());
    args.push(value);
}

pub fn with_script_args_forwarded(
    command: &str,
    args: Vec<String>,
    port: Option<u16>,
) -> Vec<String> {
    // We want to inject `-p <port>` such that it reaches the *app*, not the package manager.
    // For pnpm/npm/yarn/bun, that means putting app args after `--`.
    if port.is_none() {
        return args;
    }

    let port_str = port.unwrap().to_string();

    if is_package_manager_command(command) {
        if let Some(sep_idx) = args.iter().position(|a| a == "--") {
            let mut base = args[..=sep_idx].to_vec(); // include `--`
            let mut script_args = args[sep_idx + 1..].to_vec();
            upsert_flag_value(&mut script_args, &["-p", "--port"], port_str);
            base.extend(script_args);
            return base;
        }

        let mut out = args;
        out.push("--".to_string());
        out.push("-p".to_string());
        out.push(port_str);
        return out;
    }

    let mut out = args;
    upsert_flag_value(&mut out, &["-p", "--port"], port_str);
    out
}

fn is_pid_running(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn command_line_for_pid(pid: u32) -> Option<String> {
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let command = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if command.is_empty() {
        None
    } else {
        Some(command)
    }
}

fn parent_pid_for_pid(pid: u32) -> Option<u32> {
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "ppid="])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let parent_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parent_str.parse::<u32>().ok()
}

fn command_line_contains_app_path(command: &str, working_dir: &Path) -> bool {
    let path = working_dir.to_string_lossy();
    command.contains(path.as_ref())
}

fn parent_chain_contains_app_path(pid: u32, working_dir: &Path, max_depth: usize) -> bool {
    let mut current_pid = pid;
    for _ in 0..max_depth {
        let parent_pid = match parent_pid_for_pid(current_pid) {
            Some(pid) => pid,
            None => return false,
        };
        if parent_pid <= 1 || parent_pid == current_pid {
            return false;
        }

        let command = match command_line_for_pid(parent_pid) {
            Some(cmd) => cmd,
            None => return false,
        };

        if command_line_contains_app_path(&command, working_dir) {
            return true;
        }

        current_pid = parent_pid;
    }
    false
}

/// Check if a process is orphaned (PPID=1, meaning its parent died)
fn is_pid_orphaned(pid: u32) -> bool {
    parent_pid_for_pid(pid)
        .map(|ppid| ppid == 1)
        .unwrap_or(false)
}

fn is_pid_for_app(pid: u32, working_dir: &Path) -> bool {
    command_line_for_pid(pid)
        .map(|command| command_line_contains_app_path(&command, working_dir))
        .unwrap_or(false)
}

fn verify_pid_ownership(pid: u32, working_dir: &Path, lock_pid: Option<u32>) -> Result<(), String> {
    let command = command_line_for_pid(pid)
        .ok_or_else(|| format!("Unable to read command line for pid {}", pid))?;

    if command_line_contains_app_path(&command, working_dir) {
        return Ok(());
    }

    if parent_chain_contains_app_path(pid, working_dir, 8) {
        return Ok(());
    }

    if lock_pid == Some(pid) {
        return Err("PID matches Next lock but command line missing app path".to_string());
    }

    Err("Process command line does not include app path".to_string())
}

fn is_port_responding(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    // Use 1 second timeout - 200ms was too aggressive and caused false negatives
    TcpStream::connect_timeout(&addr, Duration::from_millis(1000)).is_ok()
}

fn find_responding_port_for_pid(
    working_dir: &Path,
    pid: u32,
    messages: Option<&mut Vec<String>>,
) -> Option<u16> {
    let working_dir_str = working_dir.to_string_lossy();
    let instances = read_instances_file(working_dir_str.as_ref(), messages);

    for instance in instances {
        if instance.pid != pid {
            continue;
        }
        if let Some(port) = instance.port {
            if is_port_responding(port) {
                return Some(port);
            }
        }
    }

    None
}

fn find_responding_instance_from_registry(
    working_dir: &Path,
    messages: Option<&mut Vec<String>>,
) -> Option<(u32, u16)> {
    let working_dir_str = working_dir.to_string_lossy();
    let instances = read_instances_file(working_dir_str.as_ref(), messages);

    for instance in instances {
        let port = match instance.port {
            Some(port) => port,
            None => continue,
        };
        if !is_pid_running(instance.pid) {
            continue;
        }
        if !is_port_responding(port) {
            continue;
        }
        if verify_pid_ownership(instance.pid, working_dir, None).is_err() {
            continue;
        }
        return Some((instance.pid, port));
    }

    None
}

fn find_running_instance(
    working_dir: &Path,
    messages: Option<&mut Vec<String>>,
) -> Option<(u32, u16)> {
    let working_dir_str = working_dir.to_string_lossy();
    let instances = read_instances_file(working_dir_str.as_ref(), messages);

    for instance in instances {
        if !is_pid_running(instance.pid) {
            continue;
        }
        if let Some(port) = instance.port {
            if is_port_responding(port) {
                return Some((instance.pid, port));
            }
        }
    }

    None
}

fn has_running_recorded_instance(working_dir: &Path, messages: Option<&mut Vec<String>>) -> bool {
    let working_dir_str = working_dir.to_string_lossy();
    let instances = read_instances_file(working_dir_str.as_ref(), messages);
    instances.iter().any(|instance| {
        if !is_pid_running(instance.pid) {
            return false;
        }
        if let Some(port) = instance.port {
            if is_port_responding(port) {
                return true;
            }
        }
        is_pid_for_app(instance.pid, working_dir)
    })
}

fn clear_stale_next_dev_lock(working_dir: &Path, messages: &mut Vec<String>) -> Option<String> {
    let lock_path = working_dir.join(".next").join("dev").join("lock");
    if !lock_path.exists() {
        return None;
    }

    if has_running_recorded_instance(working_dir, Some(messages)) {
        return None;
    }

    match std::fs::remove_file(&lock_path) {
        Ok(()) => Some(format!(
            "Removed stale Next dev lock at {}",
            lock_path.display()
        )),
        Err(e) => {
            warn!("Failed to remove Next dev lock at {:?}: {}", lock_path, e);
            None
        }
    }
}

/// Force cleanup of Next.js lock and any stale/orphaned processes.
/// Used when we hit a lock error and need to recover aggressively.
fn force_cleanup_next_lock(working_dir: &Path) -> Vec<String> {
    let mut messages = Vec::new();
    let working_dir_str = working_dir.to_string_lossy();
    let lock_pid = read_next_lock_pid(working_dir);
    let mut running_instances_left = false;

    // Kill any orphaned or non-responding processes for this app
    let instances = read_instances_file(working_dir_str.as_ref(), Some(&mut messages));
    for instance in instances {
        if !is_pid_running(instance.pid) {
            continue;
        }

        if let Err(reason) = verify_pid_ownership(instance.pid, working_dir, lock_pid) {
            warn!(
                "Skipping stale cleanup for pid {}: {}",
                instance.pid, reason
            );
            messages.push(format!(
                "[moldable] Startup cleanup: skipped process (pid {}) - {}",
                instance.pid, reason
            ));
            running_instances_left = true;
            continue;
        }

        let port_responding = instance
            .port
            .map(|p| is_port_responding(p))
            .unwrap_or(false);

        // Kill if orphaned OR if it has the lock but isn't responding
        if is_pid_orphaned(instance.pid) || !port_responding {
            info!(
                "Force killing stale process {} (orphaned={}, port_responding={})",
                instance.pid,
                is_pid_orphaned(instance.pid),
                port_responding
            );
            kill_process_tree(instance.pid);
            messages.push(format!(
                "[moldable] Killed stale process (pid {})",
                instance.pid
            ));
            if is_pid_running(instance.pid) {
                warn!("Failed to kill stale process {}", instance.pid);
                messages.push(format!(
                    "[moldable] Startup cleanup: failed to kill process (pid {})",
                    instance.pid
                ));
                running_instances_left = true;
            }
        } else {
            running_instances_left = true;
        }
    }

    // Clear the instances file since we're starting fresh
    let instances_path = working_dir.join(".moldable.instances.json");
    if instances_path.exists() {
        if running_instances_left {
            messages.push(
                "[moldable] Startup cleanup: instances still running; leaving registry intact"
                    .to_string(),
            );
        } else if let Err(e) = std::fs::remove_file(&instances_path) {
            warn!("Failed to remove instances file: {}", e);
        } else {
            messages.push("[moldable] Cleared stale instances file".to_string());
        }
    }

    // Force delete the lock file
    let lock_path = working_dir.join(".next").join("dev").join("lock");
    if lock_path.exists() {
        match std::fs::remove_file(&lock_path) {
            Ok(()) => {
                messages.push(format!(
                    "[moldable] Force removed Next dev lock at {}",
                    lock_path.display()
                ));
            }
            Err(e) => {
                warn!("Failed to force remove lock file: {}", e);
                // As a last resort, try deleting the entire .next/dev directory
                let dev_dir = working_dir.join(".next").join("dev");
                if dev_dir.exists() {
                    if let Err(e2) = std::fs::remove_dir_all(&dev_dir) {
                        warn!("Failed to remove .next/dev directory: {}", e2);
                    } else {
                        messages.push("[moldable] Removed .next/dev directory".to_string());
                    }
                }
            }
        }
    }

    messages
}

fn read_next_lock_pid(working_dir: &Path) -> Option<u32> {
    let lock_path = working_dir.join(".next").join("dev").join("lock");
    let content = std::fs::read_to_string(lock_path).ok()?;
    let pid_str = content.split_whitespace().next()?;
    pid_str.parse::<u32>().ok()
}

fn has_next_lock_error(lines: &[String]) -> bool {
    lines
        .iter()
        .any(|line| line.contains("Unable to acquire lock") && line.contains(".next/dev/lock"))
}

fn install_state_lines_for_path(app_path: &Path) -> Vec<String> {
    read_install_state(app_path)
        .map(|state| format_install_state_lines(&state))
        .unwrap_or_default()
}

fn handle_next_lock_before_start(
    working_dir: &Path,
    port: Option<u16>,
) -> (Vec<String>, Option<AppStatus>) {
    let mut messages = Vec::new();
    let lock_path = working_dir.join(".next").join("dev").join("lock");
    if !lock_path.exists() {
        return (messages, None);
    }

    if let Some(pid) = read_next_lock_pid(working_dir) {
        if is_pid_running(pid) {
            if let Err(reason) = verify_pid_ownership(pid, working_dir, Some(pid)) {
                warn!("Skipping Next dev cleanup for pid {}: {}", pid, reason);
                messages.push(format!(
                    "[moldable] Skipped Next dev cleanup (pid {}) - {}",
                    pid, reason
                ));
            } else {
                if let Some(p) = port {
                    if is_port_responding(p) {
                        return (
                            vec![format!(
                                "[moldable] Detected existing instance on port {}",
                                p
                            )],
                            Some(AppStatus {
                                running: true,
                                pid: Some(pid),
                                exit_code: None,
                                recent_output: Vec::new(),
                                actual_port: Some(p),
                            }),
                        );
                    }
                }

                if let Some(port) =
                    find_responding_port_for_pid(working_dir, pid, Some(&mut messages))
                {
                    return (
                        vec![format!(
                            "[moldable] Detected existing instance on port {}",
                            port
                        )],
                        Some(AppStatus {
                            running: true,
                            pid: Some(pid),
                            exit_code: None,
                            recent_output: Vec::new(),
                            actual_port: Some(port),
                        }),
                    );
                }

                if let Some((instance_pid, instance_port)) =
                    find_responding_instance_from_registry(working_dir, Some(&mut messages))
                {
                    return (
                        vec![format!(
                            "[moldable] Detected existing instance on port {}",
                            instance_port
                        )],
                        Some(AppStatus {
                            running: true,
                            pid: Some(instance_pid),
                            exit_code: None,
                            recent_output: Vec::new(),
                            actual_port: Some(instance_port),
                        }),
                    );
                }

                if is_pid_orphaned(pid) {
                    kill_process_tree(pid);
                    messages.push(format!(
                        "[moldable] Killed stale Next dev process (pid {})",
                        pid
                    ));
                } else {
                    messages.push(format!(
                        "[moldable] Detected running instance (pid {})",
                        pid
                    ));
                    return (
                        messages,
                        Some(AppStatus {
                            running: true,
                            pid: Some(pid),
                            exit_code: None,
                            recent_output: Vec::new(),
                            actual_port: None,
                        }),
                    );
                }
            }
        }
    }

    if let Some(line) = clear_stale_next_dev_lock(working_dir, &mut messages) {
        messages.push(format!("[moldable] {}", line));
    }

    (messages, None)
}

// ============================================================================
// PROCESS LIFECYCLE
// ============================================================================

/// Start an app process (internal implementation)
///
/// If `force_cleanup` is true, aggressively clean up any stale locks and processes
/// before starting. This is used on retry after lock errors.
pub fn start_app_internal(
    app_id: String,
    working_dir: String,
    command: String,
    args: Vec<String>,
    port: Option<u16>,
    state: &AppState,
) -> Result<AppStatus, String> {
    start_app_internal_with_options(app_id, working_dir, command, args, port, state, false)
}

fn start_app_internal_with_options(
    app_id: String,
    working_dir: String,
    command: String,
    args: Vec<String>,
    port: Option<u16>,
    state: &AppState,
    force_cleanup: bool,
) -> Result<AppStatus, String> {
    // Validate working directory exists
    let working_path = std::path::Path::new(&working_dir);
    if !working_path.exists() {
        return Err(format!(
            "App directory does not exist: {}. The app may need to be reinstalled.",
            working_dir
        ));
    }
    if !working_path.is_dir() {
        return Err(format!("App path is not a directory: {}", working_dir));
    }

    // Check for package.json (most apps need this)
    let package_json = working_path.join("package.json");
    if !package_json.exists() {
        return Err(format!(
            "No package.json found in app directory: {}. The app may be incomplete or corrupted.",
            working_dir
        ));
    }

    let start_lock = get_start_lock(&app_id);
    let _start_guard = start_lock
        .lock()
        .map_err(|_| "Failed to acquire start lock".to_string())?;
    let _start_file_guard = acquire_start_file_lock(working_path, &app_id)?;

    // Run any pending codemods to migrate the app to current Moldable version
    let codemod_messages = run_pending_codemods(working_path);
    for msg in &codemod_messages {
        info!("{}", msg);
    }

    // If force_cleanup is set, aggressively clean up stale state before proceeding
    let mut cleanup_messages = codemod_messages;
    if force_cleanup {
        info!(
            "Force cleanup enabled for {}, cleaning stale state...",
            app_id
        );
        cleanup_messages = force_cleanup_next_lock(working_path);
        for msg in &cleanup_messages {
            info!("{}", msg);
        }
    }

    // Ensure node_modules exists - install dependencies if needed
    if let Err(e) = runtime::ensure_node_modules_installed(working_path) {
        update_install_state_safe(
            working_path,
            &app_id,
            "dependencies",
            "error",
            Some(e.clone()),
        );
        return Err(format!(
            "Failed to install dependencies for {}: {}",
            app_id, e
        ));
    }
    update_install_state_safe(working_path, &app_id, "dependencies", "ok", None);

    let mut app_state = state.0.lock().map_err(|e| e.to_string())?;

    // Check if already running
    if let Some(app_proc) = app_state.processes.get_mut(&app_id) {
        match app_proc.child.try_wait() {
            Ok(None) => {
                // Still running
                return Ok(AppStatus {
                    running: true,
                    pid: Some(app_proc.child.id()),
                    exit_code: None,
                    recent_output: app_proc.output_lines.clone(),
                    actual_port: app_proc.actual_port,
                });
            }
            Ok(Some(_status)) => {
                // Process ended, capture final state
                let output = app_proc.output_lines.clone();
                app_state.last_errors.insert(app_id.clone(), output);
                app_state.processes.remove(&app_id);
                // Fall through to start a new one
            }
            Err(_) => {
                app_state.processes.remove(&app_id);
            }
        }
    }

    // Clear any previous errors and reset retry count
    app_state.last_errors.remove(&app_id);
    app_state.lock_retry_counts.insert(app_id.clone(), 0);

    // If we did force cleanup, skip the normal lock handling (we already cleaned up)
    let mut initial_output = cleanup_messages;
    if !force_cleanup {
        let (lock_messages, lock_status) = handle_next_lock_before_start(working_path, port);
        if let Some(status) = lock_status {
            return Ok(status);
        }

        if let Some((pid, port)) = find_running_instance(working_path, Some(&mut initial_output)) {
            return Ok(AppStatus {
                running: true,
                pid: Some(pid),
                exit_code: None,
                recent_output: vec![format!(
                    "[moldable] Detected existing instance on port {}",
                    port
                )],
                actual_port: Some(port),
            });
        }

        initial_output.extend(lock_messages);
    }

    // Ensure port flag reaches the underlying app when using pnpm/npm/yarn/bun
    let args = with_script_args_forwarded(&command, args, port);

    // Build PATH with bundled Node.js directory
    let new_path = runtime::build_runtime_path();

    // Read merged env vars (shared + workspace-specific)
    let env_vars = get_merged_env_vars();

    // Get MOLDABLE_HOME path and workspace-aware data dir
    let home = std::env::var("HOME").unwrap_or_default();
    let moldable_home = format!("{}/.moldable", home);
    let active_workspace = get_workspaces_config_internal()
        .map(|c| c.active_workspace)
        .unwrap_or_else(|_| "personal".to_string());
    let app_data_dir = format!(
        "{}/workspaces/{}/apps/{}/data",
        moldable_home, active_workspace, app_id
    );

    // Ensure app data directory exists
    let _ = std::fs::create_dir_all(&app_data_dir);

    info!(
        "Starting app {} with PATH containing node: {}",
        app_id,
        runtime::get_node_path().unwrap_or_else(|| "NOT FOUND".to_string())
    );

    // Start the process with piped stderr/stdout
    let mut cmd = Command::new(&command);
    cmd.args(&args)
        .current_dir(&working_dir)
        .env("PATH", &new_path)
        // Moldable-provided runtime vars
        .env("MOLDABLE_APP_ID", &app_id)
        .env("MOLDABLE_HOST", "127.0.0.1")
        .env("MOLDABLE_HOME", &moldable_home)
        .env("MOLDABLE_APP_DATA_DIR", &app_data_dir)
        .env("HOME", &home);

    if let Some(p) = port {
        let p_str = p.to_string();
        cmd.env("MOLDABLE_PORT", &p_str).env("PORT", &p_str);
    }

    // Add user's custom env vars (from .env files)
    for (k, v) in env_vars {
        cmd.env(k, v);
    }

    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start app: {}", e))?;

    let pid = child.id();

    // Capture stderr/stdout in background threads
    let stderr = child.stderr.take();
    let stdout = child.stdout.take();

    // Clone the Arc for the threads
    let state_arc = Arc::clone(&state.0);
    let state_arc2 = Arc::clone(&state.0);
    let app_id_for_stderr = app_id.clone();
    let app_id_for_stdout = app_id.clone();

    if let Some(stderr) = stderr {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(mut state) = state_arc.lock() {
                    if let Some(proc) = state.processes.get_mut(&app_id_for_stderr) {
                        push_output_line(&mut proc.output_lines, format!("[stderr] {}", line));
                    }
                }
            }
        });
    }

    if let Some(stdout) = stdout {
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            // Regex to detect port from Next.js/Vite output
            let port_regex = regex::Regex::new(r"localhost:(\d+)").ok();

            for line in reader.lines().map_while(Result::ok) {
                if let Ok(mut state) = state_arc2.lock() {
                    if let Some(proc) = state.processes.get_mut(&app_id_for_stdout) {
                        // Try to detect port from output
                        if proc.actual_port.is_none() {
                            if let Some(ref re) = port_regex {
                                if let Some(caps) = re.captures(&line) {
                                    if let Some(port_str) = caps.get(1) {
                                        if let Ok(detected_port) = port_str.as_str().parse::<u16>()
                                        {
                                            proc.actual_port = Some(detected_port);
                                        }
                                    }
                                }
                            }
                        }

                        push_output_line(&mut proc.output_lines, line);
                    }
                }
            }
        });
    }

    if let Some(actual_port) = port {
        match update_registered_app_port(&app_id, actual_port) {
            Ok(true) => {
                initial_output.push(format!(
                    "[moldable] Updated preferred port to {}",
                    actual_port
                ));
            }
            Ok(false) => {}
            Err(e) => {
                initial_output.push(format!(
                    "[moldable] Failed to persist preferred port: {}",
                    e
                ));
            }
        }
    }

    app_state.processes.insert(
        app_id,
        AppProcess {
            child,
            output_lines: initial_output,
            actual_port: port,
        },
    );

    Ok(AppStatus {
        running: true,
        pid: Some(pid),
        exit_code: None,
        recent_output: Vec::new(),
        actual_port: port,
    })
}

/// Kill all running app processes
pub fn cleanup_all_apps(state: &AppState) {
    if let Ok(mut app_state) = state.0.lock() {
        let app_ids: Vec<String> = app_state.processes.keys().cloned().collect();
        for app_id in app_ids {
            if let Some(mut app_proc) = app_state.processes.remove(&app_id) {
                info!("Stopping {}...", app_id);
                let pid = app_proc.child.id();
                kill_process_tree(pid);
                let _ = app_proc.child.wait();
            }
        }
        info!("All apps stopped");
    }
}

// ============================================================================
// PORT FILE HELPERS
// ============================================================================

/// Read port from .moldable.port file in app directory
pub fn read_port_file(working_dir: &str) -> Option<u16> {
    let port_file = std::path::Path::new(working_dir).join(".moldable.port");
    if port_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&port_file) {
            return content.trim().parse().ok();
        }
    }
    None
}

/// Read all instances from .moldable.instances.json in app directory
pub fn read_instances_file(
    working_dir: &str,
    messages: Option<&mut Vec<String>>,
) -> Vec<AppInstance> {
    let (instances, error) = read_instances_file_with_error(working_dir);
    if let Some(error) = error {
        log_instances_file_error(&error, messages);
    }
    instances
}

struct InstancesFileError {
    path: std::path::PathBuf,
    message: String,
}

fn read_instances_file_with_error(
    working_dir: &str,
) -> (Vec<AppInstance>, Option<InstancesFileError>) {
    let instances_file = std::path::Path::new(working_dir).join(".moldable.instances.json");
    if !instances_file.exists() {
        return (Vec::new(), None);
    }

    let content = match std::fs::read_to_string(&instances_file) {
        Ok(content) => content,
        Err(e) => {
            return (
                Vec::new(),
                Some(InstancesFileError {
                    path: instances_file,
                    message: format!("Failed to read instances file: {}", e),
                }),
            )
        }
    };

    match serde_json::from_str::<Vec<AppInstance>>(&content) {
        Ok(instances) => (instances, None),
        Err(e) => (
            Vec::new(),
            Some(InstancesFileError {
                path: instances_file,
                message: format!("Failed to parse instances file: {}", e),
            }),
        ),
    }
}

fn log_instances_file_error(error: &InstancesFileError, messages: Option<&mut Vec<String>>) {
    warn!(
        "Invalid instance registry at {}: {}",
        error.path.display(),
        error.message
    );
    if let Some(messages) = messages {
        messages.push(format!(
            "[moldable] Startup cleanup: invalid instance registry ({})",
            error.message
        ));
    }
}

/// Remove the .moldable.instances.json file
pub fn remove_instances_file(working_dir: &str) {
    let instances_file = std::path::Path::new(working_dir).join(".moldable.instances.json");
    let _ = std::fs::remove_file(instances_file);
}

/// Kill all orphaned app instances for a given app directory
pub fn cleanup_orphaned_instances(working_dir: &str) -> (usize, Vec<String>) {
    let mut messages = Vec::new();
    let instances = read_instances_file(working_dir, Some(&mut messages));
    let mut killed = 0;
    let mut killed_pids = HashSet::new();
    let mut running_instances_left = false;
    let working_path = Path::new(working_dir);
    let lock_pid = read_next_lock_pid(working_path);

    for instance in &instances {
        if is_pid_running(instance.pid) {
            if let Err(reason) = verify_pid_ownership(instance.pid, working_path, lock_pid) {
                warn!(
                    "Skipping orphan cleanup for pid {}: {}",
                    instance.pid, reason
                );
                messages.push(format!(
                    "[moldable] Startup cleanup: skipped process (pid {}) - {}",
                    instance.pid, reason
                ));
                running_instances_left = true;
                continue;
            }
            info!(
                "Killing orphaned process {} (port {:?})",
                instance.pid, instance.port
            );
            kill_process_tree(instance.pid);
            std::thread::sleep(Duration::from_millis(100));

            if is_pid_running(instance.pid) {
                warn!("Failed to kill orphaned process {}", instance.pid);
                messages.push(format!(
                    "[moldable] Startup cleanup: failed to kill process (pid {})",
                    instance.pid
                ));
                running_instances_left = true;
                continue;
            }

            killed += 1;
            killed_pids.insert(instance.pid);
            let port_note = instance
                .port
                .map(|port| format!(" on port {}", port))
                .unwrap_or_default();
            messages.push(format!(
                "[moldable] Startup cleanup: killed orphaned process (pid {}{})",
                instance.pid, port_note
            ));
        }
    }

    if !instances.is_empty() && !running_instances_left {
        remove_instances_file(working_dir);
        messages.push("[moldable] Startup cleanup: cleared instance registry".to_string());
    } else if running_instances_left {
        messages.push(
            "[moldable] Startup cleanup: instances still running; leaving registry intact"
                .to_string(),
        );
    }

    let lock_path = working_path.join(".next").join("dev").join("lock");
    if lock_path.exists() {
        let mut lock_pid_running = false;

        if let Some(pid) = read_next_lock_pid(working_path) {
            if is_pid_running(pid) {
                if let Err(reason) = verify_pid_ownership(pid, working_path, Some(pid)) {
                    warn!("Skipping Next dev cleanup for pid {}: {}", pid, reason);
                    messages.push(format!(
                        "[moldable] Startup cleanup: skipped Next dev process (pid {}) - {}",
                        pid, reason
                    ));
                    lock_pid_running = true;
                } else if !killed_pids.contains(&pid) {
                    info!("Killing Next dev process {} from lock file", pid);
                    kill_process_tree(pid);
                    std::thread::sleep(Duration::from_millis(100));

                    if is_pid_running(pid) {
                        warn!("Failed to kill Next dev process {}", pid);
                        messages.push(format!(
                            "[moldable] Startup cleanup: failed to kill Next dev process (pid {})",
                            pid
                        ));
                        lock_pid_running = true;
                    } else {
                        killed += 1;
                        killed_pids.insert(pid);
                        messages.push(format!(
                            "[moldable] Startup cleanup: killed Next dev process (pid {})",
                            pid
                        ));
                    }
                } else if is_pid_running(pid) {
                    lock_pid_running = true;
                }
            }
        }

        if !lock_pid_running {
            match std::fs::remove_file(&lock_path) {
                Ok(()) => {
                    messages.push(format!(
                        "[moldable] Startup cleanup: removed Next dev lock at {}",
                        lock_path.display()
                    ));
                }
                Err(e) => {
                    warn!("Failed to remove Next dev lock at {:?}: {}", lock_path, e);
                    let dev_dir = working_path.join(".next").join("dev");
                    if dev_dir.exists() {
                        if let Err(e2) = std::fs::remove_dir_all(&dev_dir) {
                            warn!("Failed to remove .next/dev directory: {}", e2);
                        } else {
                            messages.push(
                                "[moldable] Startup cleanup: removed .next/dev directory"
                                    .to_string(),
                            );
                        }
                    }
                }
            }
        } else {
            messages.push(
                "[moldable] Startup cleanup: Next dev lock left in place (process still running)"
                    .to_string(),
            );
        }
    }

    (killed, messages)
}

/// Clean up all orphaned instances for all registered apps
pub fn cleanup_all_orphaned_apps(
    get_apps: impl Fn() -> Result<Vec<RegisteredApp>, String>,
    state: &AppState,
) {
    let apps = match get_apps() {
        Ok(a) => a,
        Err(_) => return,
    };

    if apps.is_empty() {
        return;
    }

    info!("Checking for orphaned app instances...");
    let mut total_killed = 0;

    for app in &apps {
        let (killed, messages) = cleanup_orphaned_instances(&app.path);
        if killed > 0 {
            info!("Cleaned up {} orphaned instance(s) for {}", killed, app.id);
            total_killed += killed;
        }
        if !messages.is_empty() {
            append_app_logs(state, &app.id, messages);
        }
    }

    if total_killed > 0 {
        info!("Cleaned up {} total orphaned process(es)", total_killed);
    } else {
        info!("No orphaned processes found");
    }
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

#[tauri::command]
pub fn start_app(
    app_id: String,
    working_dir: String,
    command: String,
    args: Vec<String>,
    port: Option<u16>,
    state: State<AppState>,
) -> Result<AppStatus, String> {
    start_app_internal(app_id, working_dir, command, args, port, state.inner())
}

#[tauri::command]
pub fn stop_app(app_id: String, state: State<AppState>) -> Result<AppStatus, String> {
    let mut app_state = state.0.lock().map_err(|e| e.to_string())?;

    if let Some(mut app_proc) = app_state.processes.remove(&app_id) {
        // Save output before killing
        app_state
            .last_errors
            .insert(app_id.clone(), app_proc.output_lines.clone());

        let pid = app_proc.child.id();

        // Kill the entire process tree
        kill_process_tree(pid);

        // Wait for the main process to clean up
        let _ = app_proc.child.wait();
    }

    Ok(AppStatus {
        running: false,
        pid: None,
        exit_code: None,
        recent_output: Vec::new(),
        actual_port: None,
    })
}

#[tauri::command]
pub fn get_app_status(app_id: String, state: State<AppState>) -> Result<AppStatus, String> {
    let mut retry_plan: Option<(RegisteredApp, Option<u16>)> = None;
    let mut immediate_status: Option<AppStatus> = None;
    let mut app_state = state.0.lock().map_err(|e| e.to_string())?;

    if let Some(app_proc) = app_state.processes.get_mut(&app_id) {
        match app_proc.child.try_wait() {
            Ok(None) => {
                // Still running
                return Ok(AppStatus {
                    running: true,
                    pid: Some(app_proc.child.id()),
                    exit_code: None,
                    recent_output: app_proc.output_lines.clone(),
                    actual_port: app_proc.actual_port,
                });
            }
            Ok(Some(status)) => {
                // Process ended
                let exit_code = status.code();
                let mut output = app_proc.output_lines.clone();
                let attempted_port = app_proc.actual_port;
                app_state.last_errors.insert(app_id.clone(), output.clone());
                app_state.processes.remove(&app_id);

                if exit_code.is_some() && has_next_lock_error(&output) {
                    if let Ok(apps) = get_registered_apps() {
                        if let Some(app) = apps.into_iter().find(|a| a.id == app_id) {
                            let mut instance_messages = Vec::new();
                            if let Some((pid, port)) = find_running_instance(
                                Path::new(&app.path),
                                Some(&mut instance_messages),
                            ) {
                                instance_messages.push(format!(
                                    "[moldable] Detected existing instance on port {}",
                                    port
                                ));
                                immediate_status = Some(AppStatus {
                                    running: true,
                                    pid: Some(pid),
                                    exit_code: None,
                                    recent_output: instance_messages,
                                    actual_port: Some(port),
                                });
                            } else {
                                if !instance_messages.is_empty() {
                                    output.extend(instance_messages);
                                }
                                let attempts = app_state
                                    .lock_retry_counts
                                    .entry(app_id.clone())
                                    .or_insert(0);
                                if *attempts < 1 {
                                    *attempts += 1;
                                    retry_plan = Some((app, attempted_port));
                                }
                            }
                        }
                    }
                }

                if retry_plan.is_none() {
                    immediate_status = Some(AppStatus {
                        running: false,
                        pid: None,
                        exit_code,
                        recent_output: output,
                        actual_port: None,
                    });
                }
            }
            Err(_) => {
                app_state.processes.remove(&app_id);
            }
        }
    }

    drop(app_state);

    if let Some(status) = immediate_status {
        return Ok(status);
    }

    if let Some((app, port)) = retry_plan {
        info!(
            "Retrying app {} after Next dev lock error (with force cleanup)",
            app_id
        );
        // Use force_cleanup=true to aggressively clear stale state before retry
        match start_app_internal_with_options(
            app_id.clone(),
            app.path,
            app.command,
            app.args,
            port,
            state.inner(),
            true, // force_cleanup
        ) {
            Ok(status) => return Ok(status),
            Err(e) => {
                return Ok(AppStatus {
                    running: false,
                    pid: None,
                    exit_code: None,
                    recent_output: vec![format!("[moldable] Auto-retry failed: {}", e)],
                    actual_port: None,
                });
            }
        }
    }

    let app_state = state.0.lock().map_err(|e| e.to_string())?;

    // Check for stored errors from previous run
    let last_output = app_state
        .last_errors
        .get(&app_id)
        .cloned()
        .unwrap_or_default();

    Ok(AppStatus {
        running: false,
        pid: None,
        exit_code: None,
        recent_output: last_output,
        actual_port: None,
    })
}

#[tauri::command]
pub fn get_app_logs(app_id: String, state: State<AppState>) -> Result<Vec<String>, String> {
    let app_state = state.0.lock().map_err(|e| e.to_string())?;
    let install_lines = get_registered_apps()
        .ok()
        .and_then(|apps| apps.into_iter().find(|app| app.id == app_id))
        .map(|app| install_state_lines_for_path(Path::new(&app.path)))
        .unwrap_or_default();

    // First check running process
    if let Some(app_proc) = app_state.processes.get(&app_id) {
        let mut lines = install_lines;
        lines.extend(app_proc.output_lines.clone());
        return Ok(lines);
    }

    // Then check stored errors
    let mut lines = install_lines;
    lines.extend(
        app_state
            .last_errors
            .get(&app_id)
            .cloned()
            .unwrap_or_default(),
    );
    Ok(lines)
}

#[tauri::command]
pub fn set_app_actual_port(
    app_id: String,
    port: u16,
    state: State<AppState>,
) -> Result<(), String> {
    let mut app_state = state.0.lock().map_err(|e| e.to_string())?;

    if let Some(app_proc) = app_state.processes.get_mut(&app_id) {
        app_proc.actual_port = Some(port);
        match update_registered_app_port(&app_id, port) {
            Ok(true) => {
                app_proc
                    .output_lines
                    .push(format!("[moldable] Updated preferred port to {}", port));
            }
            Ok(false) => {}
            Err(e) => {
                app_proc.output_lines.push(format!(
                    "[moldable] Failed to persist preferred port: {}",
                    e
                ));
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn discover_app_port(
    app_id: String,
    working_dir: String,
    state: State<AppState>,
) -> Option<u16> {
    // First check if we have the port from the running process
    if let Ok(app_state) = state.0.lock() {
        if let Some(proc) = app_state.processes.get(&app_id) {
            if proc.actual_port.is_some() {
                return proc.actual_port;
            }
        }
    }

    let working_path = Path::new(&working_dir);

    // Try reading from .moldable.port file
    if let Some(port) = read_port_file(&working_dir) {
        // Verify the port is actually in use
        if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
            return Some(port);
        }
    }

    let mut instance_messages = Vec::new();
    if let Some((_, port)) = find_running_instance(working_path, Some(&mut instance_messages)) {
        if !instance_messages.is_empty() {
            append_app_logs(state.inner(), &app_id, instance_messages);
        }
        return Some(port);
    }
    if !instance_messages.is_empty() {
        append_app_logs(state.inner(), &app_id, instance_messages);
    }

    None
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::install_state::update_install_state;
    use std::fs;
    use tempfile::TempDir;

    // ==================== COMMAND BASENAME TESTS ====================

    #[test]
    fn test_command_basename_with_full_path() {
        assert_eq!(command_basename("/opt/homebrew/bin/pnpm"), "pnpm");
        assert_eq!(command_basename("/usr/local/bin/npm"), "npm");
        assert_eq!(command_basename("/usr/bin/yarn"), "yarn");
    }

    #[test]
    fn test_command_basename_with_simple_name() {
        assert_eq!(command_basename("pnpm"), "pnpm");
        assert_eq!(command_basename("npm"), "npm");
        assert_eq!(command_basename("node"), "node");
    }

    #[test]
    fn test_command_basename_case_insensitive() {
        assert_eq!(command_basename("/usr/bin/PNPM"), "pnpm");
        assert_eq!(command_basename("NPM"), "npm");
    }

    // ==================== PACKAGE MANAGER DETECTION TESTS ====================

    #[test]
    fn test_is_package_manager_command_positive() {
        assert!(is_package_manager_command("pnpm"));
        assert!(is_package_manager_command("npm"));
        assert!(is_package_manager_command("yarn"));
        assert!(is_package_manager_command("bun"));
        assert!(is_package_manager_command("/opt/homebrew/bin/pnpm"));
        assert!(is_package_manager_command("/usr/local/bin/npm"));
    }

    #[test]
    fn test_is_package_manager_command_negative() {
        assert!(!is_package_manager_command("node"));
        assert!(!is_package_manager_command("python"));
        assert!(!is_package_manager_command("/usr/bin/cargo"));
        assert!(!is_package_manager_command("next"));
    }

    // ==================== UPSERT FLAG TESTS ====================

    #[test]
    fn test_upsert_flag_value_existing_flag() {
        let mut args = vec!["-p".to_string(), "3000".to_string()];
        upsert_flag_value(&mut args, &["-p", "--port"], "4000".to_string());
        assert_eq!(args, vec!["-p", "4000"]);
    }

    #[test]
    fn test_upsert_flag_value_existing_long_flag() {
        let mut args = vec!["--port".to_string(), "3000".to_string()];
        upsert_flag_value(&mut args, &["-p", "--port"], "4000".to_string());
        assert_eq!(args, vec!["--port", "4000"]);
    }

    #[test]
    fn test_upsert_flag_value_missing_flag() {
        let mut args = vec!["dev".to_string()];
        upsert_flag_value(&mut args, &["-p", "--port"], "3001".to_string());
        assert_eq!(args, vec!["dev", "-p", "3001"]);
    }

    #[test]
    fn test_upsert_flag_value_empty_args() {
        let mut args: Vec<String> = vec![];
        upsert_flag_value(&mut args, &["-p"], "3000".to_string());
        assert_eq!(args, vec!["-p", "3000"]);
    }

    // ==================== SCRIPT ARGS FORWARDING TESTS ====================

    #[test]
    fn test_with_script_args_forwarded_no_port() {
        let args = vec!["dev".to_string()];
        let result = with_script_args_forwarded("pnpm", args.clone(), None);
        assert_eq!(result, args);
    }

    #[test]
    fn test_with_script_args_forwarded_pnpm_without_separator() {
        let args = vec!["dev".to_string()];
        let result = with_script_args_forwarded("pnpm", args, Some(3001));
        assert_eq!(result, vec!["dev", "--", "-p", "3001"]);
    }

    #[test]
    fn test_with_script_args_forwarded_pnpm_with_separator() {
        let args = vec![
            "dev".to_string(),
            "--".to_string(),
            "-p".to_string(),
            "3000".to_string(),
        ];
        let result = with_script_args_forwarded("pnpm", args, Some(3001));
        assert_eq!(result, vec!["dev", "--", "-p", "3001"]);
    }

    #[test]
    fn test_with_script_args_forwarded_npm() {
        let args = vec!["run".to_string(), "dev".to_string()];
        let result = with_script_args_forwarded("/usr/local/bin/npm", args, Some(3002));
        assert_eq!(result, vec!["run", "dev", "--", "-p", "3002"]);
    }

    #[test]
    fn test_with_script_args_forwarded_non_package_manager() {
        let args = vec!["--watch".to_string()];
        let result = with_script_args_forwarded("node", args, Some(3003));
        assert_eq!(result, vec!["--watch", "-p", "3003"]);
    }

    #[test]
    fn test_with_script_args_forwarded_full_path_pnpm() {
        let args = vec!["dev".to_string()];
        let result = with_script_args_forwarded("/opt/homebrew/bin/pnpm", args, Some(3004));
        assert_eq!(result, vec!["dev", "--", "-p", "3004"]);
    }

    #[test]
    fn test_empty_args_with_port_forwarding() {
        let args: Vec<String> = vec![];
        let result = with_script_args_forwarded("pnpm", args, Some(3000));
        assert_eq!(result, vec!["--", "-p", "3000"]);
    }

    #[test]
    fn test_args_with_multiple_separators() {
        let args = vec![
            "dev".to_string(),
            "--".to_string(),
            "extra".to_string(),
            "--".to_string(),
            "more".to_string(),
        ];
        let result = with_script_args_forwarded("pnpm", args, Some(3000));
        // Should insert -p after first --, updating existing port if present
        assert!(result.contains(&"-p".to_string()));
        assert!(result.contains(&"3000".to_string()));
    }

    // ==================== APP STATE TESTS ====================

    #[test]
    fn test_app_state_inner_default() {
        let state = AppStateInner {
            processes: HashMap::new(),
            last_errors: HashMap::new(),
            lock_retry_counts: HashMap::new(),
        };
        assert!(state.processes.is_empty());
        assert!(state.last_errors.is_empty());
        assert!(state.lock_retry_counts.is_empty());
    }

    // ==================== INSTALL STATE LOGS TESTS ====================

    fn create_temp_dir(prefix: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("{}_{}", prefix, nanos));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn test_install_state_lines_for_path_missing() {
        let temp_dir = create_temp_dir("moldable-install-lines-missing");
        let lines = install_state_lines_for_path(&temp_dir);
        assert!(lines.is_empty());
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_install_state_lines_for_path_error() {
        let temp_dir = create_temp_dir("moldable-install-lines-error");
        update_install_state(
            &temp_dir,
            "app-id",
            "dependencies",
            "error",
            Some("pnpm failed".to_string()),
        )
        .unwrap();

        let lines = install_state_lines_for_path(&temp_dir);
        assert!(lines.iter().any(|line| line.contains("stage=dependencies")));
        assert!(lines.iter().any(|line| line.contains("error=pnpm failed")));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_install_state_lines_for_path_ok() {
        let temp_dir = create_temp_dir("moldable-install-lines-ok");
        update_install_state(&temp_dir, "app-id", "complete", "ok", None).unwrap();

        let lines = install_state_lines_for_path(&temp_dir);
        assert!(lines.is_empty());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_verify_pid_ownership_rejects_unrelated_process() {
        let temp_dir = TempDir::new().unwrap();
        let mut child = Command::new("sleep").arg("2").spawn().unwrap();
        let pid = child.id();

        let result = verify_pid_ownership(pid, temp_dir.path(), None);

        let _ = child.kill();
        let _ = child.wait();

        assert!(result.is_err());
    }

    #[test]
    fn test_start_lock_is_shared_per_app() {
        let first = get_start_lock("app-a");
        let second = get_start_lock("app-a");
        let other = get_start_lock("app-b");

        assert!(Arc::ptr_eq(&first, &second));
        assert!(!Arc::ptr_eq(&first, &other));
    }

    #[test]
    fn test_cleanup_orphaned_instances_logs_invalid_registry() {
        let temp_dir = TempDir::new().unwrap();
        let instances_path = temp_dir.path().join(".moldable.instances.json");
        fs::write(&instances_path, "not-json").unwrap();

        let (_killed, messages) =
            cleanup_orphaned_instances(temp_dir.path().to_string_lossy().as_ref());

        assert!(messages
            .iter()
            .any(|line| line.contains("invalid instance registry")));
    }

    // ==================== NEXT LOCK CLEANUP TESTS ====================

    #[test]
    fn test_has_next_lock_error_detects_message() {
        let lines = vec![
            "[stderr] ⨯ Unable to acquire lock at /tmp/app/.next/dev/lock, is another instance of next dev running?".to_string(),
        ];
        assert!(has_next_lock_error(&lines));
    }

    #[test]
    fn test_has_next_lock_error_ignores_other_errors() {
        let lines = vec![
            "[stderr] Error: spawn next ENOENT".to_string(),
            "Some other log".to_string(),
        ];
        assert!(!has_next_lock_error(&lines));
    }

    #[test]
    fn test_clear_stale_next_dev_lock_removes_when_no_instances() {
        let temp_dir = create_temp_dir("moldable-next-lock-clear");
        let lock_path = temp_dir.join(".next").join("dev");
        fs::create_dir_all(&lock_path).unwrap();
        fs::write(lock_path.join("lock"), "locked").unwrap();

        let mut messages = Vec::new();
        let result = clear_stale_next_dev_lock(&temp_dir, &mut messages);
        assert!(result.is_some());
        assert!(!lock_path.join("lock").exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_clear_stale_next_dev_lock_keeps_when_instance_running() {
        let temp_dir = create_temp_dir("moldable-next-lock-keep");
        let lock_path = temp_dir.join(".next").join("dev");
        fs::create_dir_all(&lock_path).unwrap();
        fs::write(lock_path.join("lock"), "locked").unwrap();

        // Bind to a real port so is_port_responding returns true
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let instances = serde_json::json!([{
            "pid": std::process::id(),
            "port": port,
            "startedAt": "2026-01-01T00:00:00Z"
        }]);
        fs::write(
            temp_dir.join(".moldable.instances.json"),
            serde_json::to_string(&instances).unwrap(),
        )
        .unwrap();

        let mut messages = Vec::new();
        let result = clear_stale_next_dev_lock(&temp_dir, &mut messages);
        assert!(result.is_none());
        assert!(lock_path.join("lock").exists());

        drop(listener);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_find_running_instance_returns_port() {
        let temp_dir = create_temp_dir("moldable-instance-port");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let instances = serde_json::json!([{
            "pid": std::process::id(),
            "port": port,
            "startedAt": "2026-01-01T00:00:00Z"
        }]);
        fs::write(
            temp_dir.join(".moldable.instances.json"),
            serde_json::to_string(&instances).unwrap(),
        )
        .unwrap();

        let instance = find_running_instance(&temp_dir, None);
        assert_eq!(instance.map(|(_, p)| p), Some(port));

        drop(listener);
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_read_next_lock_pid_parses() {
        let temp_dir = create_temp_dir("moldable-next-lock-pid");
        let lock_path = temp_dir.join(".next").join("dev");
        fs::create_dir_all(&lock_path).unwrap();
        fs::write(lock_path.join("lock"), "12345").unwrap();

        let pid = read_next_lock_pid(&temp_dir);
        assert_eq!(pid, Some(12345));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_handle_next_lock_removes_when_pid_missing() {
        let temp_dir = create_temp_dir("moldable-next-lock-remove");
        let lock_path = temp_dir.join(".next").join("dev");
        fs::create_dir_all(&lock_path).unwrap();
        fs::write(lock_path.join("lock"), "999999").unwrap();

        let (messages, status) = handle_next_lock_before_start(&temp_dir, Some(4000));
        assert!(status.is_none());
        assert!(!messages.is_empty());
        assert!(!lock_path.join("lock").exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_handle_next_lock_returns_running_when_port_unresponsive() {
        let temp_dir = create_temp_dir("moldable-next-lock-running");
        let lock_path = temp_dir.join(".next").join("dev");
        fs::create_dir_all(&lock_path).unwrap();

        let app_file = temp_dir.join("dummy.log");
        fs::write(&app_file, "test".as_bytes()).unwrap();
        let mut child = Command::new("tail")
            .arg("-f")
            .arg(&app_file)
            .spawn()
            .unwrap();

        fs::write(lock_path.join("lock"), child.id().to_string()).unwrap();

        let (messages, status) = handle_next_lock_before_start(&temp_dir, Some(4000));
        assert!(status.is_some());
        let status = status.unwrap();
        assert!(status.running);
        assert_eq!(status.pid, Some(child.id()));
        assert!(!messages.is_empty());
        assert!(is_pid_running(child.id()));

        let _ = child.kill();
        let _ = child.wait();
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_find_running_instance_skips_without_port() {
        let temp_dir = create_temp_dir("moldable-instance-no-port");
        let instances = serde_json::json!([{
            "pid": std::process::id(),
            "port": null,
            "startedAt": "2026-01-01T00:00:00Z"
        }]);
        fs::write(
            temp_dir.join(".moldable.instances.json"),
            serde_json::to_string(&instances).unwrap(),
        )
        .unwrap();

        let instance = find_running_instance(&temp_dir, None);
        assert!(instance.is_none());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    // ==================== ORPHAN DETECTION TESTS ====================

    #[test]
    fn test_is_pid_orphaned_returns_false_for_current_process() {
        // Current process has a parent (the test runner), not init (PID 1)
        let current_pid = std::process::id();
        assert!(!is_pid_orphaned(current_pid));
    }

    #[test]
    fn test_is_pid_orphaned_returns_false_for_nonexistent_pid() {
        // Non-existent PID should return false (not orphaned, just doesn't exist)
        assert!(!is_pid_orphaned(999999));
    }

    // ==================== FORCE CLEANUP TESTS ====================

    #[test]
    fn test_force_cleanup_removes_lock_and_instances() {
        let temp_dir = create_temp_dir("moldable-force-cleanup");

        // Create lock file
        let lock_path = temp_dir.join(".next").join("dev");
        fs::create_dir_all(&lock_path).unwrap();
        fs::write(lock_path.join("lock"), "12345").unwrap();

        // Create instances file with a non-existent PID
        let instances = serde_json::json!([{
            "pid": 999999,
            "port": 4000,
            "startedAt": "2026-01-01T00:00:00Z"
        }]);
        fs::write(
            temp_dir.join(".moldable.instances.json"),
            serde_json::to_string(&instances).unwrap(),
        )
        .unwrap();

        let messages = force_cleanup_next_lock(&temp_dir);

        // Should have cleaned up lock file
        assert!(!lock_path.join("lock").exists());
        // Should have cleaned up instances file
        assert!(!temp_dir.join(".moldable.instances.json").exists());
        // Should have generated messages about cleanup
        assert!(!messages.is_empty());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_force_cleanup_handles_empty_directory() {
        let temp_dir = create_temp_dir("moldable-force-cleanup-empty");

        // No lock file, no instances file
        let messages = force_cleanup_next_lock(&temp_dir);

        // Should complete without error, possibly with no messages
        assert!(messages.is_empty());

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
