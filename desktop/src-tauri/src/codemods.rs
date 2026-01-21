//! App codemods integration
//!
//! Runs codemods on app directories to migrate them to newer Moldable versions.
//! Each codemod is a separate .mjs file in resources/codemods/

use crate::runtime;
use log::{info, warn};
use std::path::Path;
use std::process::Command;

/// Run all pending codemods on an app directory
/// Returns messages about what was applied
pub fn run_pending_codemods(app_dir: &Path) -> Vec<String> {
    let mut messages = Vec::new();

    let node_path = match runtime::get_node_path() {
        Some(p) => p,
        None => {
            warn!("Node not found, skipping codemods");
            return messages;
        }
    };

    let runner_path = get_codemods_runner_path();
    if !runner_path.exists() {
        warn!("Codemods runner not found at {:?}", runner_path);
        return messages;
    }

    let output = Command::new(&node_path)
        .arg(&runner_path)
        .arg(app_dir)
        .env("PATH", runtime::build_runtime_path())
        .output();

    match output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);

            // Log stderr for debugging (codemods use stderr for verbose output)
            for line in stderr.lines() {
                if !line.is_empty() {
                    info!("[codemod] {}", line);
                }
            }

            // Parse JSON output (last line should be JSON result)
            if let Some(json_line) = stdout.lines().last() {
                if json_line.starts_with('{') {
                    if let Ok(result) = serde_json::from_str::<CodemodResult>(json_line) {
                        for applied in &result.applied {
                            messages.push(format!("[codemod] Applied: {}", applied));
                            info!("Applied codemod: {}", applied);
                        }
                        for error in &result.errors {
                            messages.push(format!("[codemod] Error: {}", error));
                            warn!("Codemod error: {}", error);
                        }
                    }
                }
            }

            if !out.status.success() {
                warn!(
                    "Codemods exited with status {}: {}",
                    out.status,
                    stderr.trim()
                );
            }
        }
        Err(e) => {
            warn!("Failed to run codemods: {}", e);
        }
    }

    messages
}

fn get_codemods_runner_path() -> std::path::PathBuf {
    // Try multiple locations to find the runner

    // 1. Check CARGO_MANIFEST_DIR for development
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let dev_path =
            std::path::PathBuf::from(manifest_dir).join("resources/codemods/runner.mjs");
        if dev_path.exists() {
            return dev_path;
        }
    }

    // 2. Check relative to current exe (for production builds)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            // macOS production: Contents/MacOS/../Resources/codemods/runner.mjs
            let macos_resources = exe_dir.join("../Resources/codemods/runner.mjs");
            if macos_resources.exists() {
                return macos_resources;
            }

            // Linux/Windows production: same directory as exe
            let same_dir = exe_dir.join("resources/codemods/runner.mjs");
            if same_dir.exists() {
                return same_dir;
            }

            // Development with cargo run: target/debug/../../src-tauri/resources
            let cargo_dev = exe_dir.join("../../src-tauri/resources/codemods/runner.mjs");
            if cargo_dev.exists() {
                return cargo_dev;
            }
        }
    }

    // 3. Fallback to cwd-relative path
    std::path::PathBuf::from("resources/codemods/runner.mjs")
}

#[derive(serde::Deserialize)]
struct CodemodResult {
    applied: Vec<String>,
    #[allow(dead_code)]
    skipped: Vec<String>,
    errors: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_codemods_runner_path_does_not_panic() {
        let _ = get_codemods_runner_path();
    }
}
