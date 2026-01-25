//! Checkpoint system for Moldable apps
//!
//! Provides content-addressable storage for file snapshots, enabling
//! users to revert to previous states when the AI agent makes unwanted changes.
//!
//! Storage structure:
//! ```text
//! ~/.moldable/workspaces/{workspaceId}/checkpoints/
//! `-- {appId}/
//!     `-- {conversationId}/
//!         |-- manifest.json
//!         |-- blobs/{hash-prefix}/{hash}
//!         `-- snapshots/{messageId}.json
//! ```

use crate::paths::get_active_workspace_dir;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use walkdir::WalkDir;

// ============================================================================
// IGNORED DIRECTORIES AND FILE DETECTION
// ============================================================================

/// Directories to ignore when scanning for source files (similar to Codex)
const IGNORED_DIR_NAMES: &[&str] = &[
    "node_modules",
    ".next",
    ".git",
    ".venv",
    "venv",
    "env",
    ".env",
    "dist",
    "build",
    ".pytest_cache",
    ".mypy_cache",
    ".cache",
    ".tox",
    "__pycache__",
    "target",
    ".turbo",
    ".vercel",
    "coverage",
    ".nyc_output",
];

/// Binary file extensions to skip
const BINARY_EXTENSIONS: &[&str] = &[
    // Images
    "png", "jpg", "jpeg", "gif", "webp", "ico", "svg", "bmp", "tiff",
    // Fonts
    "woff", "woff2", "ttf", "otf", "eot",
    // Audio/Video
    "mp3", "mp4", "wav", "ogg", "webm", "avi", "mov",
    // Archives
    "zip", "tar", "gz", "rar", "7z",
    // Binaries
    "exe", "dll", "so", "dylib", "bin",
    // Other
    "pdf", "db", "sqlite", "sqlite3",
    // Lock files (large, not useful to checkpoint)
    "lock",
];

/// Max bytes per file (10MB) and total bytes per checkpoint (100MB)
const MAX_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_CHECKPOINT_BYTES: u64 = 100 * 1024 * 1024;

/// Check if a directory should be ignored
fn should_ignore_dir(name: &str) -> bool {
    IGNORED_DIR_NAMES.contains(&name)
}

/// Check if a file is binary based on extension
fn is_binary_file(path: &Path) -> bool {
    if let Some(ext) = path.extension() {
        if let Some(ext_str) = ext.to_str() {
            return BINARY_EXTENSIONS.contains(&ext_str.to_lowercase().as_str());
        }
    }
    false
}

/// Scan an app directory for all source files (excluding ignored dirs and binary files)
fn scan_source_files(app_dir: &Path) -> Result<Vec<String>, String> {
    let mut files = Vec::new();
    
    let walker = WalkDir::new(app_dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            // Skip ignored directories
            if entry.file_type().is_dir() {
                if let Some(name) = entry.file_name().to_str() {
                    return !should_ignore_dir(name);
                }
            }
            true
        });

    for entry in walker {
        let entry = entry.map_err(|e| format!("Failed to read directory: {}", e))?;
        
        // Skip directories, only process files
        if !entry.file_type().is_file() {
            continue;
        }
        
        let path = entry.path();
        
        // Skip binary files
        if is_binary_file(path) {
            continue;
        }
        
        // Get relative path
        if let Ok(relative) = path.strip_prefix(app_dir) {
            if let Some(relative_str) = relative.to_str() {
                files.push(relative_str.to_string());
            }
        }
    }
    
    Ok(files)
}

// ============================================================================
// DATA STRUCTURES
// ============================================================================

/// Summary of a checkpoint for listing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointSummary {
    pub id: String,
    pub message_id: String,
    pub created_at: DateTime<Utc>,
    pub file_count: usize,
    pub total_bytes: u64,
    /// Whether this checkpoint differs from the previous one (files were modified)
    /// This is computed when listing, not stored.
    #[serde(default)]
    pub has_changes: bool,
}

/// The checkpoint manifest for a conversation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointManifest {
    pub conversation_id: String,
    pub app_id: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub snapshots: Vec<CheckpointSummary>,
}

/// A single file entry in a snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    /// Path relative to app directory
    pub path: String,
    /// SHA-256 hash of content (None if file was deleted)
    pub hash: Option<String>,
    /// File size in bytes
    pub size: u64,
    /// Unix file mode
    pub mode: u32,
    /// Whether the file existed at snapshot time
    pub exists: bool,
}

/// A complete snapshot of files at a point in time
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub message_id: String,
    pub conversation_id: String,
    pub app_id: String,
    pub app_dir: String,
    pub created_at: DateTime<Utc>,
    pub files: Vec<FileEntry>,
}

/// Result of creating a checkpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointResult {
    pub id: String,
    pub message_id: String,
    pub file_count: usize,
    pub total_bytes: u64,
    pub blobs_created: usize,
    pub blobs_reused: usize,
}

/// Result of restoring a checkpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub files_restored: usize,
    pub files_deleted: usize,
    pub bytes_written: u64,
}

/// Result of garbage collection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub snapshots_deleted: usize,
    pub blobs_deleted: usize,
    pub bytes_freed: u64,
}

// ============================================================================
// PATH HELPERS
// ============================================================================

/// Get the checkpoints directory for the active workspace
pub fn get_checkpoints_dir() -> Result<PathBuf, String> {
    let workspace_dir = get_active_workspace_dir()?;
    Ok(workspace_dir.join("checkpoints"))
}

