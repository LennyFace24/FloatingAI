use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::settings;

pub const FLOATING_LABEL: &str = "floating";
pub const CHAT_LABEL: &str = "chat";
pub const SETTINGS_LABEL: &str = "settings";

const CHAT_WIDTH: f64 = 480.0;
const CHAT_HEIGHT: f64 = 620.0;

fn ensure_chat_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(CHAT_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(app, CHAT_LABEL, WebviewUrl::App("index.html".into()))
        .title("Floating AI")
        .inner_size(CHAT_WIDTH, CHAT_HEIGHT)
        .resizable(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
}

fn ensure_settings_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(SETTINGS_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(app, SETTINGS_LABEL, WebviewUrl::App("index.html".into()))
        .title("Floating AI 设置")
        .inner_size(460.0, 560.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
}

fn chat_position_near_floating(app: &AppHandle) -> Option<tauri::PhysicalPosition<i32>> {
    let floating = app.get_webview_window(FLOATING_LABEL)?;
    let floating_pos = floating.outer_position().ok()?;
    let monitor = floating.current_monitor().ok().flatten()?;
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let scale = monitor.scale_factor();
    let chat_width = (CHAT_WIDTH * scale) as i32;
    let chat_height = (CHAT_HEIGHT * scale) as i32;

    let mut x = floating_pos.x + 16;
    let mut y = floating_pos.y + 16;

    let right_edge = monitor_pos.x + monitor_size.width as i32;
    let bottom_edge = monitor_pos.y + monitor_size.height as i32;

    if x + chat_width > right_edge {
        x = right_edge - chat_width;
    }
    if y + chat_height > bottom_edge {
        y = bottom_edge - chat_height;
    }
    x = x.max(monitor_pos.x);
    y = y.max(monitor_pos.y);

    Some(tauri::PhysicalPosition { x, y })
}

pub fn show_chat_panel(app: &AppHandle) -> tauri::Result<()> {
    let chat = ensure_chat_window(app)?;
    if let Some(position) = chat_position_near_floating(app) {
        let _ = chat.set_position(tauri::Position::Physical(position));
    } else {
        let _ = chat.center();
    }
    if let Some(floating) = app.get_webview_window(FLOATING_LABEL) {
        floating.hide()?;
    }
    chat.show()?;
    chat.set_focus()?;
    Ok(())
}

pub fn show_floating_ball(app: &AppHandle) -> tauri::Result<()> {
    if let Some(chat) = app.get_webview_window(CHAT_LABEL) {
        chat.hide()?;
    }
    if let Some(settings_window) = app.get_webview_window(SETTINGS_LABEL) {
        settings_window.hide()?;
    }
    if let Some(floating) = app.get_webview_window(FLOATING_LABEL) {
        let always_on_top = settings::load_settings(app)
            .map(|stored| stored.floating_always_on_top)
            .unwrap_or(true);
        let _ = floating.set_always_on_top(always_on_top);
        floating.show()?;
    }
    Ok(())
}

pub fn show_settings_panel(app: &AppHandle) -> tauri::Result<()> {
    let settings_window = ensure_settings_window(app)?;
    settings_window.center()?;
    settings_window.show()?;
    settings_window.set_focus()?;
    Ok(())
}

pub fn hide_all_windows(app: &AppHandle) -> tauri::Result<()> {
    for label in [FLOATING_LABEL, CHAT_LABEL, SETTINGS_LABEL] {
        if let Some(window) = app.get_webview_window(label) {
            window.hide()?;
        }
    }
    Ok(())
}

pub fn toggle_chat_panel(app: &AppHandle) -> tauri::Result<()> {
    let chat_visible = app
        .get_webview_window(CHAT_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    if chat_visible {
        show_floating_ball(app)
    } else {
        show_chat_panel(app)
    }
}

pub fn restore_floating_position(app: &AppHandle) {
    let Ok(stored) = settings::load_settings(app) else {
        return;
    };
    let Some(position) = stored.floating_position else {
        return;
    };
    if let Some(window) = app.get_webview_window(FLOATING_LABEL) {
        let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition {
            x: position.x,
            y: position.y,
        }));
    }
}

pub fn attach_floating_position_persistence(app: &AppHandle) {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return;
    };
    let app_handle = app.clone();
    let window_for_read = window.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Moved(_)) {
            if let Ok(position) = window_for_read.outer_position() {
                if let Ok(mut stored) = settings::load_settings(&app_handle) {
                    stored.floating_position = Some(settings::WindowPosition {
                        x: position.x,
                        y: position.y,
                    });
                    let _ = settings::save_settings(&app_handle, &stored);
                }
            }
        }
    });
}
