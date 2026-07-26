use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::settings;

#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};

pub const FLOATING_LABEL: &str = "floating";

const FLOATING_SIZE: f64 = 50.0;
const CHAT_WIDTH: f64 = 480.0;
const CHAT_HEIGHT: f64 = 620.0;
const SETTINGS_WIDTH: f64 = 460.0;
const SETTINGS_HEIGHT: f64 = 560.0;
const EXPAND_DURATION: Duration = Duration::from_millis(280);
const COLLAPSE_DURATION: Duration = Duration::from_millis(180);
const FRAME_DURATION: Duration = Duration::from_millis(8);

static ANIMATION_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy)]
struct WindowBounds {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
}

fn current_bounds(window: &WebviewWindow) -> tauri::Result<WindowBounds> {
    Ok(WindowBounds {
        position: window.outer_position()?,
        size: window.outer_size()?,
    })
}

fn expanded_bounds(window: &WebviewWindow) -> tauri::Result<WindowBounds> {
    let current = current_bounds(window)?;
    let Some(monitor) = window.current_monitor()? else {
        return Ok(WindowBounds {
            position: current.position,
            size: PhysicalSize::new(CHAT_WIDTH as u32, CHAT_HEIGHT as u32),
        });
    };
    let scale = monitor.scale_factor();
    let size = PhysicalSize::new((CHAT_WIDTH * scale) as u32, (CHAT_HEIGHT * scale) as u32);
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let right = monitor_position.x + monitor_size.width as i32;
    let bottom = monitor_position.y + monitor_size.height as i32;
    let position = PhysicalPosition::new(
        current
            .position
            .x
            .min(right - size.width as i32)
            .max(monitor_position.x),
        current
            .position
            .y
            .min(bottom - size.height as i32)
            .max(monitor_position.y),
    );
    Ok(WindowBounds { position, size })
}

fn logical_size(
    window: &WebviewWindow,
    width: f64,
    height: f64,
) -> tauri::Result<PhysicalSize<u32>> {
    let scale = window.scale_factor()?;
    Ok(PhysicalSize::new(
        (width * scale) as u32,
        (height * scale) as u32,
    ))
}

fn interpolate_i32(start: i32, end: i32, progress: f64) -> i32 {
    start + ((end - start) as f64 * progress).round() as i32
}

fn interpolate_u32(start: u32, end: u32, progress: f64) -> u32 {
    (start as f64 + (end as f64 - start as f64) * progress).round() as u32
}

fn ease_out_cubic(progress: f64) -> f64 {
    1.0 - (1.0 - progress).powi(3)
}

fn set_window_bounds(window: &WebviewWindow, bounds: WindowBounds) -> tauri::Result<()> {
    #[cfg(windows)]
    {
        let hwnd = window.hwnd()?;
        let result = unsafe {
            SetWindowPos(
                hwnd.0 as _,
                std::ptr::null_mut(),
                bounds.position.x,
                bounds.position.y,
                bounds.size.width as i32,
                bounds.size.height as i32,
                SWP_NOACTIVATE | SWP_NOZORDER,
            )
        };
        if result == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        return Ok(());
    }

    #[cfg(not(windows))]
    {
        window.set_position(bounds.position)?;
        window.set_size(bounds.size)?;
        Ok(())
    }
}

async fn animate_window_bounds(
    window: &WebviewWindow,
    target: WindowBounds,
    duration: Duration,
    reduced_motion: bool,
) -> tauri::Result<()> {
    let generation = ANIMATION_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let start = current_bounds(window)?;

    if reduced_motion {
        set_window_bounds(window, target)?;
        return Ok(());
    }

    let started = Instant::now();
    loop {
        if ANIMATION_GENERATION.load(Ordering::SeqCst) != generation {
            return Ok(());
        }
        let raw_progress = (started.elapsed().as_secs_f64() / duration.as_secs_f64()).min(1.0);
        let progress = ease_out_cubic(raw_progress);
        set_window_bounds(
            window,
            WindowBounds {
                position: PhysicalPosition::new(
                    interpolate_i32(start.position.x, target.position.x, progress),
                    interpolate_i32(start.position.y, target.position.y, progress),
                ),
                size: PhysicalSize::new(
                    interpolate_u32(start.size.width, target.size.width, progress),
                    interpolate_u32(start.size.height, target.size.height, progress),
                ),
            },
        )?;
        if raw_progress >= 1.0 {
            return Ok(());
        }
        tokio::time::sleep(FRAME_DURATION).await;
    }
}

pub async fn show_chat_panel(app: &AppHandle, reduced_motion: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };
    let target = expanded_bounds(&window)?;
    window.set_resizable(false)?;
    window.emit("surface://changed", "chat")?;
    window.show()?;
    animate_window_bounds(&window, target, EXPAND_DURATION, reduced_motion).await?;
    window.set_resizable(true)?;
    window.set_focus()?;
    Ok(())
}

pub async fn show_floating_ball(app: &AppHandle, reduced_motion: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };
    let current = current_bounds(&window)?;
    let size = logical_size(&window, FLOATING_SIZE, FLOATING_SIZE)?;
    let target = WindowBounds {
        position: current.position,
        size,
    };
    window.set_resizable(false)?;
    animate_window_bounds(&window, target, COLLAPSE_DURATION, reduced_motion).await?;
    window.emit("surface://changed", "floating")?;
    let always_on_top = settings::load_settings(app)
        .map(|stored| stored.floating_always_on_top)
        .unwrap_or(true);
    window.set_always_on_top(always_on_top)?;
    window.show()?;
    window.set_focus()?;
    Ok(())
}

pub fn show_settings_panel(app: &AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };
    window.set_size(logical_size(&window, SETTINGS_WIDTH, SETTINGS_HEIGHT)?)?;
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

pub fn request_show_chat_panel(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = show_chat_panel(&app, false).await;
    });
}

pub fn request_show_floating_ball(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = show_floating_ball(&app, false).await;
    });
}

pub fn request_toggle_chat_panel(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let is_expanded = app
            .get_webview_window(FLOATING_LABEL)
            .and_then(|window| window.inner_size().ok())
            .is_some_and(|size| size.width > 100);
        if is_expanded {
            let _ = show_floating_ball(&app, false).await;
        } else {
            let _ = show_chat_panel(&app, false).await;
        }
    });
}

pub fn restore_floating_position(app: &AppHandle) {
    let Ok(stored) = settings::load_settings(app) else {
        return;
    };
    let Some(position) = stored.floating_position else {
        return;
    };
    if let Some(window) = app.get_webview_window(FLOATING_LABEL) {
        let _ = window.set_position(PhysicalPosition::new(position.x, position.y));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn easing_starts_and_finishes_at_bounds() {
        assert_eq!(ease_out_cubic(0.0), 0.0);
        assert_eq!(ease_out_cubic(1.0), 1.0);
        assert!(ease_out_cubic(0.5) > 0.5);
    }

    #[test]
    fn animation_frame_budget_supports_high_refresh_displays() {
        assert!(FRAME_DURATION <= Duration::from_millis(9));
    }

    #[test]
    fn interpolation_reaches_target() {
        assert_eq!(interpolate_i32(10, 100, 1.0), 100);
        assert_eq!(interpolate_u32(50, 480, 1.0), 480);
    }
}
