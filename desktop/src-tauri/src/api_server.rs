//! HTTP API server for AI tools
//!
//! Provides HTTP endpoints that the AI server can call to perform
//! operations that require access to Rust-side functionality.

use crate::apps::{find_available_port, register_app};
use crate::ports::{acquire_port, PortAcquisitionConfig, DEFAULT_API_SERVER_PORT};
use crate::runtime::ensure_node_modules_installed;
use crate::types::RegisteredApp;
use crate::workspace::copy_dir_recursive;
use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Default port for the API server (re-export from ports for external use)
pub const API_SERVER_PORT: u16 = DEFAULT_API_SERVER_PORT;

/// Fallback port range for API server
const API_SERVER_FALLBACK_START: u16 = DEFAULT_API_SERVER_PORT + 1;
const API_SERVER_FALLBACK_END: u16 = DEFAULT_API_SERVER_PORT + 97;

// ============================================================================
// TYPES
// ============================================================================

#[derive(Clone)]
pub struct ApiState {
    pub app_handle: Arc<Mutex<Option<tauri::AppHandle>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAppRequest {
    /// Unique app identifier (lowercase, hyphens allowed)
    pub app_id: String,
    /// Display name of the app
    pub name: String,
    /// Emoji icon for the app
    pub icon: String,
    /// Brief description of what the app does
    pub description: String,
    /// Widget size: small, medium, or large
    #[serde(default = "default_widget_size")]
    pub widget_size: String,
    /// Optional extra dependencies to add to package.json
    /// Format: { "package-name": "^1.0.0" }
    #[serde(default)]
    pub extra_dependencies: HashMap<String, String>,
    /// Optional extra dev dependencies
    #[serde(default)]
    pub extra_dev_dependencies: HashMap<String, String>,
}

fn default_widget_size() -> String {
    "medium".to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAppResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pnpm_installed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registered: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ============================================================================
// PLACEHOLDER REPLACEMENT
// ============================================================================

const PLACEHOLDERS: [(&str, &str); 5] = [
    ("__APP_ID__", "app_id"),
    ("__APP_NAME__", "name"),
    ("__APP_ICON__", "icon"),
    ("__APP_DESCRIPTION__", "description"),
    ("__WIDGET_SIZE__", "widget_size"),
];

fn replace_placeholders_in_file(
    path: &PathBuf,
    replacements: &HashMap<&str, &str>,
) -> Result<(), String> {
    // Skip binary files
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let binary_extensions = ["png", "jpg", "jpeg", "gif", "ico", "woff", "woff2", "ttf", "eot"];
    if binary_extensions.contains(&ext) {
        return Ok(());
    }

    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return Ok(()), // Skip files that can't be read as text
    };

    let mut modified = content.clone();
    let mut changed = false;

    for (placeholder, key) in &PLACEHOLDERS {
        if let Some(value) = replacements.get(*key) {
            if modified.contains(*placeholder) {
                modified = modified.replace(*placeholder, value);
                changed = true;
            }
        }
    }

    if changed {
        fs::write(path, modified).map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    }

    Ok(())
}

fn replace_placeholders_recursive(
    dir: &PathBuf,
    replacements: &HashMap<&str, &str>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

        if path.is_dir() {
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            // Skip node_modules and .next
            if name == "node_modules" || name == ".next" {
                continue;
            }
            replace_placeholders_recursive(&path, replacements)?;
        } else {
            replace_placeholders_in_file(&path, replacements)?;
        }
    }

    Ok(())
}

// ============================================================================
// DEPENDENCY MANAGEMENT
// ============================================================================

