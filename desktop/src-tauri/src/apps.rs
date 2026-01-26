//! App registration and detection for Moldable
//!
//! Handles registering apps in workspace config, detecting apps in folders,
//! and listing available apps from local development workspaces.

use crate::paths::{get_config_file_path, get_config_file_path_for_workspace, get_home_dir};
use crate::ports::{find_free_port, is_port_available};
use crate::runtime::get_pnpm_path;
use crate::types::{AvailableApp, MoldableConfig, MoldableManifest, RegisteredApp};
use log::{error, warn};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::time::{Duration, Instant, SystemTime};
use tauri::Emitter;

// ============================================================================
// APP REGISTRATION
// ============================================================================

#[tauri::command]
pub fn get_registered_apps() -> Result<Vec<RegisteredApp>, String> {
    let config_path = get_config_file_path()?;

    if !config_path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let config: MoldableConfig =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    let mut apps = config.apps;
    for app in &mut apps {
        // If icon_path is not set in config, try to read from the app's moldable.json manifest
        if app.icon_path.is_none() {
            let manifest_path = Path::new(&app.path).join("moldable.json");
            if manifest_path.exists() {
                if let Ok(manifest_content) = std::fs::read_to_string(&manifest_path) {
                    if let Ok(manifest) =
                        serde_json::from_str::<MoldableManifest>(&manifest_content)
                    {
                        if let Some(icon_path) = manifest.icon_path {
                            // Resolve relative paths to absolute
                            let resolved = if Path::new(&icon_path).is_absolute() {
                                icon_path
                            } else {
                                Path::new(&app.path)
                                    .join(&icon_path)
                                    .to_string_lossy()
                                    .to_string()
                            };
                            app.icon_path = Some(resolved);
                        }
                    }
                }
            }
        }
    }

    Ok(apps)
}

const CONFIG_LOCK_FILE: &str = ".moldable.config.lock";
const CONFIG_LOCK_STALE_AFTER: Duration = Duration::from_secs(60);

struct ConfigLock {
    path: std::path::PathBuf,
}

impl Drop for ConfigLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn acquire_config_lock(config_path: &Path) -> Result<ConfigLock, String> {
    let lock_path = config_path.with_file_name(CONFIG_LOCK_FILE);
    if let Some(parent) = lock_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let start = Instant::now();
    let timeout = Duration::from_secs(2);

