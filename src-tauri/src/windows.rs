use tauri::{AppHandle, Emitter, Manager};

use crate::settings;

pub const FLOATING_LABEL: &str = "floating";

const FLOATING_SIZE: f64 = 50.0;
const CHAT_WIDTH: f64 = 480.0;
const CHAT_HEIGHT: f64 = 620.0;


fn expanded_position(app: &AppHandle) -> Option<tauri::PhysicalPosition<i32>> {
    let window = app.get_webview_window(FLOATING_LABEL)?;
    let current = window.outer_position().ok()?;
    let monitor = window.current_monitor().ok().flatten()?;
    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let scale = monitor.scale_factor();
    let width = (CHAT_WIDTH * scale) as i32;
    let height = (CHAT_HEIGHT * scale) as i32;

    let right_edge = monitor_pos.x + monitor_size.width as i32;
    let bottom_edge = monitor_pos.y + monitor_size.height as i32;
    let x = current.x.min(right_edge - width).max(monitor_pos.x);
    let y = current.y.min(bottom_edge - height).max(monitor_pos.y);

    Some(tauri::PhysicalPosition { x, y })
}

pub fn show_chat_panel(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };

    if let Some(position) = expanded_position(app) {
        window.set_position(tauri::Position::Physical(position))?;
    }
    window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: CHAT_WIDTH,
        height: CHAT_HEIGHT,
    }))?;
    window.set_resizable(true)?;
    window.emit("surface://changed", "chat")?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

pub fn show_floating_ball(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };

    let always_on_top = settings::load_settings(app)
        .map(|stored| stored.floating_always_on_top)
        .unwrap_or(true);
    window.emit("surface://changed", "floating")?;
    window.set_resizable(false)?;
    window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: FLOATING_SIZE,
        height: FLOATING_SIZE,
    }))?;
    window.set_always_on_top(always_on_top)?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

pub fn show_settings_panel(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };
    window.set_size(tauri::Size::Logical(tauri::LogicalSize {
        width: 460.0,
        height: 560.0,
    }))?;
    window.set_resizable(false)?;
    window.emit("surface://changed", "settings")?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

pub fn hide_all_windows(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(FLOATING_LABEL) {
        window.hide()?;
    }
    Ok(())
}

pub fn toggle_chat_panel(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };
    let size = window.inner_size()?;
    if size.width > 100 {
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
            if let Ok(size) = window_for_read.inner_size() {
                if size.width > 100 {
                    return;
                }
            }
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
