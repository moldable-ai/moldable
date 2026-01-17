//! Runtime dependency management for Moldable
//!
//! This module handles detection, installation, and management of Node.js and pnpm.
//! 
//! # Design Principles
//! 
//! 1. **Respect existing installations** - System Node.js (Homebrew, etc.) is checked first
//! 2. **Moldable runtime as fallback** - Only used when no working Node is found
//! 3. **GUI-app compatible** - Works without shell config (no NVM dependency on shell functions)
//! 4. **Verify binaries work** - Check that binaries execute, not just exist
//! 5. **Support all major version managers** - NVM, fnm, Volta, asdf, mise, n, nodenv
//!
//! # CRITICAL: This is core infrastructure
//! 
//! If Node/pnpm detection fails, the entire app is unusable. Every edge case
//! must be handled. When in doubt, try more locations and verify binaries work.

use log::{info, warn, error};
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
    /// fnm (~/.local/share/fnm/ or ~/.fnm/)
    Fnm,
    /// Volta (~/.volta/)
    Volta,
    /// asdf version manager (~/.asdf/)
    Asdf,
    /// mise/rtx version manager
    Mise,
    /// n version manager (/usr/local/n/)
    N,
    /// nodenv (~/.nodenv/)
    Nodenv,
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

/// Find Node.js binary path, checking all known locations
/// 
/// This is CRITICAL infrastructure - if we can't find node, the app is useless.
/// We check every possible location and verify the binary actually works.
/// 
/// Priority order:
/// 1. Homebrew ARM (/opt/homebrew/bin)
/// 2. Homebrew Intel (/usr/local/bin)  
/// 3. NVM (~/.nvm/versions/node/*/bin) - most popular version manager
/// 4. fnm (~/.local/share/fnm/ or ~/.fnm/)
/// 5. Volta (~/.volta/)
/// 6. asdf (~/.asdf/)
/// 7. mise/rtx (~/.local/share/mise/)
/// 8. n (/usr/local/n/)
/// 9. nodenv (~/.nodenv/)
/// 10. Moldable runtime (~/.moldable/runtime/node/current/bin)
/// 11. System (/usr/bin) - checked late because macOS has Xcode stubs
/// 12. Shell lookup (bash -l -c "which node")
pub fn find_node() -> Option<FoundBinary> {
    let home = std::env::var("HOME").unwrap_or_default();
    
    // Build list of all candidates with their sources
    let mut candidates: Vec<(String, NodeSource)> = Vec::new();
    
    // 1. Homebrew ARM (most common on modern Macs)
    candidates.push(("/opt/homebrew/bin".to_string(), NodeSource::Homebrew));
    
    // 2. Homebrew Intel
    candidates.push(("/usr/local/bin".to_string(), NodeSource::Homebrew));
    
    // 3. NVM - check versions directory for latest
    if !home.is_empty() {
        let nvm_versions = format!("{}/.nvm/versions/node", home);
        if let Some(bin_dir) = find_latest_version_bin(&nvm_versions) {
            candidates.push((bin_dir, NodeSource::Nvm));
        }
        // Also check NVM default alias
        let nvm_default = format!("{}/.nvm/alias/default", home);
        if Path::new(&nvm_default).exists() {
            if let Ok(version) = std::fs::read_to_string(&nvm_default) {
                let version = version.trim();
                // Version could be like "22" or "v22.12.0" or "lts/iron"
                let version_path = format!("{}/.nvm/versions/node/{}/bin", home, version);
                if Path::new(&version_path).join("node").exists() {
                    candidates.push((version_path, NodeSource::Nvm));
                }
                // Try with v prefix
                let version_path_v = format!("{}/.nvm/versions/node/v{}/bin", home, version);
                if Path::new(&version_path_v).join("node").exists() {
                    candidates.push((version_path_v, NodeSource::Nvm));
                }
            }
        }
        
        // 4. fnm - check multiple possible locations
        let fnm_paths = [
            format!("{}/.local/share/fnm/aliases/default/bin", home),
            format!("{}/.fnm/aliases/default/bin", home),
            format!("{}/.local/share/fnm/node-versions/default/installation/bin", home),
        ];
        for fnm_path in fnm_paths {
            candidates.push((fnm_path, NodeSource::Fnm));
        }
        // fnm also stores versions - find latest
        let fnm_versions_paths = [
            format!("{}/.local/share/fnm/node-versions", home),
            format!("{}/.fnm/node-versions", home),
        ];
        for fnm_versions in fnm_versions_paths {
            if let Some(bin_dir) = find_latest_version_bin(&fnm_versions) {
                candidates.push((bin_dir, NodeSource::Fnm));
            }
        }
        
        // 5. Volta - uses shims but also has direct binaries
        candidates.push((format!("{}/.volta/bin", home), NodeSource::Volta));
        // Volta also has tools/image for actual binaries
        let volta_tools = format!("{}/.volta/tools/image/node", home);
        if let Some(bin_dir) = find_latest_version_bin(&volta_tools) {
            candidates.push((bin_dir, NodeSource::Volta));
        }
        
        // 6. asdf
        candidates.push((format!("{}/.asdf/shims", home), NodeSource::Asdf));
        let asdf_installs = format!("{}/.asdf/installs/nodejs", home);
        if let Some(bin_dir) = find_latest_version_bin(&asdf_installs) {
            candidates.push((bin_dir, NodeSource::Asdf));
        }
        
        // 7. mise (formerly rtx)
        let mise_paths = [
            format!("{}/.local/share/mise/installs/node", home),
            format!("{}/.local/share/rtx/installs/node", home),
            format!("{}/.mise/installs/node", home),
        ];
        for mise_path in mise_paths {
            if let Some(bin_dir) = find_latest_version_bin(&mise_path) {
                candidates.push((bin_dir, NodeSource::Mise));
            }
        }
        // mise shims
        candidates.push((format!("{}/.local/share/mise/shims", home), NodeSource::Mise));
        
        // 8. n version manager
        let n_versions = "/usr/local/n/versions/node";
        if let Some(bin_dir) = find_latest_version_bin(n_versions) {
            candidates.push((bin_dir, NodeSource::N));
        }
        
        // 9. nodenv
        let nodenv_versions = format!("{}/.nodenv/versions", home);
        if let Some(bin_dir) = find_latest_version_bin(&nodenv_versions) {
            candidates.push((bin_dir, NodeSource::Nodenv));
        }
        candidates.push((format!("{}/.nodenv/shims", home), NodeSource::Nodenv));
    }
    
    // 10. Moldable runtime (our managed fallback)
    if let Some(moldable_bin) = get_moldable_node_bin_dir() {
        candidates.push((moldable_bin, NodeSource::Moldable));
    }
    
    // 11. System paths (checked late because macOS /usr/bin/node is often an Xcode stub)
    candidates.push(("/usr/bin".to_string(), NodeSource::System));
    
    // Now check each candidate - verify binary exists AND works
    for (bin_dir, source) in &candidates {
        let node_path = Path::new(bin_dir).join("node");
        
        if !node_path.exists() {
            continue;
        }
        
        // Verify it's actually executable and returns a version
        // This catches macOS Xcode stubs that exist but prompt for install
        if verify_node_binary(&node_path) {
            info!("Found working Node.js at {} (source: {:?})", bin_dir, source);
            return Some(FoundBinary {
                path: bin_dir.clone(),
                source: *source,
            });
        } else {
            warn!("Node binary exists at {} but doesn't work, skipping", bin_dir);
        }
    }
    
    // 12. Last resort: Shell lookup (may find things we missed)
    info!("No node found in known locations, trying shell lookup...");
    if let Some(path) = find_via_shell("node") {
        // Verify this one too
        let node_path = Path::new(&path).join("node");
        if verify_node_binary(&node_path) {
            info!("Found working Node.js via shell at {}", path);
            return Some(FoundBinary {
                path,
                source: NodeSource::Other,
            });
        }
    }
    
    error!("Could not find a working Node.js installation anywhere!");
    None
}

