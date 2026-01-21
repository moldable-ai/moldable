//! Moldable Desktop - Main library entry point
//!
//! This module sets up the Tauri application and coordinates between
//! various subsystems. The actual logic is delegated to focused modules.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use log::{info, warn, error};
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use tauri::{AppHandle, Emitter, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_shell::process::CommandChild;

// ============================================================================
// MODULES
// ============================================================================

// Runtime dependency management (Node.js, pnpm)
mod runtime;
use runtime::DependencyStatus;

// Shared types
pub mod types;

// Path helpers
pub mod paths;
use paths::get_config_file_path;

// Environment variable management
pub mod env;

// Port management
pub mod ports;
use ports::{cleanup_stale_moldable_instances, create_instance_lock, delete_lock_file};

// Conversations
pub mod conversations;

// Preferences
pub mod preferences;
use preferences::{load_shared_config, save_shared_config, migrate_security_preferences};

// System logs
pub mod logs;

// Workspace management
pub mod workspace;
use workspace::{ensure_default_workspace, ensure_bundled_scripts, ensure_bundled_app_template};

// App process management
pub mod process;
use process::{AppState, AppStateInner, cleanup_all_apps, cleanup_all_orphaned_apps};

// Audio capture sidecar
pub mod audio;
use audio::AudioCaptureState;

// AI server sidecar
pub mod ai_server;
use ai_server::{start_ai_server, cleanup_ai_server};

// HTTP API server for AI tools
pub mod api_server;

// App registration and detection
pub mod apps;
use apps::get_registered_apps;

// Install state tracking
pub mod install_state;

// App codemods/migrations
pub mod codemods;

// GitHub app registry
pub mod registry;

// ============================================================================
// DEPENDENCY MANAGEMENT (thin wrappers)
// ============================================================================

#[tauri::command]
fn check_dependencies() -> DependencyStatus {
    runtime::check_dependencies()
}

// ============================================================================
// HELLO MOLDABLES SETUP
// ============================================================================

/// Sync wrapper to spawn the async Hello Moldables installation
fn ensure_hello_moldables_app(app_handle: &tauri::AppHandle) {
    let shared_config = load_shared_config();
    if shared_config.hello_moldables_installed {
        return;
    }

    let handle = app_handle.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(e) = registry::ensure_hello_moldables_app_async(
            handle,
            load_shared_config,
            |c| save_shared_config(c),
        ).await {
            warn!("Failed to install Hello Moldables app: {}", e);
        }
    });
}

// ============================================================================
// CONFIG WATCHER
// ============================================================================

/// Watch the config.json file for changes and emit events to the frontend
fn start_config_watcher(app_handle: AppHandle) {
    let config_path = match get_config_file_path() {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to get config path for watcher: {}", e);
            return;
        }
    };

    // Ensure the config directory exists
    if let Some(parent) = config_path.parent() {
        if !parent.exists() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                error!("Failed to create config directory: {}", e);
                return;
            }
        }
    }

    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();

        let mut debouncer = match new_debouncer(Duration::from_millis(500), tx) {
            Ok(d) => d,
            Err(e) => {
                error!("Failed to create config watcher: {}", e);
                return;
            }
        };

        let watch_path = config_path.parent().unwrap_or(&config_path);
        if let Err(e) = debouncer
            .watcher()
            .watch(watch_path, notify::RecursiveMode::NonRecursive)
        {
            error!("Failed to watch config directory: {}", e);
            return;
        }

        info!("Watching config file for changes: {:?}", config_path);

        loop {
            match rx.recv() {
                Ok(Ok(events)) => {
                    let config_changed = events.iter().any(|e| {
                        e.kind == DebouncedEventKind::Any
                            && e.path
                                .file_name()
                                .map(|n| n == "config.json")
                                .unwrap_or(false)
                    });

                    if config_changed {
                        info!("Config file changed, notifying frontend");
                        if let Err(e) = app_handle.emit("config-changed", ()) {
                            error!("Failed to emit config-changed event: {}", e);
                        }
                    }
                }
                Ok(Err(e)) => {
                    error!("Config watcher error: {:?}", e);
                }
                Err(e) => {
                    error!("Config watcher channel error: {:?}", e);
                    break;
                }
            }
        }
    });
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

