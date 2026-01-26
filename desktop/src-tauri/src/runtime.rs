//! Runtime dependency management for Moldable
//!
//! This module provides access to the bundled Node.js and pnpm runtime.
//! 
//! # Design Principles
//! 
//! 1. **Bundled runtime is primary** - Node.js and pnpm are bundled with the app
//! 2. **Just works** - No user configuration needed, no PATH issues
//! 3. **Fallback for dev** - In development, can use system Node if bundled not available

use log::{info, error, warn};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use crate::paths::get_home_dir;

// ============================================================================
// TYPES
// ============================================================================

/// Where Node.js is coming from (for diagnostics)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeSource {
    /// Bundled with the app (Contents/Resources/node/)
    Bundled,
    /// System fallback (for development)
    System,
}

/// Status of the runtime (for diagnostics)
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub node_installed: bool,
    pub node_version: Option<String>,
    pub node_path: Option<String>,
    pub node_source: Option<NodeSource>,
    pub pnpm_installed: bool,
    pub pnpm_version: Option<String>,
    pub pnpm_path: Option<String>,
}

// ============================================================================
// BUNDLED RUNTIME PATHS
// ============================================================================

/// Get the bundled Node.js bin directory path
/// 
/// On macOS:
/// - Production: Moldable.app/Contents/Resources/node/bin/
/// - Development: desktop/src-tauri/resources/node/bin/
pub fn get_bundled_node_bin_dir() -> Option<String> {
    let node_name = if cfg!(target_os = "windows") { "node.exe" } else { "node" };

    let resolve_from_resources = |resources_dir: &Path| -> Option<PathBuf> {
        let bin_dir = resources_dir.join("node").join("bin");
        if bin_dir.join(node_name).exists() {
            return Some(bin_dir);
        }

        let root_dir = resources_dir.join("node");
        if root_dir.join(node_name).exists() {
            return Some(root_dir);
        }

        None
    };

    if let Ok(resource_dir) = std::env::var("MOLDABLE_RESOURCE_DIR") {
        let base = PathBuf::from(resource_dir);
        if let Some(dir) = resolve_from_resources(&base) {
            return Some(dir.to_string_lossy().to_string());
        }
    }

    // Try to find via current executable (production)
    if let Ok(exe_path) = std::env::current_exe() {
        // On macOS: /path/to/Moldable.app/Contents/MacOS/Moldable
        // Resources are at: /path/to/Moldable.app/Contents/Resources/
        if let Some(exe_dir) = exe_path.parent() {
            if let Some(contents_dir) = exe_dir.parent() {
                let resources_dir = contents_dir.join("Resources");
                if let Some(dir) = resolve_from_resources(&resources_dir) {
                    return Some(dir.to_string_lossy().to_string());
                }
            }

            let resources_dir = exe_dir.join("resources");
            if let Some(dir) = resolve_from_resources(&resources_dir) {
                return Some(dir.to_string_lossy().to_string());
            }
        }
    }
    
    // In development, check CARGO_MANIFEST_DIR
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let dev_node_dir = PathBuf::from(&manifest_dir)
            .join("resources")
            .join("node");
        let dev_bin_dir = dev_node_dir.join("bin");
        if dev_bin_dir.join(node_name).exists() {
            return Some(dev_bin_dir.to_string_lossy().to_string());
        }
        if dev_node_dir.join(node_name).exists() {
            return Some(dev_node_dir.to_string_lossy().to_string());
        }
    }
    
    None
}