/// Verify a node binary actually works (not just exists)
/// This catches macOS Xcode stubs and broken installations
fn verify_node_binary(node_path: &Path) -> bool {
    // Check if file exists and is executable
    if !node_path.exists() {
        return false;
    }
    
    // Try to get version with a timeout
    // Use a short timeout since this should be instant
    let output = Command::new(node_path)
        .arg("--version")
        .output();
    
    match output {
        Ok(o) if o.status.success() => {
            let version = String::from_utf8_lossy(&o.stdout);
            // Should start with 'v' followed by a number
            version.trim().starts_with('v') && 
                version.trim().chars().nth(1).map(|c| c.is_ascii_digit()).unwrap_or(false)
        }
        Ok(o) => {
            // Command ran but failed - might be Xcode stub
            let stderr = String::from_utf8_lossy(&o.stderr);
            if stderr.contains("xcode") || stderr.contains("command line tools") {
                warn!("Node at {:?} appears to be macOS Xcode stub", node_path);
            }
            false
        }
        Err(e) => {
            warn!("Failed to execute node at {:?}: {}", node_path, e);
            false
        }
    }
}

/// Find Node.js path (returns just the directory path for backwards compatibility)
pub fn find_node_path() -> Option<String> {
    find_node().map(|f| f.path)
}