    loop {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(file) => {
                drop(file);
                return Ok(ConfigLock { path: lock_path });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if is_lock_stale(&lock_path, CONFIG_LOCK_STALE_AFTER) {
                    warn!("Removing stale config lock at {}", lock_path.display());
                    let _ = std::fs::remove_file(&lock_path);
                    continue;
                }
                if start.elapsed() >= timeout {
                    return Err("Timed out waiting for config lock".to_string());
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => return Err(format!("Failed to create config lock: {}", e)),
        }
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

fn write_config_atomic(config_path: &Path, config: &MoldableConfig) -> Result<(), String> {
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    let parent = config_path
        .parent()
        .ok_or_else(|| "Config path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create config directory: {}", e))?;

    let mut temp_file = tempfile::Builder::new()
        .prefix(".moldable.config.tmp-")
        .tempfile_in(parent)
        .map_err(|e| format!("Failed to create temp config: {}", e))?;
    temp_file
        .write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write temp config: {}", e))?;
    temp_file
        .as_file()
        .sync_all()
        .map_err(|e| format!("Failed to sync config: {}", e))?;
    temp_file
        .persist(config_path)
        .map_err(|e| format!("Failed to persist config: {}", e.error))?;

    Ok(())
}

/// Get registered apps for a specific workspace (used during onboarding before workspace is active)
#[tauri::command]
pub fn get_registered_apps_for_workspace(
    workspace_id: String,
) -> Result<Vec<RegisteredApp>, String> {
    let config_path = get_config_file_path_for_workspace(&workspace_id)?;

    if !config_path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let config: MoldableConfig =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    Ok(config.apps)
}

#[tauri::command]
pub fn register_app(
    app_handle: tauri::AppHandle,
    app: RegisteredApp,
) -> Result<Vec<RegisteredApp>, String> {
    let config_path = get_config_file_path()?;
    let _lock = acquire_config_lock(&config_path)?;

    // Load existing config
    let mut config = if config_path.exists() {
        let content = std::fs::read_to_string(config_path.as_path())
            .map_err(|e| format!("Failed to read config: {}", e))?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        MoldableConfig::default()
    };

    // Remove existing app with same id if present
    config.apps.retain(|a| a.id != app.id);

    // Add the new app
    config.apps.push(app);

    // Save config
    write_config_atomic(&config_path, &config)?;

    // Emit config-changed event to notify frontend immediately
    if let Err(e) = app_handle.emit("config-changed", ()) {
        error!("Failed to emit config-changed event: {}", e);
    }

    get_registered_apps()
}

#[tauri::command]
pub fn unregister_app(
    app_handle: tauri::AppHandle,
    app_id: String,
) -> Result<Vec<RegisteredApp>, String> {
    let config_path = get_config_file_path()?;
    let _lock = acquire_config_lock(&config_path)?;

    if !config_path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(config_path.as_path())
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let mut config: MoldableConfig =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    config.apps.retain(|a| a.id != app_id);

    write_config_atomic(&config_path, &config)?;

    // Emit config-changed event to notify frontend immediately
    if let Err(e) = app_handle.emit("config-changed", ()) {
        error!("Failed to emit config-changed event: {}", e);
    }

    get_registered_apps()
}

pub fn update_registered_app_port(app_id: &str, new_port: u16) -> Result<bool, String> {
    let config_path = get_config_file_path()?;
    update_registered_app_port_at_path(app_id, new_port, &config_path)
}

fn update_registered_app_port_at_path(
    app_id: &str,
    new_port: u16,
    config_path: &Path,
) -> Result<bool, String> {
    let _lock = acquire_config_lock(config_path)?;
    if !config_path.exists() {
        return Ok(false);
    }

    let content = std::fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let mut config: MoldableConfig =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    let mut updated = false;
    for app in &mut config.apps {
        if app.id != app_id {
            continue;
        }
        if app.requires_port {
            return Ok(false);
        }
        if app.port != new_port {
            app.port = new_port;
            updated = true;
        }
    }

    if !updated {
        return Ok(false);
    }

    write_config_atomic(config_path, &config)?;

    Ok(true)
}

// ============================================================================
// APP DETECTION
// ============================================================================

#[tauri::command]
pub fn detect_app_in_folder(path: String) -> Result<Option<RegisteredApp>, String> {
    let folder = Path::new(&path);

    if !folder.exists() || !folder.is_dir() {
        return Ok(None);
    }

    // Try to read moldable.json manifest first
    let manifest_path = folder.join("moldable.json");
    let manifest: MoldableManifest = if manifest_path.exists() {
        let content = std::fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Failed to read moldable.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse moldable.json: {}", e))?
    } else {
        MoldableManifest::default()
    };

    // Check for package.json (Node.js app)
    let package_json = folder.join("package.json");
    if package_json.exists() {
        let content = std::fs::read_to_string(&package_json)
            .map_err(|e| format!("Failed to read package.json: {}", e))?;

        if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
            // Get name from manifest, then package.json, then folder name
            let pkg_name = pkg
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown");

            let name = manifest.name.unwrap_or_else(|| pkg_name.to_string());

            // Generate a simple id from the folder name
            let id = folder
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("app")
                .to_lowercase()
                .replace(' ', "-");

            // Check if it has a dev script
            let has_dev = pkg.get("scripts").and_then(|s| s.get("dev")).is_some();

            if has_dev {
                // Use manifest port or find an available one
                let port = manifest.port.unwrap_or_else(|| find_available_port(4100));

                // Use manifest command or find pnpm
                let command = manifest
                    .command
                    .or_else(get_pnpm_path)
                    .unwrap_or_else(|| "pnpm".to_string());

                // Use manifest args or default dev args
                let args = manifest.args.unwrap_or_else(|| vec!["dev".to_string()]);

                // Use manifest icon or default
                let icon = manifest.icon.unwrap_or_else(|| "📦".to_string());
                let icon_path = manifest.icon_path.map(|p| {
                    if Path::new(&p).is_absolute() {
                        p
                    } else {
                        folder.join(p).to_string_lossy().to_string()
                    }
                });

                // Use manifest widget_size or default
                let widget_size = manifest.widget_size.unwrap_or_else(|| "medium".to_string());

                return Ok(Some(RegisteredApp {
                    id,
                    name,
                    icon,
                    icon_path,
                    port,
                    path: path.clone(),
                    command,
                    args,
                    widget_size,
                    requires_port: manifest.requires_port,
                }));
            }
        }
    }

    Ok(None)
}

/// Find an available port that isn't used by any registered app
pub fn find_available_port(start: u16) -> u16 {
    let config_path = get_config_file_path().ok();
    let used_ports: Vec<u16> = config_path
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|c| serde_json::from_str::<MoldableConfig>(&c).ok())
        .map(|c| c.apps.iter().map(|a| a.port).collect())
        .unwrap_or_default();

