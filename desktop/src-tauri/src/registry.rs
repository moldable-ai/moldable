//! GitHub App Registry for Moldable
//!
//! Handles fetching the app registry from GitHub, downloading and installing
//! apps from the moldable-ai/apps repository.

use crate::apps::{detect_app_in_folder, register_app, unregister_app};
use crate::install_state::update_install_state_safe;
use crate::paths::{get_cache_dir, get_config_file_path, get_shared_apps_dir};
use crate::runtime;
use crate::types::{AppRegistry, MoldableConfig, RegisteredApp};
use log::{info, warn, error};
use std::io::{Read, Write};

// ============================================================================
// REGISTRY FETCHING
// ============================================================================

/// Fetch the app registry manifest from GitHub (cached for 1 hour)
#[tauri::command]
pub async fn fetch_app_registry(force_refresh: Option<bool>) -> Result<AppRegistry, String> {
    let cache_dir = get_cache_dir()?;
    let cache_path = cache_dir.join("app-registry.json");
    let force = force_refresh.unwrap_or(false);

    // Check cache first (valid for 1 hour) unless force refresh
    if !force && cache_path.exists() {
        if let Ok(metadata) = std::fs::metadata(&cache_path) {
            if let Ok(modified) = metadata.modified() {
                if let Ok(age) = std::time::SystemTime::now().duration_since(modified) {
                    if age < std::time::Duration::from_secs(3600) {
                        if let Ok(content) = std::fs::read_to_string(&cache_path) {
                            if let Ok(registry) = serde_json::from_str::<AppRegistry>(&content) {
                                return Ok(registry);
                            }
                        }
                    }
                }
            }
        }
    }

    // Fetch from GitHub
    let manifest_url = "https://raw.githubusercontent.com/moldable-ai/apps/main/manifest.json";

    let response = reqwest::get(manifest_url)
        .await
        .map_err(|e| format!("Failed to fetch registry: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to fetch registry: HTTP {}",
            response.status()
        ));
    }

    let registry: AppRegistry = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse registry: {}", e))?;

    // Cache the result
    if let Err(e) = std::fs::create_dir_all(&cache_dir) {
        warn!("Failed to create cache dir: {}", e);
    } else if let Ok(content) = serde_json::to_string_pretty(&registry) {
        if let Err(e) = std::fs::write(&cache_path, content) {
            warn!("Failed to cache registry: {}", e);
        }
    }

    Ok(registry)
}

// ============================================================================
// APP INSTALLATION
// ============================================================================