/// Find pnpm binary path
/// 
/// Checks all known locations where pnpm might be installed.
/// This is CRITICAL - if we can't find pnpm, apps won't start.
pub fn find_pnpm_path() -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    
    // Build list of all candidate paths
    let mut candidates: Vec<String> = Vec::new();
    
    // First check alongside Node.js (most reliable for global installs)
    if let Some(node_path) = find_node_path() {
        candidates.push(format!("{}/pnpm", node_path));
    }
    
    // Homebrew locations
    candidates.extend([
        "/opt/homebrew/bin/pnpm".to_string(),      // macOS ARM
        "/usr/local/bin/pnpm".to_string(),          // macOS Intel
    ]);
    
    // pnpm's own locations when installed via `pnpm env`
    if !home.is_empty() {
        candidates.extend([
            format!("{}/.local/share/pnpm/pnpm", home),
            format!("{}/Library/pnpm/pnpm", home),  // macOS alternate
            format!("{}/.pnpm-home/pnpm", home),     // Windows-style on Unix
        ]);
    }
    
    // npm global locations (pnpm installed via npm)
    candidates.extend([
        "/usr/bin/pnpm".to_string(),
        "/home/linuxbrew/.linuxbrew/bin/pnpm".to_string(),
    ]);
    
    // Version manager locations
    if !home.is_empty() {
        // Volta
        candidates.push(format!("{}/.volta/bin/pnpm", home));
        
        // asdf
        candidates.push(format!("{}/.asdf/shims/pnpm", home));
        
        // mise
        candidates.push(format!("{}/.local/share/mise/shims/pnpm", home));
        
        // Corepack locations (pnpm via Node's corepack)
        // These are alongside node
        if let Some(node_path) = find_node_path() {
            candidates.push(format!("{}/corepack", node_path));
        }
    }
    
    // Moldable runtime
    if let Some(moldable_bin) = get_moldable_node_bin_dir() {
        candidates.push(format!("{}/pnpm", moldable_bin));
    }
    
    // Check each candidate
    for path in &candidates {
        if Path::new(path).exists() {
            // Verify it works
            if verify_pnpm_binary(path) {
                info!("Found working pnpm at {}", path);
                return Some(path.clone());
            }
        }
    }
    
    // Try shell lookup as last resort
    if let Some(path) = find_via_which("pnpm") {
        if verify_pnpm_binary(&path) {
            info!("Found working pnpm via shell at {}", path);
            return Some(path);
        }
    }
    
    warn!("Could not find a working pnpm installation");
    None
}

/// Verify a pnpm binary actually works
fn verify_pnpm_binary(pnpm_path: &str) -> bool {
    let output = Command::new(pnpm_path)
        .arg("--version")
        .output();
    
    match output {
        Ok(o) if o.status.success() => {
            let version = String::from_utf8_lossy(&o.stdout);
            // pnpm version should be numeric like "9.0.0"
            let v = version.trim();
            !v.is_empty() && v.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false)
        }
        _ => false,
    }
}

