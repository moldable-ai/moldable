//! Workspace management for Moldable
//!
//! Handles workspace CRUD operations, directory structure setup,
//! and default workspace initialization.

use crate::paths::{
    get_config_file_path, get_moldable_root, get_workspaces_file_path,
    get_workspaces_config_internal,
};
use crate::types::{MoldableConfig, Workspace, WorkspacesConfig};
use log::info;
use tauri::Manager;
use std::path::PathBuf;

// ============================================================================
// WORKSPACE CONFIG PERSISTENCE
// ============================================================================

/// Save workspaces config to disk
pub fn save_workspaces_config(config: &WorkspacesConfig) -> Result<(), String> {
    let workspaces_path = get_workspaces_file_path()?;

    // Ensure parent directory exists
    if let Some(parent) = workspaces_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize workspaces config: {}", e))?;

    std::fs::write(&workspaces_path, content)
        .map_err(|e| format!("Failed to write workspaces config: {}", e))?;

    Ok(())
}

/// Ensure workspace directories exist
pub fn ensure_workspace_dirs(workspace_id: &str) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    let workspace_dir = format!("{}/.moldable/workspaces/{}", home, workspace_id);

    // Create workspace directories
    let dirs = [
        format!("{}/apps", workspace_dir),
        format!("{}/conversations", workspace_dir),
        format!("{}/config", workspace_dir),
    ];

    for dir in &dirs {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create directory {}: {}", dir, e))?;
    }

    // Create empty config.json if it doesn't exist
    let config_path = format!("{}/config.json", workspace_dir);
    if !std::path::Path::new(&config_path).exists() {
        let default_config = MoldableConfig::default();
        let content = serde_json::to_string_pretty(&default_config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        std::fs::write(&config_path, content)
            .map_err(|e| format!("Failed to write config: {}", e))?;
    }

    Ok(())
}

/// Get config.json paths for all workspaces (used for migrations)
pub fn get_all_workspace_config_paths() -> Result<Vec<PathBuf>, String> {
    let moldable_root = get_moldable_root()?;
    let workspaces_dir = moldable_root.join("workspaces");

    if !workspaces_dir.exists() {
        return Ok(vec![]);
    }

    let mut config_paths = Vec::new();

    let entries = std::fs::read_dir(&workspaces_dir)
        .map_err(|e| format!("Failed to read workspaces directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let config_path = path.join("config.json");
            if config_path.exists() {
                config_paths.push(config_path);
            }
        }
    }

    Ok(config_paths)
}

// ============================================================================
// DEFAULT WORKSPACE SETUP
// ============================================================================

/// Ensure default workspace structure exists on fresh install
pub fn ensure_default_workspace() -> Result<(), String> {
    let moldable_root = get_moldable_root()?;
    let workspaces_file = moldable_root.join("workspaces.json");
    let personal_workspace = moldable_root.join("workspaces/personal");
    let shared_dir = moldable_root.join("shared");
    let shared_apps_dir = moldable_root.join("shared/apps");
    let shared_scripts_dir = moldable_root.join("shared/scripts");
    let cache_dir = moldable_root.join("cache");

    // Skip if already set up
    if workspaces_file.exists() && personal_workspace.join("config.json").exists() {
        // Still ensure shared/apps, shared/scripts, and cache exist (may be missing from older installs)
        let _ = std::fs::create_dir_all(&shared_apps_dir);
        let _ = std::fs::create_dir_all(&shared_scripts_dir);
        let _ = std::fs::create_dir_all(&cache_dir);
        return Ok(());
    }

    info!("Setting up default workspace structure...");

    // Create directories
    std::fs::create_dir_all(&personal_workspace)
        .map_err(|e| format!("Failed to create personal workspace: {}", e))?;
    std::fs::create_dir_all(&shared_dir)
        .map_err(|e| format!("Failed to create shared directory: {}", e))?;
    std::fs::create_dir_all(&shared_apps_dir)
        .map_err(|e| format!("Failed to create shared apps directory: {}", e))?;
    std::fs::create_dir_all(&shared_scripts_dir)
        .map_err(|e| format!("Failed to create shared scripts directory: {}", e))?;
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create cache directory: {}", e))?;

    // Create default workspaces.json
    save_workspaces_config(&WorkspacesConfig::default())?;

    // Create default config.json in personal workspace
    ensure_workspace_dirs("personal")?;

    info!("Created default workspace structure");
    Ok(())
}

/// Ensure bundled scripts are installed in ~/.moldable/shared/scripts/
pub fn ensure_bundled_scripts(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    let scripts_dir = PathBuf::from(format!("{}/.moldable/shared/scripts", home));

    // Ensure scripts directory exists
    std::fs::create_dir_all(&scripts_dir)
        .map_err(|e| format!("Failed to create scripts directory: {}", e))?;

    // Scripts to install
    let scripts = vec!["lint-moldable-app.js"];

    for script_name in scripts {
        let dest_path = scripts_dir.join(script_name);

        // Try to get from bundled resources first
        let resource_path = app_handle
            .path()
            .resource_dir()
            .map_err(|e| format!("Failed to get resource dir: {}", e))?
            .join(script_name);

        if resource_path.exists() {
            // Copy from bundled resources (production)
            std::fs::copy(&resource_path, &dest_path)
                .map_err(|e| format!("Failed to copy {}: {}", script_name, e))?;
            info!("Installed {} to ~/.moldable/shared/scripts/", script_name);
        } else {
            // In development, try to copy from the workspace scripts directory
            if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
                let dev_script_path = PathBuf::from(&manifest_dir)
                    .parent() // desktop
                    .and_then(|p| p.parent()) // moldable root
                    .map(|p| p.join("scripts").join(script_name));

                if let Some(dev_path) = dev_script_path {
                    if dev_path.exists() {
                        std::fs::copy(&dev_path, &dest_path)
                            .map_err(|e| format!("Failed to copy {}: {}", script_name, e))?;
                        info!(
                            "Installed {} to ~/.moldable/shared/scripts/ (dev)",
                            script_name
                        );
                    }
                }
            }
        }
    }

    Ok(())
}

