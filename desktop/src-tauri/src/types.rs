//! Shared data types for Moldable desktop backend
//!
//! This module contains all serializable types used across the application:
//! - Configuration types (MoldableConfig, WorkspacesConfig)
//! - App types (RegisteredApp, AppStatus, AppRegistry)
//! - Conversation types
//! - Environment types

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

pub fn default_widget_size() -> String {
    "medium".to_string()
}

// ============================================================================
// APP TYPES
// ============================================================================

/// Registered app in workspace config
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RegisteredApp {
    pub id: String,
    pub name: String,
    pub icon: String,
    #[serde(default)]
    pub icon_path: Option<String>,
    pub port: u16,
    pub path: String,
    pub command: String,
    pub args: Vec<String>,
    #[serde(default = "default_widget_size")]
    pub widget_size: String,
    /// If true, app requires this specific port (show kill dialog on conflict)
    /// If false (default), auto-pick a free port
    #[serde(default)]
    pub requires_port: bool,
}

/// App status returned to frontend
#[derive(Serialize, Debug)]
pub struct AppStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub recent_output: Vec<String>,
    /// The actual port the app is running on (may differ from configured port)
    pub actual_port: Option<u16>,
}

/// Port information for debugging
#[derive(Serialize, Debug)]
pub struct PortInfo {
    pub port: u16,
    pub pid: Option<u32>,
    pub process_name: Option<String>,
    pub command: Option<String>,
}

/// Instance entry in .moldable.instances.json
#[derive(Deserialize, Debug)]
pub struct AppInstance {
    pub pid: u32,
    #[allow(dead_code)]
    pub port: Option<u16>,
    #[allow(dead_code)]
    #[serde(rename = "startedAt")]
    pub started_at: Option<String>,
}

/// Available app info for installation (from workspace apps folder)
#[derive(Serialize, Clone, Debug)]
pub struct AvailableApp {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub icon_path: Option<String>,
    pub description: Option<String>,
    pub path: String,
    pub widget_size: String,
}

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

/// Main workspace configuration (config.json)
#[derive(Serialize, Deserialize, Default, Debug)]
pub struct MoldableConfig {
    /// Path to the Moldable development workspace (for self-modification)
    #[serde(default)]
    pub workspace: Option<String>,
    #[serde(default)]
    pub apps: Vec<RegisteredApp>,
    /// User preferences (model, theme, reasoning effort, etc.)
    #[serde(default)]
    pub preferences: serde_json::Map<String, serde_json::Value>,
}

/// Shared config stored in ~/.moldable/shared/config.json
/// Used for preferences that should persist across all workspaces
#[derive(Serialize, Deserialize, Default, Debug)]
pub struct SharedConfig {
    /// Whether the Hello Moldables tutorial app has been installed
    #[serde(default)]
    pub hello_moldables_installed: bool,
}

// ============================================================================
// WORKSPACE TYPES
// ============================================================================

/// Individual workspace metadata
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_at: String,
}

/// Top-level workspaces configuration (workspaces.json)
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacesConfig {
    pub active_workspace: String,
    pub workspaces: Vec<Workspace>,
}

impl Default for WorkspacesConfig {
    fn default() -> Self {
        Self {
            active_workspace: "personal".to_string(),
            workspaces: vec![Workspace {
                id: "personal".to_string(),
                name: "Personal".to_string(),
                color: "#10b981".to_string(),
                created_at: chrono::Utc::now().to_rfc3339(),
            }],
        }
    }
}

// ============================================================================
// MANIFEST & ENVIRONMENT TYPES
// ============================================================================

/// Environment variable requirement from moldable.json
#[derive(Serialize, Deserialize, Clone, Default, Debug)]
pub struct EnvRequirement {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub required: bool,
}