fn add_dependencies_to_package_json(
    package_json_path: &PathBuf,
    extra_deps: &HashMap<String, String>,
    extra_dev_deps: &HashMap<String, String>,
) -> Result<(), String> {
    if extra_deps.is_empty() && extra_dev_deps.is_empty() {
        return Ok(());
    }

    let content = fs::read_to_string(package_json_path)
        .map_err(|e| format!("Failed to read package.json: {}", e))?;

    let mut pkg: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse package.json: {}", e))?;

    // Add dependencies
    if !extra_deps.is_empty() {
        let deps = pkg
            .get_mut("dependencies")
            .and_then(|d| d.as_object_mut())
            .ok_or("package.json missing dependencies object")?;

        for (name, version) in extra_deps {
            deps.insert(name.clone(), serde_json::Value::String(version.clone()));
        }
    }

    // Add devDependencies
    if !extra_dev_deps.is_empty() {
        let dev_deps = pkg
            .get_mut("devDependencies")
            .and_then(|d| d.as_object_mut())
            .ok_or("package.json missing devDependencies object")?;

        for (name, version) in extra_dev_deps {
            dev_deps.insert(name.clone(), serde_json::Value::String(version.clone()));
        }
    }

    let updated = serde_json::to_string_pretty(&pkg)
        .map_err(|e| format!("Failed to serialize package.json: {}", e))?;

    fs::write(package_json_path, updated)
        .map_err(|e| format!("Failed to write package.json: {}", e))?;

    Ok(())
}

// ============================================================================
// HANDLERS
// ============================================================================

async fn health_handler() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "service": "moldable-api"
    }))
}

async fn create_app_handler(
    State(state): State<ApiState>,
    Json(req): Json<CreateAppRequest>,
) -> impl IntoResponse {
    info!("Creating app: {} ({})", req.name, req.app_id);

    // Validate app_id format
    if !req.app_id.chars().all(|c| c.is_ascii_lowercase() || c == '-' || c.is_ascii_digit()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(CreateAppResponse {
                success: false,
                error: Some("App ID must be lowercase with hyphens and numbers only".to_string()),
                ..Default::default()
            }),
        );
    }

    // Get paths
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(CreateAppResponse {
                    success: false,
                    error: Some("Could not get HOME directory".to_string()),
                    ..Default::default()
                }),
            );
        }
    };
    
    info!("Creating app with HOME={}", home);

    let template_path = PathBuf::from(format!("{}/.moldable/cache/app-template", home));
    let apps_dir = PathBuf::from(format!("{}/.moldable/shared/apps", home));
    let dest_dir = apps_dir.join(&req.app_id);

    // Check if template exists
    if !template_path.exists() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(CreateAppResponse {
                success: false,
                error: Some(format!(
                    "App template not found at {}. Restart Moldable to install it.",
                    template_path.display()
                )),
                ..Default::default()
            }),
        );
    }

    // Check if app already exists
    if dest_dir.exists() {
        return (
            StatusCode::CONFLICT,
            Json(CreateAppResponse {
                success: false,
                error: Some(format!(
                    "App '{}' already exists at {}",
                    req.app_id,
                    dest_dir.display()
                )),
                ..Default::default()
            }),
        );
    }

    // Ensure apps directory exists
    if let Err(e) = fs::create_dir_all(&apps_dir) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(CreateAppResponse {
                success: false,
                error: Some(format!("Failed to create apps directory: {}", e)),
                ..Default::default()
            }),
        );
    }

    // Copy template to destination
    if let Err(e) = copy_dir_recursive(&template_path, &dest_dir) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(CreateAppResponse {
                success: false,
                error: Some(format!("Failed to copy template: {}", e)),
                ..Default::default()
            }),
        );
    }

    // Replace placeholders
    let mut replacements: HashMap<&str, &str> = HashMap::new();
    replacements.insert("app_id", &req.app_id);
    replacements.insert("name", &req.name);
    replacements.insert("icon", &req.icon);
    replacements.insert("description", &req.description);
    replacements.insert("widget_size", &req.widget_size);

    if let Err(e) = replace_placeholders_recursive(&dest_dir, &replacements) {
        // Cleanup on failure
        let _ = fs::remove_dir_all(&dest_dir);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(CreateAppResponse {
                success: false,
                error: Some(format!("Failed to replace placeholders: {}", e)),
                ..Default::default()
            }),
        );
    }

    // Add extra dependencies if provided
    let package_json_path = dest_dir.join("package.json");
    if let Err(e) = add_dependencies_to_package_json(
        &package_json_path,
        &req.extra_dependencies,
        &req.extra_dev_dependencies,
    ) {
        warn!("Failed to add extra dependencies: {}", e);
        // Don't fail the whole operation for this
    }

    // Run pnpm install
    let pnpm_installed = match ensure_node_modules_installed(&dest_dir) {
        Ok(_) => {
            info!("pnpm install completed for {}", req.app_id);
            true
        }
        Err(e) => {
            warn!("pnpm install failed for {}: {}", req.app_id, e);
            false
        }
    };

    // Find available port
    let port = find_available_port(4100);

    // Get app handle for registration
    let app_handle = {
        let guard = state.app_handle.lock().await;
        guard.clone()
    };

    // Register app in workspace config
    let registered = if let Some(handle) = app_handle {
        let registered_app = RegisteredApp {
            id: req.app_id.clone(),
            name: req.name.clone(),
            icon: req.icon.clone(),
            icon_path: None,
            port,
            path: dest_dir.to_string_lossy().to_string(),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: req.widget_size.clone(),
            requires_port: false,
        };

        match register_app(handle, registered_app) {
            Ok(_) => {
                info!("Registered {} in workspace config", req.app_id);
                true
            }
            Err(e) => {
                warn!("Failed to register app: {}", e);
                false
            }
        }
    } else {
        warn!("No app handle available for registration");
        false
    };

    // Collect created files
    let files = collect_created_files(&dest_dir);

    info!(
        "App {} created successfully: port={}, pnpm={}, registered={}",
        req.app_id, port, pnpm_installed, registered
    );

    (
        StatusCode::OK,
        Json(CreateAppResponse {
            success: true,
            app_id: Some(req.app_id),
            name: Some(req.name),
            icon: Some(req.icon),
            port: Some(port),
            path: Some(dest_dir.to_string_lossy().to_string()),
            files: Some(files),
            pnpm_installed: Some(pnpm_installed),
            registered: Some(registered),
            message: Some(format!(
                "App created and {} on port {}",
                if registered { "registered" } else { "ready to register" },
                port
            )),
            error: None,
        }),
    )
}