/// Ensure bundled app template is installed in ~/.moldable/cache/app-template/
pub fn ensure_bundled_app_template(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "Could not get HOME directory")?;
    let template_dest = PathBuf::from(format!("{}/.moldable/cache/app-template", home));

    // Try to get from bundled resources first (production)
    let resource_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to get resource dir: {}", e))?;
    let template_source = resource_dir.join("app-template");

    if template_source.exists() {
        copy_dir_recursive(&template_source, &template_dest)?;
        info!("Installed app-template to ~/.moldable/cache/app-template/");
    } else {
        // In development, copy from desktop/resources/app-template
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let dev_template_path = PathBuf::from(&manifest_dir)
                .parent() // desktop
                .map(|p| p.join("resources").join("app-template"));

            if let Some(dev_path) = dev_template_path {
                if dev_path.exists() {
                    copy_dir_recursive(&dev_path, &template_dest)?;
                    info!("Installed app-template to ~/.moldable/cache/app-template/ (dev)");
                }
            }
        }
    }

    Ok(())
}

/// Recursively copy a directory
pub fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), String> {
    // Remove existing destination to ensure clean copy
    if dst.exists() {
        std::fs::remove_dir_all(dst)
            .map_err(|e| format!("Failed to remove existing template: {}", e))?;
    }

    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Failed to create directory {:?}: {}", dst, e))?;

    for entry in std::fs::read_dir(src)
        .map_err(|e| format!("Failed to read directory {:?}: {}", src, e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            std::fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy {:?} to {:?}: {}", src_path, dst_path, e))?;
        }
    }

    Ok(())
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

#[tauri::command]
pub fn get_workspaces_config() -> Result<WorkspacesConfig, String> {
    get_workspaces_config_internal()
}

#[tauri::command]
pub fn set_active_workspace(workspace_id: String) -> Result<(), String> {
    let mut config = get_workspaces_config_internal()?;

    // Verify workspace exists
    if !config.workspaces.iter().any(|w| w.id == workspace_id) {
        return Err(format!("Workspace '{}' not found", workspace_id));
    }

    config.active_workspace = workspace_id;
    save_workspaces_config(&config)
}

#[tauri::command]
pub fn create_workspace(name: String, color: Option<String>) -> Result<Workspace, String> {
    let mut config = get_workspaces_config_internal()?;

    // Generate ID from name
    let id = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    // Check for duplicate ID
    if config.workspaces.iter().any(|w| w.id == id) {
        return Err(format!("A workspace with ID '{}' already exists", id));
    }

    let workspace = Workspace {
        id: id.clone(),
        name,
        color: color.unwrap_or_else(|| "#10b981".to_string()),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    config.workspaces.push(workspace.clone());
    save_workspaces_config(&config)?;

    // Create workspace directories
    ensure_workspace_dirs(&id)?;

    Ok(workspace)
}

#[tauri::command]
pub fn update_workspace(
    workspace_id: String,
    name: Option<String>,
    color: Option<String>,
) -> Result<Workspace, String> {
    let mut config = get_workspaces_config_internal()?;

    let workspace = config
        .workspaces
        .iter_mut()
        .find(|w| w.id == workspace_id)
        .ok_or_else(|| format!("Workspace '{}' not found", workspace_id))?;

    if let Some(n) = name {
        workspace.name = n;
    }
    if let Some(c) = color {
        workspace.color = c;
    }

    let updated = workspace.clone();
    save_workspaces_config(&config)?;

    Ok(updated)
}

#[tauri::command]
pub fn delete_workspace(workspace_id: String) -> Result<(), String> {
    let mut config = get_workspaces_config_internal()?;

    if config.workspaces.len() <= 1 {
        return Err("Cannot delete the last workspace".to_string());
    }

    if !config.workspaces.iter().any(|w| w.id == workspace_id) {
        return Err(format!("Workspace '{}' not found", workspace_id));
    }

    config.workspaces.retain(|w| w.id != workspace_id);

    // If we deleted the active workspace, switch to the first remaining one
    if config.active_workspace == workspace_id {
        config.active_workspace = config.workspaces[0].id.clone();
    }

    save_workspaces_config(&config)?;

    // Note: We don't delete the workspace directory to prevent data loss
    // Users can manually delete ~/.moldable/workspaces/{id}/ if they want

    Ok(())
}

#[tauri::command]
pub fn get_workspace_path() -> Result<Option<String>, String> {
    let config_path = get_config_file_path()?;

    if !config_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let config: MoldableConfig =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    Ok(config.workspace)
}

#[tauri::command]
pub fn set_workspace_path(path: Option<String>) -> Result<(), String> {
    let config_path = get_config_file_path()?;

    // Ensure directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    // Load existing config
    let mut config = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        MoldableConfig::default()
    };

    config.workspace = path;

    // Save config
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::env::parse_env_file;
    use crate::types::{AppInstance, RegisteredApp};
    use std::fs;
    use tempfile::TempDir;

    /// Helper to create a temporary Moldable-like directory structure for testing
    struct TempMoldableEnv {
        _temp_dir: TempDir,
        pub moldable_root: PathBuf,
    }

    impl TempMoldableEnv {
        fn new() -> Self {
            let temp_dir = TempDir::new().unwrap();
            let moldable_root = temp_dir.path().join(".moldable");
            fs::create_dir_all(&moldable_root).unwrap();

            Self {
                _temp_dir: temp_dir,
                moldable_root,
            }
        }

        fn create_workspaces_config(&self, config: &WorkspacesConfig) {
            let path = self.moldable_root.join("workspaces.json");
            let content = serde_json::to_string_pretty(config).unwrap();
            fs::write(path, content).unwrap();
        }

        fn create_workspace_dir(&self, workspace_id: &str) {
            let workspace_dir = self.moldable_root.join("workspaces").join(workspace_id);
            fs::create_dir_all(workspace_dir.join("apps")).unwrap();
            fs::create_dir_all(workspace_dir.join("conversations")).unwrap();
            fs::create_dir_all(workspace_dir.join("config")).unwrap();
        }

        fn create_shared_dir(&self) {
            let shared_dir = self.moldable_root.join("shared");
            fs::create_dir_all(shared_dir.join("apps")).unwrap();
            fs::create_dir_all(shared_dir.join("scripts")).unwrap();
            fs::create_dir_all(shared_dir.join("skills")).unwrap();
            fs::create_dir_all(shared_dir.join("config")).unwrap();
        }

        fn create_workspace_config(&self, workspace_id: &str, config: &MoldableConfig) {
            let path = self
                .moldable_root
                .join("workspaces")
                .join(workspace_id)
                .join("config.json");
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            let content = serde_json::to_string_pretty(config).unwrap();
            fs::write(path, content).unwrap();
        }

        fn create_env_file(&self, workspace_id: &str, content: &str) {
            let path = self
                .moldable_root
                .join("workspaces")
                .join(workspace_id)
                .join(".env");
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, content).unwrap();
        }

        fn create_shared_env_file(&self, content: &str) {
            let path = self.moldable_root.join("shared").join(".env");
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, content).unwrap();
        }

        fn read_workspaces_config(&self) -> WorkspacesConfig {
            let path = self.moldable_root.join("workspaces.json");
            let content = fs::read_to_string(path).unwrap();
            serde_json::from_str(&content).unwrap()
        }

        fn read_workspace_config(&self, workspace_id: &str) -> MoldableConfig {
            let path = self
                .moldable_root
                .join("workspaces")
                .join(workspace_id)
                .join("config.json");
            let content = fs::read_to_string(path).unwrap();
            serde_json::from_str(&content).unwrap()
        }
    }

    // ==================== WORKSPACE ID GENERATION TESTS ====================

    #[test]
    fn test_workspace_id_generation() {
        let test_cases = vec![
            ("Personal", "personal"),
            ("Work Projects", "work-projects"),
            ("My Side Project", "my-side-project"),
            ("Test  Multiple   Spaces", "test-multiple-spaces"),
        ];

        for (name, expected_id) in test_cases {
            let id: String = name
                .to_lowercase()
                .chars()
                .map(|c| if c.is_alphanumeric() { c } else { '-' })
                .collect::<String>()
                .split('-')
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join("-");

            assert_eq!(
                id, expected_id,
                "Name '{}' should produce ID '{}'",
                name, expected_id
            );
        }
    }

    // ==================== FILE PERSISTENCE TESTS ====================

    #[test]
    fn test_workspace_file_persistence() {
        let env = TempMoldableEnv::new();

        let config = WorkspacesConfig {
            active_workspace: "work".to_string(),
            workspaces: vec![
                Workspace {
                    id: "personal".to_string(),
                    name: "Personal".to_string(),
                    color: "#10b981".to_string(),
                    created_at: "2026-01-01T00:00:00Z".to_string(),
                },
                Workspace {
                    id: "work".to_string(),
                    name: "Work".to_string(),
                    color: "#3b82f6".to_string(),
                    created_at: "2026-01-02T00:00:00Z".to_string(),
                },
            ],
        };

        env.create_workspaces_config(&config);

        let read_config = env.read_workspaces_config();
        assert_eq!(read_config.active_workspace, "work");
        assert_eq!(read_config.workspaces.len(), 2);
    }

    #[test]
    fn test_moldable_config_persistence() {
        let env = TempMoldableEnv::new();
        env.create_workspace_dir("personal");

        let config = MoldableConfig {
            workspace: Some("/Users/test/moldable".to_string()),
            apps: vec![
                RegisteredApp {
                    id: "app1".to_string(),
                    name: "App 1".to_string(),
                    icon: "📱".to_string(),
                    icon_path: None,
                    port: 3001,
                    path: "/app1".to_string(),
                    command: "pnpm".to_string(),
                    args: vec!["dev".to_string()],
                    widget_size: "medium".to_string(),
                    requires_port: false,
                },
                RegisteredApp {
                    id: "app2".to_string(),
                    name: "App 2".to_string(),
                    icon: "💻".to_string(),
                    icon_path: None,
                    port: 3002,
                    path: "/app2".to_string(),
                    command: "pnpm".to_string(),
                    args: vec!["dev".to_string()],
                    widget_size: "large".to_string(),
                    requires_port: true,
                },
            ],
            preferences: serde_json::Map::new(),
        };

        env.create_workspace_config("personal", &config);

        let read_config = env.read_workspace_config("personal");
        assert_eq!(read_config.apps.len(), 2);
        assert_eq!(read_config.apps[0].id, "app1");
        assert_eq!(read_config.apps[1].id, "app2");
        assert!(read_config.apps[1].requires_port);
    }

    #[test]
    fn test_preferences_persistence() {
        let env = TempMoldableEnv::new();
        env.create_workspace_dir("personal");

        let mut preferences = serde_json::Map::new();
        preferences.insert("theme".to_string(), serde_json::json!("dark"));
        preferences.insert("model".to_string(), serde_json::json!("claude-opus-4"));
        preferences.insert("reasoning_effort".to_string(), serde_json::json!("high"));

        let config = MoldableConfig {
            workspace: None,
            apps: vec![],
            preferences,
        };

        env.create_workspace_config("personal", &config);

        let read_config = env.read_workspace_config("personal");
        assert_eq!(read_config.preferences.get("theme").unwrap(), "dark");
        assert_eq!(read_config.preferences.get("model").unwrap(), "claude-opus-4");
    }

    // ==================== DIRECTORY STRUCTURE TESTS ====================

    #[test]
    fn test_fresh_install_default_workspace_setup() {
        let env = TempMoldableEnv::new();

        // Fresh install: no workspaces.json, no directories
        assert!(!env.moldable_root.join("workspaces.json").exists());
        assert!(!env.moldable_root.join("workspaces/personal").exists());

        // Simulate ensure_default_workspace() logic:
        let personal_workspace = env.moldable_root.join("workspaces/personal");
        fs::create_dir_all(&personal_workspace).unwrap();

        let shared_dir = env.moldable_root.join("shared");
        fs::create_dir_all(shared_dir.join("apps")).unwrap();
        fs::create_dir_all(shared_dir.join("scripts")).unwrap();
        fs::create_dir_all(shared_dir.join("skills")).unwrap();
        fs::create_dir_all(shared_dir.join("config")).unwrap();

        fs::create_dir_all(env.moldable_root.join("cache")).unwrap();

        env.create_workspaces_config(&WorkspacesConfig::default());

        fs::create_dir_all(personal_workspace.join("apps")).unwrap();
        fs::create_dir_all(personal_workspace.join("conversations")).unwrap();
        fs::create_dir_all(personal_workspace.join("config")).unwrap();

        let default_config = MoldableConfig::default();
        let config_path = personal_workspace.join("config.json");
        let content = serde_json::to_string_pretty(&default_config).unwrap();
        fs::write(&config_path, content).unwrap();

        // Verify the complete structure
        assert!(env.moldable_root.join("workspaces.json").exists());
        assert!(env.moldable_root.join("workspaces/personal").exists());
        assert!(env.moldable_root.join("workspaces/personal/apps").exists());
        assert!(env.moldable_root.join("workspaces/personal/conversations").exists());
        assert!(env.moldable_root.join("workspaces/personal/config").exists());
        assert!(env.moldable_root.join("workspaces/personal/config.json").exists());
        assert!(env.moldable_root.join("shared").exists());
        assert!(env.moldable_root.join("shared/apps").exists());
        assert!(env.moldable_root.join("shared/scripts").exists());
        assert!(env.moldable_root.join("shared/skills").exists());
        assert!(env.moldable_root.join("shared/config").exists());
        assert!(env.moldable_root.join("cache").exists());

        let workspaces_config = env.read_workspaces_config();
        assert_eq!(workspaces_config.active_workspace, "personal");
        assert_eq!(workspaces_config.workspaces.len(), 1);
        assert_eq!(workspaces_config.workspaces[0].id, "personal");
        assert_eq!(workspaces_config.workspaces[0].name, "Personal");
        assert_eq!(workspaces_config.workspaces[0].color, "#10b981");

        let config = env.read_workspace_config("personal");
        assert!(config.workspace.is_none());
        assert!(config.apps.is_empty());
        assert!(config.preferences.is_empty());
    }

    #[test]
    fn test_workspace_directory_structure() {
        let env = TempMoldableEnv::new();
        env.create_workspace_dir("personal");
        env.create_shared_dir();

        assert!(env.moldable_root.join("workspaces/personal/apps").exists());
        assert!(env.moldable_root.join("workspaces/personal/conversations").exists());
        assert!(env.moldable_root.join("workspaces/personal/config").exists());
        
        assert!(env.moldable_root.join("shared/apps").exists());
        assert!(env.moldable_root.join("shared/scripts").exists());
        assert!(env.moldable_root.join("shared/skills").exists());
        assert!(env.moldable_root.join("shared/config").exists());
    }

    #[test]
    fn test_shared_scripts_directory() {
        let env = TempMoldableEnv::new();
        env.create_shared_dir();

        let scripts_dir = env.moldable_root.join("shared/scripts");
        assert!(scripts_dir.exists());

        let test_script = scripts_dir.join("lint-moldable-app.js");
        fs::write(&test_script, "// test script content").unwrap();
        
        assert!(test_script.exists());
        let content = fs::read_to_string(&test_script).unwrap();
        assert!(content.contains("test script content"));
    }

    // ==================== ENV LAYERING TESTS ====================

    #[test]
    fn test_env_layering_with_temp_moldable_env() {
        let env = TempMoldableEnv::new();
        env.create_shared_dir();
        env.create_workspace_dir("personal");

        env.create_shared_env_file("ANTHROPIC_API_KEY=sk-shared\nOPENAI_API_KEY=sk-openai-shared");
        env.create_env_file("personal", "OPENAI_API_KEY=sk-openai-personal\nWORKSPACE_KEY=personal-only");

        let shared = parse_env_file(&env.moldable_root.join("shared/.env"));
        let workspace = parse_env_file(&env.moldable_root.join("workspaces/personal/.env"));

        let mut merged = shared;
        merged.extend(workspace);

        assert_eq!(merged.get("ANTHROPIC_API_KEY"), Some(&"sk-shared".to_string()));
        assert_eq!(merged.get("OPENAI_API_KEY"), Some(&"sk-openai-personal".to_string()));
        assert_eq!(merged.get("WORKSPACE_KEY"), Some(&"personal-only".to_string()));
    }

    #[test]
    fn test_env_layering_empty_workspace() {
        let env = TempMoldableEnv::new();
        env.create_shared_dir();
        env.create_workspace_dir("personal");

        env.create_shared_env_file("SHARED_KEY=shared_value");

        let shared = parse_env_file(&env.moldable_root.join("shared/.env"));
        let workspace = parse_env_file(&env.moldable_root.join("workspaces/personal/.env"));

        let mut merged = shared;
        merged.extend(workspace);

        assert_eq!(merged.get("SHARED_KEY"), Some(&"shared_value".to_string()));
        assert_eq!(merged.len(), 1);
    }

    #[test]
    fn test_env_layering_empty_shared() {
        let env = TempMoldableEnv::new();
        env.create_shared_dir();
        env.create_workspace_dir("personal");

        env.create_env_file("personal", "WORKSPACE_KEY=workspace_value");

        let shared = parse_env_file(&env.moldable_root.join("shared/.env"));
        let workspace = parse_env_file(&env.moldable_root.join("workspaces/personal/.env"));

        let mut merged = shared;
        merged.extend(workspace);

        assert_eq!(merged.get("WORKSPACE_KEY"), Some(&"workspace_value".to_string()));
        assert_eq!(merged.len(), 1);
    }

    // ==================== ROUNDTRIP TESTS ====================

    #[test]
    fn test_full_workspace_config_roundtrip() {
        let config = WorkspacesConfig {
            active_workspace: "work".to_string(),
            workspaces: vec![
                Workspace {
                    id: "personal".to_string(),
                    name: "Personal".to_string(),
                    color: "#10b981".to_string(),
                    created_at: "2026-01-01T00:00:00Z".to_string(),
                },
                Workspace {
                    id: "work".to_string(),
                    name: "Work".to_string(),
                    color: "#3b82f6".to_string(),
                    created_at: "2026-01-02T00:00:00Z".to_string(),
                },
                Workspace {
                    id: "side-project".to_string(),
                    name: "Side Project".to_string(),
                    color: "#ef4444".to_string(),
                    created_at: "2026-01-03T00:00:00Z".to_string(),
                },
            ],
        };

        let json = serde_json::to_string_pretty(&config).unwrap();
        let parsed: WorkspacesConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.active_workspace, config.active_workspace);
        assert_eq!(parsed.workspaces.len(), config.workspaces.len());

        for (original, parsed_ws) in config.workspaces.iter().zip(parsed.workspaces.iter()) {
            assert_eq!(original.id, parsed_ws.id);
            assert_eq!(original.name, parsed_ws.name);
            assert_eq!(original.color, parsed_ws.color);
            assert_eq!(original.created_at, parsed_ws.created_at);
        }
    }

    #[test]
    fn test_full_moldable_config_roundtrip() {
        let mut preferences = serde_json::Map::new();
        preferences.insert("theme".to_string(), serde_json::json!("dark"));
        preferences.insert("model".to_string(), serde_json::json!("claude-3-opus"));

        let config = MoldableConfig {
            workspace: Some("/Users/test/moldable".to_string()),
            apps: vec![
                RegisteredApp {
                    id: "scribo".to_string(),
                    name: "Scribo".to_string(),
                    icon: "✍️".to_string(),
                    icon_path: None,
                    port: 3001,
                    path: "/path/to/scribo".to_string(),
                    command: "/opt/homebrew/bin/pnpm".to_string(),
                    args: vec!["dev".to_string()],
                    widget_size: "medium".to_string(),
                    requires_port: false,
                },
                RegisteredApp {
                    id: "todo".to_string(),
                    name: "Todo".to_string(),
                    icon: "✅".to_string(),
                    icon_path: None,
                    port: 3002,
                    path: "/path/to/todo".to_string(),
                    command: "/opt/homebrew/bin/pnpm".to_string(),
                    args: vec!["dev".to_string()],
                    widget_size: "small".to_string(),
                    requires_port: true,
                },
            ],
            preferences,
        };

        let json = serde_json::to_string_pretty(&config).unwrap();
        let parsed: MoldableConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.workspace, config.workspace);
        assert_eq!(parsed.apps.len(), config.apps.len());
        assert_eq!(parsed.preferences.len(), 2);
    }

    // ==================== COMPLETE SETUP TESTS ====================

    #[test]
    fn test_complete_workspace_setup() {
        let env = TempMoldableEnv::new();

        let workspaces_config = WorkspacesConfig {
            active_workspace: "personal".to_string(),
            workspaces: vec![
                Workspace {
                    id: "personal".to_string(),
                    name: "Personal".to_string(),
                    color: "#10b981".to_string(),
                    created_at: "2026-01-01T00:00:00Z".to_string(),
                },
                Workspace {
                    id: "work".to_string(),
                    name: "Work".to_string(),
                    color: "#3b82f6".to_string(),
                    created_at: "2026-01-02T00:00:00Z".to_string(),
                },
            ],
        };
        env.create_workspaces_config(&workspaces_config);

        env.create_workspace_dir("personal");
        env.create_workspace_dir("work");
        env.create_shared_dir();

        env.create_shared_env_file("ANTHROPIC_API_KEY=sk-shared-key");
        env.create_env_file("personal", "PERSONAL_KEY=personal-value");
        env.create_env_file("work", "WORK_KEY=work-value");

        let personal_config = MoldableConfig {
            workspace: None,
            apps: vec![RegisteredApp {
                id: "personal-app".to_string(),
                name: "Personal App".to_string(),
                icon: "🏠".to_string(),
                icon_path: None,
                port: 3001,
                path: "/personal-app".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "medium".to_string(),
                requires_port: false,
            }],
            preferences: serde_json::Map::new(),
        };
        env.create_workspace_config("personal", &personal_config);

        let work_config = MoldableConfig {
            workspace: None,
            apps: vec![RegisteredApp {
                id: "work-app".to_string(),
                name: "Work App".to_string(),
                icon: "💼".to_string(),
                icon_path: None,
                port: 3002,
                path: "/work-app".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "large".to_string(),
                requires_port: true,
            }],
            preferences: serde_json::Map::new(),
        };
        env.create_workspace_config("work", &work_config);

        // Verify everything exists and is readable
        let read_workspaces = env.read_workspaces_config();
        assert_eq!(read_workspaces.workspaces.len(), 2);

        let read_personal = env.read_workspace_config("personal");
        assert_eq!(read_personal.apps.len(), 1);
        assert_eq!(read_personal.apps[0].id, "personal-app");

        let read_work = env.read_workspace_config("work");
        assert_eq!(read_work.apps.len(), 1);
        assert_eq!(read_work.apps[0].id, "work-app");

        // Verify env layering for personal workspace
        let shared = parse_env_file(&env.moldable_root.join("shared/.env"));
        let personal_env = parse_env_file(&env.moldable_root.join("workspaces/personal/.env"));
        let mut merged = shared.clone();
        merged.extend(personal_env);
        assert_eq!(merged.get("ANTHROPIC_API_KEY"), Some(&"sk-shared-key".to_string()));
        assert_eq!(merged.get("PERSONAL_KEY"), Some(&"personal-value".to_string()));

        // Verify env layering for work workspace
        let work_env = parse_env_file(&env.moldable_root.join("workspaces/work/.env"));
        let mut work_merged = shared;
        work_merged.extend(work_env);
        assert_eq!(work_merged.get("ANTHROPIC_API_KEY"), Some(&"sk-shared-key".to_string()));
        assert_eq!(work_merged.get("WORK_KEY"), Some(&"work-value".to_string()));
    }

    // ==================== SHARED APPS TESTS ====================

    #[test]
    fn test_shared_apps_directory_structure() {
        let env = TempMoldableEnv::new();

        let shared_apps_dir = env.moldable_root.join("shared/apps");
        fs::create_dir_all(&shared_apps_dir).unwrap();

        let app_dir = shared_apps_dir.join("scribo");
        fs::create_dir_all(&app_dir).unwrap();

        let manifest = serde_json::json!({
            "name": "Scribo",
            "icon": "✍️",
            "version": "0.1.0",
            "upstream": {
                "repo": "moldable-ai/apps",
                "path": "scribo",
                "installedVersion": "0.1.0",
                "installedCommit": "abc123",
                "installedAt": "2026-01-14T10:00:00Z"
            },
            "modified": false
        });
        fs::write(
            app_dir.join("moldable.json"),
            serde_json::to_string_pretty(&manifest).unwrap(),
        ).unwrap();

        assert!(env.moldable_root.join("shared/apps/scribo").exists());
        assert!(env.moldable_root.join("shared/apps/scribo/moldable.json").exists());
    }

    #[test]
    fn test_app_shared_across_workspaces() {
        let env = TempMoldableEnv::new();

        let shared_apps_dir = env.moldable_root.join("shared/apps");
        fs::create_dir_all(shared_apps_dir.join("notes")).unwrap();

        env.create_workspace_dir("personal");
        env.create_workspace_dir("work");

        let app_registration = RegisteredApp {
            id: "notes".to_string(),
            name: "Notes".to_string(),
            icon: "📝".to_string(),
            icon_path: None,
            port: 3001,
            path: env.moldable_root.join("shared/apps/notes").to_string_lossy().to_string(),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: "medium".to_string(),
            requires_port: false,
        };

        let personal_config = MoldableConfig {
            workspace: None,
            apps: vec![app_registration.clone()],
            preferences: serde_json::Map::new(),
        };
        env.create_workspace_config("personal", &personal_config);

        let work_config = MoldableConfig {
            workspace: None,
            apps: vec![app_registration],
            preferences: serde_json::Map::new(),
        };
        env.create_workspace_config("work", &work_config);

        let read_personal = env.read_workspace_config("personal");
        let read_work = env.read_workspace_config("work");

        assert_eq!(read_personal.apps.len(), 1);
        assert_eq!(read_work.apps.len(), 1);

        // Both point to the same shared path
        assert_eq!(read_personal.apps[0].path, read_work.apps[0].path);
        assert!(read_personal.apps[0].path.contains("shared/apps/notes"));
    }

    #[test]
    fn test_workspace_app_data_isolation() {
        let env = TempMoldableEnv::new();

        let personal_data = env.moldable_root.join("workspaces/personal/apps/notes/data");
        let work_data = env.moldable_root.join("workspaces/work/apps/notes/data");

        fs::create_dir_all(&personal_data).unwrap();
        fs::create_dir_all(&work_data).unwrap();

        fs::write(personal_data.join("notes.db"), "personal data").unwrap();
        fs::write(work_data.join("notes.db"), "work data").unwrap();

        let personal_content = fs::read_to_string(personal_data.join("notes.db")).unwrap();
        let work_content = fs::read_to_string(work_data.join("notes.db")).unwrap();

        assert_eq!(personal_content, "personal data");
        assert_eq!(work_content, "work data");
        assert_ne!(personal_content, work_content);
    }

    #[test]
    fn test_check_app_registered_in_workspace() {
        let env = TempMoldableEnv::new();
        env.create_workspace_dir("personal");
        env.create_workspace_dir("work");

        let personal_config = MoldableConfig {
            workspace: None,
            apps: vec![RegisteredApp {
                id: "scribo".to_string(),
                name: "Scribo".to_string(),
                icon: "✍️".to_string(),
                icon_path: None,
                port: 3001,
                path: "/shared/apps/scribo".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "medium".to_string(),
                requires_port: false,
            }],
            preferences: serde_json::Map::new(),
        };
        env.create_workspace_config("personal", &personal_config);

        let work_config = MoldableConfig {
            workspace: None,
            apps: vec![],
            preferences: serde_json::Map::new(),
        };
        env.create_workspace_config("work", &work_config);

        let read_personal = env.read_workspace_config("personal");
        let read_work = env.read_workspace_config("work");

        assert!(read_personal.apps.iter().any(|a| a.id == "scribo"));
        assert!(!read_work.apps.iter().any(|a| a.id == "scribo"));
    }

    #[test]
    fn test_same_app_different_ports_per_workspace() {
        let env = TempMoldableEnv::new();
        env.create_workspace_dir("personal");
        env.create_workspace_dir("work");

        let personal_config = MoldableConfig {
            workspace: None,
            apps: vec![RegisteredApp {
                id: "notes".to_string(),
                name: "Notes".to_string(),
                icon: "📝".to_string(),
                icon_path: None,
                port: 3001,
                path: "/shared/apps/notes".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "medium".to_string(),
                requires_port: false,
            }],
            preferences: serde_json::Map::new(),
        };
        env.create_workspace_config("personal", &personal_config);

        let work_config = MoldableConfig {
            workspace: None,
            apps: vec![RegisteredApp {
                id: "notes".to_string(),
                name: "Notes".to_string(),
                icon: "📝".to_string(),
                icon_path: None,
                port: 4001, // Different port
                path: "/shared/apps/notes".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "large".to_string(), // Different widget size
                requires_port: false,
            }],
            preferences: serde_json::Map::new(),
        };
        env.create_workspace_config("work", &work_config);

        let read_personal = env.read_workspace_config("personal");
        let read_work = env.read_workspace_config("work");

        // Same app ID, same path
        assert_eq!(read_personal.apps[0].id, read_work.apps[0].id);
        assert_eq!(read_personal.apps[0].path, read_work.apps[0].path);

        // Different ports and widget sizes
        assert_ne!(read_personal.apps[0].port, read_work.apps[0].port);
        assert_ne!(read_personal.apps[0].widget_size, read_work.apps[0].widget_size);
    }

    // ==================== WORKSPACE ISOLATION TESTS ====================

    #[test]
    fn test_workspace_directory_isolation() {
        let env = TempMoldableEnv::new();
        env.create_workspace_dir("personal");
        env.create_workspace_dir("work");

        let personal_config = MoldableConfig {
            workspace: None,
            apps: vec![RegisteredApp {
                id: "personal-app".to_string(),
                name: "Personal App".to_string(),
                icon: "🏠".to_string(),
                icon_path: None,
                port: 3001,
                path: "/personal".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "medium".to_string(),
                requires_port: false,
            }],
            preferences: serde_json::Map::new(),
        };

        let work_config = MoldableConfig {
            workspace: None,
            apps: vec![RegisteredApp {
                id: "work-app".to_string(),
                name: "Work App".to_string(),
                icon: "💼".to_string(),
                icon_path: None,
                port: 3001, // Same port is fine - different workspace
                path: "/work".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "large".to_string(),
                requires_port: false,
            }],
            preferences: serde_json::Map::new(),
        };

        env.create_workspace_config("personal", &personal_config);
        env.create_workspace_config("work", &work_config);

        let read_personal = env.read_workspace_config("personal");
        let read_work = env.read_workspace_config("work");

        assert_eq!(read_personal.apps[0].id, "personal-app");
        assert_eq!(read_work.apps[0].id, "work-app");

        // Both can use same port (they're isolated)
        assert_eq!(read_personal.apps[0].port, read_work.apps[0].port);
    }

    // ==================== FILE PATH TESTS ====================

    #[test]
    fn test_instances_file_parsing() {
        let dir = TempDir::new().unwrap();
        let instances_file = dir.path().join(".moldable.instances.json");

        let content = r#"[
            {"pid": 12345, "port": 3001, "startedAt": "2026-01-14T10:00:00Z"},
            {"pid": 12346, "port": 3002, "startedAt": "2026-01-14T10:01:00Z"}
        ]"#;
        fs::write(&instances_file, content).unwrap();

        let content = fs::read_to_string(&instances_file).unwrap();
        let instances: Vec<AppInstance> = serde_json::from_str(&content).unwrap();

        assert_eq!(instances.len(), 2);
        assert_eq!(instances[0].pid, 12345);
        assert_eq!(instances[1].pid, 12346);
    }

    #[test]
    fn test_port_file_content() {
        let dir = TempDir::new().unwrap();
        let port_file = dir.path().join(".moldable.port");

        fs::write(&port_file, "3001\n").unwrap();

        let content = fs::read_to_string(&port_file).unwrap();
        let port: u16 = content.trim().parse().unwrap();

        assert_eq!(port, 3001);
    }

    // ==================== COPY DIR RECURSIVE TESTS ====================

    #[test]
    fn test_copy_dir_recursive_basic() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        let dst_path = dst_dir.path().join("copied");

        // Create source files
        fs::write(src_dir.path().join("file1.txt"), "content1").unwrap();
        fs::write(src_dir.path().join("file2.txt"), "content2").unwrap();

        // Copy
        let result = copy_dir_recursive(&src_dir.path().to_path_buf(), &dst_path);
        assert!(result.is_ok());

        // Verify
        assert!(dst_path.exists());
        assert_eq!(fs::read_to_string(dst_path.join("file1.txt")).unwrap(), "content1");
        assert_eq!(fs::read_to_string(dst_path.join("file2.txt")).unwrap(), "content2");
    }

    #[test]
    fn test_copy_dir_recursive_nested() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        let dst_path = dst_dir.path().join("copied");

        // Create nested structure
        fs::create_dir_all(src_dir.path().join("src/app/api")).unwrap();
        fs::write(src_dir.path().join("package.json"), r#"{"name":"test"}"#).unwrap();
        fs::write(src_dir.path().join("src/app/page.tsx"), "export default function Page() {}").unwrap();
        fs::write(src_dir.path().join("src/app/api/route.ts"), "export async function GET() {}").unwrap();

        // Copy
        let result = copy_dir_recursive(&src_dir.path().to_path_buf(), &dst_path);
        assert!(result.is_ok());

        // Verify nested structure preserved
        assert!(dst_path.join("src/app/api").exists());
        assert_eq!(
            fs::read_to_string(dst_path.join("package.json")).unwrap(),
            r#"{"name":"test"}"#
        );
        assert_eq!(
            fs::read_to_string(dst_path.join("src/app/page.tsx")).unwrap(),
            "export default function Page() {}"
        );
        assert_eq!(
            fs::read_to_string(dst_path.join("src/app/api/route.ts")).unwrap(),
            "export async function GET() {}"
        );
    }

    #[test]
    fn test_copy_dir_recursive_overwrites_existing() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        let dst_path = dst_dir.path().join("copied");

        // Create existing destination with different content
        fs::create_dir_all(&dst_path).unwrap();
        fs::write(dst_path.join("old_file.txt"), "old content").unwrap();
        fs::write(dst_path.join("file1.txt"), "old version").unwrap();

        // Create source files
        fs::write(src_dir.path().join("file1.txt"), "new content").unwrap();
        fs::write(src_dir.path().join("file2.txt"), "brand new").unwrap();

        // Copy (should overwrite)
        let result = copy_dir_recursive(&src_dir.path().to_path_buf(), &dst_path);
        assert!(result.is_ok());

        // Verify old file removed and new content present
        assert!(!dst_path.join("old_file.txt").exists());
        assert_eq!(fs::read_to_string(dst_path.join("file1.txt")).unwrap(), "new content");
        assert_eq!(fs::read_to_string(dst_path.join("file2.txt")).unwrap(), "brand new");
    }

    #[test]
    fn test_copy_dir_recursive_empty_dir() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        let dst_path = dst_dir.path().join("copied");

        // Create empty subdirectories
        fs::create_dir_all(src_dir.path().join("empty_subdir")).unwrap();

        // Copy
        let result = copy_dir_recursive(&src_dir.path().to_path_buf(), &dst_path);
        assert!(result.is_ok());

        // Verify empty dir copied
        assert!(dst_path.join("empty_subdir").exists());
        assert!(dst_path.join("empty_subdir").is_dir());
    }

    // ==================== APP TEMPLATE TESTS ====================

    #[test]
    fn test_app_template_cache_directory_structure() {
        let env = TempMoldableEnv::new();

        // Create cache directory with app template
        let cache_dir = env.moldable_root.join("cache/app-template");
        fs::create_dir_all(&cache_dir).unwrap();

        // Create mock template files
        fs::create_dir_all(cache_dir.join("src/app/widget")).unwrap();
        fs::create_dir_all(cache_dir.join("src/app/api/moldable/health")).unwrap();
        fs::create_dir_all(cache_dir.join("scripts")).unwrap();

        fs::write(
            cache_dir.join("moldable.json"),
            r#"{"name":"__APP_NAME__","icon":"__APP_ICON__"}"#,
        ).unwrap();
        fs::write(
            cache_dir.join("package.json"),
            r#"{"name":"__APP_ID__","version":"0.1.0"}"#,
        ).unwrap();
        fs::write(
            cache_dir.join("scripts/moldable-dev.mjs"),
            "const appId = '__APP_ID__'",
        ).unwrap();
        fs::write(
            cache_dir.join("src/app/widget/page.tsx"),
            "const GHOST_EXAMPLES = []",
        ).unwrap();
        fs::write(
            cache_dir.join("src/app/api/moldable/health/route.ts"),
            "export async function GET() { return Response.json({ status: 'ok' }) }",
        ).unwrap();

        // Verify structure
        assert!(cache_dir.join("moldable.json").exists());
        assert!(cache_dir.join("package.json").exists());
        assert!(cache_dir.join("scripts/moldable-dev.mjs").exists());
        assert!(cache_dir.join("src/app/widget/page.tsx").exists());
        assert!(cache_dir.join("src/app/api/moldable/health/route.ts").exists());
    }

    #[test]
    fn test_app_template_to_new_app() {
        let env = TempMoldableEnv::new();
        env.create_shared_dir();

        // Create template in cache
        let template_dir = env.moldable_root.join("cache/app-template");
        fs::create_dir_all(template_dir.join("src/app")).unwrap();
        fs::create_dir_all(template_dir.join("scripts")).unwrap();

        fs::write(
            template_dir.join("moldable.json"),
            r#"{"name":"__APP_NAME__","icon":"__APP_ICON__","widgetSize":"__WIDGET_SIZE__"}"#,
        ).unwrap();
        fs::write(
            template_dir.join("package.json"),
            r#"{"name":"__APP_ID__"}"#,
        ).unwrap();
        fs::write(
            template_dir.join("src/app/page.tsx"),
            "<h1>__APP_NAME__</h1>",
        ).unwrap();

        // Copy to new app location
        let new_app_dir = env.moldable_root.join("shared/apps/my-new-app");
        let result = copy_dir_recursive(&template_dir, &new_app_dir);
        assert!(result.is_ok());

        // Verify copied
        assert!(new_app_dir.join("moldable.json").exists());
        assert!(new_app_dir.join("package.json").exists());
        assert!(new_app_dir.join("src/app/page.tsx").exists());

        // Content should still have placeholders (replacement is done by AI tool)
        let manifest = fs::read_to_string(new_app_dir.join("moldable.json")).unwrap();
        assert!(manifest.contains("__APP_NAME__"));
    }

    #[test]
    fn test_multiple_apps_from_same_template() {
        let env = TempMoldableEnv::new();
        env.create_shared_dir();

        // Create template
        let template_dir = env.moldable_root.join("cache/app-template");
        fs::create_dir_all(&template_dir).unwrap();
        fs::write(template_dir.join("package.json"), r#"{"name":"__APP_ID__"}"#).unwrap();

        // Create multiple apps from template
        let app1_dir = env.moldable_root.join("shared/apps/app1");
        let app2_dir = env.moldable_root.join("shared/apps/app2");

        copy_dir_recursive(&template_dir, &app1_dir).unwrap();
        copy_dir_recursive(&template_dir, &app2_dir).unwrap();

        // Both should exist independently
        assert!(app1_dir.join("package.json").exists());
        assert!(app2_dir.join("package.json").exists());

        // Modifying one shouldn't affect the other
        fs::write(app1_dir.join("package.json"), r#"{"name":"app1"}"#).unwrap();
        
        let app2_content = fs::read_to_string(app2_dir.join("package.json")).unwrap();
        assert!(app2_content.contains("__APP_ID__")); // Still has placeholder
    }

    #[test]
    fn test_template_with_hidden_files() {
        let src_dir = TempDir::new().unwrap();
        let dst_dir = TempDir::new().unwrap();
        let dst_path = dst_dir.path().join("copied");

        // Create files including hidden ones
        fs::write(src_dir.path().join(".gitignore"), "node_modules/\n.next/").unwrap();
        fs::write(src_dir.path().join(".eslintrc.json"), r#"{"extends":"next"}"#).unwrap();
        fs::write(src_dir.path().join("package.json"), "{}").unwrap();

        // Copy
        copy_dir_recursive(&src_dir.path().to_path_buf(), &dst_path).unwrap();

        // Hidden files should be copied
        assert!(dst_path.join(".gitignore").exists());
        assert!(dst_path.join(".eslintrc.json").exists());
        assert_eq!(
            fs::read_to_string(dst_path.join(".gitignore")).unwrap(),
            "node_modules/\n.next/"
        );
    }
}