/// Get the checkpoint directory for a specific app + conversation
pub fn get_checkpoint_dir(app_id: &str, conversation_id: &str) -> Result<PathBuf, String> {
    let checkpoints_dir = get_checkpoints_dir()?;
    Ok(checkpoints_dir.join(app_id).join(conversation_id))
}

/// Get the manifest file path for a conversation
pub fn get_manifest_path(app_id: &str, conversation_id: &str) -> Result<PathBuf, String> {
    let dir = get_checkpoint_dir(app_id, conversation_id)?;
    Ok(dir.join("manifest.json"))
}

/// Get the blobs directory for a conversation
pub fn get_blobs_dir(app_id: &str, conversation_id: &str) -> Result<PathBuf, String> {
    let dir = get_checkpoint_dir(app_id, conversation_id)?;
    Ok(dir.join("blobs"))
}

/// Get the path for a blob by its hash
pub fn get_blob_path(app_id: &str, conversation_id: &str, hash: &str) -> Result<PathBuf, String> {
    if hash.len() < 2 {
        return Err("Hash too short".to_string());
    }
    let blobs_dir = get_blobs_dir(app_id, conversation_id)?;
    let prefix = &hash[0..2];
    Ok(blobs_dir.join(prefix).join(hash))
}

/// Get the snapshots directory for a conversation
pub fn get_snapshots_dir(app_id: &str, conversation_id: &str) -> Result<PathBuf, String> {
    let dir = get_checkpoint_dir(app_id, conversation_id)?;
    Ok(dir.join("snapshots"))
}

/// Get the path for a snapshot file
pub fn get_snapshot_path(
    app_id: &str,
    conversation_id: &str,
    message_id: &str,
) -> Result<PathBuf, String> {
    let snapshots_dir = get_snapshots_dir(app_id, conversation_id)?;
    Ok(snapshots_dir.join(format!("{}.json", message_id)))
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/// Hash file content using SHA-256
pub fn hash_content(content: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content);
    format!("{:x}", hasher.finalize())
}

/// Store a blob if it doesn't already exist
/// Returns (hash, was_created)
pub fn store_blob(
    app_id: &str,
    conversation_id: &str,
    content: &[u8],
) -> Result<(String, bool), String> {
    let hash = hash_content(content);
    let blob_path = get_blob_path(app_id, conversation_id, &hash)?;

    if blob_path.exists() {
        return Ok((hash, false));
    }

    // Ensure parent directory exists
    if let Some(parent) = blob_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create blob directory: {}", e))?;
    }

    fs::write(&blob_path, content).map_err(|e| format!("Failed to write blob: {}", e))?;

    Ok((hash, true))
}

/// Read a blob by its hash
pub fn read_blob(app_id: &str, conversation_id: &str, hash: &str) -> Result<Vec<u8>, String> {
    let blob_path = get_blob_path(app_id, conversation_id, hash)?;

    if !blob_path.exists() {
        return Err(format!("Blob not found: {}", hash));
    }

    fs::read(&blob_path).map_err(|e| format!("Failed to read blob: {}", e))
}

/// Load the manifest for a conversation (or create a new one)
pub fn load_or_create_manifest(
    app_id: &str,
    conversation_id: &str,
) -> Result<CheckpointManifest, String> {
    let manifest_path = get_manifest_path(app_id, conversation_id)?;

    if manifest_path.exists() {
        let content = fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Failed to read manifest: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse manifest: {}", e))
    } else {
        Ok(CheckpointManifest {
            conversation_id: conversation_id.to_string(),
            app_id: app_id.to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            snapshots: vec![],
        })
    }
}

/// Save the manifest
pub fn save_manifest(manifest: &CheckpointManifest) -> Result<(), String> {
    let manifest_path = get_manifest_path(&manifest.app_id, &manifest.conversation_id)?;

    // Ensure parent directory exists
    if let Some(parent) = manifest_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create manifest directory: {}", e))?;
    }

    let content =
        serde_json::to_string_pretty(manifest).map_err(|e| format!("Failed to serialize: {}", e))?;

    fs::write(&manifest_path, content).map_err(|e| format!("Failed to write manifest: {}", e))
}

/// Load a snapshot by message ID
pub fn load_snapshot(
    app_id: &str,
    conversation_id: &str,
    message_id: &str,
) -> Result<Snapshot, String> {
    let snapshot_path = get_snapshot_path(app_id, conversation_id, message_id)?;

    if !snapshot_path.exists() {
        return Err(format!("Snapshot not found: {}", message_id));
    }

    let content =
        fs::read_to_string(&snapshot_path).map_err(|e| format!("Failed to read snapshot: {}", e))?;

    serde_json::from_str(&content).map_err(|e| format!("Failed to parse snapshot: {}", e))
}

/// Save a snapshot
pub fn save_snapshot(snapshot: &Snapshot) -> Result<(), String> {
    let snapshot_path =
        get_snapshot_path(&snapshot.app_id, &snapshot.conversation_id, &snapshot.message_id)?;

    // Ensure parent directory exists
    if let Some(parent) = snapshot_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create snapshots directory: {}", e))?;
    }

    let content =
        serde_json::to_string_pretty(snapshot).map_err(|e| format!("Failed to serialize: {}", e))?;

    fs::write(&snapshot_path, content).map_err(|e| format!("Failed to write snapshot: {}", e))
}

