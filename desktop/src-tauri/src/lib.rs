use log::{error, info};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;
use yiboflow_core::api::{ApiClient, LoginRequest, RegisterRequest};
use yiboflow_core::clipboard::ClipboardMonitor;
use yiboflow_core::crypto::MasterKey;
use yiboflow_core::ws::WsClient;

// We can store shared state here later, like the WsClient channel for sending new text.
pub struct AppState {
    pub is_connected: Mutex<bool>,
    pub ws_tx: Mutex<Option<tokio::sync::mpsc::Sender<yiboflow_core::ws::WsMessage>>>,
}

#[tauri::command]
async fn register_engine(
    server_url: String,
    username: String,
    password: String,
) -> Result<bool, String> {
    info!(
        "Tauri Command Received: register_engine -> Server: {}",
        server_url
    );

    // Generate a valid Argon2 salt string natively
    let kdf_salt = yiboflow_core::crypto::generate_salt();

    let client = ApiClient::new(server_url);
    let req = RegisterRequest {
        username,
        password,
        kdf_salt,
    };

    let res = client
        .register(req)
        .await
        .map_err(|e| format!("Registration API error: {}", e))?;

    if res.code == 201 || res.code == 200 {
        Ok(true)
    } else {
        Err(format!("Server returned: {}", res.msg))
    }
}

#[tauri::command]
async fn connect_engine(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    server_url: String,
    username: String,
    password: String,
) -> Result<bool, String> {
    {
        let connected_flag = state.is_connected.lock().await;
        if *connected_flag {
            info!("Already connected. Bypassing engine setup to prevent duplicate monitors.");
            return Ok(true);
        }
    }

    let (ui_tx, mut ui_rx) = tokio::sync::mpsc::channel(100);
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(evt) = ui_rx.recv().await {
            let _ = app_clone.emit("clipboard-event", evt);
        }
    });

    info!(
        "Tauri Command Received: connect_engine -> Server: {}",
        server_url
    );

    let mut client = ApiClient::new(server_url.clone());
    let login_payload = LoginRequest {
        username: username.clone(),
        password: password.clone(),
        device_name: "YiboFlow Desktop Native".to_string(),
        device_type: "windows".to_string(),
        device_fingerprint: "gui-native-1234".to_string(),
    };

    let login_result = client.login(login_payload).await;

    let is_mock_target = server_url.contains("127.0.0.1") || server_url.contains("localhost");
    let mut needs_mock = false;
    let mut api_err = String::new();

    match login_result {
        Ok(res) => {
            if res.code == 200 && res.data.is_some() {
                let d = res.data.unwrap();
                info!(
                    "Logged in from GUI! Received Token: {}...",
                    &d.access_token[0..10]
                );

                let pwd = password.clone();
                let salt_b64 = d.kdf_salt.clone();
                let mk = tokio::task::spawn_blocking(move || MasterKey::derive(&pwd, &salt_b64))
                    .await
                    .map_err(|e| format!("Task failed: {}", e))?;

                let mk = match mk {
                    Ok(k) => k,
                    Err(e) => return Err(format!("MasterKey Derivation failed: {}", e)),
                };
                info!("Locally derived MasterKey is ready.");

                // Auto cache the local password for unified offline use
                let auto_salt = d.kdf_salt.clone();
                let auto_pwd = password.clone();
                let _ = tokio::task::spawn_blocking(move || {
                    if let Ok(hash) =
                        yiboflow_core::crypto::hash_local_password(&auto_pwd, &auto_salt)
                    {
                        if let Ok(mut cfg) = yiboflow_core::config::GLOBAL_CONFIG.write() {
                            cfg.local_password_hash = hash;
                            cfg.local_kdf_salt = auto_salt;
                            cfg.save();
                        }
                    }
                })
                .await;

                // Attempt WS connection
                match WsClient::connect(&server_url, &d.access_token).await {
                    Ok((ws_client, ws_rx)) => {
                        info!("WS client created! Handshake sent implicitly.");
                        let arc_mk = Arc::new(mk);
                        let cb_monitor = ClipboardMonitor::new(
                            server_url.clone(),
                            d.access_token.clone(),
                            arc_mk,
                            ws_client.tx.clone(),
                            Some(ui_tx),
                        );
                        cb_monitor.start_polling();
                        cb_monitor.start_receiving(ws_rx);

                        let mut connected_flag = state.is_connected.lock().await;
                        *connected_flag = true;
                        let mut ws_tx = state.ws_tx.lock().await;
                        *ws_tx = Some(ws_client.tx.clone());
                        return Ok(true);
                    }
                    Err(e) => return Err(format!("WebSocket Connection Failed: {}", e)),
                }
            } else {
                api_err = format!("Login failed via API: {}", res.msg);
                needs_mock = true;
            }
        }
        Err(e) => {
            api_err = format!("Could not connect to NAS: {}", e);
            needs_mock = true; // Use this flag as 'needs_offline_fallback'
        }
    }

    if needs_mock {
        info!(
            "NAS unreachable or failed. Attempting Offline Fallback. Reason: {}",
            api_err
        );

        let mut offline_success = false;
        let pwd = password.clone();

        let (cached_hash, cached_salt) = {
            let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
            (cfg.local_password_hash.clone(), cfg.local_kdf_salt.clone())
        };

        if !cached_hash.is_empty() && !cached_salt.is_empty() {
            let salt_for_hash = cached_salt.clone();
            let hash_check = tokio::task::spawn_blocking(move || {
                yiboflow_core::crypto::hash_local_password(&pwd, &salt_for_hash)
            })
            .await
            .unwrap_or(Err(yiboflow_core::crypto::CryptoError::InvalidData));

            if let Ok(hash) = hash_check {
                if hash == cached_hash {
                    offline_success = true;
                }
            }
        }

        if offline_success {
            info!("Offline credentials match. Deriving MasterKey for Snippets...");

            let pwd = password.clone();
            let mk =
                tokio::task::spawn_blocking(move || MasterKey::derive(&pwd, &cached_salt).unwrap())
                    .await
                    .map_err(|e| format!("Task failed: {}", e))?;

            // Offline mode: No WsClient, dummy channel for intercepting clipboard events
            let dummy_ws_tx = tokio::sync::mpsc::channel(1).0;
            let arc_mk = Arc::new(mk);

            let cb_monitor = ClipboardMonitor::new(
                "offline".to_string(),
                "none".to_string(),
                arc_mk,
                dummy_ws_tx,
                Some(ui_tx),
            );
            cb_monitor.start_polling();
            // In offline mode we don't start WsClient RX receiving since there's no server

            let mut connected_flag = state.is_connected.lock().await;
            *connected_flag = true;

            info!("Running in Pure Offline Mode! Snippets engine active.");
            return Ok(true);
        } else {
            return Err(format!(
                "Network Error: {}. Offline login also failed (Wrong password or Uncached).",
                api_err
            ));
        }
    }

    Err(api_err)
}