/// Find npm binary path
pub fn find_npm_path() -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    
    // Build candidates list
    let mut candidates: Vec<String> = Vec::new();
    
    // First check alongside Node.js (most reliable)
    if let Some(node_path) = find_node_path() {
        candidates.push(format!("{}/npm", node_path));
    }
    
    // Homebrew locations
    candidates.extend([
        "/opt/homebrew/bin/npm".to_string(),
        "/usr/local/bin/npm".to_string(),
    ]);
    
    // System locations
    candidates.extend([
        "/usr/bin/npm".to_string(),
        "/home/linuxbrew/.linuxbrew/bin/npm".to_string(),
    ]);
    
    // Version manager locations
    if !home.is_empty() {
        candidates.extend([
            format!("{}/.volta/bin/npm", home),
            format!("{}/.asdf/shims/npm", home),
            format!("{}/.local/share/mise/shims/npm", home),
        ]);
    }
    
    // Moldable runtime
    if let Some(moldable_bin) = get_moldable_node_bin_dir() {
        candidates.push(format!("{}/npm", moldable_bin));
    }
    
    // Check each candidate
    for path in &candidates {
        if Path::new(path).exists() {
            return Some(path.clone());
        }
    }
    
    // Try shell lookup
    find_via_which("npm")
}

/// Find the latest Node version in a version manager's directory
/// Uses semantic version sorting (not lexicographic) to find the newest
fn find_latest_version_bin(versions_dir: &str) -> Option<String> {
    let entries = match std::fs::read_dir(versions_dir) {
        Ok(e) => e,
        Err(_) => return None,
    };
    
    let mut versions: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    
    if versions.is_empty() {
        return None;
    }
    
    // Sort by parsed version number (newest first)
    // Handle formats like "v22.12.0", "22.12.0", "v22", "lts-iron"
    versions.sort_by(|a, b| {
        let parse_version = |name: &std::ffi::OsStr| -> (u32, u32, u32) {
            let s = name.to_string_lossy();
            let s = s.trim_start_matches('v').trim_start_matches("lts-");
            let parts: Vec<u32> = s
                .split('.')
                .filter_map(|p| p.parse().ok())
                .collect();
            (
                parts.first().copied().unwrap_or(0),
                parts.get(1).copied().unwrap_or(0),
                parts.get(2).copied().unwrap_or(0),
            )
        };
        
        let va = parse_version(&a.file_name());
        let vb = parse_version(&b.file_name());
        vb.cmp(&va) // Descending order (newest first)
    });
    
    // Try each version directory until we find one with a working node
    for version_dir in versions {
        let path = version_dir.path();
        
        // Check both `bin/node` and direct `node` (different managers have different layouts)
        let bin_candidates = [
            path.join("bin"),
            path.join("installation/bin"), // fnm layout
            path.clone(),
        ];
        
        for bin_dir in bin_candidates {
            if bin_dir.join("node").exists() {
                return Some(bin_dir.to_string_lossy().to_string());
            }
        }
    }
    
    None
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
// PATH & ENVIRONMENT BUILDING
// ============================================================================

/// Build PATH string with discovered Node.js directory prepended
/// 
/// This ensures that when we spawn app processes, scripts using
/// `#!/usr/bin/env node` can find the node binary, regardless of
/// where it was installed (Homebrew, NVM, fnm, Volta, etc.)
/// 
/// CRITICAL: This PATH is used for ALL spawned app processes.
/// If node isn't in this PATH, `#!/usr/bin/env node` scripts will fail.
pub fn build_runtime_path() -> String {
    let mut path_parts: Vec<String> = Vec::new();
    let home = std::env::var("HOME").unwrap_or_default();
    
    // CRITICAL: Add the discovered node directory FIRST
    // This handles NVM, fnm, Volta, and other version managers
    // that install node outside of standard system paths
    if let Some(node_bin_dir) = find_node_path() {
        path_parts.push(node_bin_dir);
    }
    
    // Add pnpm directory if different from node directory
    if let Some(pnpm_path) = find_pnpm_path() {
        if let Some(pnpm_dir) = Path::new(&pnpm_path).parent() {
            let pnpm_dir_str = pnpm_dir.to_string_lossy().to_string();
            if !path_parts.contains(&pnpm_dir_str) {
                path_parts.push(pnpm_dir_str);
            }
        }
    }
    
    // Add Moldable runtime if it exists (might be different from above)
    if let Some(moldable_bin) = get_moldable_node_bin_dir() {
        if !path_parts.contains(&moldable_bin) {
            path_parts.push(moldable_bin);
        }
    }
    
    // Add version manager shim directories (some tools need these in PATH)
    if !home.is_empty() {
        let shim_dirs = [
            format!("{}/.volta/bin", home),
            format!("{}/.asdf/shims", home),
            format!("{}/.local/share/mise/shims", home),
            format!("{}/.nodenv/shims", home),
            format!("{}/.local/share/pnpm", home),  // pnpm global bin
        ];
        
        for shim_dir in shim_dirs {
            if Path::new(&shim_dir).exists() && !path_parts.contains(&shim_dir) {
                path_parts.push(shim_dir);
            }
        }
    }
    
    // Add common system locations
    let common_paths = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];
    
    for path in common_paths {
        let path_str = path.to_string();
        if !path_parts.contains(&path_str) {
            path_parts.push(path_str);
        }
    }
    
    // Add existing PATH (deduplicated against what we've already added)
    if let Ok(existing_path) = std::env::var("PATH") {
        for part in existing_path.split(':') {
            let part_str = part.to_string();
            if !part_str.is_empty() && !path_parts.contains(&part_str) {
                path_parts.push(part_str);
            }
        }
    }
    
    path_parts.join(":")
}

