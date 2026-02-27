// Tauri uses `tao` for windowing and `tray-icon` for system trays.
// This prototype proves we can run a background event loop without creating any Window.
// The Rust process (Core) will simply park in the event loop and handle tray events/shortcuts.

use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tray_icon::{
    menu::{Menu, MenuItem, MenuEvent},
    Icon, TrayIconBuilder,
};

fn main() {
    println!("Starting YiboFlow headless tray core...");

    let event_loop = EventLoopBuilder::new().build();

    let tray_menu = Menu::new();
    let quit_i = MenuItem::new("Quit YiboFlow Core", true, None);
    let config_i = MenuItem::new("Open Settings (Tauri UI)", true, None);
    tray_menu.append_items(&[&config_i, &quit_i]).unwrap();

    // Use a placeholder 1x1 transparent icon just to appease the builder.
    // In actual Tauri, use app icons.
    let icon = Icon::from_rgba(vec![0; 4], 1, 1).unwrap();

    let _tray_icon = TrayIconBuilder::new()
        .with_menu(Box::new(tray_menu))
        .with_tooltip("YiboFlow Core Engine")
        .with_icon(icon)
        .build()
        .unwrap();

    let menu_channel = MenuEvent::receiver();

    println!("Tray icon registered. Waiting for events in Headless mode...");

    event_loop.run(move |_event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        if let Ok(event) = menu_channel.try_recv() {
            if event.id == quit_i.id() {
                println!("Quit requested. Exiting core...");
                *control_flow = ControlFlow::Exit;
            } else if event.id == config_i.id() {
                println!("Starting Tauri UI configuration window via IPC or process spawn...");
                // Note: Normally core will spawn the Tauri UI process or signal it via Named Pipe.
            }
        }
    });
}
