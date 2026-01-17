//! Environment variable management for Moldable
//!
//! Handles:
//! - Parsing .env files
//! - Writing env vars
//! - Merging shared + workspace env vars
//! - API key detection and storage

use crate::paths::{get_env_file_path, get_shared_env_file_path};
use crate::types::{AppEnvStatus, MoldableManifest};
use std::collections::HashMap;
use std::io::Write;
use std::path::Path;

// ============================================================================
// ENV FILE PARSING
// ============================================================================

/// Parse a .env file into a HashMap
pub fn parse_env_file(path: &Path) -> HashMap<String, String> {
    let mut env = HashMap::new();

    if let Ok(content) = std::fs::read_to_string(path) {
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some(eq_idx) = trimmed.find('=') {
                let key = trimmed[..eq_idx].trim().to_string();
                let value = trimmed[eq_idx + 1..].trim().to_string();
                if !value.is_empty() {
                    env.insert(key, value);
                }
            }
        }
    }

    env
}

/// Get merged env vars (shared + workspace-specific overrides)
pub fn get_merged_env_vars() -> HashMap<String, String> {
    let mut env = HashMap::new();

    // Load shared env first
    if let Ok(shared_path) = get_shared_env_file_path() {
        let shared_env = parse_env_file(&shared_path);
        env.extend(shared_env);
    }

    // Load workspace-specific env (overrides shared)
    if let Ok(workspace_path) = get_env_file_path() {
        let workspace_env = parse_env_file(&workspace_path);
        env.extend(workspace_env);
    }

    env
}

// ============================================================================
// ENV FILE WRITING
// ============================================================================