/// Get the path to the bundled node binary
pub fn get_node_path() -> Option<String> {
    let node_name = if cfg!(target_os = "windows") { "node.exe" } else { "node" };

    // 1. Try bundled node first (always preferred)
    if let Some(bin_dir) = get_bundled_node_bin_dir() {
        let node_path = PathBuf::from(&bin_dir).join(node_name);
        if node_path.exists() {
            return Some(node_path.to_string_lossy().to_string());
        }
    }
    
    // 2. Fallback to system node (for development without bundled runtime)
    #[cfg(target_os = "windows")]
    let system_paths = [
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
    ];

    #[cfg(not(target_os = "windows"))]
    let system_paths = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];

    for path in system_paths {
        if Path::new(path).exists() {
            if let Ok(output) = Command::new(path).arg("--version").output() {
                if output.status.success() {
                    return Some(path.to_string());
                }
            }
        }
    }

    if let Ok(output) = Command::new("node").arg("--version").output() {
        if output.status.success() {
            return Some("node".to_string());
        }
    }
    
    None
}

/// Get the path to the bundled pnpm binary
pub fn get_pnpm_path() -> Option<String> {
    let pnpm_candidates = if cfg!(target_os = "windows") {
        vec!["pnpm.cmd", "pnpm.exe"]
    } else {
        vec!["pnpm"]
    };

    // 1. Try bundled pnpm first
    if let Some(bin_dir) = get_bundled_node_bin_dir() {
        for candidate in &pnpm_candidates {
            let pnpm_path = PathBuf::from(&bin_dir).join(candidate);
            if pnpm_path.exists() {
                return Some(pnpm_path.to_string_lossy().to_string());
            }
        }
    }
    
    // 2. Fallback to system pnpm
    let home = get_home_dir()
        .ok()
        .and_then(|p| p.to_str().map(|s| s.to_string()))
        .unwrap_or_default();
    let mut system_paths = vec![
        format!("{home}/.local/share/pnpm/pnpm"),
        "/opt/homebrew/bin/pnpm".to_string(),
        "/usr/local/bin/pnpm".to_string(),
    ];

    if cfg!(target_os = "windows") {
        if let Ok(app_data) = std::env::var("APPDATA") {
            system_paths.push(format!("{app_data}\\pnpm\\pnpm.cmd"));
            system_paths.push(format!("{app_data}\\pnpm\\pnpm.exe"));
        }
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            system_paths.push(format!("{local_app_data}\\pnpm\\pnpm.exe"));
            system_paths.push(format!("{local_app_data}\\pnpm\\pnpm.cmd"));
        }
    }
    
    for path in system_paths {
        if Path::new(&path).exists() {
            return Some(path);
        }
    }

    if cfg!(target_os = "windows") {
        if let Ok(output) = Command::new("pnpm").arg("--version").output() {
            if output.status.success() {
                return Some("pnpm".to_string());
            }
        }
    }
    
    None
}

