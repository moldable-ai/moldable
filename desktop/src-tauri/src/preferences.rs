//! User preferences management for Moldable
//!
//! Handles workspace-specific preferences and shared config.

use crate::paths::{get_config_file_path, get_shared_config_path};
use crate::types::{MoldableConfig, SharedConfig};

// ============================================================================
// SHARED CONFIG
// ============================================================================

/// Load shared config from ~/.moldable/shared/config.json
pub fn load_shared_config() -> SharedConfig {
    let config_path = match get_shared_config_path() {
        Ok(p) => p,
        Err(_) => return SharedConfig::default(),
    };

    if !config_path.exists() {
        return SharedConfig::default();
    }

    match std::fs::read_to_string(&config_path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => SharedConfig::default(),
    }
}

/// Save shared config to ~/.moldable/shared/config.json
pub fn save_shared_config(config: &SharedConfig) -> Result<(), String> {
    let config_path = get_shared_config_path()?;

    // Ensure directory exists
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create shared config directory: {}", e))?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize shared config: {}", e))?;
    std::fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write shared config: {}", e))?;

    Ok(())
}

// ============================================================================
// WORKSPACE PREFERENCES
// ============================================================================

/// Get a preference value from workspace config
#[tauri::command]
pub fn get_preference(key: String) -> Result<Option<serde_json::Value>, String> {
    let config_path = get_config_file_path()?;

    if !config_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let config: MoldableConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    Ok(config.preferences.get(&key).cloned())
}

/// Set a preference value in workspace config
#[tauri::command]
pub fn set_preference(key: String, value: serde_json::Value) -> Result<(), String> {
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

    // Update preference
    config.preferences.insert(key, value);

    // Save config
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(&config_path, content)
        .map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(())
}

/// Get all preferences from workspace config
#[tauri::command]
pub fn get_all_preferences() -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let config_path = get_config_file_path()?;

    if !config_path.exists() {
        return Ok(serde_json::Map::new());
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let config: MoldableConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    Ok(config.preferences)
}

// ============================================================================
// SHARED PREFERENCES (Global settings like security)
// ============================================================================

/// Get a shared preference value (from ~/.moldable/shared/config.json)
#[tauri::command]
pub fn get_shared_preference(key: String) -> Result<Option<serde_json::Value>, String> {
    let config = load_shared_config();
    Ok(config.preferences.get(&key).cloned())
}

/// Set a shared preference value (in ~/.moldable/shared/config.json)
#[tauri::command]
pub fn set_shared_preference(key: String, value: serde_json::Value) -> Result<(), String> {
    let mut config = load_shared_config();
    config.preferences.insert(key, value);
    save_shared_config(&config)
}

/// Get all shared preferences
#[tauri::command]
pub fn get_all_shared_preferences() -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let config = load_shared_config();
    Ok(config.preferences)
}

// ============================================================================
// MIGRATIONS
// ============================================================================

/// Preference keys that should default to true for security (stored in shared config)
const SECURITY_PREFERENCES_DEFAULT_TRUE: &[&str] = &[
    "requireUnsandboxedApproval",
    "requireDangerousCommandApproval",
];

