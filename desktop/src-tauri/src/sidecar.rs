//! Shared sidecar lifecycle helpers (logging + restart loop).

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

fn restart_delay_ms(policy: RestartPolicy) -> u64 {
    let range = policy.max_delay_ms.saturating_sub(policy.min_delay_ms);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() as u64;
    let offset = if range == 0 { 0 } else { nanos % (range + 1) };
    policy.min_delay_ms + offset
}

pub fn spawn_sidecar_monitor<FRestart>(
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