/// Validate that a path is within the app directory (security check)
pub fn validate_path_in_app_dir(app_dir: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);

    if relative.is_absolute() {
        return Err(format!("Path must be relative: {}", relative_path));
    }

    for component in relative.components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Path contains invalid component: {}", relative_path));
            }
            _ => {}
        }
    }

    // Resolve the full path
    let full_path = app_dir.join(relative);

    // Canonicalize both paths to resolve any .. or symlinks
    // Note: For non-existent files, we check the parent
    let canonical_app_dir = app_dir
        .canonicalize()
        .map_err(|e| format!("Invalid app directory: {}", e))?;

    // Check the nearest existing ancestor to prevent symlink escapes
    let mut cursor = full_path.clone();
    loop {
        if cursor.exists() {
            let canonical_cursor = cursor
                .canonicalize()
                .map_err(|e| format!("Invalid path: {}", e))?;
            if !canonical_cursor.starts_with(&canonical_app_dir) {
                return Err(format!("Path escapes app directory: {}", relative_path));
            }
            break;
        }

        let parent = match cursor.parent() {
            Some(p) => p,
            None => break,
        };

        // Stop if we can no longer ascend
        if parent == cursor {
            break;
        }
        cursor = parent.to_path_buf();
    }

    Ok(full_path)
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

/// Create a checkpoint by scanning all source files in the app directory.
/// This captures the complete state of the app before an AI response.
#[tauri::command]
pub async fn create_checkpoint(
    app_id: String,
    app_dir: String,
    conversation_id: String,
    message_id: String,
) -> Result<CheckpointResult, String> {
    let app_dir_path = PathBuf::from(&app_dir);

    if !app_dir_path.exists() {
        return Err(format!("App directory does not exist: {}", app_dir));
    }

    // Scan all source files in the app directory
    let source_files = scan_source_files(&app_dir_path)?;
    
    let mut files: Vec<FileEntry> = vec![];
    let mut total_bytes: u64 = 0;
    let mut blobs_created: usize = 0;
    let mut blobs_reused: usize = 0;

    for relative_path in &source_files {
        let full_path = validate_path_in_app_dir(&app_dir_path, relative_path)?;

        if !full_path.exists() {
            continue;
        }

        let metadata = full_path
            .metadata()
            .map_err(|e| format!("Failed to read file metadata: {}", e))?;
        let size = metadata.len();

        // Skip files that are too large (10MB limit per file)
        if size > MAX_FILE_BYTES {
            continue;
        }

        // Enforce total size limit (100MB per checkpoint)
        if total_bytes + size > MAX_CHECKPOINT_BYTES {
            break;
        }
        total_bytes += size;

        let content = fs::read(&full_path).map_err(|e| format!("Failed to read file: {}", e))?;
        let (hash, was_created) = store_blob(&app_id, &conversation_id, &content)?;

        if was_created {
            blobs_created += 1;
        } else {
            blobs_reused += 1;
        }

        // Get file mode (Unix permissions)
        #[cfg(unix)]
        let mode = {
            use std::os::unix::fs::MetadataExt;
            metadata.mode()
        };
        #[cfg(not(unix))]
        let mode = 0o644u32;

        files.push(FileEntry {
            path: relative_path.clone(),
            hash: Some(hash),
            size,
            mode,
            exists: true,
        });
    }

    let snapshot_id = format!("snap-{}", &message_id[..8.min(message_id.len())]);

    let snapshot = Snapshot {
        id: snapshot_id.clone(),
        message_id: message_id.clone(),
        conversation_id: conversation_id.clone(),
        app_id: app_id.clone(),
        app_dir: app_dir.clone(),
        created_at: Utc::now(),
        files: files.clone(),
    };

    save_snapshot(&snapshot)?;

    // Update manifest
    let mut manifest = load_or_create_manifest(&app_id, &conversation_id)?;
    manifest.updated_at = Utc::now();
    manifest.snapshots.push(CheckpointSummary {
        id: snapshot_id.clone(),
        message_id: message_id.clone(),
        created_at: snapshot.created_at,
        file_count: files.len(),
        total_bytes,
        has_changes: false, // Computed when listing
    });
    save_manifest(&manifest)?;

    Ok(CheckpointResult {
        id: snapshot_id,
        message_id,
        file_count: files.len(),
        total_bytes,
        blobs_created,
        blobs_reused,
    })
}

fn hash_file_if_allowed(path: &Path) -> Option<String> {
    let metadata = path.metadata().ok()?;
    if metadata.len() > MAX_FILE_BYTES {
        return None;
    }
    let content = std::fs::read(path).ok()?;
    Some(hash_content(&content))
}