/// Migrate shared config to ensure security preferences default to true.
/// This runs on app start to handle existing configs that don't have these keys.
pub fn migrate_security_preferences() {
    use log::info;

    let mut config = load_shared_config();
    let mut needs_save = false;

    for key in SECURITY_PREFERENCES_DEFAULT_TRUE {
        if !config.preferences.contains_key(*key) {
            info!(
                "Migrating shared config: setting {} = true",
                key
            );
            config
                .preferences
                .insert(key.to_string(), serde_json::json!(true));
            needs_save = true;
        }
    }

    if needs_save {
        if let Err(e) = save_shared_config(&config) {
            log::warn!("Failed to save migrated shared config: {}", e);
        }
    }
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== SHARED CONFIG TESTS ====================

    #[test]
    fn test_shared_config_default() {
        let config = SharedConfig::default();
        assert!(!config.hello_moldables_installed);
        assert!(config.preferences.is_empty());
    }

    #[test]
    fn test_shared_config_with_preferences() {
        let mut preferences = serde_json::Map::new();
        preferences.insert(
            "requireUnsandboxedApproval".to_string(),
            serde_json::json!(true),
        );
        preferences.insert(
            "requireDangerousCommandApproval".to_string(),
            serde_json::json!(false),
        );

        let config = SharedConfig {
            hello_moldables_installed: true,
            preferences,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: SharedConfig = serde_json::from_str(&json).unwrap();

        assert!(parsed.hello_moldables_installed);
        assert_eq!(
            parsed.preferences.get("requireUnsandboxedApproval").unwrap(),
            &serde_json::json!(true)
        );
        assert_eq!(
            parsed
                .preferences
                .get("requireDangerousCommandApproval")
                .unwrap(),
            &serde_json::json!(false)
        );
    }

    #[test]
    fn test_shared_config_camel_case_serialization() {
        let mut preferences = serde_json::Map::new();
        preferences.insert("testKey".to_string(), serde_json::json!("value"));

        let config = SharedConfig {
            hello_moldables_installed: true,
            preferences,
        };

        let json = serde_json::to_string(&config).unwrap();

        // Should use camelCase
        assert!(json.contains("helloMoldablesInstalled"));
        assert!(!json.contains("hello_moldables_installed"));
    }

    #[test]
    fn test_shared_config_deserialize_from_camel_case() {
        let json = r#"{
            "helloMoldablesInstalled": true,
            "preferences": {
                "requireUnsandboxedApproval": true,
                "customDangerousPatterns": []
            }
        }"#;

        let config: SharedConfig = serde_json::from_str(json).unwrap();

        assert!(config.hello_moldables_installed);
        assert_eq!(
            config.preferences.get("requireUnsandboxedApproval").unwrap(),
            &serde_json::json!(true)
        );
    }

    #[test]
    fn test_shared_config_custom_dangerous_patterns() {
        let mut preferences = serde_json::Map::new();
        preferences.insert(
            "customDangerousPatterns".to_string(),
            serde_json::json!([
                {"pattern": "\\bmy-dangerous-cmd\\b", "description": "Custom dangerous command"},
                {"pattern": "\\brm\\s+-rf\\s+/", "description": "Root deletion"}
            ]),
        );

        let config = SharedConfig {
            hello_moldables_installed: false,
            preferences,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: SharedConfig = serde_json::from_str(&json).unwrap();

        let patterns = parsed.preferences.get("customDangerousPatterns").unwrap();
        assert!(patterns.is_array());
        assert_eq!(patterns.as_array().unwrap().len(), 2);
    }

    // ==================== WORKSPACE PREFERENCES TESTS ====================

    #[test]
    fn test_preferences_in_config() {
        let mut preferences = serde_json::Map::new();
        preferences.insert("theme".to_string(), serde_json::json!("dark"));
        preferences.insert("model".to_string(), serde_json::json!("claude-3-opus"));
        preferences.insert("reasoning_effort".to_string(), serde_json::json!(0.8));

        let config = MoldableConfig {
            workspace: None,
            apps: vec![],
            preferences,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: MoldableConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.preferences.get("theme").unwrap(), "dark");
        assert_eq!(parsed.preferences.get("model").unwrap(), "claude-3-opus");
        assert_eq!(parsed.preferences.get("reasoning_effort").unwrap(), 0.8);
    }

    #[test]
    fn test_workspace_config_empty_preferences() {
        let config = MoldableConfig::default();
        assert!(config.preferences.is_empty());

        let json = serde_json::to_string(&config).unwrap();
        let parsed: MoldableConfig = serde_json::from_str(&json).unwrap();
        assert!(parsed.preferences.is_empty());
    }

    // ==================== SECURITY MIGRATION TESTS ====================

    #[test]
    fn test_security_preferences_constant() {
        // Ensure the constant contains expected keys
        assert!(SECURITY_PREFERENCES_DEFAULT_TRUE.contains(&"requireUnsandboxedApproval"));
        assert!(SECURITY_PREFERENCES_DEFAULT_TRUE.contains(&"requireDangerousCommandApproval"));
        assert_eq!(SECURITY_PREFERENCES_DEFAULT_TRUE.len(), 2);
    }

    #[test]
    fn test_migration_adds_missing_security_prefs() {
        // Simulate migration logic without file I/O
        let mut config = SharedConfig::default();

        // Before migration: no security preferences
        assert!(!config.preferences.contains_key("requireUnsandboxedApproval"));
        assert!(!config
            .preferences
            .contains_key("requireDangerousCommandApproval"));

        // Simulate migration
        for key in SECURITY_PREFERENCES_DEFAULT_TRUE {
            if !config.preferences.contains_key(*key) {
                config
                    .preferences
                    .insert(key.to_string(), serde_json::json!(true));
            }
        }

        // After migration: security preferences should be true
        assert_eq!(
            config.preferences.get("requireUnsandboxedApproval").unwrap(),
            &serde_json::json!(true)
        );
        assert_eq!(
            config
                .preferences
                .get("requireDangerousCommandApproval")
                .unwrap(),
            &serde_json::json!(true)
        );
    }

    #[test]
    fn test_migration_preserves_existing_values() {
        // Simulate migration with pre-existing values
        let mut config = SharedConfig::default();

        // User has explicitly set requireUnsandboxedApproval to false
        config.preferences.insert(
            "requireUnsandboxedApproval".to_string(),
            serde_json::json!(false),
        );

        // Simulate migration
        for key in SECURITY_PREFERENCES_DEFAULT_TRUE {
            if !config.preferences.contains_key(*key) {
                config
                    .preferences
                    .insert(key.to_string(), serde_json::json!(true));
            }
        }

        // User's explicit false should be preserved
        assert_eq!(
            config.preferences.get("requireUnsandboxedApproval").unwrap(),
            &serde_json::json!(false)
        );
        // Missing key should be added as true
        assert_eq!(
            config
                .preferences
                .get("requireDangerousCommandApproval")
                .unwrap(),
            &serde_json::json!(true)
        );
    }

    #[test]
    fn test_migration_idempotent() {
        // Running migration twice should not change values
        let mut config = SharedConfig::default();

        // First migration
        for key in SECURITY_PREFERENCES_DEFAULT_TRUE {
            if !config.preferences.contains_key(*key) {
                config
                    .preferences
                    .insert(key.to_string(), serde_json::json!(true));
            }
        }

        let after_first = config.preferences.clone();

        // Second migration
        for key in SECURITY_PREFERENCES_DEFAULT_TRUE {
            if !config.preferences.contains_key(*key) {
                config
                    .preferences
                    .insert(key.to_string(), serde_json::json!(true));
            }
        }

        // Values should be identical
        assert_eq!(config.preferences, after_first);
    }

    // ==================== PREFERENCE VALUE TYPES TESTS ====================

    #[test]
    fn test_preference_boolean_values() {
        let mut preferences = serde_json::Map::new();
        preferences.insert("boolTrue".to_string(), serde_json::json!(true));
        preferences.insert("boolFalse".to_string(), serde_json::json!(false));

        let config = SharedConfig {
            hello_moldables_installed: false,
            preferences,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: SharedConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(
            parsed.preferences.get("boolTrue").unwrap().as_bool(),
            Some(true)
        );
        assert_eq!(
            parsed.preferences.get("boolFalse").unwrap().as_bool(),
            Some(false)
        );
    }

    #[test]
    fn test_preference_string_values() {
        let mut preferences = serde_json::Map::new();
        preferences.insert("model".to_string(), serde_json::json!("claude-opus-4"));
        preferences.insert("theme".to_string(), serde_json::json!("dark"));

        let config = SharedConfig {
            hello_moldables_installed: false,
            preferences,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: SharedConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(
            parsed.preferences.get("model").unwrap().as_str(),
            Some("claude-opus-4")
        );
        assert_eq!(
            parsed.preferences.get("theme").unwrap().as_str(),
            Some("dark")
        );
    }

    #[test]
    fn test_preference_array_values() {
        let mut preferences = serde_json::Map::new();
        preferences.insert(
            "patterns".to_string(),
            serde_json::json!(["pattern1", "pattern2", "pattern3"]),
        );

        let config = SharedConfig {
            hello_moldables_installed: false,
            preferences,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: SharedConfig = serde_json::from_str(&json).unwrap();

        let patterns = parsed.preferences.get("patterns").unwrap();
        assert!(patterns.is_array());
        assert_eq!(patterns.as_array().unwrap().len(), 3);
    }

    #[test]
    fn test_preference_object_values() {
        let mut preferences = serde_json::Map::new();
        preferences.insert(
            "reasoningEffort".to_string(),
            serde_json::json!({
                "anthropic": "high",
                "openai": "medium"
            }),
        );

        let config = SharedConfig {
            hello_moldables_installed: false,
            preferences,
        };

        let json = serde_json::to_string(&config).unwrap();
        let parsed: SharedConfig = serde_json::from_str(&json).unwrap();

        let effort = parsed.preferences.get("reasoningEffort").unwrap();
        assert!(effort.is_object());
        assert_eq!(effort.get("anthropic").unwrap().as_str(), Some("high"));
        assert_eq!(effort.get("openai").unwrap().as_str(), Some("medium"));
    }
}