#[tauri::command]
fn get_snippets() -> Result<(std::collections::HashMap<String, String>, std::collections::HashMap<String, String>), String> {
    let (mut multi_snippets, folders) = yiboflow_core::config::get_snippets();
    let mut single_snippets = std::collections::HashMap::new();
    for (k, v) in multi_snippets {
        if let Some(first) = v.into_iter().next() {
            single_snippets.insert(k, first);
        }
    }
    Ok((single_snippets, folders))
}

#[tauri::command]
fn add_snippet(trigger: String, replacement: String, folder: Option<String>) -> Result<(), String> {
    yiboflow_core::config::add_snippet(trigger, replacement, folder)
}

#[tauri::command]
fn remove_snippet(trigger: String) -> Result<(), String> {
    yiboflow_core::config::remove_snippet(trigger)
}

#[tauri::command]
fn get_blocked_apps() -> Result<Vec<String>, String> {
    Ok(yiboflow_core::config::get_blocked_apps())
}

#[tauri::command]
fn get_autofills() -> Result<std::collections::HashMap<String, String>, String> {
    Ok(yiboflow_core::config::get_autofills())
}

#[tauri::command]
fn add_autofill(trigger: String, candidate: String) -> Result<(), String> {
    yiboflow_core::config::add_autofill(trigger, candidate)
}

#[tauri::command]
fn remove_autofill(trigger: String) -> Result<(), String> {
    yiboflow_core::config::remove_autofill(trigger)
}

