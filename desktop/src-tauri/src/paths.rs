//! Path helpers for Moldable configuration and data directories
//!
//! This module centralizes all path resolution for:
//! - Moldable home directory (~/.moldable)
//! - Workspace directories
//! - Config files
//! - Conversations
//! - Shared resources

use crate::types::WorkspacesConfig;
use std::path::PathBuf;

// ============================================================================
// MOLDABLE ROOT
// ============================================================================

/// Get the Moldable home directory (~/.moldable)
pub fn get_moldable_root() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    Ok(PathBuf::from(format!("{}/.moldable", home)))
}

// ============================================================================
// WORKSPACES
// ============================================================================

/// Get the workspaces.json file path
pub fn get_workspaces_file_path() -> Result<PathBuf, String> {
    let root = get_moldable_root()?;
    Ok(root.join("workspaces.json"))
}

/// Get the workspaces config (internal helper used by path resolution)
pub fn get_workspaces_config_internal() -> Result<WorkspacesConfig, String> {
    let workspaces_path = get_workspaces_file_path()?;

    if !workspaces_path.exists() {
        return Ok(WorkspacesConfig::default());
    }

    let content = std::fs::read_to_string(&workspaces_path)
        .map_err(|e| format!("Failed to read workspaces config: {}", e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse workspaces config: {}", e))
}

/// Get the active workspace directory
pub fn get_active_workspace_dir() -> Result<PathBuf, String> {
    let config = get_workspaces_config_internal()?;
    let root = get_moldable_root()?;
    Ok(root.join("workspaces").join(&config.active_workspace))
}

/// Get a specific workspace directory by ID
pub fn get_workspace_dir(workspace_id: &str) -> Result<PathBuf, String> {
    let root = get_moldable_root()?;
    Ok(root.join("workspaces").join(workspace_id))
}

// ============================================================================
// CONFIG FILES
// ============================================================================

/// Get the active workspace's config.json path
pub fn get_config_file_path() -> Result<PathBuf, String> {
    let workspace_dir = get_active_workspace_dir()?;
    Ok(workspace_dir.join("config.json"))
}

/// Get config.json path for a specific workspace
pub fn get_config_file_path_for_workspace(workspace_id: &str) -> Result<PathBuf, String> {
    let workspace_dir = get_workspace_dir(workspace_id)?;
    Ok(workspace_dir.join("config.json"))
}

/// Get the shared config.json path (~/.moldable/shared/config.json)
pub fn get_shared_config_path() -> Result<PathBuf, String> {
    let root = get_moldable_root()?;
    Ok(root.join("shared").join("config.json"))
}

// ============================================================================
// ENVIRONMENT FILES
// ============================================================================

/// Get the active workspace's .env file path
pub fn get_env_file_path() -> Result<PathBuf, String> {
    let workspace_dir = get_active_workspace_dir()?;
    Ok(workspace_dir.join(".env"))
}

/// Get the shared .env file path (~/.moldable/shared/.env)
pub fn get_shared_env_file_path() -> Result<PathBuf, String> {
    let root = get_moldable_root()?;
    Ok(root.join("shared").join(".env"))
}

// ============================================================================
// CONVERSATIONS
// ============================================================================

/// Get the conversations directory for the active workspace
pub fn get_conversations_dir() -> Result<PathBuf, String> {
    let workspace_dir = get_active_workspace_dir()?;
    Ok(workspace_dir.join("conversations"))
}

// ============================================================================
// SHARED DIRECTORIES
// ============================================================================

/// Get the shared apps directory (~/.moldable/shared/apps)
pub fn get_shared_apps_dir() -> Result<PathBuf, String> {
    let root = get_moldable_root()?;
    Ok(root.join("shared").join("apps"))
}

/// Get the shared scripts directory (~/.moldable/shared/scripts)
pub fn get_shared_scripts_dir() -> Result<PathBuf, String> {
    let root = get_moldable_root()?;
    Ok(root.join("shared").join("scripts"))
}

/// Get the cache directory (~/.moldable/cache)
pub fn get_cache_dir() -> Result<PathBuf, String> {
    let root = get_moldable_root()?;
    Ok(root.join("cache"))
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

/// Get the Moldable config path (Tauri command)
#[tauri::command]
pub fn get_moldable_config_path() -> Result<String, String> {
    get_moldable_root().map(|p| p.to_string_lossy().to_string())
}

/// Get the Moldable root directory (Tauri command)
#[tauri::command]
pub fn get_moldable_root_cmd() -> Result<String, String> {
    get_moldable_root().map(|p| p.to_string_lossy().to_string())
}

/// Reveal a file in the native file manager (Finder on macOS, Explorer on Windows)
#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    
    if !path.exists() {
        return Err(format!("Path does not exist: {}", path.display()));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal in Explorer: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Linux doesn't have a standard way to select a file, so just open the parent folder
        let parent = path.parent().unwrap_or(&path);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_moldable_root() {
        // Should work if HOME is set
        if std::env::var("HOME").is_ok() {
            let root = get_moldable_root();
            assert!(root.is_ok());
            let path = root.unwrap();
            assert!(path.to_string_lossy().contains(".moldable"));
        }
    }

    #[test]
    fn test_get_workspaces_file_path() {
        if std::env::var("HOME").is_ok() {
            let path = get_workspaces_file_path();
            assert!(path.is_ok());
            assert!(path.unwrap().to_string_lossy().contains("workspaces.json"));
        }
    }

    #[test]
    fn test_get_shared_paths() {
        if std::env::var("HOME").is_ok() {
            let apps = get_shared_apps_dir();
            assert!(apps.is_ok());
            assert!(apps.unwrap().to_string_lossy().contains("shared/apps"));

            let scripts = get_shared_scripts_dir();
            assert!(scripts.is_ok());
            assert!(scripts.unwrap().to_string_lossy().contains("shared/scripts"));

            let cache = get_cache_dir();
            assert!(cache.is_ok());
            assert!(cache.unwrap().to_string_lossy().contains("cache"));
        }
    }

    #[test]
    fn test_get_env_paths() {
        if std::env::var("HOME").is_ok() {
            let shared_env = get_shared_env_file_path();
            assert!(shared_env.is_ok());
            assert!(shared_env.unwrap().to_string_lossy().contains("shared/.env"));
        }
    }

    #[test]
    fn test_workspace_dir() {
        if std::env::var("HOME").is_ok() {
            let dir = get_workspace_dir("test-workspace");
            assert!(dir.is_ok());
            assert!(dir.unwrap().to_string_lossy().contains("workspaces/test-workspace"));
        }
    }

    #[test]
    fn test_config_file_path_for_workspace() {
        if std::env::var("HOME").is_ok() {
            let path = get_config_file_path_for_workspace("personal");
            assert!(path.is_ok());
            let path_str = path.unwrap().to_string_lossy().to_string();
            assert!(path_str.contains("workspaces/personal/config.json"));
        }
    }
}