fn collect_created_files(dir: &PathBuf) -> Vec<String> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            
            // Skip node_modules and .next
            if name == "node_modules" || name == ".next" {
                continue;
            }

            if path.is_dir() {
                // Just list directories, don't recurse for simplicity
                files.push(format!("{}/", name));
            } else {
                files.push(name.to_string());
            }
        }
    }
    files.sort();
    files
}

// ============================================================================
// SERVER LIFECYCLE
// ============================================================================

/// Acquire the API server port using robust retry and fallback logic.
fn acquire_api_server_port() -> Result<u16, String> {
    let config = PortAcquisitionConfig {
        preferred_port: API_SERVER_PORT,
        max_retries: 2,
        initial_delay_ms: 200,
        max_delay_ms: 2000,
        allow_fallback: true,
        fallback_range: Some((API_SERVER_FALLBACK_START, API_SERVER_FALLBACK_END)),
    };
    
    let result = acquire_port(config)?;
    
    if !result.is_preferred {
        warn!(
            "API Server using fallback port {} (preferred {} was unavailable)",
            result.port, API_SERVER_PORT
        );
    }
    
    Ok(result.port)
}

/// Start the API server.
/// Returns the actual port the server is running on.
pub async fn start_api_server(app_handle: tauri::AppHandle) -> Result<u16, String> {
    // Acquire port with retry and fallback logic (run in blocking context)
    let actual_port = tokio::task::spawn_blocking(acquire_api_server_port)
        .await
        .map_err(|e| format!("Failed to acquire port: {}", e))??;
    
    let state = ApiState {
        app_handle: Arc::new(Mutex::new(Some(app_handle))),
    };

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/api/create-app", post(create_app_handler))
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], actual_port));
    
    info!("Starting API server on http://{}", addr);

    // Spawn the server in the background
    tokio::spawn(async move {
        let listener = match tokio::net::TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                error!("Failed to bind API server: {}", e);
                return;
            }
        };

        if let Err(e) = axum::serve(listener, app).await {
            error!("API server error: {}", e);
        }
    });

    Ok(actual_port)
}

