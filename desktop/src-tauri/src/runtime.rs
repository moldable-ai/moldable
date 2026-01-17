//! Runtime dependency management for Moldable
//!
//! This module handles detection, installation, and management of Node.js and pnpm.
//! 
//! # Design Principles
//! 
//! 1. **Respect existing installations** - System Node.js (Homebrew, etc.) is checked first
//! 2. **Moldable runtime as fallback** - Only used when no working Node is found
//! 3. **GUI-app compatible** - Works without shell config (no NVM dependency)
//! 4. **Verify binaries work** - Check that binaries execute, not just exist

use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

// ============================================================================
// TYPES
// ============================================================================

/// Where Node.js was found
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NodeSource {
    /// Moldable-managed runtime (~/.moldable/runtime/node/)
    Moldable,
    /// Homebrew installation
    Homebrew,
    /// System installation (/usr/bin, /usr/local/bin)
    System,
    /// NVM (~/.nvm/versions/node/)
    Nvm,
    /// fnm (~/.local/share/fnm/)
    Fnm,
    /// Volta (~/.volta/bin/)
    Volta,
    /// Found via shell lookup or other means
    Other,
}

/// Status of development dependencies (Node.js, pnpm)
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

/// Result of finding a binary with its source
#[derive(Debug)]
pub struct FoundBinary {
    pub path: String,
    pub source: NodeSource,
}

// ============================================================================
// CONSTANTS
// ============================================================================

/// Default Node.js version to install (LTS)
pub const DEFAULT_NODE_VERSION: &str = "22.12.0";

/// Node.js download base URL
pub const NODE_DIST_URL: &str = "https://nodejs.org/dist";

// ============================================================================
// PATH FINDING - Respects existing installations
// ============================================================================

/// Get the Moldable runtime directory path
pub fn get_moldable_runtime_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(|home| PathBuf::from(format!("{}/.moldable/runtime", home)))
}

