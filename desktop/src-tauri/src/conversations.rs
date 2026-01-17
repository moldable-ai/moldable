//! Conversation persistence for Moldable
//!
//! Handles saving and loading chat conversations to the workspace's
//! conversations directory.

use crate::paths::get_conversations_dir;
use crate::types::ConversationMeta;

// ============================================================================
// TAURI COMMANDS
// ============================================================================

/// List all conversations (metadata only)
#[tauri::command]
pub fn list_conversations() -> Result<Vec<ConversationMeta>, String> {
    let dir = get_conversations_dir()?;

    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut conversations: Vec<ConversationMeta> = vec![];

    let entries = std::fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read conversations dir: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|e| e == "json") {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(meta) = serde_json::from_str::<ConversationMeta>(&content) {
                    conversations.push(meta);
                }
            }
        }
    }

    // Sort by updated_at descending (newest first)
    conversations.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    Ok(conversations)
}

/// Load a specific conversation by ID
#[tauri::command]
pub fn load_conversation(id: String) -> Result<Option<serde_json::Value>, String> {
    let dir = get_conversations_dir()?;
    let file_path = dir.join(format!("{}.json", id));

    if !file_path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read conversation: {}", e))?;

    let conversation: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse conversation: {}", e))?;

    Ok(Some(conversation))
}

/// Save a conversation
#[tauri::command]
pub fn save_conversation(conversation: serde_json::Value) -> Result<(), String> {
    let dir = get_conversations_dir()?;

    // Ensure directory exists
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create conversations dir: {}", e))?;

    let id = conversation
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Conversation must have an id")?;

    let file_path = dir.join(format!("{}.json", id));

    let content = serde_json::to_string_pretty(&conversation)
        .map_err(|e| format!("Failed to serialize conversation: {}", e))?;

    std::fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write conversation: {}", e))?;

    Ok(())
}

/// Delete a conversation
#[tauri::command]
pub fn delete_conversation(id: String) -> Result<(), String> {
    let dir = get_conversations_dir()?;
    let file_path = dir.join(format!("{}.json", id));

    if file_path.exists() {
        std::fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete conversation: {}", e))?;
    }

    Ok(())
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    #[test]
    fn test_conversation_file_format() {
        let conversation = serde_json::json!({
            "id": "conv-abc123",
            "title": "Building a Todo App",
            "createdAt": "2026-01-14T10:00:00Z",
            "updatedAt": "2026-01-14T12:00:00Z",
            "messageCount": 10,
            "messages": [
                {
                    "role": "user",
                    "content": "Create a todo app"
                },
                {
                    "role": "assistant",
                    "content": "I'll create a todo app for you..."
                }
            ]
        });

        // Verify it can be serialized and parsed
        let json = serde_json::to_string_pretty(&conversation).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed["id"], "conv-abc123");
        assert_eq!(parsed["messageCount"], 10);
    }
}