/// Get the path to npm (for installing pnpm if needed)
#[allow(dead_code)]
pub fn get_npm_path() -> Option<String> {
    let npm_candidates = if cfg!(target_os = "windows") {
        vec!["npm.cmd", "npm.exe"]
    } else {
        vec!["npm"]
    };

    // 1. Try bundled npm first
    if let Some(bin_dir) = get_bundled_node_bin_dir() {
        for candidate in &npm_candidates {
            let npm_path = PathBuf::from(&bin_dir).join(candidate);
            if npm_path.exists() {
                return Some(npm_path.to_string_lossy().to_string());
            }
        }
    }
    
    // 2. Fallback to system npm
    #[cfg(target_os = "windows")]
    let system_paths = [
        r"C:\Program Files\nodejs\npm.cmd",
        r"C:\Program Files (x86)\nodejs\npm.cmd",
    ];

    #[cfg(not(target_os = "windows"))]
    let system_paths = ["/opt/homebrew/bin/npm", "/usr/local/bin/npm", "/usr/bin/npm"];

    for path in system_paths {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    
    None
}

// ============================================================================
// PATH BUILDING
// ============================================================================

/// Build PATH environment variable for running Node.js processes
/// 
/// This ensures spawned processes can find node and pnpm regardless of
/// the user's shell configuration.
pub fn build_runtime_path() -> String {
    let mut path_parts: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    
    // 1. Bundled node directory (always first)
    if let Some(bundled_bin) = get_bundled_node_bin_dir() {
        let bin_path = PathBuf::from(bundled_bin);
        let key = bin_path.to_string_lossy().to_string();
        if seen.insert(key) {
            path_parts.push(bin_path);
        }
    }
    
    // 2. Common system paths
    let system_paths = if cfg!(target_os = "windows") {
        vec![
            r"C:\Windows\System32",
            r"C:\Windows",
            r"C:\Windows\System32\WindowsPowerShell\v1.0",
            r"C:\Program Files\nodejs",
            r"C:\Program Files (x86)\nodejs",
        ]
    } else {
        vec![
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
        ]
    };
    
    for path in system_paths {
        let buf = PathBuf::from(path);
        let key = buf.to_string_lossy().to_string();
        if seen.insert(key) {
            path_parts.push(buf);
        }
    }
    
    // 3. Append existing PATH
    if let Some(existing_path) = std::env::var_os("PATH") {
        for part in std::env::split_paths(&existing_path) {
            if part.as_os_str().is_empty() {
                continue;
            }
            let key = part.to_string_lossy().to_string();
            if seen.insert(key) {
                path_parts.push(part);
            }
        }
    }

    std::env::join_paths(path_parts)
        .ok()
        .and_then(|p| p.into_string().ok())
        .unwrap_or_default()
}

// ============================================================================
// DEPENDENCY STATUS
// ============================================================================

/// Check runtime status (for diagnostics)
pub fn check_dependencies() -> DependencyStatus {
    let mut status = DependencyStatus {
        node_installed: false,
        node_version: None,
        node_path: None,
        node_source: None,
        pnpm_installed: false,
        pnpm_version: None,
        pnpm_path: None,
    };
    
    // Check Node.js
    if let Some(node_path) = get_node_path() {
        if let Some(version) = get_command_version(&node_path, "--version") {
            status.node_installed = true;
            status.node_version = Some(version);
            status.node_path = Some(node_path.clone());
            
            // Determine source
            if let Some(bundled) = get_bundled_node_bin_dir() {
                if node_path.starts_with(&bundled) {
                    status.node_source = Some(NodeSource::Bundled);
                } else {
                    status.node_source = Some(NodeSource::System);
                }
            } else {
                status.node_source = Some(NodeSource::System);
            }
        }
    }
    
    // Check pnpm
    if let Some(pnpm_path) = get_pnpm_path() {
        // pnpm needs node in PATH to run
        let path = build_runtime_path();
        if let Ok(output) = command_for_path(&pnpm_path)
            .arg("--version")
            .env("PATH", &path)
            .output()
        {
            if output.status.success() {
                if let Ok(version) = String::from_utf8(output.stdout) {
                    status.pnpm_installed = true;
                    status.pnpm_version = Some(version.trim().to_string());
                    status.pnpm_path = Some(pnpm_path);
                }
            }
        }
    }
    
    status
}

/// Get version from a command
fn get_command_version(cmd_path: &str, arg: &str) -> Option<String> {
    command_for_path(cmd_path)
        .arg(arg)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn command_for_path(cmd_path: &str) -> Command {
    #[cfg(target_os = "windows")]
    {
        if cmd_path.ends_with(".cmd") || cmd_path.ends_with(".bat") {
            let mut cmd = Command::new("cmd");
            cmd.args(["/d", "/s", "/c", cmd_path]);
            return cmd;
        }
    }

    Command::new(cmd_path)
}

// ============================================================================
// APP SETUP
// ============================================================================

/// Ensure pnpm is available, return path to pnpm binary
pub fn ensure_pnpm_installed() -> Result<String, String> {
    // Check if pnpm is already available
    if let Some(pnpm_path) = get_pnpm_path() {
        info!("pnpm found at: {}", pnpm_path);
        return Ok(pnpm_path);
    }
    
    // pnpm should be bundled - if not found, something is wrong
    error!("pnpm not found! It should be bundled with the app.");
    Err("pnpm not found. Please reinstall Moldable.".to_string())
}

fn read_package_json(app_dir: &Path) -> Option<serde_json::Value> {
    let package_json_path = app_dir.join("package.json");
    let content = std::fs::read_to_string(package_json_path).ok()?;
    serde_json::from_str(&content).ok()
}

fn has_next_dependency(package_json: &serde_json::Value) -> bool {
    for key in ["dependencies", "devDependencies"] {
        if let Some(dep_map) = package_json.get(key).and_then(|v| v.as_object()) {
            if dep_map.contains_key("next") {
                return true;
            }
        }
    }
    false
}

fn missing_expected_bin(app_dir: &Path) -> Option<String> {
    let package_json = read_package_json(app_dir)?;
    if !has_next_dependency(&package_json) {
        return None;
    }

    let bin_dir = app_dir.join("node_modules").join(".bin");
    let candidates = ["next", "next.cmd", "next.ps1"];
    let has_bin = candidates
        .iter()
        .any(|name| bin_dir.join(name).exists());
    if has_bin {
        return None;
    }

    Some("next".to_string())
}

fn run_pnpm_install(app_dir: &Path) -> Result<(), String> {
    let pnpm_path = ensure_pnpm_installed()?;
    let path = build_runtime_path();

    let output = command_for_path(&pnpm_path)
        .arg("install")
        .current_dir(app_dir)
        .env("PATH", &path)
        .output()
        .map_err(|e| format!("Failed to run pnpm install: {}", e))?;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let code = output
            .status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "unknown".to_string());
        return Err(format!(
            "pnpm install failed (exit {}). stdout: {} stderr: {}",
            code,
            stdout.trim(),
            stderr.trim()
        ));
    }

    Ok(())
}