/// List checkpoints for a conversation within an app.
/// Computes `has_changes` for each checkpoint by comparing with the NEXT snapshot.
/// This means: "did the AI make changes AFTER this checkpoint was created?"
/// - If checkpoint A differs from checkpoint B, then A shows an undo button
/// - For the LAST checkpoint, compare with current disk state
#[tauri::command]
pub fn list_checkpoints(
    app_id: String,
    conversation_id: String,
) -> Result<Vec<CheckpointSummary>, String> {
    let manifest_path = get_manifest_path(&app_id, &conversation_id)?;

    if !manifest_path.exists() {
        return Ok(vec![]);
    }

    let manifest = load_or_create_manifest(&app_id, &conversation_id)?;
    
    if manifest.snapshots.is_empty() {
        return Ok(vec![]);
    }
    
    // First, load all snapshot hashes
    let snapshot_hashes: Vec<HashSet<(String, Option<String>)>> = manifest.snapshots
        .iter()
        .map(|summary| {
            if let Ok(snapshot) = load_snapshot(&app_id, &conversation_id, &summary.message_id) {
                snapshot.files.iter()
                    .map(|f| (f.path.clone(), f.hash.clone()))
                    .collect()
            } else {
                HashSet::new()
            }
        })
        .collect();
    
    // For the last checkpoint, get current disk state to compare against
    let current_disk_hashes: HashSet<(String, Option<String>)> = {
        // Get app_dir from the last snapshot
        let last_snapshot = load_snapshot(
            &app_id, 
            &conversation_id, 
            &manifest.snapshots.last().unwrap().message_id
        );
        
        if let Ok(snapshot) = last_snapshot {
            let app_dir = PathBuf::from(&snapshot.app_dir);
            if app_dir.exists() {
                // Scan current files and compute their hashes
                // scan_source_files returns relative paths already
                scan_source_files(&app_dir)
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|rel_path| {
                        let full_path = app_dir.join(rel_path);
                        let hash = hash_file_if_allowed(&full_path)?;
                        Some((rel_path.clone(), Some(hash)))
                    })
                    .collect()
            } else {
                HashSet::new()
            }
        } else {
            HashSet::new()
        }
    };
    
    // Compare each checkpoint with the NEXT one (or current disk for last)
    let mut result: Vec<CheckpointSummary> = Vec::new();
    let last_idx = manifest.snapshots.len() - 1;
    
    for (i, summary) in manifest.snapshots.into_iter().enumerate() {
        let has_changes = if i < last_idx {
            // Compare with next checkpoint
            snapshot_hashes[i] != snapshot_hashes[i + 1]
        } else {
            // Last checkpoint: compare with current disk state
            snapshot_hashes[i] != current_disk_hashes
        };
        
        result.push(CheckpointSummary {
            id: summary.id,
            message_id: summary.message_id,
            created_at: summary.created_at,
            file_count: summary.file_count,
            total_bytes: summary.total_bytes,
            has_changes,
        });
    }
    
    Ok(result)
}

/// Restore files to a checkpoint state.
/// 
/// This restores ALL files to their state at the target checkpoint, including:
/// - Files that were in the checkpoint (restored to their captured state)
/// - Files that were created/modified AFTER this checkpoint (deleted, since they
///   didn't exist or had different content at checkpoint time)
/// 
/// This allows users to "undo" all changes from a certain point forward in the
/// conversation.
#[tauri::command]
pub async fn restore_checkpoint(
    app_id: String,
    conversation_id: String,
    message_id: String,
) -> Result<RestoreResult, String> {
    let target_snapshot = load_snapshot(&app_id, &conversation_id, &message_id)?;
    let app_dir_path = PathBuf::from(&target_snapshot.app_dir);

    if !app_dir_path.exists() {
        return Err(format!(
            "App directory no longer exists: {}",
            target_snapshot.app_dir
        ));
    }

    // Build a set of files in the target snapshot for quick lookup
    let target_files: std::collections::HashMap<String, &FileEntry> = target_snapshot
        .files
        .iter()
        .map(|f| (f.path.clone(), f))
        .collect();

    // Collect all files from checkpoints AFTER the target checkpoint
    // These files need to be either restored to target state or deleted
    let manifest = load_or_create_manifest(&app_id, &conversation_id)?;
    let mut files_from_later_checkpoints: HashSet<String> = HashSet::new();
    
    // Find the target checkpoint index and collect files from later checkpoints
    let mut found_target = false;
    for summary in &manifest.snapshots {
        if summary.message_id == message_id {
            found_target = true;
            continue; // Skip the target itself, start collecting from the next one
        }
        
        if found_target {
            // This checkpoint is after the target - collect its files
            if let Ok(later_snapshot) = load_snapshot(&app_id, &conversation_id, &summary.message_id) {
                for file_entry in &later_snapshot.files {
                    files_from_later_checkpoints.insert(file_entry.path.clone());
                }
            }
        }
    }

    let mut files_restored: usize = 0;
    let mut files_deleted: usize = 0;
    let mut bytes_written: u64 = 0;

    // First, restore all files from the target snapshot
    for file_entry in &target_snapshot.files {
        let full_path = validate_path_in_app_dir(&app_dir_path, &file_entry.path)?;

        if file_entry.exists {
            // Restore file content
            let hash = file_entry
                .hash
                .as_ref()
                .ok_or_else(|| format!("Missing hash for file: {}", file_entry.path))?;

            let content = read_blob(&app_id, &conversation_id, hash)?;

            // Verify hash matches
            let actual_hash = hash_content(&content);
            if &actual_hash != hash {
                return Err(format!(
                    "Hash mismatch for blob {}: expected {}, got {}",
                    file_entry.path, hash, actual_hash
                ));
            }

            // Ensure parent directory exists
            if let Some(parent) = full_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create directory: {}", e))?;
            }

            fs::write(&full_path, &content)
                .map_err(|e| format!("Failed to write file: {}", e))?;

            // Restore file permissions (Unix only)
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if file_entry.mode != 0 {
                    let permissions = fs::Permissions::from_mode(file_entry.mode);
                    fs::set_permissions(&full_path, permissions).ok();
                }
            }

            bytes_written += content.len() as u64;
            files_restored += 1;
        } else {
            // Delete the file if it exists now but didn't at snapshot time
            if full_path.exists() {
                fs::remove_file(&full_path)
                    .map_err(|e| format!("Failed to delete file: {}", e))?;
                files_deleted += 1;
            }
        }
    }

    // Now handle files that were created/modified in LATER checkpoints but aren't
    // in the target snapshot (or exist with different state)
    for later_file_path in &files_from_later_checkpoints {
        // Skip if this file is already in the target snapshot (handled above)
        if target_files.contains_key(later_file_path) {
            continue;
        }

        // This file was created after the target checkpoint - delete it
        let full_path = match validate_path_in_app_dir(&app_dir_path, later_file_path) {
            Ok(p) => p,
            Err(_) => continue, // Skip invalid paths
        };

        if full_path.exists() {
            if fs::remove_file(&full_path).is_ok() {
                files_deleted += 1;
            }
        }
    }

    Ok(RestoreResult {
        files_restored,
        files_deleted,
        bytes_written,
    })
}