#[tauri::command]
fn add_blocked_app(app_name: String) -> Result<(), String> {
    yiboflow_core::config::add_blocked_app(app_name)
}

#[tauri::command]
fn remove_blocked_app(app_name: String) -> Result<(), String> {
    yiboflow_core::config::remove_blocked_app(app_name)
}

#[derive(serde::Serialize)]
struct SettingsPayload {
    is_smartlib_enabled: bool,
    is_sync_enabled: bool,
    is_autofill_enabled: bool,
    flowhint_min_chars: usize,
    flowhint_accept_key: u32,
}

#[tauri::command]
fn get_settings() -> Result<SettingsPayload, String> {
    let (is_smartlib_enabled, is_sync_enabled, is_autofill_enabled, flowhint_min_chars, flowhint_accept_key) = yiboflow_core::config::get_settings();
    Ok(SettingsPayload {
        is_smartlib_enabled,
        is_sync_enabled,
        is_autofill_enabled,
        flowhint_min_chars,
        flowhint_accept_key,
    })
}

#[tauri::command]
fn update_settings(is_smartlib_enabled: bool, is_sync_enabled: bool, is_autofill_enabled: bool, flowhint_min_chars: usize, flowhint_accept_key: u32) -> Result<(), String> {
    yiboflow_core::config::update_settings(is_smartlib_enabled, is_sync_enabled, is_autofill_enabled, flowhint_min_chars, flowhint_accept_key)
}

#[tauri::command]
fn diagnose_flowhint() -> Result<String, String> {
    let mut report = String::new();

    // 1. Config
    let (snap_en, _sync, autofill_en, _, _) = yiboflow_core::config::get_settings();
    report.push_str(&format!("[Config] snippets_enabled={}, autofill_enabled={}\n", snap_en, autofill_en));

    // 2. Rules default
    let rules = yiboflow_core::rules::get_rules();
    report.push_str(&format!("[Rules] default.flowhint={}\n", rules.default.flowhint));
    report.push_str(&format!("[Rules] default.flowsnap={}\n", rules.default.flowsnap));

    // 3. Feature query for notepad
    let hint_ok = yiboflow_core::rules::is_feature_enabled("notepad.exe", yiboflow_core::rules::Feature::FlowHint);
    report.push_str(&format!("[Rules] is_feature_enabled(notepad.exe, FlowHint)={}\n", hint_ok));

    // 4. Dict IDs
    let dict_ids = yiboflow_core::rules::get_app_flowhint_dicts("notepad.exe");
    report.push_str(&format!("[Dicts] dict_ids_for_notepad={:?}\n", dict_ids));

    // 5. Dictionary search
    let cands = yiboflow_core::dictionary::search_candidates_tail(&dict_ids, "gi");
    report.push_str(&format!("[Dicts] search_candidates_tail('gi')={:?}\n", cands));

    let cands_exact = yiboflow_core::dictionary::search_candidates(&dict_ids, "gi");
    report.push_str(&format!("[Dicts] search_candidates_exact('gi')={:?}\n", cands_exact));

    // 6. HINT_TX status
    let tx_set = yiboflow_core::hook_manager::HINT_TX.lock().map(|tx| tx.is_some()).unwrap_or(false);
    report.push_str(&format!("[Channel] HINT_TX is_set={}\n", tx_set));

    // 7. Try actually sending a test event
    if tx_set {
        yiboflow_core::hook_manager::set_hint_tx_test_send();
        report.push_str("[Channel] Sent test HintEvent::Show\n");
    }

    Ok(report)
}

#[tauri::command]
fn accept_hint_candidate(index: usize) -> Result<(), String> {
    yiboflow_core::hook_manager::accept_hint_by_index(index);
    Ok(())
}

#[tauri::command]
fn dismiss_hint_window() -> Result<(), String> {
    yiboflow_core::hook_manager::dismiss_hint();
    Ok(())
}

#[tauri::command]
fn update_hint_position(x: i32, y: i32) -> Result<(), String> {
    let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().unwrap();
    cfg.hint_fixed_x = x;
    cfg.hint_fixed_y = y;
    cfg.save();
    Ok(())
}

