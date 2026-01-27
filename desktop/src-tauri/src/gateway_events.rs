//! Gateway event listener
//!
//! Maintains a WebSocket connection to the gateway and forwards
//! pairing request events to the frontend.

use crate::paths::get_gateway_config_path as get_gateway_config_path_internal;
use futures_util::{SinkExt, StreamExt};
use log::{debug, error, info, warn};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};

const GATEWAY_WS_PORT: u16 = 19789;
const RECONNECT_DELAY_MS: u64 = 5000;

static LISTENER_RUNNING: AtomicBool = AtomicBool::new(false);

/// Pairing request event payload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingRequest {
    pub channel: String,
    pub sender_id: String,
    pub display_name: Option<String>,
    pub code: String,
    pub timestamp: String,
}

/// Gateway WebSocket protocol frame types
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Frame {
    Req {
        id: String,
        method: String,
        params: Option<serde_json::Value>,
    },
    Res {
        id: String,
        ok: bool,
        payload: Option<serde_json::Value>,
        error: Option<serde_json::Value>,
    },
    Event {
        event: String,
        payload: Option<serde_json::Value>,
    },
}

/// Start the gateway event listener in a background task.
/// Automatically reconnects if the connection is lost.
pub fn start_gateway_event_listener(app: AppHandle) {
    // Prevent multiple listeners
    if LISTENER_RUNNING.swap(true, Ordering::SeqCst) {
        info!("[GatewayEvents] Listener already running, skipping");
        return;
    }

    info!("[GatewayEvents] Starting gateway event listener");

    tauri::async_runtime::spawn(async move {
        let shutdown = Arc::new(AtomicBool::new(false));

        loop {
            if shutdown.load(Ordering::SeqCst) {
                break;
            }

            match run_event_loop(&app).await {
                Ok(()) => {
                    info!("[GatewayEvents] Event loop exited normally");
                }
                Err(e) => {
                    warn!("[GatewayEvents] Event loop error: {}", e);
                }
            }

            // Wait before reconnecting
            tokio::time::sleep(Duration::from_millis(RECONNECT_DELAY_MS)).await;
            debug!("[GatewayEvents] Reconnecting to gateway...");
        }

        LISTENER_RUNNING.store(false, Ordering::SeqCst);
        info!("[GatewayEvents] Listener stopped");
    });
}

async fn run_event_loop(app: &AppHandle) -> Result<(), String> {
    let url = format!("ws://127.0.0.1:{}", GATEWAY_WS_PORT);
    debug!("[GatewayEvents] Connecting to {}", url);

    let (ws_stream, _) = connect_async(&url)
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;

    debug!("[GatewayEvents] Connected to gateway");

    let (mut write, mut read) = ws_stream.split();

    // Get auth token from config
    let auth_token = get_gateway_auth_token().await;

    // Send connect message to authenticate
    let connect_msg = Frame::Req {
        id: "connect-1".to_string(),
        method: "connect".to_string(),
        params: Some(serde_json::json!({
            "min_protocol": 1,
            "max_protocol": 1,
            "client": {
                "id": "moldable-desktop",
                "version": env!("CARGO_PKG_VERSION"),
                "platform": std::env::consts::OS,
            },
            "auth": {
                "token": auth_token,
            },
            "role": "operator",
            "scopes": ["operator.admin"],
        })),
    };

    let connect_json = serde_json::to_string(&connect_msg)
        .map_err(|e| format!("Failed to serialize connect message: {}", e))?;

    write
        .send(Message::Text(connect_json.into()))
        .await
        .map_err(|e| format!("Failed to send connect: {}", e))?;

    // Wait for connect response
    let response = read
        .next()
        .await
        .ok_or("Connection closed before response")?
        .map_err(|e| format!("Failed to read response: {}", e))?;

    if let Message::Text(text) = response {
        let frame: Frame = serde_json::from_str(&text)
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        match frame {
            Frame::Res { ok: true, .. } => {
                info!("[GatewayEvents] Authenticated with gateway");
            }
            Frame::Res {
                ok: false, error, ..
            } => {
                let err_msg = error
                    .and_then(|e| e.get("message").and_then(|m| m.as_str()).map(String::from))
                    .unwrap_or_else(|| "Unknown error".to_string());
                return Err(format!("Authentication failed: {}", err_msg));
            }
            _ => {
                return Err("Unexpected response type".to_string());
            }
        }
    } else {
        return Err("Expected text message response".to_string());
    }

    // Now listen for events (they're pushed automatically to authenticated clients)
    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                if let Ok(Frame::Event { event, payload }) = serde_json::from_str::<Frame>(&text) {
                    handle_event(app, &event, payload);
                }
            }
            Ok(Message::Close(_)) => {
                info!("[GatewayEvents] Server closed connection");
                break;
            }
            Ok(Message::Ping(data)) => {
                let _ = write.send(Message::Pong(data)).await;
            }
            Err(e) => {
                warn!("[GatewayEvents] WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }

    Ok(())
}

/// Get the gateway auth token from the config file
async fn get_gateway_auth_token() -> Option<String> {
    // Try to read from gateway config
    let config_path = get_gateway_config_path_internal().ok()?;
    let content = tokio::fs::read_to_string(&config_path).await.ok()?;

    // Parse JSON5 to get the auth token
    let config: serde_json::Value = json5::from_str(&content).ok()?;
    config
        .get("gateway")
        .and_then(|g| g.get("auth"))
        .and_then(|a| a.get("token"))
        .and_then(|t| t.as_str())
        .map(String::from)
}

fn handle_event(app: &AppHandle, event: &str, payload: Option<serde_json::Value>) {
    match event {
        "pairing.requested" => {
            if let Some(data) = payload {
                info!("[GatewayEvents] Received pairing request: {:?}", data);
                handle_pairing_requested(app, data);
            }
        }
        "pairing.approved" => {
            if let Some(data) = payload {
                info!("[GatewayEvents] Pairing approved: {:?}", data);
                let _ = app.emit("gateway:pairing-approved", data);
            }
        }
        "pairing.rejected" => {
            if let Some(data) = payload {
                info!("[GatewayEvents] Pairing rejected: {:?}", data);
                let _ = app.emit("gateway:pairing-rejected", data);
            }
        }
        _ => {
            debug!("[GatewayEvents] Unhandled event: {}", event);
        }
    }
}

fn handle_pairing_requested(app: &AppHandle, data: serde_json::Value) {
    // Try to parse the pairing request
    let request = PairingRequest {
        channel: data
            .get("channel")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
        sender_id: data
            .get("sender_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        display_name: data
            .get("display_name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        code: data
            .get("code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        timestamp: data
            .get("timestamp")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    };

    // Emit to frontend
    if let Err(e) = app.emit("gateway:pairing-requested", &request) {
        error!("[GatewayEvents] Failed to emit pairing request: {}", e);
    }
}
