//! Shared sidecar lifecycle helpers (start/stop/restart/cleanup + logging).

use crate::ports::kill_process_tree;
use log::{error, info, warn};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::mpsc::Receiver;

#[derive(Clone, Copy)]
pub struct RestartPolicy {
    pub min_delay_ms: u64,
    pub max_delay_ms: u64,
}

#[derive(Clone, Copy)]
pub struct RestartFlags {
    pub disabled: &'static AtomicBool,
    pub in_progress: &'static AtomicBool,
}

#[derive(Clone, Copy)]
pub struct SidecarRuntime {
    pub log_prefix: &'static str,
    pub restart_policy: RestartPolicy,
    pub restart_flags: RestartFlags,
}

fn restart_delay_ms(policy: RestartPolicy) -> u64 {
    let range = policy.max_delay_ms.saturating_sub(policy.min_delay_ms);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() as u64;
    let offset = if range == 0 { 0 } else { nanos % (range + 1) };
    policy.min_delay_ms + offset
}

fn spawn_sidecar_monitor<FRestart>(
    mut rx: Receiver<CommandEvent>,
    log_prefix: &'static str,
    state: Arc<Mutex<Option<CommandChild>>>,
    restart_flags: RestartFlags,
    restart_policy: RestartPolicy,
    restart_fn: FRestart,
) where
    FRestart: Fn() -> Result<String, String> + Send + 'static,
{
    std::thread::spawn(move || {
        while let Some(event) = rx.blocking_recv() {
            match event {
                CommandEvent::Stdout(line) => {
                    info!("{} {}", log_prefix, String::from_utf8_lossy(&line));
                }
                CommandEvent::Stderr(line) => {
                    error!("{} {}", log_prefix, String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(status) => {
                    info!("{} Terminated with status: {:?}", log_prefix, status);
                    if let Ok(mut guard) = state.lock() {
                        *guard = None;
                    }

                    if restart_flags.disabled.load(Ordering::SeqCst) {
                        info!("{} Restart suppressed (shutdown in progress)", log_prefix);
                        break;
                    }

                    if restart_flags
                        .in_progress
                        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                        .is_err()
                    {
                        info!("{} Restart already in progress", log_prefix);
                        break;
                    }

                    loop {
                        if restart_flags.disabled.load(Ordering::SeqCst) {
                            info!("{} Restart cancelled (shutdown in progress)", log_prefix);
                            break;
                        }

                        let delay_ms = restart_delay_ms(restart_policy);
                        warn!("{} Restarting in {}ms", log_prefix, delay_ms);
                        std::thread::sleep(Duration::from_millis(delay_ms));

                        if restart_flags.disabled.load(Ordering::SeqCst) {
                            info!("{} Restart cancelled (shutdown in progress)", log_prefix);
                            break;
                        }

                        match restart_fn() {
                            Ok(message) => {
                                if message.is_empty() {
                                    info!("{} Restarted", log_prefix);
                                } else {
                                    info!("{} {}", log_prefix, message);
                                }
                                break;
                            }
                            Err(err) => {
                                error!("{} Failed to restart: {}", log_prefix, err);
                            }
                        }
                    }

                    restart_flags.in_progress.store(false, Ordering::SeqCst);
                    break;
                }
                _ => {}
            }
        }
    });
}

pub fn is_sidecar_running(state: &Arc<Mutex<Option<CommandChild>>>) -> bool {
    match state.lock() {
        Ok(guard) => guard.is_some(),
        Err(_) => false,
    }
}

fn kill_sidecar_child(child: CommandChild, log_prefix: &'static str) -> u32 {
    let pid = child.pid();
    if let Err(err) = child.kill() {
        warn!(
            "{} Tauri kill failed: {}, using kill_process_tree",
            log_prefix, err
        );
    }
    kill_process_tree(pid);
    pid
}

pub fn start_sidecar<FPre, FSpawn, FHealth, FOnStarted, FRestart>(
    runtime: &SidecarRuntime,
    state: Arc<Mutex<Option<CommandChild>>>,
    pre_start: FPre,
    spawn: FSpawn,
    health_check: FHealth,
    health_check_failed_log: Option<String>,
    health_check_failed_message: String,
    on_started: FOnStarted,
    started_log: Option<String>,
    restart_fn: FRestart,
) -> Result<bool, String>
where
    FPre: Fn() -> Result<(), String>,
    FSpawn: Fn() -> Result<(Receiver<CommandEvent>, CommandChild), String> + Send + 'static,
    FHealth: Fn() -> bool,
    FOnStarted: Fn() -> Result<(), String>,
    FRestart: Fn() -> Result<String, String> + Send + 'static,
{
    runtime
        .restart_flags
        .disabled
        .store(false, Ordering::SeqCst);

    if is_sidecar_running(&state) {
        info!("{} already running", runtime.log_prefix);
        return Ok(true);
    }

    pre_start()?;

    let (rx, child) = spawn()?;
    let pid = child.pid();
    info!("{} process started (pid {})", runtime.log_prefix, pid);

    spawn_sidecar_monitor(
        rx,
        runtime.log_prefix,
        state.clone(),
        runtime.restart_flags,
        runtime.restart_policy,
        restart_fn,
    );

    if !health_check() {
        if let Some(message) = health_check_failed_log {
            warn!("{} {}", runtime.log_prefix, message);
        } else {
            warn!("{} health check failed", runtime.log_prefix);
        }
        let _ = kill_sidecar_child(child, runtime.log_prefix);
        return Err(health_check_failed_message);
    }

    on_started()?;

    if let Ok(mut guard) = state.lock() {
        *guard = Some(child);
    }

    if let Some(message) = started_log {
        info!("{} {}", runtime.log_prefix, message);
    }

    Ok(true)
}

pub fn stop_sidecar(
    runtime: &SidecarRuntime,
    state: &Arc<Mutex<Option<CommandChild>>>,
) -> Result<bool, String> {
    runtime
        .restart_flags
        .disabled
        .store(true, Ordering::SeqCst);

    let mut guard = state.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.take() {
        info!("{} stopping...", runtime.log_prefix);
        let pid = kill_sidecar_child(child, runtime.log_prefix);
        std::thread::sleep(Duration::from_millis(100));
        info!("{} stopped (pid {})", runtime.log_prefix, pid);
    } else {
        info!("{} already stopped", runtime.log_prefix);
    }

    Ok(true)
}

pub fn cleanup_sidecar(runtime: &SidecarRuntime, state: &Arc<Mutex<Option<CommandChild>>>) {
    runtime
        .restart_flags
        .disabled
        .store(true, Ordering::SeqCst);
    let _ = stop_sidecar(runtime, state);
}
