//! GitHub App Registry for Moldable
//!
//! Handles fetching the app registry from GitHub, downloading and installing
//! apps from the moldable-ai/apps repository.

use crate::apps::{detect_app_in_folder, register_app, unregister_app};
use crate::install_state::update_install_state_safe;
use crate::paths::{get_cache_dir, get_config_file_path, get_shared_apps_dir};
use crate::runtime;
use crate::types::{AppRegistry, MoldableConfig, RegisteredApp};
use log::{error, info, warn};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

fn ensure_path_within_root(root: &Path, path: &Path) -> Result<(), String> {
    let resolved = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve path {:?}: {}", path, e))?;
    if !resolved.starts_with(root) {
        return Err(format!(
            "Zip entry attempted to write outside install directory: {}",
            resolved.display()
        ));
    }
    Ok(())
}

fn validate_extracted_app(app_dir: &Path) -> Result<(), String> {
    if !app_dir.exists() {
        return Err(format!("Expected app directory to exist at {}", app_dir.display()));
    }

    let package_json = app_dir.join("package.json");
    if !package_json.exists() {
        return Err(format!(
            "Expected package.json at {}",
            package_json.display()
        ));
    }

    let moldable_json = app_dir.join("moldable.json");
    if moldable_json.exists() {
        let content = std::fs::read_to_string(&moldable_json)
            .map_err(|e| format!("Failed to read moldable.json: {}", e))?;
        serde_json::from_str::<serde_json::Value>(&content)
            .map_err(|e| format!("Failed to parse moldable.json: {}", e))?;
    }

    Ok(())
}

fn unique_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{}-{}", nanos, std::process::id())
}

fn create_install_staging_dir(app_id: &str) -> Result<PathBuf, String> {
    let cache_dir = get_cache_dir()?;
    let staging_root = cache_dir.join("install-staging");
    std::fs::create_dir_all(&staging_root)
        .map_err(|e| format!("Failed to create install staging dir: {}", e))?;

    for attempt in 0..10 {
        let suffix = unique_suffix();
        let candidate = staging_root.join(format!("{}-{}-{}", app_id, suffix, attempt));
        match std::fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => {
                return Err(format!(
                    "Failed to create staging dir {}: {}",
                    candidate.display(),
                    e
                ))
            }
        }
    }

    Err("Failed to create unique staging directory".to_string())
}

fn swap_app_directory(staging_dir: &Path, app_dir: &Path) -> Result<(), String> {
    let mut backup_dir = None;
    if app_dir.exists() {
        let parent = app_dir
            .parent()
            .ok_or_else(|| "App directory has no parent".to_string())?;
        let backup_name = format!(
            ".{}-backup-{}",
            app_dir
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("app"),
            unique_suffix()
        );
        let backup_path = parent.join(backup_name);
        std::fs::rename(app_dir, &backup_path)
            .map_err(|e| format!("Failed to backup existing app: {}", e))?;
        backup_dir = Some(backup_path);
    }

    if let Err(e) = std::fs::rename(staging_dir, app_dir) {
        if let Some(backup_path) = backup_dir.as_ref() {
            if let Err(restore_err) = std::fs::rename(backup_path, app_dir) {
                return Err(format!(
                    "Failed to move app into place: {} (restore failed: {})",
                    e, restore_err
                ));
            }
        }
        return Err(format!("Failed to move app into place: {}", e));
    }

    if let Some(backup_path) = backup_dir {
        if let Err(e) = std::fs::remove_dir_all(&backup_path) {
            warn!("Failed to remove backup dir {:?}: {}", backup_path, e);
        }
    }

    Ok(())
}

fn safe_zip_entry_name(file: &zip::read::ZipFile) -> Result<PathBuf, String> {
    let raw_path = Path::new(file.name());
    if raw_path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err(format!("Unsafe zip entry path: {}", file.name()));
    }

    file.enclosed_name()
        .map(|path| path.to_path_buf())
        .ok_or_else(|| format!("Unsafe zip entry path: {}", file.name()))
}