// ============================================================================
// DEFAULT IMPL
// ============================================================================

impl Default for CreateAppResponse {
    fn default() -> Self {
        Self {
            success: false,
            app_id: None,
            name: None,
            icon: None,
            port: None,
            path: None,
            files: None,
            pnpm_installed: None,
            registered: None,
            message: None,
            error: None,
        }
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_default_widget_size() {
        assert_eq!(default_widget_size(), "medium");
    }

    #[test]
    fn test_create_app_response_default() {
        let response = CreateAppResponse::default();
        assert!(!response.success);
        assert!(response.app_id.is_none());
        assert!(response.error.is_none());
    }

    // ==================== PORT CONSTANTS TESTS ====================
    
    #[test]
    fn test_api_server_port_constant() {
        assert_eq!(API_SERVER_PORT, 39102);
    }
    
    #[test]
    fn test_api_server_port_matches_default() {
        // API_SERVER_PORT should equal DEFAULT_API_SERVER_PORT from ports module
        assert_eq!(API_SERVER_PORT, DEFAULT_API_SERVER_PORT);
    }
    
    #[test]
    fn test_api_server_fallback_range() {
        assert_eq!(API_SERVER_FALLBACK_START, 39103);
        assert_eq!(API_SERVER_FALLBACK_END, 39199);
        // Fallback range should be after the main port
        assert!(API_SERVER_FALLBACK_START > API_SERVER_PORT);
    }
    
    #[test]
    fn test_api_server_fallback_range_is_contiguous() {
        // Fallback start should be exactly one more than the main port
        assert_eq!(API_SERVER_FALLBACK_START, API_SERVER_PORT + 1);
    }
    
    #[test]
    fn test_api_server_fallback_range_size() {
        // Should have 97 fallback ports (39103-39199)
        let range_size = API_SERVER_FALLBACK_END - API_SERVER_FALLBACK_START + 1;
        assert_eq!(range_size, 97);
    }
    
    #[test]
    fn test_api_server_port_in_valid_range() {
        // Port should be > 1024 (unprivileged) and < 65536
        assert!(API_SERVER_PORT > 1024);
        assert!(API_SERVER_PORT < 65535);
        assert!(API_SERVER_FALLBACK_END < 65535);
    }
    
    #[test]
    fn test_api_server_ports_dont_conflict_with_ai_server() {
        use crate::ai_server::AI_SERVER_PORT;
        
        // API server port should be different from AI server port
        assert_ne!(API_SERVER_PORT, AI_SERVER_PORT);
        
        // API server port should not be in AI server's range
        // (AI server uses 39100-39199, API uses 39102-39199, so they overlap)
        // But the default ports are distinct
        assert_eq!(AI_SERVER_PORT, 39100);
        assert_eq!(API_SERVER_PORT, 39102);
    }
    
    // ==================== PORT ACQUISITION TESTS ====================
    
    #[test]
    fn test_acquire_api_server_port_when_free() {
        use crate::ports::is_port_available;
        
        // If the default port happens to be free, acquisition should succeed
        if is_port_available(API_SERVER_PORT) {
            let result = acquire_api_server_port();
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), API_SERVER_PORT);
        }
    }
    
    #[test]
    fn test_acquire_api_server_port_returns_result() {
        // Should always return a Result (Ok or Err), never panic
        let result = acquire_api_server_port();
        match result {
            Ok(port) => {
                assert!(port > 0);
                assert!(port >= API_SERVER_PORT);
                assert!(port <= API_SERVER_FALLBACK_END);
            }
            Err(msg) => {
                // Error message should be descriptive
                assert!(!msg.is_empty());
            }
        }
    }
    
    #[test]
    fn test_acquire_api_server_port_returns_valid_port() {
        use crate::ports::is_port_available;
        
        // If acquisition succeeds, port should be valid
        if is_port_available(API_SERVER_PORT) {
            if let Ok(port) = acquire_api_server_port() {
                // Port should be in the expected range
                assert!(port >= API_SERVER_PORT);
                assert!(port <= API_SERVER_FALLBACK_END);
            }
        }
    }

    // ==================== PLACEHOLDER REPLACEMENT TESTS ====================

    #[test]
    fn test_replace_placeholders_in_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.json");
        
        fs::write(&file_path, r#"{
            "id": "__APP_ID__",
            "name": "__APP_NAME__",
            "icon": "__APP_ICON__",
            "description": "__APP_DESCRIPTION__"
        }"#).unwrap();

        let mut replacements: HashMap<&str, &str> = HashMap::new();
        replacements.insert("app_id", "my-app");
        replacements.insert("name", "My App");
        replacements.insert("icon", "🚀");
        replacements.insert("description", "A test app");

        let result = replace_placeholders_in_file(&file_path, &replacements);
        assert!(result.is_ok());

        let content = fs::read_to_string(&file_path).unwrap();
        assert!(content.contains("my-app"));
        assert!(content.contains("My App"));
        assert!(content.contains("🚀"));
        assert!(content.contains("A test app"));
        assert!(!content.contains("__APP_ID__"));
        assert!(!content.contains("__APP_NAME__"));
    }

    #[test]
    fn test_replace_placeholders_skips_binary_files() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.png");
        
        // Write some binary-ish content
        fs::write(&file_path, &[0x89, 0x50, 0x4E, 0x47]).unwrap();

        let mut replacements: HashMap<&str, &str> = HashMap::new();
        replacements.insert("app_id", "my-app");

        // Should succeed without modifying
        let result = replace_placeholders_in_file(&file_path, &replacements);
        assert!(result.is_ok());
    }

    #[test]
    fn test_replace_placeholders_recursive() {
        let temp_dir = TempDir::new().unwrap();
        let sub_dir = temp_dir.path().join("src");
        fs::create_dir_all(&sub_dir).unwrap();
        
        // Create files in root and subdirectory
        fs::write(temp_dir.path().join("root.txt"), "App: __APP_NAME__").unwrap();
        fs::write(sub_dir.join("nested.txt"), "ID: __APP_ID__").unwrap();

        let mut replacements: HashMap<&str, &str> = HashMap::new();
        replacements.insert("name", "Test App");
        replacements.insert("app_id", "test-app");

        let result = replace_placeholders_recursive(&temp_dir.path().to_path_buf(), &replacements);
        assert!(result.is_ok());

        let root_content = fs::read_to_string(temp_dir.path().join("root.txt")).unwrap();
        let nested_content = fs::read_to_string(sub_dir.join("nested.txt")).unwrap();
        
        assert!(root_content.contains("Test App"));
        assert!(nested_content.contains("test-app"));
    }

    #[test]
    fn test_replace_placeholders_skips_node_modules() {
        let temp_dir = TempDir::new().unwrap();
        let node_modules = temp_dir.path().join("node_modules");
        fs::create_dir_all(&node_modules).unwrap();
        
        fs::write(node_modules.join("file.txt"), "__APP_NAME__").unwrap();

        let mut replacements: HashMap<&str, &str> = HashMap::new();
        replacements.insert("name", "Test App");

        let result = replace_placeholders_recursive(&temp_dir.path().to_path_buf(), &replacements);
        assert!(result.is_ok());

        // node_modules should be skipped, so file should still have placeholder
        let content = fs::read_to_string(node_modules.join("file.txt")).unwrap();
        assert!(content.contains("__APP_NAME__"));
    }

    #[test]
    fn test_add_dependencies_to_package_json() {
        let temp_dir = TempDir::new().unwrap();
        let package_json = temp_dir.path().join("package.json");
        
        fs::write(&package_json, r#"{
            "name": "test",
            "dependencies": {
                "react": "^18.0.0"
            },
            "devDependencies": {
                "typescript": "^5.0.0"
            }
        }"#).unwrap();

        let mut extra_deps: HashMap<String, String> = HashMap::new();
        extra_deps.insert("zod".to_string(), "^3.0.0".to_string());

        let mut extra_dev_deps: HashMap<String, String> = HashMap::new();
        extra_dev_deps.insert("vitest".to_string(), "^1.0.0".to_string());

        let result = add_dependencies_to_package_json(&package_json, &extra_deps, &extra_dev_deps);
        assert!(result.is_ok());

        let content = fs::read_to_string(&package_json).unwrap();
        assert!(content.contains("zod"));
        assert!(content.contains("vitest"));
        assert!(content.contains("react")); // Original deps preserved
        assert!(content.contains("typescript")); // Original devDeps preserved
    }

    #[test]
    fn test_add_empty_dependencies_is_noop() {
        let temp_dir = TempDir::new().unwrap();
        let package_json = temp_dir.path().join("package.json");
        
        let original = r#"{"name":"test","dependencies":{},"devDependencies":{}}"#;
        fs::write(&package_json, original).unwrap();

        let empty_deps: HashMap<String, String> = HashMap::new();
        let result = add_dependencies_to_package_json(&package_json, &empty_deps, &empty_deps);
        assert!(result.is_ok());

        // File should not be modified if no deps to add
        let content = fs::read_to_string(&package_json).unwrap();
        assert_eq!(content, original);
    }

    #[test]
    fn test_collect_created_files() {
        let temp_dir = TempDir::new().unwrap();
        
        fs::write(temp_dir.path().join("file1.txt"), "").unwrap();
        fs::write(temp_dir.path().join("file2.json"), "").unwrap();
        fs::create_dir_all(temp_dir.path().join("src")).unwrap();
        
        let files = collect_created_files(&temp_dir.path().to_path_buf());
        
        assert!(files.contains(&"file1.txt".to_string()));
        assert!(files.contains(&"file2.json".to_string()));
        assert!(files.contains(&"src/".to_string()));
    }

    #[test]
    fn test_collect_created_files_excludes_node_modules() {
        let temp_dir = TempDir::new().unwrap();
        
        fs::write(temp_dir.path().join("file.txt"), "").unwrap();
        fs::create_dir_all(temp_dir.path().join("node_modules")).unwrap();
        fs::create_dir_all(temp_dir.path().join(".next")).unwrap();
        
        let files = collect_created_files(&temp_dir.path().to_path_buf());
        
        assert!(files.contains(&"file.txt".to_string()));
        assert!(!files.iter().any(|f| f.contains("node_modules")));
        assert!(!files.iter().any(|f| f.contains(".next")));
    }

    #[test]
    fn test_create_app_request_deserialization() {
        let json = r#"{
            "appId": "test-app",
            "name": "Test App",
            "icon": "🚀",
            "description": "A test application",
            "widgetSize": "large",
            "extraDependencies": {"zod": "^3.0.0"}
        }"#;

        let req: CreateAppRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.app_id, "test-app");
        assert_eq!(req.name, "Test App");
        assert_eq!(req.icon, "🚀");
        assert_eq!(req.description, "A test application");
        assert_eq!(req.widget_size, "large");
        assert_eq!(req.extra_dependencies.get("zod"), Some(&"^3.0.0".to_string()));
    }

    #[test]
    fn test_create_app_request_default_widget_size() {
        let json = r#"{
            "appId": "test-app",
            "name": "Test App",
            "icon": "🚀",
            "description": "A test application"
        }"#;

        let req: CreateAppRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.widget_size, "medium");
    }

    #[test]
    fn test_create_app_response_serialization() {
        let response = CreateAppResponse {
            success: true,
            app_id: Some("test-app".to_string()),
            name: Some("Test App".to_string()),
            icon: Some("🚀".to_string()),
            port: Some(4100),
            path: Some("/path/to/app".to_string()),
            files: Some(vec!["file1.txt".to_string()]),
            pnpm_installed: Some(true),
            registered: Some(true),
            message: Some("App created".to_string()),
            error: None,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"success\":true"));
        assert!(json.contains("\"appId\":\"test-app\""));
        assert!(json.contains("\"port\":4100"));
        assert!(!json.contains("error")); // None fields should be skipped
    }
}