/// Install node_modules for an app if not present
pub fn ensure_node_modules_installed(app_dir: &Path) -> Result<(), String> {
    let node_modules_path = app_dir.join("node_modules");
    let install_reason = if !node_modules_path.exists() {
        Some("node_modules missing".to_string())
    } else {
        missing_expected_bin(app_dir)
            .map(|missing_bin| format!("missing '{}' binary", missing_bin))
    };

    if let Some(reason) = install_reason {
        info!(
            "Dependency install stage=prepare path={:?} reason={}",
            app_dir, reason
        );
    } else {
        return Ok(());
    }

    let max_attempts = 2;
    for attempt in 1..=max_attempts {
        info!(
            "Dependency install stage=pnpm attempt={}/{}",
            attempt, max_attempts
        );
        let result = run_pnpm_install(app_dir).and_then(|_| {
            if let Some(missing_bin) = missing_expected_bin(app_dir) {
                Err(format!(
                    "Dependencies installed but '{}' binary is still missing",
                    missing_bin
                ))
            } else {
                Ok(())
            }
        });

        match result {
            Ok(()) => {
                info!("Dependency install stage=verify status=ok");
                return Ok(());
            }
            Err(e) => {
                warn!("pnpm install attempt {} failed: {}", attempt, e);
                if attempt < max_attempts {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                } else {
                    return Err(e);
                }
            }
        }
    }

    Ok(())
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

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
    fn test_get_bundled_node_bin_dir() {
        // This may return Some or None depending on environment
        let result = get_bundled_node_bin_dir();
        if let Some(path) = result {
            let node_name = if cfg!(target_os = "windows") {
                "node.exe"
            } else {
                "node"
            };
            assert!(Path::new(&path).join(node_name).exists());
        }
    }

    #[test]
    fn test_get_node_path() {
        // Should find either bundled or system node
        let result = get_node_path();
        // In CI or dev, we should have node available
        if let Some(path) = result {
            assert!(Path::new(&path).exists());
        }
    }

    #[test]
    fn test_get_pnpm_path() {
        let result = get_pnpm_path();
        if let Some(path) = result {
            assert!(Path::new(&path).exists());
        }
    }

    #[test]
    fn test_build_runtime_path() {
        let path = build_runtime_path();
        
        // Should contain common paths
        if cfg!(target_os = "windows") {
            assert!(path.to_lowercase().contains("windows\\system32"));
        } else {
            assert!(path.contains("/usr/bin"));
        }
        assert!(!path.is_empty());
        
        // Should not have duplicates
        let parts: Vec<_> = std::env::split_paths(std::ffi::OsStr::new(&path)).collect();
        let unique: std::collections::HashSet<_> =
            parts.iter().map(|p| p.to_string_lossy()).collect();
        assert_eq!(parts.len(), unique.len());
    }

    #[test]
    fn test_check_dependencies() {
        let status = check_dependencies();
        
        // If node is found, verify fields are populated
        if status.node_installed {
            assert!(status.node_version.is_some());
            assert!(status.node_path.is_some());
            assert!(status.node_source.is_some());
        }
        
        if status.pnpm_installed {
            assert!(status.pnpm_version.is_some());
            assert!(status.pnpm_path.is_some());
        }
    }

    #[test]
    fn test_ensure_node_modules_with_existing() {
        // Create temp dir with node_modules
        let temp_dir = std::env::temp_dir().join("moldable_test_modules");
        let _ = std::fs::remove_dir_all(&temp_dir);
        std::fs::create_dir_all(temp_dir.join("node_modules")).unwrap();
        
        let result = ensure_node_modules_installed(&temp_dir);
        assert!(result.is_ok());
        
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_node_source_serialization() {
        let bundled = serde_json::to_string(&NodeSource::Bundled).unwrap();
        assert_eq!(bundled, "\"bundled\"");
        
        let system = serde_json::to_string(&NodeSource::System).unwrap();
        assert_eq!(system, "\"system\"");
    }

    #[test]
    fn test_dependency_status_serialization() {
        let status = DependencyStatus {
            node_installed: true,
            node_version: Some("v22.22.0".to_string()),
            node_path: Some("/app/Resources/node/bin/node".to_string()),
            node_source: Some(NodeSource::Bundled),
            pnpm_installed: true,
            pnpm_version: Some("9.0.0".to_string()),
            pnpm_path: Some("/app/Resources/node/bin/pnpm".to_string()),
        };
        
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("nodeInstalled"));
        assert!(json.contains("nodeSource"));
        assert!(json.contains("\"bundled\""));
    }

    #[test]
    fn test_missing_expected_bin_without_next_dependency() {
        let temp_dir = create_temp_dir("moldable-test-no-next");
        let package_json = r#"{"name":"app","dependencies":{"react":"19.0.0"}}"#;
        fs::write(temp_dir.join("package.json"), package_json).unwrap();

        let missing = missing_expected_bin(&temp_dir);
        assert!(missing.is_none());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_missing_expected_bin_when_next_missing() {
        let temp_dir = create_temp_dir("moldable-test-next-missing");
        let package_json = r#"{"name":"app","dependencies":{"next":"16.1.1"}}"#;
        fs::write(temp_dir.join("package.json"), package_json).unwrap();

        let missing = missing_expected_bin(&temp_dir);
        assert_eq!(missing, Some("next".to_string()));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_missing_expected_bin_with_next_present() {
        let temp_dir = create_temp_dir("moldable-test-next-present");
        let package_json = r#"{"name":"app","dependencies":{"next":"16.1.1"}}"#;
        fs::write(temp_dir.join("package.json"), package_json).unwrap();
        fs::create_dir_all(temp_dir.join("node_modules").join(".bin")).unwrap();
        fs::write(temp_dir.join("node_modules").join(".bin").join("next"), "").unwrap();

        let missing = missing_expected_bin(&temp_dir);
        assert!(missing.is_none());

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