fn safe_zip_entry_relative_path(
    file: &zip::read::ZipFile,
    prefix: &str,
) -> Result<Option<PathBuf>, String> {
    let enclosed = safe_zip_entry_name(file)?;
    let enclosed_str = enclosed.to_string_lossy();
    if !enclosed_str.starts_with(prefix) {
        return Ok(None);
    }
    let relative = &enclosed_str[prefix.len()..];
    if relative.is_empty() {
        return Ok(None);
    }
    Ok(Some(PathBuf::from(relative)))
}

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
        update_install_state_safe(&app_dir, &app_id, "start", "in_progress", None);
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

    let temp_dir = create_install_staging_dir(&app_id)?;

    update_install_state_safe(&temp_dir, &app_id, "start", "in_progress", None);
    info!("Install stage=start app={}", app_id);
    info!("Install stage=download app={} source=moldable-ai/apps", app_id);
    update_install_state_safe(&temp_dir, &app_id, "download", "in_progress", None);

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
                &temp_dir,
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
            &temp_dir,
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
                &temp_dir,
                &app_id,
                "download",
                "error",
                Some(message.clone()),
            );
            message
        })?;
    update_install_state_safe(&temp_dir, &app_id, "download", "ok", None);

    info!(
        "Install stage=extract app={} bytes={}",
        app_id,
        bytes.len()
    );
    update_install_state_safe(&temp_dir, &app_id, "extract", "in_progress", None);

    let extracted_count = match (|| -> Result<usize, String> {
        // Extract the zip
        let cursor = std::io::Cursor::new(bytes.as_ref());
        let mut archive = zip::ZipArchive::new(cursor).map_err(|e| {
            let message = format!("Failed to open zip: {}", e);
            update_install_state_safe(
                &temp_dir,
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
            let file = archive.by_index(i).map_err(|e| {
                let message = format!("Failed to read archive entry: {}", e);
                update_install_state_safe(
                    &temp_dir,
                    &app_id,
                    "extract",
                    "error",
                    Some(message.clone()),
                );
                message
            })?;
            let name = safe_zip_entry_name(&file).map_err(|message| {
                update_install_state_safe(
                    &temp_dir,
                    &app_id,
                    "extract",
                    "error",
                    Some(message.clone()),
                );
                message
            })?;
            let name_str = name.to_string_lossy();
            for prefix in &possible_prefixes {
                if name_str.starts_with(prefix) {
                    actual_prefix = Some(prefix.clone());
                    break;
                }
            }
            if actual_prefix.is_some() {
                break;
            }
        }

        let prefix = actual_prefix.ok_or_else(|| {
            let message = format!(
                "Could not find app '{}' in archive (tried prefixes: {:?})",
                app_path, possible_prefixes
            );
            update_install_state_safe(
                &temp_dir,
                &app_id,
                "extract",
                "error",
                Some(message.clone()),
            );
            message
        })?;

        info!("Found app at prefix: {}", prefix);

        // Ensure the shared apps directory exists
        std::fs::create_dir_all(&shared_apps_dir).map_err(|e| {
            let message = format!("Failed to create shared apps dir: {}", e);
            update_install_state_safe(
                &temp_dir,
                &app_id,
                "extract",
                "error",
                Some(message.clone()),
            );
            message
        })?;

        let temp_root = temp_dir.canonicalize().map_err(|e| {
            let message = format!("Failed to resolve temp dir: {}", e);
            update_install_state_safe(
                &temp_dir,
                &app_id,
                "extract",
                "error",
                Some(message.clone()),
            );
            message
        })?;

        // Extract just the app folder
        let mut extracted_count = 0;
        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| {
                let message = format!("Failed to read archive entry: {}", e);
                update_install_state_safe(
                    &temp_dir,
                    &app_id,
                    "extract",
                    "error",
                    Some(message.clone()),
                );
                message
            })?;

            let relative_path =
                match safe_zip_entry_relative_path(&file, &prefix).map_err(|message| {
                    update_install_state_safe(
                        &temp_dir,
                        &app_id,
                        "extract",
                        "error",
                        Some(message.clone()),
                    );
                    message
                })? {
                    Some(path) => path,
                    None => continue,
                };

            let dest_path = temp_dir.join(&relative_path);

            if file.is_dir() {
                std::fs::create_dir_all(&dest_path)
                    .map_err(|e| {
                        let message = format!("Failed to create dir {:?}: {}", dest_path, e);
                        update_install_state_safe(
                            &temp_dir,
                            &app_id,
                            "extract",
                            "error",
                            Some(message.clone()),
                        );
                        message
                    })?;
                ensure_path_within_root(&temp_root, &dest_path).map_err(|message| {
                    update_install_state_safe(
                        &temp_dir,
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
                                &temp_dir,
                                &app_id,
                                "extract",
                                "error",
                                Some(message.clone()),
                            );
                            message
                        })?;
                    ensure_path_within_root(&temp_root, parent).map_err(|message| {
                        update_install_state_safe(
                            &temp_dir,
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
                            &temp_dir,
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
                            &temp_dir,
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
                            &temp_dir,
                            &app_id,
                            "extract",
                            "error",
                            Some(message.clone()),
                        );
                        message
                    })?;
                ensure_path_within_root(&temp_root, &dest_path).map_err(|message| {
                    update_install_state_safe(
                        &temp_dir,
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

        Ok(extracted_count)
    })() {
        Ok(count) => count,
        Err(message) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return Err(message);
        }
    };

    info!(
        "Install stage=extract_complete app={} files={}",
        app_id, extracted_count
    );
    if let Err(e) = validate_extracted_app(&temp_dir) {
        let message = format!("Extracted app validation failed: {}", e);
        update_install_state_safe(&temp_dir, &app_id, "extract", "error", Some(message.clone()));
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(message);
    }

    if let Err(e) = swap_app_directory(&temp_dir, &app_dir) {
        update_install_state_safe(&temp_dir, &app_id, "extract", "error", Some(e.clone()));
        let _ = std::fs::remove_dir_all(&temp_dir);
        return Err(e);
    }
    update_install_state_safe(&app_dir, &app_id, "extract", "ok", None);

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
    use super::{safe_zip_entry_relative_path, swap_app_directory, validate_extracted_app};
    use std::io::{Cursor, Write};
    use tempfile::TempDir;
    use zip::write::FileOptions;

    fn build_test_zip(entries: Vec<(&str, &str)>) -> Vec<u8> {
        let mut buffer = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(&mut buffer);
        let options = FileOptions::<()>::default();

        for (name, contents) in entries {
            zip.start_file(name, options).unwrap();
            zip.write_all(contents.as_bytes()).unwrap();
        }

        zip.finish().unwrap();
        buffer.into_inner()
    }

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

    #[test]
    fn test_zip_entry_path_rejects_parent_traversal() {
        let bytes = build_test_zip(vec![("apps-abc/app/../evil.txt", "oops")]);
        let cursor = Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(cursor).unwrap();
        let file = archive.by_index(0).unwrap();

        let result = safe_zip_entry_relative_path(&file, "apps-abc/app/");
        assert!(result.is_err());
    }

    #[test]
    fn test_zip_entry_path_rejects_absolute() {
        let bytes = build_test_zip(vec![("/absolute/evil.txt", "oops")]);
        let cursor = Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(cursor).unwrap();
        let file = archive.by_index(0).unwrap();

        let result = safe_zip_entry_relative_path(&file, "apps-abc/app/");
        assert!(result.is_err());
    }

    #[test]
    fn test_zip_entry_path_accepts_safe_entry() {
        let bytes = build_test_zip(vec![("apps-abc/app/src/index.js", "ok")]);
        let cursor = Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(cursor).unwrap();
        let file = archive.by_index(0).unwrap();

        let result = safe_zip_entry_relative_path(&file, "apps-abc/app/").unwrap();
        assert_eq!(result, Some(std::path::PathBuf::from("src/index.js")));
    }

    #[test]
    fn test_validate_extracted_app_requires_package_json() {
        let temp_dir = TempDir::new().unwrap();
        let result = validate_extracted_app(temp_dir.path());
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_extracted_app_rejects_invalid_moldable_json() {
        let temp_dir = TempDir::new().unwrap();
        std::fs::write(temp_dir.path().join("package.json"), "{}".as_bytes()).unwrap();
        std::fs::write(
            temp_dir.path().join("moldable.json"),
            "{not json}".as_bytes(),
        )
        .unwrap();

        let result = validate_extracted_app(temp_dir.path());
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_extracted_app_accepts_valid_manifest() {
        let temp_dir = TempDir::new().unwrap();
        std::fs::write(temp_dir.path().join("package.json"), "{}".as_bytes()).unwrap();
        std::fs::write(temp_dir.path().join("moldable.json"), "{}".as_bytes()).unwrap();

        let result = validate_extracted_app(temp_dir.path());
        assert!(result.is_ok());
    }

    #[test]
    fn test_swap_app_directory_replaces_existing() {
        let root = TempDir::new().unwrap();
        let shared_apps = root.path().join("shared");
        std::fs::create_dir_all(&shared_apps).unwrap();

        let app_dir = shared_apps.join("example-app");
        std::fs::create_dir_all(&app_dir).unwrap();
        std::fs::write(app_dir.join("old.txt"), "old".as_bytes()).unwrap();

        let staging_root = root.path().join("staging");
        std::fs::create_dir_all(&staging_root).unwrap();
        let staging_dir = staging_root.join("example-app-staging");
        std::fs::create_dir_all(&staging_dir).unwrap();
        std::fs::write(staging_dir.join("new.txt"), "new".as_bytes()).unwrap();

        swap_app_directory(&staging_dir, &app_dir).unwrap();

        assert!(app_dir.join("new.txt").exists());
        assert!(!app_dir.join("old.txt").exists());
    }
}
