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
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shared_config_default() {
        let config = SharedConfig::default();
        assert!(!config.hello_moldables_installed);
    }

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
}
