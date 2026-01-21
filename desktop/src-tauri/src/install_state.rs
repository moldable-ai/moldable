use chrono::Utc;
use log::warn;
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const INSTALL_STATE_FILE: &str = ".moldable.install.json";
const INSTALL_STATE_LOCK_FILE: &str = ".moldable.install.lock";
const INSTALL_HISTORY_LIMIT: usize = 50;

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallEvent {
    pub stage: String,
    pub status: String,
    pub timestamp: String,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallState {
    pub app_id: String,
    pub stage: String,
    pub status: String,
    pub updated_at: String,
    pub history: Vec<InstallEvent>,
}

fn install_state_path(app_dir: &Path) -> PathBuf {
    app_dir.join(INSTALL_STATE_FILE)
}

struct InstallStateLock {
    path: PathBuf,
}

impl Drop for InstallStateLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn acquire_install_state_lock(app_dir: &Path) -> Result<InstallStateLock, String> {
    if !app_dir.exists() {
        std::fs::create_dir_all(app_dir)
            .map_err(|e| format!("Failed to create install state dir: {}", e))?;
    }

    let lock_path = app_dir.join(INSTALL_STATE_LOCK_FILE);
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
                return Ok(InstallStateLock { path: lock_path });
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if start.elapsed() >= timeout {
                    return Err("Timed out waiting for install state lock".to_string());
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(e) => {
                return Err(format!("Failed to create install state lock: {}", e));
            }
        }
    }
}

fn write_install_state_atomic(app_dir: &Path, content: &str) -> Result<(), String> {
    let mut temp_file = tempfile::Builder::new()
        .prefix(".moldable.install.tmp-")
        .tempfile_in(app_dir)
        .map_err(|e| format!("Failed to create temp install state: {}", e))?;

    temp_file
        .write_all(content.as_bytes())
        .map_err(|e| format!("Failed to write temp install state: {}", e))?;
    temp_file
        .as_file()
        .sync_all()
        .map_err(|e| format!("Failed to sync install state: {}", e))?;

    temp_file
        .persist(install_state_path(app_dir))
        .map_err(|e| format!("Failed to persist install state: {}", e.error))?;

    Ok(())
}

pub fn read_install_state(app_dir: &Path) -> Option<InstallState> {
    let path = install_state_path(app_dir);
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

pub fn update_install_state(
    app_dir: &Path,
    app_id: &str,
    stage: &str,
    status: &str,
    error: Option<String>,
) -> Result<(), String> {
    let _lock = acquire_install_state_lock(app_dir)?;
    let timestamp = Utc::now().to_rfc3339();
    let mut state = read_install_state(app_dir).unwrap_or_default();

    state.app_id = app_id.to_string();
    state.stage = stage.to_string();
    state.status = status.to_string();
    state.updated_at = timestamp.clone();
    state.history.push(InstallEvent {
        stage: stage.to_string(),
        status: status.to_string(),
        timestamp: timestamp.clone(),
        error: error.clone(),
    });

    if state.history.len() > INSTALL_HISTORY_LIMIT {
        let excess = state.history.len() - INSTALL_HISTORY_LIMIT;
        state.history.drain(0..excess);
    }

    let content = serde_json::to_string_pretty(&state)
        .map_err(|e| format!("Failed to serialize install state: {}", e))?;
    write_install_state_atomic(app_dir, &content)?;

    Ok(())
}

pub fn format_install_state_lines(state: &InstallState) -> Vec<String> {
    if state.status == "ok" {
        return Vec::new();
    }

    let mut lines = Vec::new();
    lines.push(format!(
        "[install] stage={} status={} updated_at={}",
        state.stage, state.status, state.updated_at
    ));

    if let Some(error) = state
        .history
        .iter()
        .rev()
        .find_map(|event| event.error.as_ref())
    {
        lines.push(format!("[install] error={}", error));
    }

    lines
}

pub fn update_install_state_safe(
    app_dir: &Path,
    app_id: &str,
    stage: &str,
    status: &str,
    error: Option<String>,
) {
    if let Err(e) = update_install_state(app_dir, app_id, stage, status, error) {
        warn!(
            "Failed to update install state for {} (stage={}, status={}): {}",
            app_id, stage, status, e
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn create_temp_dir(prefix: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("{}_{}", prefix, nanos));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn test_update_and_read_install_state() {
        let temp_dir = create_temp_dir("moldable-install-state");
        update_install_state(&temp_dir, "app-id", "download", "in_progress", None).unwrap();

        let state = read_install_state(&temp_dir).unwrap();
        assert_eq!(state.app_id, "app-id");
        assert_eq!(state.stage, "download");
        assert_eq!(state.status, "in_progress");
        assert!(!state.updated_at.is_empty());
        assert_eq!(state.history.len(), 1);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_format_install_state_lines_error() {
        let temp_dir = create_temp_dir("moldable-install-state-error");
        update_install_state(
            &temp_dir,
            "app-id",
            "dependencies",
            "error",
            Some("pnpm failed".to_string()),
        )
        .unwrap();

        let state = read_install_state(&temp_dir).unwrap();
        let lines = format_install_state_lines(&state);
        assert!(lines.iter().any(|line| line.contains("stage=dependencies")));
        assert!(lines.iter().any(|line| line.contains("error=pnpm failed")));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_format_install_state_lines_ok_skips() {
        let temp_dir = create_temp_dir("moldable-install-state-ok");
        update_install_state(&temp_dir, "app-id", "complete", "ok", None).unwrap();

        let state = read_install_state(&temp_dir).unwrap();
        let lines = format_install_state_lines(&state);
        assert!(lines.is_empty());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_install_state_history_capped() {
        let temp_dir = create_temp_dir("moldable-install-state-cap");

        for index in 0..(INSTALL_HISTORY_LIMIT + 10) {
            update_install_state(
                &temp_dir,
                "app-id",
                &format!("stage-{}", index),
                "in_progress",
                None,
            )
            .unwrap();
        }

        let state = read_install_state(&temp_dir).unwrap();
        assert_eq!(state.history.len(), INSTALL_HISTORY_LIMIT);
        assert_eq!(state.history.last().unwrap().stage, "stage-59");

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