/// Get the Moldable Node.js bin directory if it exists and has node
pub fn get_moldable_node_bin_dir() -> Option<String> {
    let runtime_dir = get_moldable_runtime_dir()?;
    let current_bin = runtime_dir.join("node/current/bin");
    
    if current_bin.join("node").exists() {
        Some(current_bin.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Find Node.js binary path, checking system locations first
/// 
/// Priority order (respects existing installations):
/// 1. Homebrew ARM (/opt/homebrew/bin)
/// 2. Homebrew Intel (/usr/local/bin)  
/// 3. System (/usr/bin)
/// 4. NVM (~/.nvm/versions/node/*/bin)
/// 5. fnm (~/.local/share/fnm/aliases/default/bin)
/// 6. Volta (~/.volta/bin)
/// 7. Moldable runtime (~/.moldable/runtime/node/current/bin)
/// 8. Shell lookup (bash -l -c "which node")
pub fn find_node() -> Option<FoundBinary> {
    // 1. Homebrew ARM (most common on modern Macs)
    if Path::new("/opt/homebrew/bin/node").exists() {
        return Some(FoundBinary {
            path: "/opt/homebrew/bin".to_string(),
            source: NodeSource::Homebrew,
        });
    }
    
    // 2. Homebrew Intel
    if Path::new("/usr/local/bin/node").exists() {
        return Some(FoundBinary {
            path: "/usr/local/bin".to_string(),
            source: NodeSource::Homebrew,
        });
    }
    
    // 3. System
    if Path::new("/usr/bin/node").exists() {
        return Some(FoundBinary {
            path: "/usr/bin".to_string(),
            source: NodeSource::System,
        });
    }
    
    // 4-6. Version managers (check home-based paths)
    if let Ok(home) = std::env::var("HOME") {
        // 4. NVM
        let nvm_versions = format!("{}/.nvm/versions/node", home);
        if let Some(bin_dir) = find_latest_version_bin(&nvm_versions) {
            return Some(FoundBinary {
                path: bin_dir,
                source: NodeSource::Nvm,
            });
        }
        
        // 5. fnm
        let fnm_path = format!("{}/.local/share/fnm/aliases/default/bin", home);
        if Path::new(&fnm_path).join("node").exists() {
            return Some(FoundBinary {
                path: fnm_path,
                source: NodeSource::Fnm,
            });
        }
        
        // 6. Volta
        let volta_path = format!("{}/.volta/bin", home);
        if Path::new(&volta_path).join("node").exists() {
            return Some(FoundBinary {
                path: volta_path,
                source: NodeSource::Volta,
            });
        }
    }
    
    // 7. Moldable runtime (fallback for fresh installs)
    if let Some(moldable_bin) = get_moldable_node_bin_dir() {
        return Some(FoundBinary {
            path: moldable_bin,
            source: NodeSource::Moldable,
        });
    }
    
    // 8. Shell lookup (last resort, often fails for GUI apps)
    if let Some(path) = find_via_shell("node") {
        return Some(FoundBinary {
            path,
            source: NodeSource::Other,
        });
    }
    
    None
}

/// Find Node.js path (returns just the directory path for backwards compatibility)
pub fn find_node_path() -> Option<String> {
    find_node().map(|f| f.path)
}

/// Find pnpm binary path
pub fn find_pnpm_path() -> Option<String> {
    // First check alongside Node.js (most reliable)
    if let Some(node_path) = find_node_path() {
        let pnpm_in_node = format!("{}/pnpm", node_path);
        if Path::new(&pnpm_in_node).exists() {
            return Some(pnpm_in_node);
        }
    }
    
    // Check common pnpm locations
    let paths = [
        "/opt/homebrew/bin/pnpm",      // macOS ARM (Homebrew)
        "/usr/local/bin/pnpm",          // macOS Intel (Homebrew)
        "/usr/bin/pnpm",                // Linux system
        "/home/linuxbrew/.linuxbrew/bin/pnpm", // Linux Homebrew
    ];
    
    for path in paths {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    
    // Check Moldable runtime
    if let Some(moldable_bin) = get_moldable_node_bin_dir() {
        let pnpm_in_moldable = format!("{}/pnpm", moldable_bin);
        if Path::new(&pnpm_in_moldable).exists() {
            return Some(pnpm_in_moldable);
        }
    }
    
    // Try shell lookup
    if let Some(path) = find_via_which("pnpm") {
        return Some(path);
    }
    
    None
}

/// Find npm binary path
pub fn find_npm_path() -> Option<String> {
    // First check alongside Node.js
    if let Some(node_path) = find_node_path() {
        let npm_in_node = format!("{}/npm", node_path);
        if Path::new(&npm_in_node).exists() {
            return Some(npm_in_node);
        }
    }
    
    // Check common locations
    let paths = [
        "/opt/homebrew/bin/npm",
        "/usr/local/bin/npm",
        "/usr/bin/npm",
        "/home/linuxbrew/.linuxbrew/bin/npm",
    ];
    
    for path in paths {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }
    
    // Check Moldable runtime
    if let Some(moldable_bin) = get_moldable_node_bin_dir() {
        let npm_in_moldable = format!("{}/npm", moldable_bin);
        if Path::new(&npm_in_moldable).exists() {
            return Some(npm_in_moldable);
        }
    }
    
    // Try shell lookup
    find_via_which("npm")
}

/// Find the latest Node version in a version manager's directory
fn find_latest_version_bin(versions_dir: &str) -> Option<String> {
    let entries = std::fs::read_dir(versions_dir).ok()?;
    
    let mut versions: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    
    // Sort descending to get latest version first
    versions.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    
    versions.first().and_then(|version_dir| {
        let bin_dir = version_dir.path().join("bin");
        if bin_dir.join("node").exists() {
            Some(bin_dir.to_string_lossy().to_string())
        } else {
            None
        }
    })
}

/// Find a binary via shell (bash -l -c "which ...")
fn find_via_shell(binary: &str) -> Option<String> {
    Command::new("/bin/bash")
        .args(["-l", "-c", &format!("which {}", binary)])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .and_then(|path| {
            Path::new(&path)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
        })
}

/// Find a binary via `which` command
fn find_via_which(binary: &str) -> Option<String> {
    Command::new("which")
        .arg(binary)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

// ============================================================================
// VERSION CHECKING
// ============================================================================

/// Get version of a command (e.g., "node --version" returns "v22.12.0")
pub fn get_command_version(cmd_path: &str, arg: &str) -> Option<String> {
    Command::new(cmd_path)
        .arg(arg)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Check if NVM is installed (for backwards compatibility/UI display)
#[allow(dead_code)]
pub fn is_nvm_installed() -> bool {
    if let Ok(home) = std::env::var("HOME") {
        let nvm_sh = format!("{}/.nvm/nvm.sh", home);
        return Path::new(&nvm_sh).exists();
    }
    false
}

// ============================================================================
// DEPENDENCY STATUS
// ============================================================================

/// Check development dependencies status
/// 
/// Note: We verify binaries actually work (return a version), not just exist,
/// because macOS may have stub binaries that prompt for Xcode tools install.
pub fn check_dependencies() -> DependencyStatus {
    // Check Node.js
    let node_found = find_node();
    let (node_path, node_source) = node_found
        .as_ref()
        .map(|f| (Some(f.path.clone()), Some(f.source)))
        .unwrap_or((None, None));
    
    let node_version = node_path.as_ref().and_then(|p| {
        let node_bin = format!("{}/node", p);
        get_command_version(&node_bin, "--version")
    });
    
    // Only consider node installed if it actually runs and returns a version
    let node_installed = node_version.is_some();
    
    // Check pnpm
    let pnpm_path = find_pnpm_path();
    let pnpm_version = pnpm_path.as_ref().and_then(|p| {
        get_command_version(p, "--version")
    });
    let pnpm_installed = pnpm_version.is_some();
    
    info!(
        "Dependency check: node={} ({:?} from {:?}), pnpm={} ({:?})",
        node_installed, node_version, node_source,
        pnpm_installed, pnpm_version,
    );
    
    DependencyStatus {
        node_installed,
        node_version,
        node_path: if node_installed { node_path } else { None },
        node_source: if node_installed { node_source } else { None },
        pnpm_installed,
        pnpm_version,
        pnpm_path: if pnpm_installed { pnpm_path } else { None },
    }
}

// ============================================================================
// MOLDABLE RUNTIME MANAGEMENT
// ============================================================================

/// Get the current architecture for Node.js downloads
pub fn get_node_arch() -> &'static str {
    #[cfg(target_arch = "aarch64")]
    { "arm64" }
    #[cfg(target_arch = "x86_64")]
    { "x64" }
    #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
    { "x64" } // fallback
}

/// Get the current OS for Node.js downloads
pub fn get_node_os() -> &'static str {
    #[cfg(target_os = "macos")]
    { "darwin" }
    #[cfg(target_os = "linux")]
    { "linux" }
    #[cfg(target_os = "windows")]
    { "win" }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    { "linux" } // fallback
}

/// Get macOS version for compatibility checks
#[allow(dead_code)]
pub fn get_macos_version() -> Option<String> {
    Command::new("sw_vers")
        .args(["-productVersion"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
}

/// Get the Node.js download URL for the current platform
pub fn get_node_download_url(version: &str) -> String {
    let os = get_node_os();
    let arch = get_node_arch();
    format!(
        "{}/v{}/node-v{}-{}-{}.tar.gz",
        NODE_DIST_URL, version, version, os, arch
    )
}

/// Get the directory name for a Node.js installation
pub fn get_node_install_dirname(version: &str) -> String {
    let arch = get_node_arch();
    format!("v{}-{}", version, arch)
}

/// Install Node.js to Moldable runtime directory
/// 
/// This downloads the official Node.js tarball and extracts it to
/// ~/.moldable/runtime/node/v{VERSION}-{ARCH}/
pub async fn install_node(version: Option<&str>) -> Result<String, String> {
    let version = version.unwrap_or(DEFAULT_NODE_VERSION);
    let runtime_dir = get_moldable_runtime_dir()
        .ok_or("Could not determine Moldable runtime directory")?;
    
    let node_dir = runtime_dir.join("node");
    let install_dirname = get_node_install_dirname(version);
    let install_path = node_dir.join(&install_dirname);
    let current_link = node_dir.join("current");
    
    info!("Installing Node.js {} to {:?}", version, install_path);
    
    // Create directory structure
    std::fs::create_dir_all(&node_dir)
        .map_err(|e| format!("Failed to create runtime directory: {}", e))?;
    
    // Check if already installed
    if install_path.join("bin/node").exists() {
        info!("Node.js {} is already installed", version);
        // Update symlink if needed
        update_current_symlink(&current_link, &install_dirname)?;
        return Ok(format!("Node.js {} is already installed", version));
    }
    
    // Download URL
    let download_url = get_node_download_url(version);
    info!("Downloading from {}", download_url);
    
    // Download and extract using curl + tar
    // We use curl because it's available on all target platforms
    let temp_tarball = runtime_dir.join("node-download.tar.gz");
    
    // Download
    let download_output = Command::new("curl")
        .args([
            "-fSL",                           // Fail silently, show errors, follow redirects
            "--progress-bar",                 // Show progress
            "-o", temp_tarball.to_str().unwrap(),
            &download_url,
        ])
        .output()
        .map_err(|e| format!("Failed to download Node.js: {}", e))?;
    
    if !download_output.status.success() {
        let stderr = String::from_utf8_lossy(&download_output.stderr);
        return Err(format!("Download failed: {}", stderr));
    }
    
    // Create install directory
    std::fs::create_dir_all(&install_path)
        .map_err(|e| format!("Failed to create install directory: {}", e))?;
    
    // Extract (strip the top-level directory from the tarball)
    let extract_output = Command::new("tar")
        .args([
            "xzf",
            temp_tarball.to_str().unwrap(),
            "-C", install_path.to_str().unwrap(),
            "--strip-components=1",
        ])
        .output()
        .map_err(|e| format!("Failed to extract Node.js: {}", e))?;
    
    if !extract_output.status.success() {
        let stderr = String::from_utf8_lossy(&extract_output.stderr);
        // Clean up failed install
        let _ = std::fs::remove_dir_all(&install_path);
        return Err(format!("Extraction failed: {}", stderr));
    }
    
    // Clean up tarball
    let _ = std::fs::remove_file(&temp_tarball);
    
    // Update current symlink
    update_current_symlink(&current_link, &install_dirname)?;
    
    // Verify installation
    let node_bin = install_path.join("bin/node");
    if let Some(version_str) = get_command_version(node_bin.to_str().unwrap(), "--version") {
        info!("Node.js {} installed successfully", version_str);
        Ok(format!("Node.js {} installed successfully", version_str))
    } else {
        Err("Node.js installed but binary doesn't work".to_string())
    }
}

/// Update the "current" symlink to point to a specific version
fn update_current_symlink(link_path: &Path, target_dirname: &str) -> Result<(), String> {
    // Remove existing symlink if present
    if link_path.exists() || link_path.is_symlink() {
        std::fs::remove_file(link_path)
            .map_err(|e| format!("Failed to remove old symlink: {}", e))?;
    }
    
    // Create new symlink
    #[cfg(unix)]
    std::os::unix::fs::symlink(target_dirname, link_path)
        .map_err(|e| format!("Failed to create symlink: {}", e))?;
    
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(target_dirname, link_path)
        .map_err(|e| format!("Failed to create symlink: {}", e))?;
    
    Ok(())
}

/// Install pnpm using the available Node.js/npm
pub async fn install_pnpm() -> Result<String, String> {
    info!("Installing pnpm...");
    
    // Find Node.js
    let node_path = find_node_path()
        .ok_or("Node.js is not installed. Please install Node.js first.")?;
    
    // Find npm (should be alongside node)
    let npm_path = format!("{}/npm", node_path);
    let npm_cmd = if Path::new(&npm_path).exists() {
        npm_path
    } else {
        find_npm_path()
            .ok_or("npm not found. Please ensure Node.js is properly installed.")?
    };
    
    info!("Using npm at: {}", npm_cmd);
    
    // First try Corepack (bundled with Node.js)
    let corepack_path = format!("{}/corepack", node_path);
    if Path::new(&corepack_path).exists() {
        info!("Trying Corepack for pnpm installation...");
        
        // Enable corepack
        let enable_output = Command::new(&corepack_path)
            .arg("enable")
            .output();
        
        if let Ok(output) = enable_output {
            if output.status.success() {
                // Prepare pnpm
                let prepare_output = Command::new(&corepack_path)
                    .args(["prepare", "pnpm@latest-10", "--activate"])
                    .output();
                
                if let Ok(output) = prepare_output {
                    if output.status.success() {
                        // Verify pnpm works
                        if find_pnpm_path().is_some() {
                            info!("pnpm installed successfully via Corepack");
                            return Ok("pnpm installed successfully via Corepack".to_string());
                        }
                    }
                }
            }
        }
        warn!("Corepack installation failed, falling back to npm");
    }
    
    // Fallback: npm install -g pnpm
    let output = Command::new(&npm_cmd)
        .args(["install", "-g", "pnpm@latest-10"])
        .output()
        .map_err(|e| format!("Failed to run npm install: {}", e))?;
    
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("pnpm installation failed: {}", stderr));
    }
    
    // Verify pnpm is now available
    let pnpm_in_node = format!("{}/pnpm", node_path);
    if Path::new(&pnpm_in_node).exists() || find_pnpm_path().is_some() {
        info!("pnpm installed successfully");
        Ok("pnpm installed successfully".to_string())
    } else {
        // Try to verify via which
        if let Some(_) = find_via_which("pnpm") {
            info!("pnpm installed successfully");
            return Ok("pnpm installed successfully".to_string());
        }
        Err("pnpm installation completed but pnpm not found".to_string())
    }
}

/// Ensure pnpm is installed, installing it via npm if necessary.
/// Returns the path to pnpm or an error.
pub fn ensure_pnpm_installed() -> Result<String, String> {
    if let Some(pnpm_path) = find_pnpm_path() {
        return Ok(pnpm_path);
    }
    
    info!("pnpm not found, attempting to install via npm...");
    
    if let Some(npm_path) = find_npm_path() {
        let output = Command::new(&npm_path)
            .args(["install", "-g", "pnpm"])
            .output();
        
        if let Ok(output) = output {
            if output.status.success() {
                info!("pnpm installed successfully");
                if let Some(pnpm_path) = find_pnpm_path() {
                    return Ok(pnpm_path);
                }
                return Ok("pnpm".to_string());
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!(
                    "Failed to install pnpm: {}. Try running manually: npm install -g pnpm",
                    stderr.trim()
                ));
            }
        }
    }
    
    Err(
        "pnpm is required but npm was not found. Please install Node.js (https://nodejs.org) \
         and then run: npm install -g pnpm".to_string()
    )
}

/// Ensure node_modules exists in an app directory
pub fn ensure_node_modules_installed(app_dir: &Path) -> Result<(), String> {
    let node_modules_path = app_dir.join("node_modules");
    if node_modules_path.exists() {
        return Ok(());
    }
    
    info!("node_modules missing in {:?}, running pnpm install...", app_dir);
    
    let pnpm_path = ensure_pnpm_installed()?;
    
    // Build PATH with Moldable runtime if available
    let path = build_runtime_path();
    
    let install_output = Command::new(&pnpm_path)
        .arg("install")
        .current_dir(app_dir)
        .env("PATH", &path)
        .output()
        .map_err(|e| format!("Failed to run pnpm install: {}", e))?;
    
    if !install_output.status.success() {
        let stderr = String::from_utf8_lossy(&install_output.stderr);
        warn!("pnpm install had issues (stderr: {}), but continuing...", stderr);
    } else {
        info!("pnpm install completed for {:?}", app_dir);
    }
    
    Ok(())
}

// ============================================================================
// PATH BUILDING
// ============================================================================

/// Build PATH string with Moldable runtime prepended (if it exists)
pub fn build_runtime_path() -> String {
    let mut path_parts: Vec<String> = Vec::new();
    
    // Add Moldable runtime if it exists
    if let Some(moldable_bin) = get_moldable_node_bin_dir() {
        path_parts.push(moldable_bin);
    }
    
    // Add common locations
    path_parts.extend([
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
    ]);
    
    // Add existing PATH
    if let Ok(existing_path) = std::env::var("PATH") {
        path_parts.push(existing_path);
    }
    
    path_parts.join(":")
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_node_arch() {
        let arch = get_node_arch();
        assert!(arch == "arm64" || arch == "x64");
    }

    #[test]
    fn test_get_node_os() {
        let os = get_node_os();
        assert!(os == "darwin" || os == "linux" || os == "win");
    }

    #[test]
    fn test_get_node_download_url() {
        let url = get_node_download_url("22.12.0");
        assert!(url.starts_with("https://nodejs.org/dist/v22.12.0/"));
        assert!(url.contains("node-v22.12.0"));
        assert!(url.ends_with(".tar.gz"));
    }

    #[test]
    fn test_get_node_install_dirname() {
        let dirname = get_node_install_dirname("22.12.0");
        assert!(dirname.starts_with("v22.12.0-"));
        assert!(dirname.contains("arm64") || dirname.contains("x64"));
    }

    #[test]
    fn test_find_node_returns_valid_result() {
        // This test verifies find_node works and returns expected structure
        // It may return None on machines without Node, which is valid
        let result = find_node();
        
        if let Some(found) = result {
            assert!(!found.path.is_empty());
            // Path should exist
            assert!(
                Path::new(&found.path).exists(),
                "Found path {} doesn't exist",
                found.path
            );
        }
    }

    #[test]
    fn test_find_pnpm_path_returns_valid_or_none() {
        let result = find_pnpm_path();
        
        if let Some(path) = result {
            assert!(!path.is_empty());
            assert!(!path.contains('\n'));
        }
    }

    #[test]
    fn test_find_npm_path_returns_valid_or_none() {
        let result = find_npm_path();
        
        if let Some(path) = result {
            assert!(!path.is_empty());
            assert!(!path.contains('\n'));
        }
    }

    #[test]
    fn test_node_source_serialization() {
        // Test that NodeSource serializes to lowercase
        let source = NodeSource::Homebrew;
        let json = serde_json::to_string(&source).unwrap();
        assert_eq!(json, "\"homebrew\"");
        
        let source = NodeSource::Moldable;
        let json = serde_json::to_string(&source).unwrap();
        assert_eq!(json, "\"moldable\"");
    }

    #[test]
    fn test_dependency_status_serialization() {
        let status = DependencyStatus {
            node_installed: true,
            node_version: Some("v22.12.0".to_string()),
            node_path: Some("/opt/homebrew/bin".to_string()),
            node_source: Some(NodeSource::Homebrew),
            pnpm_installed: true,
            pnpm_version: Some("10.0.0".to_string()),
            pnpm_path: Some("/opt/homebrew/bin/pnpm".to_string()),
        };
        
        let json = serde_json::to_string(&status).unwrap();
        
        // Verify camelCase
        assert!(json.contains("nodeInstalled"));
        assert!(json.contains("nodeVersion"));
        assert!(json.contains("nodeSource"));
        assert!(json.contains("pnpmInstalled"));
        
        // Verify values
        assert!(json.contains("\"homebrew\""));
        assert!(json.contains("v22.12.0"));
    }

    #[test]
    fn test_build_runtime_path() {
        let path = build_runtime_path();
        
        // Should contain common paths
        assert!(path.contains("/opt/homebrew/bin") || path.contains("/usr/local/bin"));
        assert!(path.contains("/usr/bin"));
        
        // Should not be empty
        assert!(!path.is_empty());
    }

    #[test]
    fn test_is_nvm_installed() {
        // This just verifies the function doesn't panic
        let _ = is_nvm_installed();
    }

    #[test]
    fn test_get_moldable_runtime_dir() {
        let result = get_moldable_runtime_dir();
        
        // Should return Some if HOME is set
        if std::env::var("HOME").is_ok() {
            assert!(result.is_some());
            let path = result.unwrap();
            assert!(path.to_string_lossy().contains(".moldable/runtime"));
        }
    }

    #[test]
    fn test_check_dependencies_returns_valid_status() {
        let status = check_dependencies();
        
        // If node is installed, we should have version and path
        if status.node_installed {
            assert!(status.node_version.is_some());
            assert!(status.node_path.is_some());
            assert!(status.node_source.is_some());
        } else {
            // If not installed, these should be None
            assert!(status.node_path.is_none());
            assert!(status.node_source.is_none());
        }
        
        // Same for pnpm
        if status.pnpm_installed {
            assert!(status.pnpm_version.is_some());
            assert!(status.pnpm_path.is_some());
        }
    }

    #[test]
    fn test_ensure_pnpm_installed_when_available() {
        // Skip if pnpm isn't available
        if find_pnpm_path().is_none() {
            println!("Skipping test - pnpm not available");
            return;
        }
        
        let result = ensure_pnpm_installed();
        assert!(result.is_ok(), "ensure_pnpm_installed failed: {:?}", result);
        
        let pnpm_path = result.unwrap();
        assert!(!pnpm_path.is_empty());
    }

    #[test]
    fn test_get_command_version() {
        // Test with a command that should exist on all systems
        let version = get_command_version("/bin/bash", "--version");
        
        // bash --version should return something
        assert!(version.is_some());
        assert!(!version.unwrap().is_empty());
    }

    #[test]
    fn test_get_command_version_nonexistent() {
        let version = get_command_version("/nonexistent/binary", "--version");
        assert!(version.is_none());
    }
}
