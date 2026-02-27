mod api;
mod crypto;
mod ws;

use log::{error, info};
use std::time::Duration;
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tray_icon::{
    Icon, TrayIconBuilder,
    menu::{Menu, MenuEvent, MenuItem},
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    info!("Starting YiboFlow Desktop Core Daemon (v1.3)...");

    // Start UI Event Loop in main thread (required by Tao/windows)
    let event_loop = EventLoopBuilder::new().build();

    let tray_menu = Menu::new();
    let quit_i = MenuItem::new("Quit YiboFlow Core", true, None);
    let config_i = MenuItem::new("Connect to NAS & Test Mode", true, None);
    tray_menu.append_items(&[&config_i, &quit_i]).unwrap();

    let icon = Icon::from_rgba(vec![255; 4], 1, 1).unwrap();

    let _tray_icon = TrayIconBuilder::new()
        .with_menu(Box::new(tray_menu))
        .with_tooltip("YiboFlow Core Engine")
        .with_icon(icon)
        .build()
        .unwrap();

    let menu_channel = MenuEvent::receiver();
    info!("Tray registered. Core is running headlessly.");

    // Run the OS GUI message pump on main thread
    event_loop.run(move |_event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        if let Ok(event) = menu_channel.try_recv() {
            if event.id == quit_i.id() {
                info!("Quit requested from generic tray. Exiting...");
                *control_flow = ControlFlow::Exit;
            } else if event.id == config_i.id() {
                info!("Testing API connectivity asynchronously...");

                let rt = tokio::runtime::Handle::current();
                rt.spawn(async {
                    run_mock_api_test().await;
                });
            }
        }
    });
}

async fn run_mock_api_test() {
    let mut client = api::ApiClient::new("http://localhost:8080".to_string());

    // Simulate Login Flow
    let login_payload = api::LoginRequest {
        username: "admin".to_string(),
        password: "my_strong_password".to_string(),
        device_name: "Mocked Desktop Agent".to_string(),
        device_type: "windows".to_string(),
        device_fingerprint: "win-1234-uuid".to_string(),
    };

    match client.login(login_payload).await {
        Ok(res) => {
            if res.code == 200 && res.data.is_some() {
                let d = res.data.unwrap();
                info!("Logged in! Received Token: {}...", &d.access_token[0..10]);

                let mk = crypto::MasterKey::derive("my_strong_password", &d.kdf_salt).unwrap();
                info!("Locally derived MasterKey from password & salt is ready.");

                // Test querying online devices
                let online_res = client.get_online_devices().await.unwrap();
                info!("Online devices count: {:?}", online_res.data);

                // --- NEW: Test WebSocket Connection ---
                // We use the tokio-tungstenite module we built here!
                match ws::WsClient::connect("http://localhost:8080", &d.access_token).await {
                    Ok(ws_client) => {
                        info!("WS client created! Attempting to send a handshake payload...");

                        // Let's create a ping message using the WsMessage struct
                        let msg = ws::WsMessage {
                            sender_uid: 0,          // overwritten by server (secure)
                            sender_device_id: 0,    // overwritten by server (secure)
                            target_devices: vec![], // broadcast to all
                            r#type: "handshake_test".to_string(),
                            payload: serde_json::json!({
                                "status": "Desktop Core Initialized",
                                "enc_support": true
                            }),
                        };

                        if let Err(e) = ws_client.send_message(msg).await {
                            error!("Failed to send WS message: {}", e);
                        }

                        // Just waiting around so the Write/Read daemons don't die instantly.
                        tokio::time::sleep(Duration::from_secs(10)).await;
                    }
                    Err(e) => {
                        error!("Failed to upgrade to WebSocket: {}", e);
                    }
                }
            } else {
                error!("Login failed via API: {}", res.msg);
            }
        }
        Err(e) => {
            error!("Could not connect to NAS: {}", e);
        }
    }
}
