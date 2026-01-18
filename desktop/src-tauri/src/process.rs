//! App process management for Moldable
//!
//! Handles starting, stopping, and monitoring app processes.

use crate::env::get_merged_env_vars;
use crate::paths::get_workspaces_config_internal;
use crate::ports::kill_process_tree;
use crate::runtime;
use crate::types::{AppInstance, AppStatus, RegisteredApp};
use log::{info, warn};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
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
}

/// Wrap in Arc so it can be shared across threads
pub struct AppState(pub Arc<Mutex<AppStateInner>>);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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

pub fn with_script_args_forwarded(command: &str, args: Vec<String>, port: Option<u16>) -> Vec<String> {
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

// ============================================================================
// PROCESS LIFECYCLE
// ============================================================================

/// Start an app process (internal implementation)
pub fn start_app_internal(
    app_id: String,
    working_dir: String,
    command: String,
    args: Vec<String>,
    port: Option<u16>,
    state: &AppState,
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

    // Ensure node_modules exists - install dependencies if needed
    if let Err(e) = runtime::ensure_node_modules_installed(working_path) {
        warn!("Failed to ensure node_modules for {}: {}", app_id, e);
        // Don't fail - the app might still work, or will show a clearer error
    }

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

    // Clear any previous errors
    app_state.last_errors.remove(&app_id);

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
                        // Keep last 100 lines
                        if proc.output_lines.len() >= 100 {
                            proc.output_lines.remove(0);
                        }
                        proc.output_lines.push(format!("[stderr] {}", line));
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
                        // Keep last 100 lines
                        if proc.output_lines.len() >= 100 {
                            proc.output_lines.remove(0);
                        }

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

                        proc.output_lines.push(line);
                    }
                }
            }
        });
    }

    app_state.processes.insert(
        app_id,
        AppProcess {
            child,
            output_lines: Vec::new(),
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
pub fn read_instances_file(working_dir: &str) -> Vec<AppInstance> {
    let instances_file = std::path::Path::new(working_dir).join(".moldable.instances.json");
    if instances_file.exists() {
        if let Ok(content) = std::fs::read_to_string(&instances_file) {
            if let Ok(instances) = serde_json::from_str::<Vec<AppInstance>>(&content) {
                return instances;
            }
        }
    }
    Vec::new()
}

/// Remove the .moldable.instances.json file
pub fn remove_instances_file(working_dir: &str) {
    let instances_file = std::path::Path::new(working_dir).join(".moldable.instances.json");
    let _ = std::fs::remove_file(instances_file);
}

/// Kill all orphaned app instances for a given app directory
pub fn cleanup_orphaned_instances(working_dir: &str) -> usize {
    let instances = read_instances_file(working_dir);
    let mut killed = 0;

    for instance in &instances {
        // Check if process is still running
        let is_running = Command::new("kill")
            .args(["-0", &instance.pid.to_string()])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if is_running {
            info!(
                "Killing orphaned process {} (port {:?})",
                instance.pid, instance.port
            );
            kill_process_tree(instance.pid);
            killed += 1;
        }
    }

    // Clean up the instances file
    if !instances.is_empty() {
        remove_instances_file(working_dir);
    }

    killed
}

/// Clean up all orphaned instances for all registered apps
pub fn cleanup_all_orphaned_apps(get_apps: impl Fn() -> Result<Vec<RegisteredApp>, String>) {
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
        let killed = cleanup_orphaned_instances(&app.path);
        if killed > 0 {
            info!("Cleaned up {} orphaned instance(s) for {}", killed, app.id);
            total_killed += killed;
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
                let output = app_proc.output_lines.clone();
                app_state.last_errors.insert(app_id.clone(), output.clone());
                app_state.processes.remove(&app_id);

                return Ok(AppStatus {
                    running: false,
                    pid: None,
                    exit_code,
                    recent_output: output,
                    actual_port: None,
                });
            }
            Err(_) => {
                app_state.processes.remove(&app_id);
            }
        }
    }

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

    // First check running process
    if let Some(app_proc) = app_state.processes.get(&app_id) {
        return Ok(app_proc.output_lines.clone());
    }

    // Then check stored errors
    Ok(app_state
        .last_errors
        .get(&app_id)
        .cloned()
        .unwrap_or_default())
}

#[tauri::command]
pub fn set_app_actual_port(app_id: String, port: u16, state: State<AppState>) -> Result<(), String> {
    let mut app_state = state.0.lock().map_err(|e| e.to_string())?;

    if let Some(app_proc) = app_state.processes.get_mut(&app_id) {
        app_proc.actual_port = Some(port);
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

    // Try reading from .moldable.port file
    if let Some(port) = read_port_file(&working_dir) {
        // Verify the port is actually in use
        if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
            return Some(port);
        }
    }

    None
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

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
        };
        assert!(state.processes.is_empty());
        assert!(state.last_errors.is_empty());
    }
}