#[tauri::command]
fn move_hint_window(x: i32, y: i32) -> Result<(), String> {
    if let Some(tx) = &*yiboflow_core::hook_manager::HINT_TX.lock().unwrap() {
        let _ = tx.send(yiboflow_core::hook_manager::HintEvent::MoveWindow { x, y });
    }
    Ok(())
}

#[tauri::command]
fn reset_hint_position() -> Result<(), String> {
    let mut cfg = yiboflow_core::config::GLOBAL_CONFIG.write().unwrap();
    cfg.hint_fixed_x = -1;
    cfg.hint_fixed_y = -1;
    cfg.save();
    Ok(())
}

#[tauri::command]
fn change_local_password(new_password: String) -> Result<(), String> {
    let salt = yiboflow_core::crypto::generate_salt();
    let hash_result = tokio::task::block_in_place(|| {
        let np = new_password.clone();
        let s = salt.clone();
        yiboflow_core::crypto::hash_local_password(&np, &s)
    });

    match hash_result {
        Ok(hash_str) => {
            let mut cfg = yiboflow_core::config::GLOBAL_CONFIG
                .write()
                .map_err(|e| e.to_string())?;
            cfg.local_password_hash = hash_str;
            cfg.local_kdf_salt = salt;
            cfg.save();
            log::info!("Local offline password updated successfully");
            Ok(())
        }
        Err(e) => Err(format!("Hashing failed: {}", e)),
    }
}

#[tauri::command]
async fn send_file_p2p(
    state: tauri::State<'_, AppState>,
    file_path: String,
    target_device: u32,
) -> Result<(), String> {
    let ws_tx_guard = state.ws_tx.lock().await;
    if let Some(ws_tx) = ws_tx_guard.as_ref() {
        let path = std::path::PathBuf::from(file_path);
        yiboflow_core::p2p::start_file_send(path, target_device, ws_tx.clone()).await
    } else {
        Err("Core Engine not connected yet.".to_string())
    }
}

// ---------------------------------------------------------------------------
// FlowRules Commands — per-app feature permission matrix
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
struct FlowRulesPayload {
    default: yiboflow_core::rules::DefaultRules,
    app_overrides: Vec<yiboflow_core::rules::AppRule>,
}

#[tauri::command]
fn get_flow_rules() -> Result<FlowRulesPayload, String> {
    let cfg = yiboflow_core::rules::get_rules();
    Ok(FlowRulesPayload {
        default: cfg.default,
        app_overrides: cfg.app_overrides,
    })
}

#[tauri::command]
fn set_default_rules(
    flowsnap: bool,
    flowhint: bool,
    flowwriter: bool,
    flowpredict: bool,
    flowsync: bool,
) -> Result<(), String> {
    yiboflow_core::rules::set_default_rules(yiboflow_core::rules::DefaultRules {
        flowsnap,
        flowhint,
        flowwriter,
        flowpredict,
        flowsync,
    })
}

#[tauri::command]
fn upsert_app_rule(
    process: String,
    display_name: String,
    flowsnap: bool,
    flowhint: bool,
    flowhint_dicts: Vec<String>,
    flowwriter: bool,
    flowpredict: bool,
    flowsync: bool,
) -> Result<(), String> {
    yiboflow_core::rules::upsert_app_rule(yiboflow_core::rules::AppRule {
        process,
        display_name,
        flowsnap,
        flowhint,
        flowhint_dicts,
        flowwriter,
        flowpredict,
        flowsync,
    })
}

#[tauri::command]
fn remove_app_rule(process: String) -> Result<(), String> {
    yiboflow_core::rules::remove_app_rule(process)
}

#[tauri::command]
fn toggle_app_feature(process: String, feature: String) -> Result<(), String> {
    let f = parse_feature(&feature)?;
    yiboflow_core::rules::toggle_app_feature(process, f)
}

#[tauri::command]
fn toggle_default_feature(feature: String) -> Result<(), String> {
    let f = parse_feature(&feature)?;
    yiboflow_core::rules::toggle_default_feature(f)
}

fn parse_feature(s: &str) -> Result<yiboflow_core::rules::Feature, String> {
    match s.to_lowercase().as_str() {
        "flowsnap" => Ok(yiboflow_core::rules::Feature::FlowSnap),
        "flowhint" => Ok(yiboflow_core::rules::Feature::FlowHint),
        "flowwriter" => Ok(yiboflow_core::rules::Feature::FlowWriter),
        "flowpredict" => Ok(yiboflow_core::rules::Feature::FlowPredict),
        "flowsync" => Ok(yiboflow_core::rules::Feature::FlowSync),
        _ => Err(format!("Unknown feature: {}", s)),
    }
}