/// Get environment variables needed for version managers to work correctly
/// 
/// Some version managers (Volta, NVM) need specific env vars to function.
/// This returns a HashMap of env vars that should be set when spawning processes.
pub fn get_version_manager_env_vars() -> std::collections::HashMap<String, String> {
    let mut env_vars = std::collections::HashMap::new();
    let home = std::env::var("HOME").unwrap_or_default();
    
    if home.is_empty() {
        return env_vars;
    }
    
    // NVM
    let nvm_dir = format!("{}/.nvm", home);
    if Path::new(&nvm_dir).exists() {
        env_vars.insert("NVM_DIR".to_string(), nvm_dir);
    }
    
    // Volta
    let volta_home = format!("{}/.volta", home);
    if Path::new(&volta_home).exists() {
        env_vars.insert("VOLTA_HOME".to_string(), volta_home);
    }
    
    // fnm
    let fnm_dir = format!("{}/.local/share/fnm", home);
    if Path::new(&fnm_dir).exists() {
        env_vars.insert("FNM_DIR".to_string(), fnm_dir);
    }
    let fnm_alt_dir = format!("{}/.fnm", home);
    if Path::new(&fnm_alt_dir).exists() {
        env_vars.insert("FNM_DIR".to_string(), fnm_alt_dir);
    }
    
    // asdf
    let asdf_dir = format!("{}/.asdf", home);
    if Path::new(&asdf_dir).exists() {
        env_vars.insert("ASDF_DIR".to_string(), asdf_dir.clone());
        env_vars.insert("ASDF_DATA_DIR".to_string(), asdf_dir);
    }
    
    // mise
    let mise_data_dir = format!("{}/.local/share/mise", home);
    if Path::new(&mise_data_dir).exists() {
        env_vars.insert("MISE_DATA_DIR".to_string(), mise_data_dir);
    }
    
    env_vars
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
    fn test_verify_node_binary_with_real_node() {
        // If we can find node, verify the verification works
        if let Some(found) = find_node() {
            let node_path = Path::new(&found.path).join("node");
            assert!(
                verify_node_binary(&node_path),
                "verify_node_binary should return true for real node at {:?}",
                node_path
            );
        }
    }

    #[test]
    fn test_verify_node_binary_nonexistent() {
        let fake_path = Path::new("/nonexistent/path/to/node");
        assert!(
            !verify_node_binary(fake_path),
            "verify_node_binary should return false for nonexistent path"
        );
    }

    #[test]
    fn test_verify_pnpm_binary_with_real_pnpm() {
        // If we can find pnpm, verify the verification works
        if let Some(pnpm_path) = find_pnpm_path() {
            assert!(
                verify_pnpm_binary(&pnpm_path),
                "verify_pnpm_binary should return true for real pnpm at {}",
                pnpm_path
            );
        }
    }

    #[test]
    fn test_verify_pnpm_binary_nonexistent() {
        assert!(
            !verify_pnpm_binary("/nonexistent/path/to/pnpm"),
            "verify_pnpm_binary should return false for nonexistent path"
        );
    }

    #[test]
    fn test_get_version_manager_env_vars() {
        let env_vars = get_version_manager_env_vars();
        
        // Should return a HashMap (may be empty if no version managers installed)
        // Just verify it doesn't panic and returns valid structure
        for (key, value) in &env_vars {
            assert!(!key.is_empty(), "env var key should not be empty");
            assert!(!value.is_empty(), "env var value should not be empty");
            // Values should be paths that exist
            assert!(
                Path::new(value).exists(),
                "env var {} points to non-existent path: {}",
                key, value
            );
        }
    }

    #[test]
    fn test_find_latest_version_bin_empty_dir() {
        // Should handle non-existent directories gracefully
        let result = find_latest_version_bin("/nonexistent/path");
        assert!(result.is_none());
    }

    #[test]
    fn test_find_latest_version_bin_version_sorting() {
        // Create a temp directory with fake version directories to test sorting
        let temp_dir = std::env::temp_dir().join("moldable_test_versions");
        let _ = std::fs::remove_dir_all(&temp_dir); // Clean up from previous runs
        std::fs::create_dir_all(&temp_dir).unwrap();
        
        // Create fake version directories (without actual node binaries)
        let versions = ["v18.0.0", "v20.11.1", "v22.12.0", "v21.6.2"];
        for v in versions {
            let version_dir = temp_dir.join(v).join("bin");
            std::fs::create_dir_all(&version_dir).unwrap();
            // Create a fake node file
            std::fs::write(version_dir.join("node"), "fake").unwrap();
        }
        
        // find_latest_version_bin should return v22.12.0 (the highest version)
        let result = find_latest_version_bin(temp_dir.to_str().unwrap());
        assert!(result.is_some());
        let result_path = result.unwrap();
        assert!(
            result_path.contains("v22.12.0"),
            "Should find v22.12.0 as latest, got: {}",
            result_path
        );
        
        // Clean up
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_node_source_new_variants() {
        // Test serialization of new NodeSource variants
        let sources = [
            (NodeSource::Asdf, "\"asdf\""),
            (NodeSource::Mise, "\"mise\""),
            (NodeSource::N, "\"n\""),
            (NodeSource::Nodenv, "\"nodenv\""),
        ];
        
        for (source, expected) in sources {
            let json = serde_json::to_string(&source).unwrap();
            assert_eq!(json, expected, "NodeSource::{:?} should serialize to {}", source, expected);
        }
    }

    #[test]
    fn test_build_runtime_path() {
        let path = build_runtime_path();
        
        // Should contain common paths
        assert!(path.contains("/usr/bin"), "PATH should contain /usr/bin");
        
        // Should not be empty
        assert!(!path.is_empty());
        
        // If node is installed, the path should include its directory
        if let Some(node_dir) = find_node_path() {
            assert!(
                path.contains(&node_dir),
                "PATH should contain discovered node directory: {}",
                node_dir
            );
        }
        
        // Should not have duplicate entries
        let parts: Vec<&str> = path.split(':').collect();
        let unique_parts: std::collections::HashSet<&str> = parts.iter().cloned().collect();
        assert_eq!(parts.len(), unique_parts.len(), "PATH should not have duplicates");
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