/// App manifest (moldable.json)
#[derive(Serialize, Deserialize, Default, Debug)]
pub struct MoldableManifest {
    pub name: Option<String>,
    pub icon: Option<String>,
    #[serde(rename = "iconPath")]
    pub icon_path: Option<String>,
    pub description: Option<String>,
    #[serde(rename = "widgetSize")]
    pub widget_size: Option<String>,
    pub port: Option<u16>,
    /// If true, app requires this specific port (show kill dialog on conflict)
    #[serde(default, rename = "requiresPort")]
    pub requires_port: bool,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Vec<EnvRequirement>,
}

/// Environment status for an app
#[derive(Serialize, Debug)]
pub struct AppEnvStatus {
    pub requirements: Vec<EnvRequirement>,
    pub missing: Vec<String>,
    pub present: Vec<String>,
}

// ============================================================================
// APP REGISTRY TYPES (GitHub)
// ============================================================================

/// Entry for an app in the remote registry manifest
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppRegistryEntry {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub icon: String,
    pub icon_url: Option<String>,
    pub widget_size: String,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    pub path: String,
    pub required_env: Option<Vec<String>>,
    pub moldable_dependencies: Option<HashMap<String, String>>,
    /// Commit SHA to install from
    pub commit: String,
}

/// Category in the registry
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub icon: String,
}

/// The full app registry manifest from GitHub
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppRegistry {
    #[serde(rename = "$schema")]
    pub schema: Option<String>,
    pub version: String,
    pub generated_at: Option<String>,
    pub registry: String,
    pub apps: Vec<AppRegistryEntry>,
    pub categories: Option<Vec<Category>>,
}

// ============================================================================
// CONVERSATION TYPES
// ============================================================================