// ---------------------------------------------------------------------------
// Backup & Restore
// ---------------------------------------------------------------------------

#[tauri::command]
fn export_config(dest_path: String) -> Result<(), String> {
    log::info!("Tauri Command: export_config to {}", dest_path);
    yiboflow_core::backup::export_config(&dest_path)
}

#[tauri::command]
fn import_config(src_path: String) -> Result<(), String> {
    log::info!("Tauri Command: import_config from {}", src_path);
    yiboflow_core::backup::import_config(&src_path)
}

#[tauri::command]
fn get_all_dictionaries() -> Result<Vec<yiboflow_core::dictionary::SmartDictionary>, String> {
    Ok(yiboflow_core::dictionary::get_all_dictionaries())
}

#[tauri::command]
fn save_dictionary(dict: yiboflow_core::dictionary::SmartDictionary) -> Result<(), String> {
    log::info!("Tauri Command: save_dictionary {}", dict.id);
    yiboflow_core::dictionary::save_dictionary(dict)
}

#[tauri::command]
fn delete_dictionary(id: String) -> Result<(), String> {
    log::info!("Tauri Command: delete_dictionary {}", id);
    yiboflow_core::dictionary::delete_dictionary(&id)
}
#[tauri::command]
fn get_window_under_cursor() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    unsafe {
        use std::ffi::OsString;
        use std::os::windows::ffi::OsStringExt;
        use windows::Win32::Foundation::{MAX_PATH, POINT};
        use windows::Win32::System::ProcessStatus::GetModuleFileNameExW;
        use windows::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            GetCursorPos, GetWindowThreadProcessId, WindowFromPoint,
        };

        let mut pt = POINT::default();
        if GetCursorPos(&mut pt).is_ok() {
            let hwnd = WindowFromPoint(pt);
            if hwnd.0 != std::ptr::null_mut() {
                let mut pid: u32 = 0;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                if pid != 0 {
                    if let Ok(process_handle) =
                        OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid)
                    {
                        let mut buf = [0u16; MAX_PATH as usize];
                        let len = GetModuleFileNameExW(Some(process_handle), None, &mut buf);
                        if len > 0 {
                            let mut current_exe = String::from_utf16_lossy(&buf[..len as usize]);
                            current_exe = current_exe.trim_matches('\0').to_string();
                            let exe_name =
                                current_exe.split('\\').last().unwrap_or("").to_lowercase();
                            return Ok(exe_name);
                        }
                    }
                }
            }
        }
    }
    Err("Could not find window under cursor".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Intialize Rust logger
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    // 预热词库引擎
    yiboflow_core::dictionary::init_and_load_dictionaries();
    yiboflow_core::dictionary::load_freq_cache();

    #[cfg(target_os = "windows")]
    yiboflow_core::hook_manager::start_global_hook();

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .manage(AppState {
            is_connected: Mutex::new(false),
            ws_tx: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            use tauri::Manager;

            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .tooltip("YiboFlow")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                        let _ = app.save_window_state(StateFlags::all());
                        std::process::exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            let main_window = app.get_webview_window("main").unwrap();

            let window_clone = main_window.clone();
            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                    let _ = window_clone.app_handle().save_window_state(StateFlags::all());
                    window_clone.hide().unwrap();
                    api.prevent_close();
                }
            });

            // Dynamically create the Hint window so window-state-plugin ignores it
            let hint_win = tauri::WebviewWindowBuilder::new(
                app,
                "hint",
                tauri::WebviewUrl::App("/#/hint".into()),
            )
            .title("FlowHint")
            .inner_size(300.0, 280.0)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .visible(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .build()
            .unwrap();

            // Get Win32 HWND for direct window management (no focus stealing)
            #[cfg(target_os = "windows")]
            let hint_hwnd = {
                use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongW, SetWindowLongW, GWL_EXSTYLE};
                let raw_hwnd = hint_win.hwnd().unwrap();
                let hwnd = windows::Win32::Foundation::HWND(raw_hwnd.0 as *mut _);
                unsafe {
                    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                    // WS_EX_NOACTIVATE = 0x08000000, WS_EX_TOOLWINDOW = 0x00000080
                    SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | 0x08000000i32 | 0x00000080i32);
                }
                hwnd
            };

            // Bridge FlowHint events from Hook to Tauri Frontend
            // Show/hide/position the hint window from Rust side using Win32 APIs
            // to guarantee NO focus stealing (SW_SHOWNOACTIVATE)
            let (hint_tx, hint_rx) = std::sync::mpsc::channel();
            yiboflow_core::hook_manager::set_hint_tx(hint_tx);
            let app_handle = app.handle().clone();
            #[cfg(target_os = "windows")]
            let hint_hwnd_raw = hint_hwnd.0 as isize; // isize is Send-safe
            std::thread::spawn(move || {
                use yiboflow_core::hook_manager::HintEvent;
                while let Ok(event) = hint_rx.recv() {
                    let ev_clone = event.clone();
                    let app_handle_clone = app_handle.clone();
                    
                    let _ = app_handle_clone.run_on_main_thread(move || {
                        #[cfg(target_os = "windows")]
                        {
                            let hint_hwnd = windows::Win32::Foundation::HWND(hint_hwnd_raw as *mut _);
                            use windows::Win32::UI::WindowsAndMessaging::{
                                ShowWindow, SetWindowPos, SW_SHOWNOACTIVATE, SW_HIDE,
                                HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOSIZE, SWP_SHOWWINDOW, SWP_NOZORDER,
                            };
                            match &ev_clone {
                                HintEvent::Show { candidates, x, y, .. } => {
                                    // Cap visible items at 8 for height; scrolling handles the rest
                                    let visible_count = candidates.len().min(8) as i32;
                                    // handle(18) + items(n*35) + footer(32) + padding(12) + border(4) = 66
                                    let inner_height = 70 + (visible_count * 35);
                                    let outer_height = inner_height;
                                    let outer_width = 300;

                                    let cfg = yiboflow_core::config::GLOBAL_CONFIG.read().unwrap();
                                    let (cfg_x, cfg_y) = (cfg.hint_fixed_x, cfg.hint_fixed_y);
                                    drop(cfg);

                                    // If user has pinned position, use it; otherwise follow caret
                                    let pos_x = if cfg_x != -1 { cfg_x } else { *x };
                                    let pos_y = if cfg_y != -1 { cfg_y } else { *y + 20 }; // offset below caret

                                    unsafe {
                                        // Position and show without activating
                                        SetWindowPos(
                                            hint_hwnd,
                                            Some(HWND_TOPMOST),
                                            pos_x, pos_y,
                                            outer_width, outer_height,
                                            SWP_NOACTIVATE | SWP_SHOWWINDOW,
                                        );
                                        ShowWindow(hint_hwnd, SW_SHOWNOACTIVATE);
                                    }
                                }
                                HintEvent::Hide => {
                                    unsafe {
                                        ShowWindow(hint_hwnd, SW_HIDE);
                                    }
                                }
                                HintEvent::MoveWindow { x, y } => {
                                    unsafe {
                                        SetWindowPos(
                                            hint_hwnd,
                                            None,
                                            *x, *y,
                                            0, 0,
                                            SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOZORDER,
                                        );
                                    }
                                }
                                _ => {}
                            }
                        }
                    });

                    // Always emit event to frontend for content updates
                    let _ = app_handle.emit("hint-event", event);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect_engine,
            register_engine,
            get_snippets,
            add_snippet,
            remove_snippet,
            get_autofills,
            add_autofill,
            remove_autofill,
            get_blocked_apps,
            add_blocked_app,
            remove_blocked_app,
            get_settings,
            update_settings,
            send_file_p2p,
            get_window_under_cursor,
            change_local_password,
            get_flow_rules,
            set_default_rules,
            upsert_app_rule,
            remove_app_rule,
            toggle_app_feature,
            toggle_default_feature,
            export_config,
            import_config,
            get_all_dictionaries,
            save_dictionary,
            delete_dictionary,
            diagnose_flowhint,
            accept_hint_candidate,
            dismiss_hint_window,
            update_hint_position,
            move_hint_window,
            reset_hint_position,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