/// Delete old checkpoints (garbage collection)
#[tauri::command]
pub fn cleanup_checkpoints(
    app_id: String,
    conversation_id: String,
    keep_last_n: usize,
) -> Result<CleanupResult, String> {
    let mut manifest = load_or_create_manifest(&app_id, &conversation_id)?;

    if manifest.snapshots.len() <= keep_last_n {
        return Ok(CleanupResult {
            snapshots_deleted: 0,
            blobs_deleted: 0,
            bytes_freed: 0,
        });
    }

    // Collect hashes from snapshots we're keeping
    let snapshots_to_keep: Vec<_> = manifest.snapshots.iter().rev().take(keep_last_n).collect();
    let mut hashes_to_keep = HashSet::new();

    for summary in &snapshots_to_keep {
        if let Ok(snapshot) = load_snapshot(&app_id, &conversation_id, &summary.message_id) {
            for file in &snapshot.files {
                if let Some(hash) = &file.hash {
                    hashes_to_keep.insert(hash.clone());
                }
            }
        }
    }

    // Delete old snapshots and collect their hashes
    let snapshots_to_delete: Vec<_> = manifest
        .snapshots
        .iter()
        .rev()
        .skip(keep_last_n)
        .cloned()
        .collect();
    let mut hashes_to_maybe_delete = HashSet::new();
    let mut snapshots_deleted = 0;

    for summary in &snapshots_to_delete {
        if let Ok(snapshot) = load_snapshot(&app_id, &conversation_id, &summary.message_id) {
            for file in &snapshot.files {
                if let Some(hash) = &file.hash {
                    hashes_to_maybe_delete.insert(hash.clone());
                }
            }
        }

        // Delete snapshot file
        if let Ok(path) = get_snapshot_path(&app_id, &conversation_id, &summary.message_id) {
            if path.exists() {
                fs::remove_file(&path).ok();
                snapshots_deleted += 1;
            }
        }
    }

    // Delete blobs not referenced by kept snapshots
    let hashes_to_delete: Vec<_> = hashes_to_maybe_delete
        .difference(&hashes_to_keep)
        .cloned()
        .collect();
    let mut blobs_deleted = 0;
    let mut bytes_freed = 0u64;

    for hash in &hashes_to_delete {
        if let Ok(path) = get_blob_path(&app_id, &conversation_id, hash) {
            if path.exists() {
                if let Ok(metadata) = path.metadata() {
                    bytes_freed += metadata.len();
                }
                if fs::remove_file(&path).is_ok() {
                    blobs_deleted += 1;
                }
            }
        }
    }

    // Update manifest
    manifest.snapshots = manifest
        .snapshots
        .into_iter()
        .rev()
        .take(keep_last_n)
        .rev()
        .collect();
    manifest.updated_at = Utc::now();
    save_manifest(&manifest)?;

    Ok(CleanupResult {
        snapshots_deleted,
        blobs_deleted,
        bytes_freed,
    })
}