/// Write an env var to the workspace .env file, preserving comments and structure
pub fn write_env_var(key: &str, value: &str) -> Result<(), String> {
    let env_path = get_env_file_path()?;

    // Ensure directory exists
    if let Some(parent) = env_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    // Read existing content
    let content = std::fs::read_to_string(&env_path).unwrap_or_default();
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    // Find and replace existing key, or add new one
    let key_prefix = format!("{}=", key);
    let mut found = false;

    for line in &mut lines {
        if line.starts_with(&key_prefix) || line.starts_with(&format!("# {}=", key)) {
            *line = format!("{}={}", key, value);
            found = true;
            break;
        }
    }

    if !found {
        // Add to end
        if !lines.is_empty() && !lines.last().map(|l| l.is_empty()).unwrap_or(true) {
            lines.push(String::new());
        }
        lines.push(format!("{}={}", key, value));
    }

    std::fs::write(&env_path, lines.join("\n"))
        .map_err(|e| format!("Failed to write .env: {}", e))?;

    Ok(())
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

/// Get all env vars from the workspace .env file
#[tauri::command]
pub fn get_all_env_vars() -> Result<HashMap<String, String>, String> {
    let env_path = get_env_file_path()?;
    Ok(parse_env_file(&env_path))
}

/// Set an env var in the workspace .env file
#[tauri::command]
pub fn set_app_env_var(key: String, value: String) -> Result<(), String> {
    write_env_var(&key, &value)
}

/// Get env requirements and status for an app
#[tauri::command]
pub fn get_app_env_requirements(app_path: String) -> Result<AppEnvStatus, String> {
    let manifest_path = Path::new(&app_path).join("moldable.json");

    let manifest: MoldableManifest = if manifest_path.exists() {
        let content = std::fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Failed to read moldable.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse moldable.json: {}", e))?
    } else {
        return Ok(AppEnvStatus {
            requirements: Vec::new(),
            missing: Vec::new(),
            present: Vec::new(),
        });
    };

    // Use merged env vars (shared + workspace-specific) to check requirements
    let current_env = get_merged_env_vars();

    let mut missing = Vec::new();
    let mut present = Vec::new();

    for req in &manifest.env {
        if current_env.contains_key(&req.key) {
            present.push(req.key.clone());
        } else if req.required {
            missing.push(req.key.clone());
        }
    }

    Ok(AppEnvStatus {
        requirements: manifest.env,
        missing,
        present,
    })
}

/// Save an API key to the shared .env file (for onboarding)
/// Auto-detects the key type based on prefix and saves with the appropriate env var name
#[tauri::command]
pub fn save_api_key(api_key: String) -> Result<String, String> {
    let api_key = api_key.trim();

    if api_key.is_empty() {
        return Err("API key cannot be empty".to_string());
    }

    // Auto-detect key type based on prefix
    let (env_var_name, provider_name) = if api_key.starts_with("sk-or-") {
        ("OPENROUTER_API_KEY", "OpenRouter")
    } else if api_key.starts_with("sk-ant-") {
        ("ANTHROPIC_API_KEY", "Anthropic")
    } else if api_key.starts_with("sk-proj-") || api_key.starts_with("sk-") {
        ("OPENAI_API_KEY", "OpenAI")
    } else {
        // Default to OpenRouter for unrecognized keys (most flexible)
        ("OPENROUTER_API_KEY", "OpenRouter")
    };

    // Write to shared .env file
    let env_path = get_shared_env_file_path()?;

    // Ensure directory exists
    if let Some(parent) = env_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    // Read existing content
    let content = std::fs::read_to_string(&env_path).unwrap_or_default();
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    // Find and replace existing key, or add new one
    let key_prefix = format!("{}=", env_var_name);
    let mut found = false;

    for line in &mut lines {
        if line.starts_with(&key_prefix) || line.starts_with(&format!("# {}=", env_var_name)) {
            *line = format!("{}={}", env_var_name, api_key);
            found = true;
            break;
        }
    }

    if !found {
        // Add header comment if file is empty
        if lines.is_empty() || (lines.len() == 1 && lines[0].is_empty()) {
            lines = vec![
                "# Moldable Configuration".to_string(),
                "# API keys for LLM providers".to_string(),
                String::new(),
            ];
        } else if !lines.last().map(|l| l.is_empty()).unwrap_or(true) {
            lines.push(String::new());
        }
        lines.push(format!("{}={}", env_var_name, api_key));
    }

    // Write and sync to ensure data is flushed to disk before returning
    // This prevents race conditions where the AI server reads stale data
    let file = std::fs::File::create(&env_path)
        .map_err(|e| format!("Failed to create .env: {}", e))?;
    let mut writer = std::io::BufWriter::new(file);
    writer
        .write_all(lines.join("\n").as_bytes())
        .map_err(|e| format!("Failed to write .env: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("Failed to flush .env: {}", e))?;
    writer
        .get_ref()
        .sync_all()
        .map_err(|e| format!("Failed to sync .env: {}", e))?;

    Ok(provider_name.to_string())
}

/// API key provider info (for settings UI)
#[derive(serde::Serialize)]
pub struct ApiKeyInfo {
    pub provider: String,
    pub env_var: String,
    pub is_configured: bool,
    /// Masked key value like "sk-or-...abc123"
    pub masked_value: Option<String>,
}

/// Get status of all API keys from the shared .env file
#[tauri::command]
pub fn get_api_key_status() -> Result<Vec<ApiKeyInfo>, String> {
    let env_path = get_shared_env_file_path()?;
    let env = parse_env_file(&env_path);

    let providers = vec![
        ("OpenRouter", "OPENROUTER_API_KEY"),
        ("Anthropic", "ANTHROPIC_API_KEY"),
        ("OpenAI", "OPENAI_API_KEY"),
    ];

    let result = providers
        .into_iter()
        .map(|(provider, env_var)| {
            let value = env.get(env_var);
            let is_configured = value.is_some();
            let masked_value = value.map(|v| mask_api_key(v));

            ApiKeyInfo {
                provider: provider.to_string(),
                env_var: env_var.to_string(),
                is_configured,
                masked_value,
            }
        })
        .collect();

    Ok(result)
}

/// Mask an API key for display (show prefix and last 6 chars)
fn mask_api_key(key: &str) -> String {
    if key.len() <= 12 {
        return "••••••••".to_string();
    }

    // Find a good prefix to show (e.g., "sk-or-", "sk-ant-", "sk-")
    let prefix_len = if key.starts_with("sk-or-") {
        6
    } else if key.starts_with("sk-ant-") {
        7
    } else if key.starts_with("sk-proj-") {
        8
    } else if key.starts_with("sk-") {
        3
    } else {
        0
    };

    let suffix_len = 6;
    let prefix = &key[..prefix_len];
    let suffix = &key[key.len() - suffix_len..];

    format!("{}•••{}", prefix, suffix)
}

/// Remove an API key from the shared .env file
#[tauri::command]
pub fn remove_api_key(env_var: String) -> Result<(), String> {
    let valid_vars = vec![
        "OPENROUTER_API_KEY",
        "ANTHROPIC_API_KEY",
        "OPENAI_API_KEY",
    ];

    if !valid_vars.contains(&env_var.as_str()) {
        return Err(format!("Invalid env var: {}", env_var));
    }

    let env_path = get_shared_env_file_path()?;

    // Read existing content
    let content = std::fs::read_to_string(&env_path).unwrap_or_default();
    let lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    // Filter out the line with the key
    let key_prefix = format!("{}=", env_var);
    let new_lines: Vec<String> = lines
        .into_iter()
        .filter(|line| !line.starts_with(&key_prefix))
        .collect();

    // Write back
    let file = std::fs::File::create(&env_path)
        .map_err(|e| format!("Failed to create .env: {}", e))?;
    let mut writer = std::io::BufWriter::new(file);
    writer
        .write_all(new_lines.join("\n").as_bytes())
        .map_err(|e| format!("Failed to write .env: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("Failed to flush .env: {}", e))?;
    writer
        .get_ref()
        .sync_all()
        .map_err(|e| format!("Failed to sync .env: {}", e))?;

    Ok(())
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn create_temp_env_file(dir: &TempDir, filename: &str, content: &str) -> PathBuf {
        let path = dir.path().join(filename);
        fs::write(&path, content).unwrap();
        path
    }

    #[test]
    fn test_parse_env_file_basic() {
        let dir = TempDir::new().unwrap();
        let path = create_temp_env_file(&dir, ".env", "KEY1=value1\nKEY2=value2");

        let env = parse_env_file(&path);

        assert_eq!(env.get("KEY1"), Some(&"value1".to_string()));
        assert_eq!(env.get("KEY2"), Some(&"value2".to_string()));
    }

    #[test]
    fn test_parse_env_file_with_comments() {
        let dir = TempDir::new().unwrap();
        let content = "# This is a comment\nKEY1=value1\n# Another comment\nKEY2=value2";
        let path = create_temp_env_file(&dir, ".env", content);

        let env = parse_env_file(&path);

        assert_eq!(env.len(), 2);
        assert_eq!(env.get("KEY1"), Some(&"value1".to_string()));
        assert_eq!(env.get("KEY2"), Some(&"value2".to_string()));
    }

    #[test]
    fn test_parse_env_file_with_empty_lines() {
        let dir = TempDir::new().unwrap();
        let content = "KEY1=value1\n\n\nKEY2=value2\n";
        let path = create_temp_env_file(&dir, ".env", content);

        let env = parse_env_file(&path);

        assert_eq!(env.len(), 2);
    }

    #[test]
    fn test_parse_env_file_with_whitespace() {
        let dir = TempDir::new().unwrap();
        let content = "  KEY1 = value1  \n  KEY2=value2";
        let path = create_temp_env_file(&dir, ".env", content);

        let env = parse_env_file(&path);

        assert_eq!(env.get("KEY1"), Some(&"value1".to_string()));
        assert_eq!(env.get("KEY2"), Some(&"value2".to_string()));
    }

    #[test]
    fn test_parse_env_file_ignores_empty_values() {
        let dir = TempDir::new().unwrap();
        let content = "KEY1=\nKEY2=value2";
        let path = create_temp_env_file(&dir, ".env", content);

        let env = parse_env_file(&path);

        assert_eq!(env.len(), 1);
        assert_eq!(env.get("KEY2"), Some(&"value2".to_string()));
    }

    #[test]
    fn test_parse_env_file_nonexistent() {
        let path = PathBuf::from("/nonexistent/.env");
        let env = parse_env_file(&path);
        assert!(env.is_empty());
    }

    #[test]
    fn test_parse_env_file_with_equals_in_value() {
        let dir = TempDir::new().unwrap();
        let content = "DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require";
        let path = create_temp_env_file(&dir, ".env", content);

        let env = parse_env_file(&path);

        assert_eq!(
            env.get("DATABASE_URL"),
            Some(&"postgres://user:pass@host:5432/db?sslmode=require".to_string())
        );
    }

    #[test]
    fn test_env_file_special_characters() {
        let dir = TempDir::new().unwrap();
        let content = r#"API_KEY=sk-ant-api03-abc123XYZ_-
DATABASE_URL=postgres://user:p@ss!word@localhost:5432/db
JSON_CONFIG={"key": "value", "nested": {"a": 1}}"#;
        let path = create_temp_env_file(&dir, ".env", content);

        let env = parse_env_file(&path);

        assert_eq!(
            env.get("API_KEY"),
            Some(&"sk-ant-api03-abc123XYZ_-".to_string())
        );
        assert!(env.get("DATABASE_URL").is_some());
        assert!(env.get("JSON_CONFIG").is_some());
    }

    #[test]
    fn test_env_file_layering() {
        let dir = TempDir::new().unwrap();

        let shared_path = dir.path().join("shared.env");
        fs::write(&shared_path, "KEY1=shared1\nKEY2=shared2").unwrap();

        let workspace_path = dir.path().join("workspace.env");
        fs::write(&workspace_path, "KEY2=workspace2\nKEY3=workspace3").unwrap();

        let shared_env = parse_env_file(&shared_path);
        let mut merged = shared_env;

        let workspace_env = parse_env_file(&workspace_path);
        merged.extend(workspace_env);

        // KEY1 should be from shared
        assert_eq!(merged.get("KEY1"), Some(&"shared1".to_string()));
        // KEY2 should be overridden by workspace
        assert_eq!(merged.get("KEY2"), Some(&"workspace2".to_string()));
        // KEY3 should be from workspace only
        assert_eq!(merged.get("KEY3"), Some(&"workspace3".to_string()));
    }

    #[test]
    fn test_many_env_vars() {
        let dir = TempDir::new().unwrap();

        let mut content = String::new();
        for i in 0..100 {
            content.push_str(&format!("KEY_{}=value_{}\n", i, i));
        }
        let path = create_temp_env_file(&dir, ".env", &content);

        let env = parse_env_file(&path);

        assert_eq!(env.len(), 100);
        assert_eq!(env.get("KEY_0"), Some(&"value_0".to_string()));
        assert_eq!(env.get("KEY_99"), Some(&"value_99".to_string()));
    }

    // ========================================================================
    // mask_api_key tests
    // ========================================================================

    #[test]
    fn test_mask_api_key_openrouter() {
        let key = "sk-or-v1-abc123def456ghi789jkl012mno345pqr678stu901vwx234";
        let masked = mask_api_key(key);
        // Should show "sk-or-" prefix and last 6 chars
        assert!(masked.starts_with("sk-or-"));
        assert!(masked.ends_with("vwx234"));
        assert!(masked.contains("•••"));
    }

    #[test]
    fn test_mask_api_key_anthropic() {
        let key = "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901";
        let masked = mask_api_key(key);
        // Should show "sk-ant-" prefix and last 6 chars
        assert!(masked.starts_with("sk-ant-"));
        assert!(masked.ends_with("stu901"));
        assert!(masked.contains("•••"));
    }

    #[test]
    fn test_mask_api_key_openai() {
        let key = "sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwxyz";
        let masked = mask_api_key(key);
        // Should show "sk-proj-" prefix and last 6 chars
        assert!(masked.starts_with("sk-proj-"));
        assert!(masked.ends_with("wxyz"));
        assert!(masked.contains("•••"));
    }

    #[test]
    fn test_mask_api_key_openai_legacy() {
        let key = "sk-abc123def456ghi789jkl012mno345pqr678stu901vwxyz123";
        let masked = mask_api_key(key);
        // Should show "sk-" prefix and last 6 chars
        assert!(masked.starts_with("sk-"));
        assert!(masked.ends_with("z123"));
        assert!(masked.contains("•••"));
    }

    #[test]
    fn test_mask_api_key_short_key() {
        let key = "short";
        let masked = mask_api_key(key);
        // Short keys should be fully masked
        assert_eq!(masked, "••••••••");
    }

    #[test]
    fn test_mask_api_key_exactly_12_chars() {
        let key = "123456789012";
        let masked = mask_api_key(key);
        // Keys <= 12 chars should be fully masked
        assert_eq!(masked, "••••••••");
    }

    #[test]
    fn test_mask_api_key_unknown_prefix() {
        let key = "unknown-prefix-abc123def456ghi789jkl012mno345";
        let masked = mask_api_key(key);
        // Unknown prefix should show no prefix, just masked with last 6 chars
        assert!(masked.starts_with("•••"));
        assert!(masked.ends_with("no345"));
    }

    #[test]
    fn test_mask_api_key_preserves_structure() {
        // Verify the masked output has expected structure
        let key = "sk-or-v1-abcdefghijklmnopqrstuvwxyz123456";
        let masked = mask_api_key(key);

        // Should be: prefix + "•••" + suffix (last 6 chars)
        let parts: Vec<&str> = masked.split("•••").collect();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], "sk-or-");
        assert_eq!(parts[1], "123456");
    }
}