    let start_port = find_free_port(start);
    let mut port: u32 = start_port as u32;
    while port <= u16::MAX as u32 {
        let candidate = port as u16;
        if !used_ports.contains(&candidate) && is_port_available(candidate) {
            return candidate;
        }
        port += 1;
    }
    start_port
}

// ============================================================================
// LOCAL WORKSPACE APPS
// ============================================================================

/// List available apps from the workspace apps/ folder
#[tauri::command]
pub fn list_available_apps() -> Result<Vec<AvailableApp>, String> {
    // Get workspace path from config
    let config_path = get_config_file_path()?;

    let workspace_path = if config_path.exists() {
        let content = std::fs::read_to_string(config_path.as_path())
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let config: MoldableConfig =
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;
        config.workspace
    } else {
        None
    };

    // Try configured workspace path first, then fallback to common development locations
    let workspace = workspace_path.or_else(|| {
        let home = get_home_dir().ok()?;
        let candidates = [
            home.join("moldable"),
            home.join("code").join("moldable"),
            home.join("dev").join("moldable"),
            home.join("projects").join("moldable"),
        ];

        for candidate in candidates {
            let apps_dir = candidate.join("apps");
            if apps_dir.exists() && apps_dir.is_dir() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
        None
    });

    let workspace = match workspace {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };

    let apps_dir = Path::new(&workspace).join("apps");
    if !apps_dir.exists() || !apps_dir.is_dir() {
        return Ok(Vec::new());
    }

    // Get already registered app paths to filter them out
    let registered_apps = get_registered_apps().unwrap_or_default();
    let registered_paths: std::collections::HashSet<String> =
        registered_apps.iter().map(|a| a.path.clone()).collect();

    let mut available = Vec::new();

    if let Ok(entries) = std::fs::read_dir(&apps_dir) {
        for entry in entries.flatten() {
            let app_path = entry.path();
            if !app_path.is_dir() {
                continue;
            }

            let app_path_str = app_path.to_string_lossy().to_string();

            // Skip if already registered
            if registered_paths.contains(&app_path_str) {
                continue;
            }

            let manifest_path = app_path.join("moldable.json");
            if !manifest_path.exists() {
                continue;
            }

            // Read the manifest
            if let Ok(content) = std::fs::read_to_string(&manifest_path) {
                if let Ok(manifest) = serde_json::from_str::<MoldableManifest>(&content) {
                    let folder_name = app_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("app")
                        .to_string();

                    let icon_path = manifest.icon_path.map(|p| {
                        if Path::new(&p).is_absolute() {
                            p
                        } else {
                            app_path.join(p).to_string_lossy().to_string()
                        }
                    });

                    available.push(AvailableApp {
                        id: folder_name.clone(),
                        name: manifest.name.unwrap_or(folder_name),
                        icon: manifest.icon.unwrap_or_else(|| "📦".to_string()),
                        icon_path,
                        description: manifest.description,
                        path: app_path_str,
                        widget_size: manifest.widget_size.unwrap_or_else(|| "medium".to_string()),
                    });
                }
            }
        }
    }

    // Sort by name
    available.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(available)
}

/// Install an available app by path (register it in config)
#[tauri::command]
pub fn install_available_app(
    app_handle: tauri::AppHandle,
    path: String,
) -> Result<RegisteredApp, String> {
    let detected = detect_app_in_folder(path.clone())?
        .ok_or_else(|| "Could not detect app in folder".to_string())?;

    register_app(app_handle, detected.clone())?;

    Ok(detected)
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // ==================== FIND AVAILABLE PORT TESTS ====================

    #[test]
    fn test_find_available_port_starts_at_given() {
        // When no apps are registered, should return start port or higher
        let port = find_available_port(4100);
        assert!(port >= 4100);
    }

    #[test]
    fn test_find_available_port_high_start() {
        // Test with a higher start port
        let port = find_available_port(8000);
        assert!(port >= 8000);
    }

    #[test]
    fn test_find_available_port_skips_in_use() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let candidate = find_available_port(port);
        assert_ne!(candidate, port);
    }

    // ==================== DETECT APP IN FOLDER TESTS ====================

    #[test]
    fn test_detect_app_nonexistent_folder() {
        let result = detect_app_in_folder("/nonexistent/path/to/app".to_string());
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn test_detect_app_empty_folder() {
        let dir = TempDir::new().unwrap();
        let result = detect_app_in_folder(dir.path().to_string_lossy().to_string());
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn test_detect_app_with_package_json_no_dev() {
        let dir = TempDir::new().unwrap();
        let package = serde_json::json!({
            "name": "test-app",
            "version": "1.0.0",
            "scripts": {
                "build": "tsc"
            }
        });
        fs::write(
            dir.path().join("package.json"),
            serde_json::to_string(&package).unwrap(),
        )
        .unwrap();

        let result = detect_app_in_folder(dir.path().to_string_lossy().to_string());
        assert!(result.is_ok());
        // No dev script, should return None
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn test_detect_app_with_package_json_with_dev() {
        let dir = TempDir::new().unwrap();
        let package = serde_json::json!({
            "name": "my-cool-app",
            "version": "1.0.0",
            "scripts": {
                "dev": "next dev",
                "build": "next build"
            }
        });
        fs::write(
            dir.path().join("package.json"),
            serde_json::to_string(&package).unwrap(),
        )
        .unwrap();

        let result = detect_app_in_folder(dir.path().to_string_lossy().to_string());
        assert!(result.is_ok());
        let app = result.unwrap();
        assert!(app.is_some());

        let app = app.unwrap();
        assert!(app.port >= 4100);
        assert!(!app.id.is_empty());
        assert_eq!(app.widget_size, "medium");
    }

    #[test]
    fn test_detect_app_with_moldable_manifest() {
        let dir = TempDir::new().unwrap();

        let package = serde_json::json!({
            "name": "base-name",
            "scripts": { "dev": "vite" }
        });
        fs::write(
            dir.path().join("package.json"),
            serde_json::to_string(&package).unwrap(),
        )
        .unwrap();

        let manifest = serde_json::json!({
            "name": "Custom App Name",
            "icon": "🚀",
            "port": 4200,
            "widgetSize": "large"
        });
        fs::write(
            dir.path().join("moldable.json"),
            serde_json::to_string(&manifest).unwrap(),
        )
        .unwrap();

        let result = detect_app_in_folder(dir.path().to_string_lossy().to_string());
        assert!(result.is_ok());
        let app = result.unwrap().unwrap();

        assert_eq!(app.name, "Custom App Name");
        assert_eq!(app.icon, "🚀");
        assert_eq!(app.port, 4200);
        assert_eq!(app.widget_size, "large");
    }

    #[test]
    fn test_detect_app_manifest_overrides_package() {
        let dir = TempDir::new().unwrap();

        let package = serde_json::json!({
            "name": "package-name",
            "scripts": { "dev": "next dev" }
        });
        fs::write(
            dir.path().join("package.json"),
            serde_json::to_string(&package).unwrap(),
        )
        .unwrap();

        let manifest = serde_json::json!({
            "name": "Manifest Name",
            "icon": "📱"
        });
        fs::write(
            dir.path().join("moldable.json"),
            serde_json::to_string(&manifest).unwrap(),
        )
        .unwrap();

        let result = detect_app_in_folder(dir.path().to_string_lossy().to_string());
        let app = result.unwrap().unwrap();

        // Manifest name should override package.json
        assert_eq!(app.name, "Manifest Name");
        assert_eq!(app.icon, "📱");
    }

    #[test]
    fn test_detect_app_requires_port_from_manifest() {
        let dir = TempDir::new().unwrap();

        let package = serde_json::json!({
            "name": "test-app",
            "scripts": { "dev": "next dev" }
        });
        fs::write(
            dir.path().join("package.json"),
            serde_json::to_string(&package).unwrap(),
        )
        .unwrap();

        let manifest = serde_json::json!({
            "requiresPort": true
        });
        fs::write(
            dir.path().join("moldable.json"),
            serde_json::to_string(&manifest).unwrap(),
        )
        .unwrap();

        let result = detect_app_in_folder(dir.path().to_string_lossy().to_string());
        let app = result.unwrap().unwrap();

        assert!(app.requires_port);
    }

    #[test]
    fn test_detect_app_id_from_folder_name() {
        let dir = TempDir::new().unwrap();
        let app_dir = dir.path().join("My Cool App");
        fs::create_dir_all(&app_dir).unwrap();

        let package = serde_json::json!({
            "name": "@scope/package-name",
            "scripts": { "dev": "next dev" }
        });
        fs::write(
            app_dir.join("package.json"),
            serde_json::to_string(&package).unwrap(),
        )
        .unwrap();

        let result = detect_app_in_folder(app_dir.to_string_lossy().to_string());
        let app = result.unwrap().unwrap();

        // ID should be derived from folder name, lowercase with dashes
        assert_eq!(app.id, "my-cool-app");
    }

    #[test]
    fn test_update_registered_app_port_updates_config() {
        let dir = TempDir::new().unwrap();
        let config_path = dir.path().join("config.json");
        let config = MoldableConfig {
            workspace: None,
            apps: vec![RegisteredApp {
                id: "test-app".to_string(),
                name: "Test".to_string(),
                icon: "🧪".to_string(),
                icon_path: None,
                port: 4100,
                path: "/tmp/test-app".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "medium".to_string(),
                requires_port: false,
            }],
            preferences: serde_json::Map::new(),
        };
        fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap()).unwrap();

        let updated = update_registered_app_port_at_path("test-app", 4200, &config_path).unwrap();
        assert!(updated);

        let content = fs::read_to_string(config_path.as_path()).unwrap();
        let reloaded: MoldableConfig = serde_json::from_str(&content).unwrap();
        assert_eq!(reloaded.apps[0].port, 4200);
    }

    #[test]
    fn test_update_registered_app_port_skips_requires_port() {
        let dir = TempDir::new().unwrap();
        let config_path = dir.path().join("config.json");
        let config = MoldableConfig {
            workspace: None,
            apps: vec![RegisteredApp {
                id: "test-app".to_string(),
                name: "Test".to_string(),
                icon: "🧪".to_string(),
                icon_path: None,
                port: 4100,
                path: "/tmp/test-app".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "medium".to_string(),
                requires_port: true,
            }],
            preferences: serde_json::Map::new(),
        };
        fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap()).unwrap();

        let updated = update_registered_app_port_at_path("test-app", 4200, &config_path).unwrap();
        assert!(!updated);

        let content = fs::read_to_string(config_path.as_path()).unwrap();
        let reloaded: MoldableConfig = serde_json::from_str(&content).unwrap();
        assert_eq!(reloaded.apps[0].port, 4100);
    }
}