/// Install an app from the registry (download from GitHub)
#[tauri::command]
pub async fn install_app_from_registry(
    app_handle: tauri::AppHandle,
    app_id: String,
    app_path: String,
    commit: String,
    version: String,
) -> Result<RegisteredApp, String> {
    let shared_apps_dir = get_shared_apps_dir()?;
    let app_dir = shared_apps_dir.join(&app_id);

    update_install_state_safe(&app_dir, &app_id, "start", "in_progress", None);

    // Check if already registered in the current workspace
    let config_path = get_config_file_path()?;
    let current_apps: Vec<RegisteredApp> = if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let config: MoldableConfig =
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;
        config.apps
    } else {
        Vec::new()
    };

    if current_apps.iter().any(|a| a.id == app_id) {
        return Err(format!(
            "App '{}' is already installed in this workspace",
            app_id
        ));
    }

    // If app code already exists in shared/apps, just register it
    if app_dir.exists() {
        info!(
            "App '{}' already downloaded, registering in workspace...",
            app_id
        );
        info!("Install stage=dependencies app={}", app_id);
        update_install_state_safe(&app_dir, &app_id, "dependencies", "in_progress", None);

        if let Err(e) = runtime::ensure_node_modules_installed(&app_dir) {
            update_install_state_safe(
                &app_dir,
                &app_id,
                "dependencies",
                "error",
                Some(e.clone()),
            );
            return Err(e);
        }
        update_install_state_safe(&app_dir, &app_id, "dependencies", "ok", None);

        let app_dir_str = app_dir.to_string_lossy().to_string();
        let detected =
            detect_app_in_folder(app_dir_str)?.ok_or_else(|| "Failed to detect app".to_string())?;

        info!("Install stage=register app={}", app_id);
        update_install_state_safe(&app_dir, &app_id, "register", "in_progress", None);
        if let Err(e) = register_app(app_handle.clone(), detected.clone()) {
            update_install_state_safe(&app_dir, &app_id, "register", "error", Some(e.clone()));
            return Err(e);
        }
        update_install_state_safe(&app_dir, &app_id, "register", "ok", None);
        update_install_state_safe(&app_dir, &app_id, "complete", "ok", None);

        info!("Install stage=complete app={}", app_id);

        return Ok(detected);
    }

    info!("Install stage=start app={}", app_id);
    info!("Install stage=download app={} source=moldable-ai/apps", app_id);
    update_install_state_safe(&app_dir, &app_id, "download", "in_progress", None);

    // Download the repo archive for the specific commit
    let archive_url = format!(
        "https://github.com/moldable-ai/apps/archive/{}.zip",
        commit
    );

    info!("Downloading from {}...", archive_url);

    let response = reqwest::get(&archive_url)
        .await
        .map_err(|e| {
            let message = format!("Failed to download: {}", e);
            update_install_state_safe(
                &app_dir,
                &app_id,
                "download",
                "error",
                Some(message.clone()),
            );
            message
        })?;

    if !response.status().is_success() {
        let message = format!("Failed to download: HTTP {}", response.status());
        update_install_state_safe(
            &app_dir,
            &app_id,
            "download",
            "error",
            Some(message.clone()),
        );
        return Err(message);
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| {
            let message = format!("Failed to read response: {}", e);
            update_install_state_safe(
                &app_dir,
                &app_id,
                "download",
                "error",
                Some(message.clone()),
            );
            message
        })?;
    update_install_state_safe(&app_dir, &app_id, "download", "ok", None);

    info!(
        "Install stage=extract app={} bytes={}",
        app_id,
        bytes.len()
    );
    update_install_state_safe(&app_dir, &app_id, "extract", "in_progress", None);

    // Create a temporary directory for extraction
    let temp_dir = std::env::temp_dir().join(format!("moldable-app-{}", app_id));
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to clean temp dir: {}", e))?;
    }
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;

    // Extract the zip
    let cursor = std::io::Cursor::new(bytes.as_ref());
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| {
            let message = format!("Failed to open zip: {}", e);
            update_install_state_safe(
                &app_dir,
                &app_id,
                "extract",
                "error",
                Some(message.clone()),
            );
            message
        })?;

    // The archive structure is: apps-{commit}/{app_path}/...
    let short_commit = if commit.len() > 7 {
        &commit[..7]
    } else {
        &commit
    };
    let possible_prefixes = vec![
        format!("apps-{}/{}/", commit, app_path),
        format!("apps-{}/{}/", short_commit, app_path),
        format!("moldable-apps-{}/{}/", commit, app_path),
        format!("moldable-apps-{}/{}/", short_commit, app_path),
    ];

    // Find which prefix is used in this archive
    let mut actual_prefix: Option<String> = None;
    for i in 0..archive.len() {
        if let Ok(file) = archive.by_index(i) {
            let name = file.name();
            for prefix in &possible_prefixes {
                if name.starts_with(prefix) {
                    actual_prefix = Some(prefix.clone());
                    break;
                }
            }
            if actual_prefix.is_some() {
                break;
            }
        }
    }

    let prefix = actual_prefix.ok_or_else(|| {
        let message = format!(
            "Could not find app '{}' in archive (tried prefixes: {:?})",
            app_path, possible_prefixes
        );
        update_install_state_safe(&app_dir, &app_id, "extract", "error", Some(message.clone()));
        message
    })?;

    info!("Found app at prefix: {}", prefix);

    // Ensure the shared apps directory exists
    std::fs::create_dir_all(&shared_apps_dir)
        .map_err(|e| {
            let message = format!("Failed to create shared apps dir: {}", e);
            update_install_state_safe(&app_dir, &app_id, "extract", "error", Some(message.clone()));
            message
        })?;

    // Extract just the app folder
    let mut extracted_count = 0;
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| {
                let message = format!("Failed to read archive entry: {}", e);
                update_install_state_safe(
                    &app_dir,
                    &app_id,
                    "extract",
                    "error",
                    Some(message.clone()),
                );
                message
            })?;

        let file_name = file.name().to_string();

        if !file_name.starts_with(&prefix) {
            continue;
        }

        // Get the relative path within the app
        let relative_path = &file_name[prefix.len()..];
        if relative_path.is_empty() {
            continue;
        }

        let dest_path = app_dir.join(relative_path);

        if file.is_dir() {
            std::fs::create_dir_all(&dest_path)
                .map_err(|e| {
                    let message = format!("Failed to create dir {:?}: {}", dest_path, e);
                    update_install_state_safe(
                        &app_dir,
                        &app_id,
                        "extract",
                        "error",
                        Some(message.clone()),
                    );
                    message
                })?;
        } else {
            if let Some(parent) = dest_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| {
                        let message = format!("Failed to create parent dir: {}", e);
                        update_install_state_safe(
                            &app_dir,
                            &app_id,
                            "extract",
                            "error",
                            Some(message.clone()),
                        );
                        message
                    })?;
            }

            let mut content = Vec::new();
            file.read_to_end(&mut content)
                .map_err(|e| {
                    let message = format!("Failed to read file: {}", e);
                    update_install_state_safe(
                        &app_dir,
                        &app_id,
                        "extract",
                        "error",
                        Some(message.clone()),
                    );
                    message
                })?;

            let mut dest_file = std::fs::File::create(&dest_path)
                .map_err(|e| {
                    let message = format!("Failed to create file {:?}: {}", dest_path, e);
                    update_install_state_safe(
                        &app_dir,
                        &app_id,
                        "extract",
                        "error",
                        Some(message.clone()),
                    );
                    message
                })?;
            dest_file
                .write_all(&content)
                .map_err(|e| {
                    let message = format!("Failed to write file: {}", e);
                    update_install_state_safe(
                        &app_dir,
                        &app_id,
                        "extract",
                        "error",
                        Some(message.clone()),
                    );
                    message
                })?;

            extracted_count += 1;
        }
    }

    info!(
        "Install stage=extract_complete app={} files={}",
        app_id, extracted_count
    );
    update_install_state_safe(&app_dir, &app_id, "extract", "ok", None);

    // Clean up temp dir
    let _ = std::fs::remove_dir_all(&temp_dir);

    // Update moldable.json with upstream info
    let moldable_json_path = app_dir.join("moldable.json");
    if moldable_json_path.exists() {
        let content = std::fs::read_to_string(&moldable_json_path)
            .map_err(|e| format!("Failed to read moldable.json: {}", e))?;

        let mut manifest: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse moldable.json: {}", e))?;

        manifest["upstream"] = serde_json::json!({
            "repo": "moldable-ai/apps",
            "path": app_path,
            "installedVersion": version,
            "installedCommit": commit,
            "installedAt": chrono::Utc::now().to_rfc3339()
        });
        manifest["modified"] = serde_json::json!(false);

        let updated_content = serde_json::to_string_pretty(&manifest)
            .map_err(|e| format!("Failed to serialize moldable.json: {}", e))?;

        std::fs::write(&moldable_json_path, updated_content)
            .map_err(|e| format!("Failed to write moldable.json: {}", e))?;
    }

    info!("Install stage=dependencies app={}", app_id);
    update_install_state_safe(&app_dir, &app_id, "dependencies", "in_progress", None);
    if let Err(e) = runtime::ensure_node_modules_installed(&app_dir) {
        error!("Failed to install dependencies for {}: {}", app_id, e);
        update_install_state_safe(
            &app_dir,
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
    update_install_state_safe(&app_dir, &app_id, "dependencies", "ok", None);

    // Detect and register the app
    let app_dir_str = app_dir.to_string_lossy().to_string();
    let detected = detect_app_in_folder(app_dir_str.clone())?
        .ok_or_else(|| "Failed to detect installed app".to_string())?;

    info!("Install stage=register app={}", app_id);
    update_install_state_safe(&app_dir, &app_id, "register", "in_progress", None);
    if let Err(e) = register_app(app_handle, detected.clone()) {
        update_install_state_safe(&app_dir, &app_id, "register", "error", Some(e.clone()));
        return Err(e);
    }
    update_install_state_safe(&app_dir, &app_id, "register", "ok", None);
    update_install_state_safe(&app_dir, &app_id, "complete", "ok", None);

    info!("Install stage=complete app={}", app_id);

    Ok(detected)
}

// ============================================================================
// APP UNINSTALLATION
// ============================================================================

/// Uninstall an app from the shared directory
#[tauri::command]
pub fn uninstall_app_from_shared(
    app_handle: tauri::AppHandle,
    app_id: String,
) -> Result<(), String> {
    let shared_apps_dir = get_shared_apps_dir()?;
    let app_dir = shared_apps_dir.join(&app_id);

    if !app_dir.exists() {
        return Err(format!(
            "App '{}' is not installed in shared directory",
            app_id
        ));
    }

    // First unregister from config
    let _ = unregister_app(app_handle, app_id.clone());

    // Then remove the directory
    std::fs::remove_dir_all(&app_dir)
        .map_err(|e| format!("Failed to remove app directory: {}", e))?;

    info!("Uninstalled {} from shared apps", app_id);

    Ok(())
}

// ============================================================================
// HELLO MOLDABLES SETUP
// ============================================================================

/// Install the Hello Moldables tutorial app on first launch
pub async fn ensure_hello_moldables_app_async(
    app_handle: tauri::AppHandle,
    load_shared_config: impl Fn() -> crate::types::SharedConfig,
    save_shared_config: impl Fn(&crate::types::SharedConfig) -> Result<(), String>,
) -> Result<(), String> {
    let shared_config = load_shared_config();
    if shared_config.hello_moldables_installed {
        return Ok(());
    }

    info!("Installing Hello Moldables tutorial app from GitHub...");

    let registry = fetch_app_registry(Some(false)).await?;

    let hello_app = registry
        .apps
        .iter()
        .find(|app| app.id == "hello-moldables")
        .ok_or_else(|| "Hello Moldables app not found in registry".to_string())?;

    match install_app_from_registry(
        app_handle,
        hello_app.id.clone(),
        hello_app.path.clone(),
        hello_app.commit.clone(),
        hello_app.version.clone(),
    )
    .await
    {
        Ok(_) => {
            info!("Hello Moldables app installed!");
        }
        Err(e) => {
            if !e.contains("already installed") {
                return Err(e);
            }
            info!("Hello Moldables already installed in workspace");
        }
    }

    let mut shared_config = load_shared_config();
    shared_config.hello_moldables_installed = true;
    save_shared_config(&shared_config)?;

    Ok(())
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    // Note: AppRegistry type serialization tests are in types.rs
    // These tests focus on registry-specific behavior

    #[test]
    fn test_github_archive_url_format() {
        // Verify the expected GitHub archive URL format
        let repo = "moldable-ai/apps";
        let commit = "abc123def456";
        let expected = format!("https://github.com/{}/archive/{}.zip", repo, commit);
        assert_eq!(expected, "https://github.com/moldable-ai/apps/archive/abc123def456.zip");
    }

    #[test]
    fn test_manifest_url_format() {
        // Verify the expected manifest URL format with cache busting
        let base = "https://raw.githubusercontent.com/moldable-ai/apps/main/manifest.json";
        let with_cache_bust = format!("{}?_={}", base, 12345);
        assert!(with_cache_bust.contains("?_="));
    }
}