fn run_shutdown_cleanup(
    cleanup_guard: &Arc<AtomicBool>,
    app_state: &Arc<Mutex<AppStateInner>>,
    ai_server_state: &Arc<Mutex<Option<CommandChild>>>,
    audio_capture_state: &Arc<Mutex<Option<CommandChild>>>,
    reason: &str,
) {
    if cleanup_guard.swap(true, Ordering::SeqCst) {
        return;
    }

    info!("Shutdown cleanup triggered: {}", reason);

    let temp_state = AppState(app_state.clone());
    cleanup_all_apps(&temp_state);

    cleanup_ai_server(ai_server_state);
    audio::cleanup_audio_capture(audio_capture_state);

    delete_lock_file();
    info!("Lock file deleted");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState(Arc::new(Mutex::new(AppStateInner {
        processes: HashMap::new(),
        last_errors: HashMap::new(),
        lock_retry_counts: HashMap::new(),
    })));

    // Create AI server state to track the sidecar process
    let ai_server_state: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));

    // Create audio capture state
    let audio_capture_state = AudioCaptureState(Arc::new(Mutex::new(None)));

    // Clone for the exit handler
    let app_state_for_exit = app_state.0.clone();
    let ai_server_for_exit = ai_server_state.clone();
    let audio_capture_for_exit = audio_capture_state.0.clone();
    let app_state_for_run_event = app_state_for_exit.clone();
    let ai_server_for_run_event = ai_server_for_exit.clone();
    let audio_capture_for_run_event = audio_capture_for_exit.clone();
    let cleanup_guard = Arc::new(AtomicBool::new(false));
    let cleanup_guard_for_window = cleanup_guard.clone();
    let cleanup_guard_for_run_event = cleanup_guard.clone();

    // Clone for setup closure
    let ai_server_for_setup = ai_server_state.clone();

    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
                .max_file_size(5_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(app_state)
        .manage(audio_capture_state)
        .invoke_handler(tauri::generate_handler![
            // App process management (from process module)
            process::start_app,
            process::stop_app,
            process::get_app_status,
            process::get_app_logs,
            process::set_app_actual_port,
            process::discover_app_port,
            // Port management (from ports module)
            ports::check_port,
            ports::is_port_available,
            ports::find_free_port,
            ports::get_port_info,
            ports::kill_port,
            // Paths (from paths module)
            paths::get_moldable_config_path,
            paths::get_moldable_root_cmd,
            // App registration (from apps module)
            apps::get_registered_apps,
            apps::get_registered_apps_for_workspace,
            apps::register_app,
            apps::unregister_app,
            apps::detect_app_in_folder,
            apps::list_available_apps,
            apps::install_available_app,
            // Workspace paths (from workspace module)
            workspace::get_workspace_path,
            workspace::set_workspace_path,
            // App registry (from registry module)
            registry::fetch_app_registry,
            registry::install_app_from_registry,
            registry::uninstall_app_from_shared,
            // Environment (from env module)
            env::get_app_env_requirements,
            env::set_app_env_var,
            env::get_all_env_vars,
            env::save_api_key,
            env::get_api_key_status,
            env::remove_api_key,
            // Preferences (from preferences module)
            preferences::get_preference,
            preferences::set_preference,
            preferences::get_all_preferences,
            // Shared preferences (global settings like security)
            preferences::get_shared_preference,
            preferences::set_shared_preference,
            preferences::get_all_shared_preferences,
            // Workspace commands (from workspace module)
            workspace::get_workspaces_config,
            workspace::set_active_workspace,
            workspace::create_workspace,
            workspace::update_workspace,
            workspace::delete_workspace,
            // Conversation commands (from conversations module)
            conversations::list_conversations,
            conversations::load_conversation,
            conversations::save_conversation,
            conversations::delete_conversation,
            // Audio capture commands (from audio module)
            audio::is_system_audio_available,
            audio::start_audio_capture,
            audio::stop_audio_capture,
            // System logs (from logs module)
            logs::get_system_logs,
            logs::get_system_log_path,
            logs::clear_system_logs,
            // Runtime status (for diagnostics)
            check_dependencies,
            // Server ports (for frontend to connect)
            ports::get_ai_server_port,
            ports::get_api_server_port
        ])
        .setup(move |app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            
            // CRITICAL: Clean up any stale instances from previous runs FIRST
            // This must happen before we try to start our servers
            let killed = cleanup_stale_moldable_instances();
            if killed > 0 {
                info!("Cleaned up {} stale process(es) from previous run", killed);
            }

            // Create custom menu to override Cmd+M (which normally minimizes on macOS)
            let toggle_chat = MenuItemBuilder::new("Toggle Chat")
                .id("toggle_chat")
                .accelerator("CmdOrCtrl+M")
                .build(app)?;

            // Build "Moldable" app menu with About, Hide, Quit, etc.
            let icon = {
                let png_bytes = include_bytes!("../icons/128x128.png");
                image::load_from_memory(png_bytes).ok().map(|img| {
                    let rgba = img.to_rgba8();
                    let (width, height) = rgba.dimensions();
                    tauri::image::Image::new_owned(rgba.into_raw(), width, height)
                })
            };

            let app_menu = SubmenuBuilder::new(app, "Moldable")
                .about(Some(tauri::menu::AboutMetadata {
                    name: Some("Moldable".to_string()),
                    version: Some(env!("CARGO_PKG_VERSION").to_string()),
                    short_version: Some("prod".to_string()),
                    copyright: Some("© 2026 Moldable AI".to_string()),
                    icon,
                    ..Default::default()
                }))
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let window_menu = SubmenuBuilder::new(app, "Window")
                .item(&toggle_chat)
                .separator()
                .minimize()
                .maximize()
                .close_window()
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&edit_menu)
                .item(&window_menu)
                .build()?;

            app.set_menu(menu)?;

            // Handle menu events
            app.on_menu_event(move |app_handle, event| {
                if event.id().as_ref() == "toggle_chat" {
                    let _ = app_handle.emit("toggle-chat", ());
                }
            });

            // Ensure default workspace exists on fresh install
            if let Err(e) = ensure_default_workspace() {
                warn!("Failed to create default workspace: {}", e);
            }

            // Migrate security preferences to default true for existing workspaces
            migrate_security_preferences();

            // Install bundled scripts to ~/.moldable/shared/scripts/
            if let Err(e) = ensure_bundled_scripts(app.handle()) {
                warn!("Failed to install bundled scripts: {}", e);
            }

            // Install bundled app template to ~/.moldable/cache/app-template/
            if let Err(e) = ensure_bundled_app_template(app.handle()) {
                warn!("Failed to install bundled app template: {}", e);
            }

            // Install Hello Moldables tutorial app on first launch
            ensure_hello_moldables_app(app.handle());

            // Start AI server sidecar first (it uses the API server, so needs to start first)
            let ai_server_port = match start_ai_server(app.handle(), ai_server_for_setup) {
                Ok(port) => {
                    info!("AI server started on port {}", port);
                    // Store the actual port for frontend to read
                    ports::set_ai_server_actual_port(port);
                    port
                }
                Err(e) => {
                    error!("Failed to start AI server: {}", e);
                    // Use default port for lock file even if we failed
                    ai_server::AI_SERVER_PORT
                }
            };

            // Start API server for AI tools
            let api_handle = app.handle().clone();
            let api_server_port_holder = std::sync::Arc::new(std::sync::atomic::AtomicU16::new(
                api_server::API_SERVER_PORT,
            ));
            let api_port_for_lock = api_server_port_holder.clone();
            
            tauri::async_runtime::spawn(async move {
                match api_server::start_api_server(api_handle).await {
                    Ok(port) => {
                        info!("API server started on port {}", port);
                        api_port_for_lock.store(port, std::sync::atomic::Ordering::SeqCst);
                        // Store in static for frontend access
                        ports::set_api_server_actual_port(port);
                    }
                    Err(e) => {
                        error!("Failed to start API server: {}", e);
                    }
                }
            });
            
            // Create the lock file to track our instance
            // Give the API server a moment to start, then create lock file
            let ai_port_for_lock = ai_server_port;
            std::thread::spawn(move || {
                // Wait a bit for API server to start and update port
                std::thread::sleep(std::time::Duration::from_millis(500));
                let api_port = api_server_port_holder.load(std::sync::atomic::Ordering::SeqCst);
                
                if let Err(e) = create_instance_lock(ai_port_for_lock, api_port) {
                    warn!("Failed to create instance lock file: {}", e);
                }
            });

            // Start watching config file for changes
            start_config_watcher(app.handle().clone());

            // Clean up any orphaned processes from previous runs
            let app_state_for_cleanup = app.state::<AppState>();
            cleanup_all_orphaned_apps(|| get_registered_apps(), app_state_for_cleanup.inner());

            Ok(())
        })
        .on_window_event(move |_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                run_shutdown_cleanup(
                    &cleanup_guard_for_window,
                    &app_state_for_exit,
                    &ai_server_for_exit,
                    &audio_capture_for_exit,
                    "window destroyed",
                );
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            run_shutdown_cleanup(
                &cleanup_guard_for_run_event,
                &app_state_for_run_event,
                &ai_server_for_run_event,
                &audio_capture_for_run_event,
                "exit requested",
            );
        }
    });
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // ==================== STATE INITIALIZATION TESTS ====================

    #[test]
    fn test_app_state_initialization() {
        let app_state = AppState(Arc::new(Mutex::new(AppStateInner {
            processes: HashMap::new(),
            last_errors: HashMap::new(),
            lock_retry_counts: HashMap::new(),
        })));

        let state = app_state.0.lock().unwrap();
        assert!(state.processes.is_empty());
        assert!(state.last_errors.is_empty());
    }

    #[test]
    fn test_ai_server_state_initialization() {
        let ai_server_state: Arc<Mutex<Option<CommandChild>>> = Arc::new(Mutex::new(None));
        let state = ai_server_state.lock().unwrap();
        assert!(state.is_none());
    }

    #[test]
    fn test_audio_capture_state_initialization() {
        let audio_capture_state = AudioCaptureState(Arc::new(Mutex::new(None)));
        let state = audio_capture_state.0.lock().unwrap();
        assert!(state.is_none());
    }

    // ==================== CONFIG WATCHER LOGIC TESTS ====================

    #[test]
    fn test_config_file_detection_logic() {
        // This tests the logic used in start_config_watcher to detect config.json changes
        let config_path = PathBuf::from("/some/path/config.json");
        let other_path = PathBuf::from("/some/path/other.json");
        let nested_config = PathBuf::from("/some/path/nested/config.json");

        // Check that we correctly identify config.json
        assert_eq!(
            config_path.file_name().map(|n| n == "config.json"),
            Some(true)
        );
        assert_eq!(
            other_path.file_name().map(|n| n == "config.json"),
            Some(false)
        );
        assert_eq!(
            nested_config.file_name().map(|n| n == "config.json"),
            Some(true)
        );
    }

    #[test]
    fn test_config_path_parent_detection() {
        let config_path = PathBuf::from("/home/user/.moldable/workspaces/personal/config.json");
        let parent = config_path.parent();
        
        assert!(parent.is_some());
        assert!(parent.unwrap().ends_with("personal"));
    }

    #[test]
    fn test_config_path_no_parent() {
        let config_path = PathBuf::from("config.json");
        let watch_path = config_path.parent().unwrap_or(&config_path);
        
        // When there's no parent, should use the path itself
        assert_eq!(watch_path.to_str(), Some(""));
    }

    // ==================== MODULE INTEGRATION TESTS ====================

    #[test]
    fn test_modules_are_accessible() {
        // Verify all public modules are accessible and their key types exist
        
        // types module
        let _config = types::MoldableConfig::default();
        let _workspace_config = types::WorkspacesConfig::default();
        
        // Test that default implementations work
        assert!(types::MoldableConfig::default().apps.is_empty());
        assert_eq!(types::WorkspacesConfig::default().active_workspace, "personal");
    }

    #[test]
    fn test_dependency_status_from_runtime() {
        // Verify we can call through to the runtime module
        let status = runtime::check_dependencies();
        
        // Should return a valid status regardless of what's installed
        // Just verify the fields exist and are accessible
        let _node_installed = status.node_installed;
        let _node_version = &status.node_version;
        let _pnpm_installed = status.pnpm_installed;
        let _pnpm_version = &status.pnpm_version;
    }

    // ==================== CLONING BEHAVIOR TESTS ====================

    #[test]
    fn test_arc_mutex_cloning_for_exit_handler() {
        // This tests the pattern used for cleanup handlers
        let app_state = AppState(Arc::new(Mutex::new(AppStateInner {
            processes: HashMap::new(),
            last_errors: HashMap::new(),
            lock_retry_counts: HashMap::new(),
        })));

        // Clone the inner Arc (as done for exit handler)
        let cloned = app_state.0.clone();
        
        // Both should point to the same data
        {
            let mut state = app_state.0.lock().unwrap();
            state.last_errors.insert("test-app".to_string(), vec!["test error".to_string()]);
        }
        
        // Verify the clone sees the change
        let cloned_state = cloned.lock().unwrap();
        assert_eq!(cloned_state.last_errors.get("test-app"), Some(&vec!["test error".to_string()]));
    }

    #[test]
    fn test_multiple_arc_clones_share_state() {
        let ai_server_state: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        
        let for_exit = ai_server_state.clone();
        let for_setup = ai_server_state.clone();
        
        // Modify through one clone
        {
            let mut state = for_setup.lock().unwrap();
            *state = Some("running".to_string());
        }
        
        // Verify all clones see the change
        assert_eq!(*ai_server_state.lock().unwrap(), Some("running".to_string()));
        assert_eq!(*for_exit.lock().unwrap(), Some("running".to_string()));
    }
}