/// Conversation metadata for listing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMeta {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: usize,
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_widget_size() {
        assert_eq!(default_widget_size(), "medium");
    }

    #[test]
    fn test_workspaces_config_default() {
        let config = WorkspacesConfig::default();
        assert_eq!(config.active_workspace, "personal");
        assert_eq!(config.workspaces.len(), 1);
        assert_eq!(config.workspaces[0].id, "personal");
        assert_eq!(config.workspaces[0].name, "Personal");
        assert_eq!(config.workspaces[0].color, "#10b981");
    }

    #[test]
    fn test_workspaces_config_serialization() {
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
                    created_at: "2026-01-01T00:00:00Z".to_string(),
                },
            ],
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: WorkspacesConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.active_workspace, "work");
        assert_eq!(parsed.workspaces.len(), 2);
    }

    #[test]
    fn test_workspaces_config_camel_case() {
        let config = WorkspacesConfig::default();
        let json = serde_json::to_string(&config).unwrap();

        assert!(json.contains("activeWorkspace"));
        assert!(json.contains("createdAt"));
        assert!(!json.contains("active_workspace"));
        assert!(!json.contains("created_at"));
    }

    #[test]
    fn test_registered_app_default_widget_size() {
        let json = r#"{
            "id": "test",
            "name": "Test",
            "icon": "📦",
            "port": 3000,
            "path": "/test",
            "command": "pnpm",
            "args": ["dev"]
        }"#;

        let app: RegisteredApp = serde_json::from_str(json).unwrap();
        assert_eq!(app.widget_size, "medium");
        assert!(!app.requires_port);
    }

    #[test]
    fn test_registered_app_requires_port() {
        let json = r#"{
            "id": "test",
            "name": "Test",
            "icon": "📦",
            "port": 3000,
            "path": "/test",
            "command": "pnpm",
            "args": ["dev"],
            "requires_port": true
        }"#;

        let app: RegisteredApp = serde_json::from_str(json).unwrap();
        assert!(app.requires_port);
    }

    #[test]
    fn test_moldable_config_default() {
        let config = MoldableConfig::default();
        assert!(config.workspace.is_none());
        assert!(config.apps.is_empty());
        assert!(config.preferences.is_empty());
    }

    #[test]
    fn test_moldable_manifest_minimal() {
        let json = r#"{}"#;
        let manifest: MoldableManifest = serde_json::from_str(json).unwrap();

        assert!(manifest.name.is_none());
        assert!(manifest.icon.is_none());
        assert!(manifest.port.is_none());
        assert!(!manifest.requires_port);
        assert!(manifest.env.is_empty());
    }

    #[test]
    fn test_moldable_manifest_full() {
        let json = r#"{
            "name": "My App",
            "icon": "🚀",
            "description": "A cool app",
            "widgetSize": "large",
            "port": 3005,
            "requiresPort": true,
            "command": "pnpm",
            "args": ["dev"],
            "env": [
                {
                    "key": "API_KEY",
                    "name": "API Key",
                    "description": "Your API key",
                    "url": "https://example.com/api-keys",
                    "required": true
                }
            ]
        }"#;

        let manifest: MoldableManifest = serde_json::from_str(json).unwrap();

        assert_eq!(manifest.name, Some("My App".to_string()));
        assert_eq!(manifest.icon, Some("🚀".to_string()));
        assert_eq!(manifest.widget_size, Some("large".to_string()));
        assert_eq!(manifest.port, Some(3005));
        assert!(manifest.requires_port);
        assert_eq!(manifest.env.len(), 1);
        assert_eq!(manifest.env[0].key, "API_KEY");
        assert!(manifest.env[0].required);
    }

    #[test]
    fn test_env_requirement_defaults() {
        let json = r#"{
            "key": "TEST_KEY",
            "name": "Test Key"
        }"#;

        let req: EnvRequirement = serde_json::from_str(json).unwrap();

        assert_eq!(req.key, "TEST_KEY");
        assert_eq!(req.name, "Test Key");
        assert!(req.description.is_none());
        assert!(req.url.is_none());
        assert!(!req.required);
    }

    #[test]
    fn test_conversation_meta_serialization() {
        let meta = ConversationMeta {
            id: "conv-123".to_string(),
            title: "Test Conversation".to_string(),
            created_at: "2026-01-14T10:00:00Z".to_string(),
            updated_at: "2026-01-14T11:00:00Z".to_string(),
            message_count: 5,
        };

        let json = serde_json::to_string(&meta).unwrap();

        assert!(json.contains("createdAt"));
        assert!(json.contains("updatedAt"));
        assert!(json.contains("messageCount"));

        let parsed: ConversationMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, "conv-123");
        assert_eq!(parsed.message_count, 5);
    }

    #[test]
    fn test_app_registry_entry_serialization() {
        let entry = AppRegistryEntry {
            id: "scribo".to_string(),
            name: "Scribo".to_string(),
            version: "0.1.0".to_string(),
            description: Some("A translation journal app".to_string()),
            icon: "✍️".to_string(),
            icon_url: Some("https://example.com/icon.png".to_string()),
            widget_size: "medium".to_string(),
            category: Some("productivity".to_string()),
            tags: Some(vec!["translation".to_string(), "language".to_string()]),
            path: "scribo".to_string(),
            required_env: Some(vec!["OPENAI_API_KEY".to_string()]),
            moldable_dependencies: None,
            commit: "abc123def456".to_string(),
        };

        let json = serde_json::to_string(&entry).unwrap();
        let parsed: AppRegistryEntry = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, "scribo");
        assert_eq!(parsed.version, "0.1.0");
        assert_eq!(parsed.commit, "abc123def456");
    }

    #[test]
    fn test_app_registry_entry_camel_case() {
        let entry = AppRegistryEntry {
            id: "test".to_string(),
            name: "Test".to_string(),
            version: "1.0.0".to_string(),
            description: None,
            icon: "📦".to_string(),
            icon_url: None,
            widget_size: "small".to_string(),
            category: None,
            tags: None,
            path: "test".to_string(),
            required_env: Some(vec!["API_KEY".to_string()]),
            moldable_dependencies: None,
            commit: "deadbeef".to_string(),
        };

        let json = serde_json::to_string(&entry).unwrap();

        assert!(json.contains("widgetSize"));
        assert!(json.contains("iconUrl"));
        assert!(json.contains("requiredEnv"));
        assert!(json.contains("moldableDependencies"));
        assert!(!json.contains("widget_size"));
        assert!(!json.contains("icon_url"));
    }

    #[test]
    fn test_app_registry_from_github_format() {
        let json = r#"{
            "$schema": "https://moldable.sh/schemas/manifest.json",
            "version": "1",
            "generatedAt": "2026-01-15T04:20:46.412Z",
            "registry": "moldable-ai/apps",
            "apps": [
                {
                    "id": "calendar",
                    "name": "Calendar",
                    "version": "0.1.0",
                    "description": "Integrated calendar",
                    "icon": "🗓️",
                    "iconUrl": "https://example.com/icon.png",
                    "widgetSize": "medium",
                    "category": "productivity",
                    "tags": ["calendar"],
                    "path": "calendar",
                    "requiredEnv": ["GOOGLE_CLIENT_ID"],
                    "moldableDependencies": {},
                    "commit": "994b1cc123456789"
                }
            ],
            "categories": [
                {"id": "productivity", "name": "Productivity", "icon": "⚡"}
            ]
        }"#;

        let registry: AppRegistry = serde_json::from_str(json).unwrap();

        assert_eq!(registry.version, "1");
        assert_eq!(registry.registry, "moldable-ai/apps");
        assert_eq!(registry.apps.len(), 1);
        assert_eq!(registry.apps[0].id, "calendar");
    }

    #[test]
    fn test_app_status_serialization() {
        let status = AppStatus {
            running: true,
            pid: Some(12345),
            exit_code: None,
            recent_output: vec!["line1".to_string(), "line2".to_string()],
            actual_port: Some(3001),
        };

        let json = serde_json::to_string(&status).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["running"], true);
        assert_eq!(parsed["pid"], 12345);
        assert!(parsed["exit_code"].is_null());
        assert_eq!(parsed["actual_port"], 3001);
    }

    #[test]
    fn test_port_info_serialization() {
        let info = PortInfo {
            port: 3001,
            pid: Some(12345),
            process_name: Some("node".to_string()),
            command: Some("node server.js".to_string()),
        };

        let json = serde_json::to_string(&info).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["port"], 3001);
        assert_eq!(parsed["pid"], 12345);
        assert_eq!(parsed["process_name"], "node");
    }

    #[test]
    fn test_app_instance_deserialization() {
        let json = r#"{
            "pid": 12345,
            "port": 3001,
            "startedAt": "2026-01-14T10:00:00Z"
        }"#;

        let instance: AppInstance = serde_json::from_str(json).unwrap();
        assert_eq!(instance.pid, 12345);
    }

    #[test]
    fn test_shared_config_default() {
        let config = SharedConfig::default();
        assert!(!config.hello_moldables_installed);
    }

    // ==================== ADDITIONAL REGISTERED APP TESTS ====================

    #[test]
    fn test_registered_app_custom_widget_size() {
        let app = RegisteredApp {
            id: "test".to_string(),
            name: "Test".to_string(),
            icon: "📦".to_string(),
            icon_path: None,
            port: 3000,
            path: "/test".to_string(),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: "large".to_string(),
            requires_port: false,
        };

        let json = serde_json::to_string(&app).unwrap();
        let parsed: RegisteredApp = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.widget_size, "large");
    }

    #[test]
    fn test_unicode_in_app_names() {
        let app = RegisteredApp {
            id: "scribo".to_string(),
            name: "Scribo 語言學習".to_string(),
            icon: "✍️".to_string(),
            icon_path: None,
            port: 3001,
            path: "/path/to/app".to_string(),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: "medium".to_string(),
            requires_port: false,
        };

        let json = serde_json::to_string(&app).unwrap();
        let parsed: RegisteredApp = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.name, "Scribo 語言學習");
        assert_eq!(parsed.icon, "✍️");
    }

    #[test]
    fn test_port_range() {
        let app = RegisteredApp {
            id: "test".to_string(),
            name: "Test".to_string(),
            icon: "📦".to_string(),
            icon_path: None,
            port: 65535, // Max valid port
            path: "/test".to_string(),
            command: "pnpm".to_string(),
            args: vec!["dev".to_string()],
            widget_size: "medium".to_string(),
            requires_port: false,
        };

        let json = serde_json::to_string(&app).unwrap();
        let parsed: RegisteredApp = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.port, 65535);
    }

    #[test]
    fn test_widget_sizes() {
        let sizes = vec!["small", "medium", "large"];

        for size in sizes {
            let app = RegisteredApp {
                id: "test".to_string(),
                name: "Test".to_string(),
                icon: "📦".to_string(),
                icon_path: None,
                port: 3000,
                path: "/test".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: size.to_string(),
                requires_port: false,
            };

            let json = serde_json::to_string(&app).unwrap();
            let parsed: RegisteredApp = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed.widget_size, size);
        }
    }

    // ==================== MOLDABLE CONFIG TESTS ====================

    #[test]
    fn test_moldable_config_with_apps() {
        let config = MoldableConfig {
            workspace: Some("/Users/test/moldable".to_string()),
            apps: vec![RegisteredApp {
                id: "scribo".to_string(),
                name: "Scribo".to_string(),
                icon: "✍️".to_string(),
                icon_path: None,
                port: 3001,
                path: "/path/to/scribo".to_string(),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "medium".to_string(),
                requires_port: false,
            }],
            preferences: serde_json::Map::new(),
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: MoldableConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.apps.len(), 1);
        assert_eq!(parsed.apps[0].id, "scribo");
        assert_eq!(parsed.apps[0].port, 3001);
    }

    #[test]
    fn test_multiple_apps_registration() {
        let config = MoldableConfig {
            workspace: None,
            apps: vec![
                RegisteredApp {
                    id: "app1".to_string(),
                    name: "App 1".to_string(),
                    icon: "1️⃣".to_string(),
                    icon_path: None,
                    port: 3001,
                    path: "/app1".to_string(),
                    command: "pnpm".to_string(),
                    args: vec!["dev".to_string()],
                    widget_size: "small".to_string(),
                    requires_port: false,
                },
                RegisteredApp {
                    id: "app2".to_string(),
                    name: "App 2".to_string(),
                    icon: "2️⃣".to_string(),
                    icon_path: None,
                    port: 3002,
                    path: "/app2".to_string(),
                    command: "pnpm".to_string(),
                    args: vec!["dev".to_string()],
                    widget_size: "medium".to_string(),
                    requires_port: true,
                },
                RegisteredApp {
                    id: "app3".to_string(),
                    name: "App 3".to_string(),
                    icon: "3️⃣".to_string(),
                    icon_path: None,
                    port: 3003,
                    path: "/app3".to_string(),
                    command: "pnpm".to_string(),
                    args: vec!["dev".to_string()],
                    widget_size: "large".to_string(),
                    requires_port: false,
                },
            ],
            preferences: serde_json::Map::new(),
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: MoldableConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.apps.len(), 3);

        // Verify each app has unique port
        let ports: Vec<u16> = parsed.apps.iter().map(|a| a.port).collect();
        let unique_ports: std::collections::HashSet<u16> = ports.iter().cloned().collect();
        assert_eq!(ports.len(), unique_ports.len());
    }

    // ==================== WORKSPACE TESTS ====================

    #[test]
    fn test_workspace_color_formats() {
        let colors = vec!["#10b981", "#3b82f6", "#ef4444", "#000000", "#ffffff"];

        for color in colors {
            let workspace = Workspace {
                id: "test".to_string(),
                name: "Test".to_string(),
                color: color.to_string(),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            };

            let json = serde_json::to_string(&workspace).unwrap();
            let parsed: Workspace = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed.color, color);
        }
    }

    #[test]
    fn test_many_workspaces() {
        let workspaces: Vec<Workspace> = (0..50)
            .map(|i| Workspace {
                id: format!("workspace-{}", i),
                name: format!("Workspace {}", i),
                color: format!("#{:06x}", i * 10000),
                created_at: "2026-01-01T00:00:00Z".to_string(),
            })
            .collect();

        let config = WorkspacesConfig {
            active_workspace: "workspace-25".to_string(),
            workspaces,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: WorkspacesConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.workspaces.len(), 50);
        assert_eq!(parsed.active_workspace, "workspace-25");
    }

    // ==================== APP STATUS TESTS ====================

    #[test]
    fn test_app_status_stopped() {
        let status = AppStatus {
            running: false,
            pid: None,
            exit_code: Some(0),
            recent_output: vec![],
            actual_port: None,
        };

        let json = serde_json::to_string(&status).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["running"], false);
        assert!(parsed["pid"].is_null());
        assert_eq!(parsed["exit_code"], 0);
    }

    // ==================== APP INSTANCE TESTS ====================

    #[test]
    fn test_app_instance_minimal() {
        let json = r#"{"pid": 12345}"#;
        let instance: AppInstance = serde_json::from_str(json).unwrap();
        assert_eq!(instance.pid, 12345);
    }

    // ==================== APP ENV STATUS TESTS ====================

    #[test]
    fn test_app_env_status_serialization() {
        let status = AppEnvStatus {
            requirements: vec![EnvRequirement {
                key: "API_KEY".to_string(),
                name: "API Key".to_string(),
                description: Some("Your API key".to_string()),
                url: Some("https://example.com".to_string()),
                required: true,
            }],
            missing: vec!["API_KEY".to_string()],
            present: vec![],
        };

        let json = serde_json::to_string(&status).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert!(parsed["requirements"].is_array());
        assert_eq!(parsed["requirements"][0]["key"], "API_KEY");
        assert_eq!(parsed["missing"][0], "API_KEY");
    }

    // ==================== APP REGISTRY TESTS ====================

    #[test]
    fn test_app_registry_entry_minimal() {
        let json = r#"{
            "id": "minimal-app",
            "name": "Minimal App",
            "version": "0.0.1",
            "icon": "📦",
            "widgetSize": "medium",
            "path": "minimal-app",
            "commit": "abc123"
        }"#;

        let entry: AppRegistryEntry = serde_json::from_str(json).unwrap();

        assert_eq!(entry.id, "minimal-app");
        assert!(entry.description.is_none());
        assert!(entry.icon_url.is_none());
        assert!(entry.category.is_none());
        assert!(entry.tags.is_none());
        assert!(entry.required_env.is_none());
        assert!(entry.moldable_dependencies.is_none());
    }

    #[test]
    fn test_category_serialization() {
        let category = Category {
            id: "productivity".to_string(),
            name: "Productivity".to_string(),
            icon: "⚡".to_string(),
        };

        let json = serde_json::to_string(&category).unwrap();
        let parsed: Category = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, "productivity");
        assert_eq!(parsed.name, "Productivity");
        assert_eq!(parsed.icon, "⚡");
    }

    #[test]
    fn test_app_registry_full() {
        let registry = AppRegistry {
            schema: Some("https://moldable.sh/schemas/manifest.json".to_string()),
            version: "1".to_string(),
            generated_at: Some("2026-01-14T10:00:00Z".to_string()),
            registry: "moldable-ai/apps".to_string(),
            apps: vec![
                AppRegistryEntry {
                    id: "app1".to_string(),
                    name: "App 1".to_string(),
                    version: "1.0.0".to_string(),
                    description: Some("First app".to_string()),
                    icon: "1️⃣".to_string(),
                    icon_url: None,
                    widget_size: "small".to_string(),
                    category: Some("productivity".to_string()),
                    tags: None,
                    path: "app1".to_string(),
                    required_env: None,
                    moldable_dependencies: None,
                    commit: "commit1".to_string(),
                },
            ],
            categories: Some(vec![
                Category {
                    id: "productivity".to_string(),
                    name: "Productivity".to_string(),
                    icon: "⚡".to_string(),
                },
            ]),
        };

        let json = serde_json::to_string(&registry).unwrap();
        let parsed: AppRegistry = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.version, "1");
        assert_eq!(parsed.registry, "moldable-ai/apps");
        assert_eq!(parsed.apps.len(), 1);
        assert_eq!(parsed.categories.unwrap().len(), 1);
    }

    #[test]
    fn test_app_registry_camel_case() {
        let registry = AppRegistry {
            schema: Some("https://moldable.sh/schemas/manifest.json".to_string()),
            version: "1".to_string(),
            generated_at: Some("2026-01-14T10:00:00Z".to_string()),
            registry: "moldable-ai/apps".to_string(),
            apps: vec![],
            categories: None,
        };

        let json = serde_json::to_string(&registry).unwrap();

        assert!(json.contains("\"$schema\""));
        assert!(json.contains("generatedAt"));
        assert!(!json.contains("generated_at"));
    }

    #[test]
    fn test_app_registry_with_moldable_dependencies() {
        let mut deps = std::collections::HashMap::new();
        deps.insert("@moldable-ai/ui".to_string(), "^0.1.0".to_string());
        deps.insert("@moldable-ai/storage".to_string(), "^0.1.0".to_string());

        let entry = AppRegistryEntry {
            id: "test".to_string(),
            name: "Test".to_string(),
            version: "1.0.0".to_string(),
            description: None,
            icon: "📦".to_string(),
            icon_url: None,
            widget_size: "medium".to_string(),
            category: None,
            tags: None,
            path: "test".to_string(),
            required_env: None,
            moldable_dependencies: Some(deps),
            commit: "abc123".to_string(),
        };

        let json = serde_json::to_string(&entry).unwrap();
        let parsed: AppRegistryEntry = serde_json::from_str(&json).unwrap();

        let parsed_deps = parsed.moldable_dependencies.unwrap();
        assert_eq!(parsed_deps.get("@moldable-ai/ui"), Some(&"^0.1.0".to_string()));
    }

    // ==================== ERROR HANDLING TESTS ====================

    #[test]
    fn test_invalid_json_parsing() {
        let invalid_json = "{ invalid json }";
        let result: Result<MoldableConfig, _> = serde_json::from_str(invalid_json);
        assert!(result.is_err());
    }

    #[test]
    fn test_missing_required_fields() {
        let json = r#"{"id": "test"}"#;
        let result: Result<RegisteredApp, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_wrong_type_fields() {
        let json = r#"{
            "id": "test",
            "name": "Test",
            "icon": "📦",
            "port": "not a number",
            "path": "/test",
            "command": "pnpm",
            "args": ["dev"]
        }"#;
        let result: Result<RegisteredApp, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_malformed_workspaces_config() {
        let json = r#"{"activeWorkspace": 123, "workspaces": "not an array"}"#;
        let result: Result<WorkspacesConfig, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_workspaces_array() {
        let json = r#"{"activeWorkspace": "personal", "workspaces": []}"#;
        let result: Result<WorkspacesConfig, _> = serde_json::from_str(json);
        assert!(result.is_ok());
        let config = result.unwrap();
        assert!(config.workspaces.is_empty());
    }

    // ==================== MANY ITEMS STRESS TESTS ====================

    #[test]
    fn test_many_apps() {
        let apps: Vec<RegisteredApp> = (0..100)
            .map(|i| RegisteredApp {
                id: format!("app-{}", i),
                name: format!("App {}", i),
                icon: "📦".to_string(),
                icon_path: None,
                port: 3000 + i,
                path: format!("/path/to/app-{}", i),
                command: "pnpm".to_string(),
                args: vec!["dev".to_string()],
                widget_size: "medium".to_string(),
                requires_port: false,
            })
            .collect();

        let config = MoldableConfig {
            workspace: None,
            apps,
            preferences: serde_json::Map::new(),
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: MoldableConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.apps.len(), 100);
    }
}