/// Delete all checkpoints for an app (called when app is deleted)
#[tauri::command]
pub fn delete_app_checkpoints(app_id: String) -> Result<(), String> {
    let checkpoints_dir = get_checkpoints_dir()?;
    let app_checkpoints_dir = checkpoints_dir.join(&app_id);

    if app_checkpoints_dir.exists() {
        fs::remove_dir_all(&app_checkpoints_dir)
            .map_err(|e| format!("Failed to delete app checkpoints: {}", e))?;
    }

    Ok(())
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    // ==================== HASHING TESTS ====================

    #[test]
    fn test_hash_content_empty() {
        let hash = hash_content(b"");
        // SHA-256 of empty string
        assert_eq!(
            hash,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn test_hash_content_hello() {
        let hash = hash_content(b"hello");
        assert_eq!(
            hash,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn test_hash_content_deterministic() {
        let content = b"some test content";
        let hash1 = hash_content(content);
        let hash2 = hash_content(content);
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_hash_content_different_for_different_input() {
        let hash1 = hash_content(b"hello");
        let hash2 = hash_content(b"world");
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_hash_length() {
        let hash = hash_content(b"test");
        // SHA-256 produces 64 hex characters
        assert_eq!(hash.len(), 64);
    }

    // ==================== DATA STRUCTURE TESTS ====================

    #[test]
    fn test_file_entry_serialization() {
        let entry = FileEntry {
            path: "src/app/page.tsx".to_string(),
            hash: Some("abc123".to_string()),
            size: 1024,
            mode: 0o644,
            exists: true,
        };

        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("src/app/page.tsx"));
        assert!(json.contains("abc123"));

        let parsed: FileEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.path, entry.path);
        assert_eq!(parsed.hash, entry.hash);
    }

    #[test]
    fn test_file_entry_deleted_file() {
        let entry = FileEntry {
            path: "deleted.ts".to_string(),
            hash: None,
            size: 0,
            mode: 0,
            exists: false,
        };

        let json = serde_json::to_string(&entry).unwrap();
        let parsed: FileEntry = serde_json::from_str(&json).unwrap();

        assert!(!parsed.exists);
        assert!(parsed.hash.is_none());
    }

    #[test]
    fn test_snapshot_serialization() {
        let snapshot = Snapshot {
            id: "snap-001".to_string(),
            message_id: "msg-123".to_string(),
            conversation_id: "conv-456".to_string(),
            app_id: "my-app".to_string(),
            app_dir: "/path/to/app".to_string(),
            created_at: Utc::now(),
            files: vec![FileEntry {
                path: "test.ts".to_string(),
                hash: Some("hash".to_string()),
                size: 100,
                mode: 0o644,
                exists: true,
            }],
        };

        let json = serde_json::to_string_pretty(&snapshot).unwrap();
        let parsed: Snapshot = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.id, snapshot.id);
        assert_eq!(parsed.files.len(), 1);
    }

    #[test]
    fn test_manifest_serialization() {
        let manifest = CheckpointManifest {
            conversation_id: "conv-123".to_string(),
            app_id: "my-app".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            snapshots: vec![CheckpointSummary {
                id: "snap-001".to_string(),
                message_id: "msg-001".to_string(),
                created_at: Utc::now(),
                file_count: 3,
                total_bytes: 1024,
                has_changes: false,
            }],
        };

        let json = serde_json::to_string_pretty(&manifest).unwrap();
        let parsed: CheckpointManifest = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.snapshots.len(), 1);
        assert_eq!(parsed.snapshots[0].file_count, 3);
    }

    // ==================== BLOB STORAGE TESTS ====================

    #[test]
    fn test_blob_path_structure() {
        // This tests the path structure without needing actual filesystem
        let hash = "a1b2c3d4e5f6789012345678901234567890123456789012345678901234abcd";
        let result = get_blob_path("my-app", "conv-123", hash);

        // Should return Ok if hash is long enough
        assert!(result.is_ok());

        let path = result.unwrap();
        let path_str = path.to_string_lossy();

        // Path should contain the hash prefix directory
        assert!(path_str.contains("/a1/"));
        // Path should end with the full hash
        assert!(path_str.ends_with(hash));
    }

    #[test]
    fn test_blob_path_rejects_short_hash() {
        let result = get_blob_path("my-app", "conv-123", "a");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too short"));
    }

    // ==================== PATH VALIDATION TESTS ====================

    #[test]
    fn test_validate_path_rejects_parent_traversal() {
        let temp_dir = TempDir::new().unwrap();
        let app_dir = temp_dir.path().join("app");
        let outside_dir = temp_dir.path().join("outside");

        // Create both directories
        fs::create_dir_all(&app_dir).unwrap();
        fs::create_dir_all(&outside_dir).unwrap();
        
        // Create a file outside the app dir
        let secret_file = outside_dir.join("secret.txt");
        fs::write(&secret_file, "secret data").unwrap();

        // Try to escape with .. to access the outside file
        let result = validate_path_in_app_dir(&app_dir, "../outside/secret.txt");
        assert!(result.is_err(), "Should reject path that escapes app directory");
    }

    #[test]
    fn test_validate_path_allows_valid_path() {
        let temp_dir = TempDir::new().unwrap();
        let app_dir = temp_dir.path();

        // Create the app directory and a subdirectory
        fs::create_dir_all(app_dir.join("src")).unwrap();

        let result = validate_path_in_app_dir(app_dir, "src/file.ts");
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_path_allows_nested_path() {
        let temp_dir = TempDir::new().unwrap();
        let app_dir = temp_dir.path();

        // Create nested directory
        fs::create_dir_all(app_dir.join("src/components")).unwrap();

        let result = validate_path_in_app_dir(app_dir, "src/components/Button.tsx");
        assert!(result.is_ok());
    }

    // ==================== INTEGRATION TESTS ====================

    #[test]
    fn test_store_and_read_blob() {
        // This test uses a mock directory structure
        let temp_dir = TempDir::new().unwrap();

        // We need to test the blob functions directly with a known path
        let content = b"test file content";
        let hash = hash_content(content);

        // Create blob directory structure
        let blobs_dir = temp_dir.path().join("blobs").join(&hash[0..2]);
        fs::create_dir_all(&blobs_dir).unwrap();

        let blob_path = blobs_dir.join(&hash);
        fs::write(&blob_path, content).unwrap();

        // Verify we can read it back
        let read_content = fs::read(&blob_path).unwrap();
        assert_eq!(read_content, content);

        // Verify hash matches
        let read_hash = hash_content(&read_content);
        assert_eq!(read_hash, hash);
    }

    #[test]
    fn test_snapshot_round_trip() {
        let temp_dir = TempDir::new().unwrap();
        let snapshot_dir = temp_dir.path().join("snapshots");
        fs::create_dir_all(&snapshot_dir).unwrap();

        let snapshot = Snapshot {
            id: "snap-001".to_string(),
            message_id: "msg-abc".to_string(),
            conversation_id: "conv-xyz".to_string(),
            app_id: "test-app".to_string(),
            app_dir: "/test/path".to_string(),
            created_at: Utc::now(),
            files: vec![
                FileEntry {
                    path: "src/index.ts".to_string(),
                    hash: Some("hash1".to_string()),
                    size: 100,
                    mode: 0o644,
                    exists: true,
                },
                FileEntry {
                    path: "deleted.ts".to_string(),
                    hash: None,
                    size: 0,
                    mode: 0,
                    exists: false,
                },
            ],
        };

        // Write snapshot
        let snapshot_path = snapshot_dir.join("msg-abc.json");
        let json = serde_json::to_string_pretty(&snapshot).unwrap();
        fs::write(&snapshot_path, &json).unwrap();

        // Read it back
        let content = fs::read_to_string(&snapshot_path).unwrap();
        let loaded: Snapshot = serde_json::from_str(&content).unwrap();

        assert_eq!(loaded.id, "snap-001");
        assert_eq!(loaded.files.len(), 2);
        assert!(loaded.files[0].exists);
        assert!(!loaded.files[1].exists);
    }

    // ==================== FILE OPERATION TESTS ====================

    #[test]
    fn test_checkpoint_and_restore_workflow() {
        let temp_dir = TempDir::new().unwrap();
        let app_dir = temp_dir.path().join("app");
        let checkpoint_dir = temp_dir.path().join("checkpoints");

        // Create app directory with a file
        fs::create_dir_all(&app_dir).unwrap();
        let test_file = app_dir.join("test.txt");
        fs::write(&test_file, "original content").unwrap();

        // Simulate checkpoint: read and hash the file
        let content = fs::read(&test_file).unwrap();
        let hash = hash_content(&content);

        // Store blob
        let blob_dir = checkpoint_dir.join("blobs").join(&hash[0..2]);
        fs::create_dir_all(&blob_dir).unwrap();
        fs::write(blob_dir.join(&hash), &content).unwrap();

        // Modify the file
        fs::write(&test_file, "modified content").unwrap();
        assert_eq!(fs::read_to_string(&test_file).unwrap(), "modified content");

        // Simulate restore: read blob and write back
        let restored_content = fs::read(blob_dir.join(&hash)).unwrap();
        fs::write(&test_file, &restored_content).unwrap();

        // Verify restored
        assert_eq!(fs::read_to_string(&test_file).unwrap(), "original content");
    }

    #[test]
    fn test_blob_deduplication() {
        let temp_dir = TempDir::new().unwrap();
        let blobs_dir = temp_dir.path().join("blobs");

        let content = b"duplicate content";
        let hash = hash_content(content);
        let blob_dir = blobs_dir.join(&hash[0..2]);
        fs::create_dir_all(&blob_dir).unwrap();
        let blob_path = blob_dir.join(&hash);

        // First write
        assert!(!blob_path.exists());
        fs::write(&blob_path, content).unwrap();
        assert!(blob_path.exists());

        // Second "write" with same content - in real code, we'd skip this
        let already_exists = blob_path.exists();
        assert!(already_exists); // We'd reuse the existing blob
    }

    // ==================== EDGE CASE TESTS ====================

    #[test]
    fn test_empty_file_checkpoint() {
        let content = b"";
        let hash = hash_content(content);

        // Empty files should still have a valid hash
        assert!(!hash.is_empty());
        assert_eq!(hash.len(), 64);
    }

    #[test]
    fn test_binary_file_checkpoint() {
        let binary_content: Vec<u8> = (0..256).map(|i| i as u8).collect();
        let hash = hash_content(&binary_content);

        // Binary content should hash fine
        assert_eq!(hash.len(), 64);
    }

    #[test]
    fn test_unicode_filename() {
        let entry = FileEntry {
            path: "src/日本語/ファイル.tsx".to_string(),
            hash: Some("abc".to_string()),
            size: 100,
            mode: 0o644,
            exists: true,
        };

        let json = serde_json::to_string(&entry).unwrap();
        let parsed: FileEntry = serde_json::from_str(&json).unwrap();

        assert!(parsed.path.contains("日本語"));
    }

    #[test]
    fn test_large_file_entry_list() {
        let files: Vec<FileEntry> = (0..1000)
            .map(|i| FileEntry {
                path: format!("file_{}.ts", i),
                hash: Some(format!("hash_{}", i)),
                size: 100,
                mode: 0o644,
                exists: true,
            })
            .collect();

        let snapshot = Snapshot {
            id: "snap-large".to_string(),
            message_id: "msg-large".to_string(),
            conversation_id: "conv-large".to_string(),
            app_id: "large-app".to_string(),
            app_dir: "/path/to/large/app".to_string(),
            created_at: Utc::now(),
            files,
        };

        let json = serde_json::to_string(&snapshot).unwrap();
        let parsed: Snapshot = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.files.len(), 1000);
    }

    // ==================== CLEANUP TESTS ====================

    #[test]
    fn test_manifest_snapshot_ordering() {
        let mut manifest = CheckpointManifest {
            conversation_id: "conv-123".to_string(),
            app_id: "my-app".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            snapshots: vec![],
        };

        // Add snapshots in order
        for i in 0..5 {
            manifest.snapshots.push(CheckpointSummary {
                id: format!("snap-{}", i),
                message_id: format!("msg-{}", i),
                created_at: Utc::now(),
                file_count: 1,
                total_bytes: 100,
                has_changes: false,
            });
        }

        assert_eq!(manifest.snapshots.len(), 5);
        assert_eq!(manifest.snapshots[0].id, "snap-0");
        assert_eq!(manifest.snapshots[4].id, "snap-4");

        // Keep last 3 (what cleanup would do)
        let kept: Vec<_> = manifest.snapshots.iter().rev().take(3).rev().cloned().collect();
        assert_eq!(kept.len(), 3);
        assert_eq!(kept[0].id, "snap-2");
        assert_eq!(kept[2].id, "snap-4");
    }

    // ==================== RESULT STRUCTURE TESTS ====================

    #[test]
    fn test_checkpoint_result() {
        let result = CheckpointResult {
            id: "snap-123".to_string(),
            message_id: "msg-456".to_string(),
            file_count: 5,
            total_bytes: 10240,
            blobs_created: 3,
            blobs_reused: 2,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("snap-123"));
        assert!(json.contains("10240"));
    }

    #[test]
    fn test_restore_result() {
        let result = RestoreResult {
            files_restored: 4,
            files_deleted: 1,
            bytes_written: 8192,
        };

        let json = serde_json::to_string(&result).unwrap();
        let parsed: RestoreResult = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.files_restored, 4);
        assert_eq!(parsed.files_deleted, 1);
    }

    #[test]
    fn test_cleanup_result() {
        let result = CleanupResult {
            snapshots_deleted: 10,
            blobs_deleted: 25,
            bytes_freed: 102400,
        };

        let json = serde_json::to_string(&result).unwrap();
        let parsed: CleanupResult = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.bytes_freed, 102400);
    }

    // ==================== CASCADING REVERT TESTS ====================

    #[test]
    fn test_cascading_revert_identifies_later_files() {
        // Test that the restore logic correctly identifies files from later checkpoints
        // This is a unit test for the data structure manipulation

        let target_files: std::collections::HashMap<String, FileEntry> = vec![
            ("button.tsx".to_string(), FileEntry {
                path: "button.tsx".to_string(),
                hash: Some("hash1".to_string()),
                size: 100,
                mode: 0o644,
                exists: true,
            }),
        ].into_iter().collect();

        // Simulate files from later checkpoints
        let later_files: HashSet<String> = vec![
            "button.tsx".to_string(),  // Already in target - should be skipped
            "global.css".to_string(),  // New in later checkpoint - should be deleted
            "header.tsx".to_string(),  // New in later checkpoint - should be deleted
        ].into_iter().collect();

        // Count files that would be deleted (in later but not in target)
        let files_to_delete: Vec<_> = later_files
            .iter()
            .filter(|f| !target_files.contains_key(*f))
            .collect();

        assert_eq!(files_to_delete.len(), 2);
        assert!(files_to_delete.contains(&&"global.css".to_string()));
        assert!(files_to_delete.contains(&&"header.tsx".to_string()));
    }

    #[test]
    fn test_manifest_ordering_for_cascading_revert() {
        // Test that we can correctly find checkpoints after a target
        let manifest = CheckpointManifest {
            conversation_id: "conv-123".to_string(),
            app_id: "my-app".to_string(),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            snapshots: vec![
                CheckpointSummary {
                    id: "snap-A".to_string(),
                    message_id: "msg-A".to_string(),
                    created_at: Utc::now(),
                    file_count: 1,
                    total_bytes: 100,
                    has_changes: true, // A differs from B -> A has undo
                },
                CheckpointSummary {
                    id: "snap-B".to_string(),
                    message_id: "msg-B".to_string(),
                    created_at: Utc::now(),
                    file_count: 2,
                    total_bytes: 200,
                    has_changes: true, // B differs from C -> B has undo
                },
                CheckpointSummary {
                    id: "snap-C".to_string(),
                    message_id: "msg-C".to_string(),
                    created_at: Utc::now(),
                    file_count: 3,
                    total_bytes: 300,
                    has_changes: false, // C is last -> no undo yet
                },
            ],
        };

        // If restoring to msg-A, we should collect files from msg-B and msg-C
        let target_message_id = "msg-A";
        let mut found_target = false;
        let mut later_checkpoint_ids: Vec<String> = vec![];

        for summary in &manifest.snapshots {
            if summary.message_id == target_message_id {
                found_target = true;
                continue;
            }
            if found_target {
                later_checkpoint_ids.push(summary.message_id.clone());
            }
        }

        assert_eq!(later_checkpoint_ids.len(), 2);
        assert_eq!(later_checkpoint_ids[0], "msg-B");
        assert_eq!(later_checkpoint_ids[1], "msg-C");
    }

    #[test]
    fn test_cascading_revert_full_scenario() {
        // Integration test for the cascading revert scenario
        let temp_dir = TempDir::new().unwrap();
        let app_dir = temp_dir.path().join("app");
        fs::create_dir_all(&app_dir).unwrap();

        // Setup: Create files representing state after multiple AI responses
        // Initial state (before any changes)
        // -> Message A response creates button.tsx
        // -> Message B response modifies button.tsx, creates global.css
        // -> Message C response creates header.tsx

        // Create current state (after all responses)
        fs::write(app_dir.join("button.tsx"), "modified button").unwrap();
        fs::write(app_dir.join("global.css"), "styles").unwrap();
        fs::write(app_dir.join("header.tsx"), "header").unwrap();

        // Simulate checkpoint A (only had button.tsx in original state)
        let checkpoint_a_files: std::collections::HashMap<String, FileEntry> = vec![
            ("button.tsx".to_string(), FileEntry {
                path: "button.tsx".to_string(),
                hash: Some("original_hash".to_string()),
                size: 50,
                mode: 0o644,
                exists: true,
            }),
        ].into_iter().collect();

        // Files from later checkpoints B and C
        let later_files: HashSet<String> = vec![
            "button.tsx".to_string(),
            "global.css".to_string(),
            "header.tsx".to_string(),
        ].into_iter().collect();

        // When restoring to A, we should delete files not in A
        let files_to_delete: Vec<_> = later_files
            .iter()
            .filter(|f| !checkpoint_a_files.contains_key(*f))
            .collect();

        // global.css and header.tsx should be deleted
        assert_eq!(files_to_delete.len(), 2);

        // Simulate deletion
        for file_path in files_to_delete {
            let full_path = app_dir.join(file_path);
            if full_path.exists() {
                fs::remove_file(&full_path).unwrap();
            }
        }

        // Verify: Only button.tsx remains (which would be restored to original content)
        assert!(app_dir.join("button.tsx").exists());
        assert!(!app_dir.join("global.css").exists());
        assert!(!app_dir.join("header.tsx").exists());
    }
}
