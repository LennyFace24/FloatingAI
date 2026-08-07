use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::settings;

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{POINT, RECT},
    Graphics::Gdi::{CreateRectRgn, SetWindowRgn},
    UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON},
        WindowsAndMessaging::{
            GetCursorPos, GetWindowRect, SetWindowPos, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE,
            SWP_NOCOPYBITS, SWP_NOSIZE, SWP_NOZORDER,
        },
    },
};

pub const FLOATING_LABEL: &str = "floating";

const FLOATING_SIZE: f64 = 50.0;
const SURFACE_WIDTH: f64 = 640.0;
const PROMPT_HEIGHT: f64 = 58.0;
const WAITING_SIZE: f64 = 50.0;
const RESPONSE_MIN_HEIGHT: f64 = 120.0;
const RESPONSE_MAX_HEIGHT: f64 = 560.0;
const BOTTOM_GAP: f64 = 72.0;
const SETTINGS_WIDTH: f64 = 460.0;
const SETTINGS_HEIGHT: f64 = 560.0;
static ANIMATION_GENERATION: AtomicU64 = AtomicU64::new(0);
static MOVE_PERSISTENCE_GENERATION: AtomicU64 = AtomicU64::new(0);
const MOVE_PERSISTENCE_DELAY: Duration = Duration::from_millis(120);

/// 前端渲染完成的确认信号：Rust emit `surface://changed` 后，前端渲染完目标 surface
/// 会调用 `surface_ready` 命令，动画据此才启动——避免动画开始而前端仍是旧内容。
static SURFACE_READY_TX: tokio::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>> =
    tokio::sync::Mutex::const_new(None);
/// 前端首次加载完成的标志：surface_ready 首次调用时置位。
/// 首次启动 WebView 未加载完时点击悬浮球，不做窗口动画（直接设目标尺寸），
/// 避免 resize 期间 WebView 内容未渲染导致的「输入框渲染一半/空白」。
static FRONTEND_READY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 前端调用的就绪信号（命令 `surface_ready`）。
#[tauri::command]
pub async fn surface_ready() {
    FRONTEND_READY.store(true, std::sync::atomic::Ordering::SeqCst);
    if let Some(sender) = SURFACE_READY_TX.lock().await.take() {
        let _ = sender.send(());
    }
}

/// 等待前端渲染完成（最多 3s——重历史（KaTeX/图片/大 DOM）渲染可能跨多帧；
/// 超时仍继续设尺寸，避免永久卡死）。
async fn wait_for_surface_ready() {
    let (sender, receiver) = tokio::sync::oneshot::channel::<()>();
    *SURFACE_READY_TX.lock().await = Some(sender);
    let _ = tokio::time::timeout(Duration::from_millis(3000), receiver).await;
}

/// 直接设目标尺寸（无窗口动画——全面采用前端 fade 切换）。
/// 等前端渲染完成再设，避免 resize 时 WebView2 内容未渲染导致的「渲染一半」。
async fn set_bounds_after_ready(
    app: &AppHandle,
    window: &WebviewWindow,
    target: WindowBounds,
) -> tauri::Result<AnimationOutcome> {
    wait_for_surface_ready().await;
    set_window_bounds(window, target)?;
    restore_transparent_background(app, window);
    Ok(AnimationOutcome::Completed)
}

fn is_latest_move(move_generation: u64, current_generation: u64) -> bool {
    move_generation == current_generation
}

fn drag_position(
    cursor: PhysicalPosition<i32>,
    offset: PhysicalPosition<i32>,
) -> PhysicalPosition<i32> {
    PhysicalPosition::new(cursor.x - offset.x, cursor.y - offset.y)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
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

#[derive(Clone, Copy)]
struct SurfaceGeometry {
    work_area_position: PhysicalPosition<i32>,
    work_area_size: PhysicalSize<u32>,
    scale_factor: f64,
}

impl SurfaceGeometry {
    fn centered_bounds(self, current: WindowBounds, logical_width: f64, logical_height: f64) -> WindowBounds {
        let scale = self.scale_factor;
        let width = ((logical_width * scale).round() as u32).min(self.work_area_size.width);
        let height = (logical_height * scale).round() as u32;
        let current_center = (
            current.position.x + current.size.width as i32 / 2,
            current.position.y + current.size.height as i32 / 2,
        );
        let max_x = self.work_area_position.x + self.work_area_size.width as i32 - width as i32;
        let max_y = self.work_area_position.y + self.work_area_size.height as i32 - height as i32;
        WindowBounds {
            position: PhysicalPosition::new(
                (current_center.0 - width as i32 / 2)
                    .clamp(self.work_area_position.x, max_x),
                (current_center.1 - height as i32 / 2)
                    .clamp(self.work_area_position.y, max_y),
            ),
            size: PhysicalSize::new(width, height),
        }
    }



    fn response_bounds(self, content_height: f64) -> WindowBounds {
        let width = ((SURFACE_WIDTH * self.scale_factor).round() as u32).min(self.work_area_size.width);
        let height = (content_height.clamp(RESPONSE_MIN_HEIGHT, RESPONSE_MAX_HEIGHT) * self.scale_factor).round() as u32;
        let bottom_gap = (BOTTOM_GAP * self.scale_factor).round() as i32;
        let position = PhysicalPosition::new(
            self.work_area_position.x + (self.work_area_size.width - width) as i32 / 2,
            self.work_area_position.y + self.work_area_size.height as i32 - bottom_gap - height as i32,
        );
        WindowBounds { position, size: PhysicalSize::new(width, height) }
    }
    fn settings_bounds(self, current: WindowBounds) -> WindowBounds {
        let width = ((SETTINGS_WIDTH * self.scale_factor).round() as u32)
            .min(self.work_area_size.width);
        let height = ((SETTINGS_HEIGHT * self.scale_factor).round() as u32)
            .min(self.work_area_size.height);
        let max_x = self.work_area_position.x + self.work_area_size.width as i32 - width as i32;
        let max_y = self.work_area_position.y + self.work_area_size.height as i32 - height as i32;
        WindowBounds {
            position: PhysicalPosition::new(
                current.position.x.clamp(self.work_area_position.x, max_x),
                current.position.y.clamp(self.work_area_position.y, max_y),
            ),
            size: PhysicalSize::new(width, height),
        }
    }
}
fn surface_geometry(window: &WebviewWindow) -> tauri::Result<SurfaceGeometry> {
    let monitor = window
        .current_monitor()?
        .ok_or(tauri::Error::WindowNotFound)?;
    let work_area = monitor.work_area();
    Ok(SurfaceGeometry {
        work_area_position: work_area.position,
        work_area_size: work_area.size,
        scale_factor: monitor.scale_factor(),
    })
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AnimationOutcome {
    Completed,
    Cancelled,
}

impl AnimationOutcome {
    fn should_finish_transition(self) -> bool {
        self == Self::Completed
    }
}



fn cancel_window_animation() {
    ANIMATION_GENERATION.fetch_add(1, Ordering::SeqCst);
}


#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
enum WindowMode {
    Floating,
    Prompt,
    Waiting,
    Response,
    Settings,
    Hidden,
    Transitioning,
}

static WINDOW_MODE: AtomicU64 = AtomicU64::new(WindowMode::Floating as u64);

fn current_window_mode() -> WindowMode {
    match WINDOW_MODE.load(Ordering::SeqCst) {
        value if value == WindowMode::Prompt as u64 => WindowMode::Prompt,
        value if value == WindowMode::Waiting as u64 => WindowMode::Waiting,
        value if value == WindowMode::Response as u64 => WindowMode::Response,
        value if value == WindowMode::Settings as u64 => WindowMode::Settings,
        value if value == WindowMode::Hidden as u64 => WindowMode::Hidden,
        value if value == WindowMode::Transitioning as u64 => WindowMode::Transitioning,
        _ => WindowMode::Floating,
    }
}

fn set_window_mode(mode: WindowMode) {
    WINDOW_MODE.store(mode as u64, Ordering::SeqCst);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ToggleAction {
    Collapse,
    RequestShow,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ToggleReservation {
    previous: WindowMode,
    action: ToggleAction,
}

fn finalize_toggle(reservation: ToggleReservation, successful_mode: Option<WindowMode>) -> WindowMode {
    successful_mode.unwrap_or(reservation.previous)
}

fn toggle_action(mode: WindowMode) -> ToggleAction {
    match mode {
        WindowMode::Floating | WindowMode::Hidden => ToggleAction::RequestShow,
        WindowMode::Prompt | WindowMode::Waiting | WindowMode::Response | WindowMode::Settings => {
            ToggleAction::Collapse
        }
        WindowMode::Transitioning => unreachable!("transitioning mode has no toggle action"),
    }
}

fn begin_toggle(mode: WindowMode) -> (WindowMode, Option<ToggleAction>) {
    if mode == WindowMode::Transitioning {
        (mode, None)
    } else {
        (WindowMode::Transitioning, Some(toggle_action(mode)))
    }
}

fn completed_mode(target: WindowMode, outcome: AnimationOutcome) -> Option<WindowMode> {
    outcome.should_finish_transition().then_some(target)
}

fn reserve_toggle() -> Option<ToggleReservation> {
    loop {
        let current = current_window_mode();
        let (reserved, action) = begin_toggle(current);
        let action = action?;
        if WINDOW_MODE.compare_exchange(
            current as u64,
            reserved as u64,
            Ordering::SeqCst,
            Ordering::SeqCst,
        ).is_ok() {
            return Some(ToggleReservation { previous: current, action });
        }
    }
}

fn finish_reserved_toggle(reservation: ToggleReservation, successful_mode: Option<WindowMode>) {
    let final_mode = finalize_toggle(reservation, successful_mode);
    let _ = WINDOW_MODE.compare_exchange(
        WindowMode::Transitioning as u64,
        final_mode as u64,
        Ordering::SeqCst,
        Ordering::SeqCst,
    );
}

/// resize 后重设 WebView2 默认背景透明：WebView2 在窗口 resize（表面重建）后
/// DefaultBackgroundColor 会重置为默认白色，导致圆角外透明区域短暂显示白色尖角。
fn restore_transparent_background(app: &AppHandle, window: &WebviewWindow) {
    let app = app.clone();
    let webview = window.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = webview
            .as_ref()
            .set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
    });
}


pub async fn start_floating_drag(app: &AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound.to_string());
    };

    #[cfg(windows)]
    {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        return tauri::async_runtime::spawn_blocking(move || {
            let mut cursor = POINT { x: 0, y: 0 };
            let mut window_rect = unsafe { std::mem::zeroed() };
            if unsafe { GetCursorPos(&mut cursor) } == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            if unsafe { GetWindowRect(hwnd as _, &mut window_rect) } == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }

            let offset = PhysicalPosition::new(
                cursor.x - window_rect.left,
                cursor.y - window_rect.top,
            );
            while unsafe { GetAsyncKeyState(VK_LBUTTON as i32) } < 0 {
                if unsafe { GetCursorPos(&mut cursor) } == 0 {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                let position = drag_position(
                    PhysicalPosition::new(cursor.x, cursor.y),
                    offset,
                );
                if unsafe {
                    SetWindowPos(
                        hwnd as _,
                        std::ptr::null_mut(),
                        position.x,
                        position.y,
                        0,
                        0,
                        SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER,
                    )
                } == 0
                {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                std::thread::sleep(Duration::from_millis(2));
            }
            Ok(())
        })
        .await
        .map_err(|error| error.to_string())?;
    }

    #[cfg(not(windows))]
    {
        window.start_dragging().map_err(|error| error.to_string())
    }
}
pub async fn show_prompt_bar(app: &AppHandle, reduced_motion: bool) -> tauri::Result<()> {
    let outcome = show_bottom_anchored(app, reduced_motion, SURFACE_WIDTH, PROMPT_HEIGHT).await?;
    if let Some(mode) = completed_mode(WindowMode::Prompt, outcome) {
        set_window_mode(mode);
    }
    Ok(())
}
pub async fn show_waiting_ball(app: &AppHandle, reduced_motion: bool) -> tauri::Result<()> {
    let outcome = show_bottom_anchored(app, reduced_motion, WAITING_SIZE, WAITING_SIZE).await?;
    if let Some(mode) = completed_mode(WindowMode::Waiting, outcome) {
        set_window_mode(mode);
    }
    Ok(())
}
pub async fn resize_response_panel(
    app: &AppHandle,
    content_height: f64,
    reduced_motion: bool,
) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };
    let current = current_bounds(&window)?;
    let target = surface_geometry(&window)?.response_bounds(content_height);
    // 无窗口动画：直接设目标尺寸（fade 由前端完成）。流式时前端持续渲染中，
    // 不等就绪（避免延迟），直接 resize 视口一次到位。
    set_window_bounds(&window, target)?;
    restore_transparent_background(app, &window);
    set_window_mode(WindowMode::Response);
    Ok(())
}
pub async fn show_response_panel(
    app: &AppHandle,
    content_height: f64,
    reduced_motion: bool,
) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };
    let from_settings = current_window_mode() == WindowMode::Settings;
    window.set_resizable(false)?;
    if !from_settings {
        window.emit("surface://changed", "chat")?;
        window.show()?;
    }
    resize_response_panel(app, content_height, reduced_motion).await?;
    if from_settings {
        window.emit("surface://changed", "chat")?;
        window.show()?;
    }
    Ok(())
}

async fn show_bottom_anchored(
    app: &AppHandle,
    reduced_motion: bool,
    logical_width: f64,
    logical_height: f64,
) -> tauri::Result<AnimationOutcome> {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };
    let geometry = surface_geometry(&window)?;
    let current = current_bounds(&window)?;
    let from_settings = current_window_mode() == WindowMode::Settings;
    // 从设置页返回：settings_bounds 打开时保持输入条 position（左边对齐），
    // 关闭时若用 centered_bounds（中心对齐）会因宽度 460→640 左移 (640-460)/2。
    // 保持 position 的 x 不变、仅 y 底部锚定，往返零漂移。
    let target = if from_settings {
        let centered = geometry.centered_bounds(current, logical_width, logical_height);
        WindowBounds {
            position: PhysicalPosition::new(current.position.x, centered.position.y),
            size: centered.size,
        }
    } else {
        geometry.centered_bounds(current, logical_width, logical_height)
    };
    apply_always_on_top(app, &window);
    window.set_resizable(false)?;
    // 动画前切换前端到目标 surface：动画展示的是目标 UI 本身，而非旧 surface 的裁切。
    let outcome = set_bounds_after_ready(app, &window, target).await?;
    if outcome.should_finish_transition() {
        window.set_focus()?;
    }
    Ok(outcome)
}

pub async fn show_chat_panel(app: &AppHandle, reduced_motion: bool) -> tauri::Result<()> {
    show_prompt_bar(app, reduced_motion).await
}
fn apply_always_on_top(app: &AppHandle, window: &WebviewWindow) {
    let always_on_top = settings::load_settings(app)
        .map(|stored| stored.floating_always_on_top)
        .unwrap_or(false);
    let _ = window.set_always_on_top(always_on_top);
}

pub async fn show_floating_ball(app: &AppHandle, reduced_motion: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };
    let current = current_bounds(&window)?;
    let size = logical_size(&window, FLOATING_SIZE, FLOATING_SIZE)?;
    // 收起时位置中心对齐当前窗口中心（与展开的 centered_bounds 对称），
    // 避免每次开关窗口累积左移漂移
    let target = WindowBounds {
        position: PhysicalPosition::new(
            current.position.x + current.size.width as i32 / 2 - size.width as i32 / 2,
            current.position.y + current.size.height as i32 / 2 - size.height as i32 / 2,
        ),
        size,
    };
    window.set_resizable(false)?;
    // 切换前端到悬浮球，等渲染完成再直接设尺寸（无窗口动画——fade 由前端完成）
    window.emit("surface://changed", "floating")?;
    apply_always_on_top(app, &window);
    window.show()?;
    let outcome = set_bounds_after_ready(app, &window, target).await?;
    if !outcome.should_finish_transition() {
        return Ok(());
    }
    window.set_focus()?;
    set_window_mode(WindowMode::Floating);
    Ok(())
}

pub async fn show_settings_panel(app: &AppHandle, reduced_motion: bool) -> tauri::Result<()> {
    cancel_window_animation();

    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };
    apply_always_on_top(app, &window);
    let current = current_bounds(&window)?;
    let target = surface_geometry(&window)?.settings_bounds(current);
    window.set_resizable(false)?;
    window.emit("surface://changed", "settings")?;
    window.show()?;
    // 等前端渲染（设置页懒加载 Suspense）再直接设尺寸（无窗口动画——fade 由前端完成）
    let outcome = set_bounds_after_ready(app, &window, target).await?;
    if outcome.should_finish_transition() {
        window.set_focus()?;
        set_window_mode(WindowMode::Settings);
    }
    Ok(())
}

pub fn hide_all_windows(app: &AppHandle) -> tauri::Result<()> {
    cancel_window_animation();
    if let Some(window) = app.get_webview_window(FLOATING_LABEL) {
        window.hide()?;
    }
    set_window_mode(WindowMode::Hidden);
    Ok(())
}

pub fn request_show_chat_panel(app: &AppHandle) {
    let _ = app.emit("surface://show-requested", ());
}

/// 快速提问：读取剪贴板文本，非空则唤起输入条并预填（quick-ask://prefill 事件）。
pub fn request_quick_ask(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Some(text) = crate::shortcuts::read_clipboard_text(&app) else {
            return;
        };
        if show_prompt_bar(&app, false).await.is_ok() {
            let _ = app.emit("quick-ask://prefill", text);
        }
    });
}

pub fn request_show_floating_ball(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = show_floating_ball(&app, false).await;
    });
}

pub fn request_toggle_chat_panel(app: &AppHandle) {
    let Some(reservation) = reserve_toggle() else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let successful_mode = match reservation.action {
            ToggleAction::Collapse => show_floating_ball(&app, false)
                .await
                .ok()
                .map(|_| WindowMode::Floating),
            ToggleAction::RequestShow => app
                .emit("surface://show-requested", ())
                .ok()
                .map(|_| reservation.previous),
        };
        finish_reserved_toggle(reservation, successful_mode);
    });
}

pub fn restore_floating_position(app: &AppHandle) {
    let Ok(stored) = settings::load_settings(app) else {
        return;
    };
    let Some(position) = stored.floating_position else {
        return;
    };
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return;
    };
    // 记录位置所在显示器仍存在时直接恢复；显示器被拔掉（工作区原点失配）则回退主屏，
    // 避免悬浮球被恢复到不存在的屏幕上。
    let monitor_ok = window
        .current_monitor()
        .ok()
        .flatten()
        .is_some_and(|monitor| {
            let area = monitor.work_area();
            area.position.x == position.monitor_origin_x
                && area.position.y == position.monitor_origin_y
        });
    let (x, y) = if monitor_ok {
        (position.x, position.y)
    } else {
        // 回退：主屏工作区左上角（保持悬浮球可见）
        let primary = window
            .primary_monitor()
            .ok()
            .flatten()
            .map(|monitor| *monitor.work_area())
            .unwrap_or(tauri::PhysicalRect {
                position: PhysicalPosition::new(0, 0),
                size: PhysicalSize::new(0, 0),
            });
        (primary.position.x, primary.position.y)
    };
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

pub fn attach_floating_position_persistence(app: &AppHandle) {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return;
    };
    let app_handle = app.clone();
    let window_for_read = window.clone();
    window.on_window_event(move |event| {
        let tauri::WindowEvent::Moved(position) = event else {
            return;
        };
        if window_for_read
            .inner_size()
            .is_ok_and(|size| size.width > 100)
        {
            return;
        }

        let generation = MOVE_PERSISTENCE_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let position = *position;
        let app_handle = app_handle.clone();
        // 在闭包内（spawn 外）取显示器工作区原点，避免把 window_for_read move 进异步块
        let monitor_origin = window_for_read
            .current_monitor()
            .ok()
            .flatten()
            .map(|monitor| {
                let area = monitor.work_area();
                (area.position.x, area.position.y)
            });
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(MOVE_PERSISTENCE_DELAY).await;
            if !is_latest_move(
                generation,
                MOVE_PERSISTENCE_GENERATION.load(Ordering::SeqCst),
            ) {
                return;
            }
            if let Ok(mut stored) = settings::load_settings(&app_handle) {
                stored.floating_position = Some(settings::WindowPosition {
                    x: position.x,
                    y: position.y,
                    monitor_origin_x: monitor_origin.map(|(x, _)| x).unwrap_or(0),
                    monitor_origin_y: monitor_origin.map(|(_, y)| y).unwrap_or(0),
                });
                let _ = settings::save_settings(&app_handle, &stored);
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;


    #[test]
    fn toggle_treats_waiting_and_every_visible_surface_as_expanded() {
        for mode in [WindowMode::Prompt, WindowMode::Waiting, WindowMode::Response, WindowMode::Settings] {
            assert_eq!(toggle_action(mode), ToggleAction::Collapse);
        }
        for mode in [WindowMode::Floating, WindowMode::Hidden] {
            assert_eq!(toggle_action(mode), ToggleAction::RequestShow);
        }
    }
    #[test]
    fn cancelled_transition_does_not_publish_its_target_mode() {
        assert_eq!(completed_mode(WindowMode::Prompt, AnimationOutcome::Cancelled), None);
        assert_eq!(completed_mode(WindowMode::Prompt, AnimationOutcome::Completed), Some(WindowMode::Prompt));
    }

    #[test]
    fn rapid_toggle_reserves_the_first_transition() {
        assert_eq!(begin_toggle(WindowMode::Waiting), (WindowMode::Transitioning, Some(ToggleAction::Collapse)));
        assert_eq!(begin_toggle(WindowMode::Transitioning), (WindowMode::Transitioning, None));
    }
    #[test]
    fn failed_toggle_rolls_back_and_can_be_reserved_again() {
        let reservation = ToggleReservation { previous: WindowMode::Waiting, action: ToggleAction::Collapse };
        assert_eq!(finalize_toggle(reservation, None), WindowMode::Waiting);
        assert_eq!(begin_toggle(finalize_toggle(reservation, None)).1, Some(ToggleAction::Collapse));
        assert_eq!(finalize_toggle(reservation, Some(WindowMode::Floating)), WindowMode::Floating);
    }

    #[test]
    fn drag_persistence_only_commits_latest_move() {
        assert!(!is_latest_move(4, 5));
        assert!(is_latest_move(5, 5));
    }

    #[test]
    fn drag_position_preserves_cursor_offset() {
        assert_eq!(
            drag_position(PhysicalPosition::new(125, 240), PhysicalPosition::new(25, 40)),
            PhysicalPosition::new(100, 200),
        );
    }


    fn geometry(scale_factor: f64) -> SurfaceGeometry {
        SurfaceGeometry {
            work_area_position: PhysicalPosition::new(100, 50),
            work_area_size: PhysicalSize::new(1920, 1080),
            scale_factor,
        }
    }

    #[test]
    fn bottom_anchored_prompt_at_1x() {
        let bounds = geometry(1.0).centered_bounds(WindowBounds { position: PhysicalPosition::new(400, 300), size: PhysicalSize::new(50, 50) }, 640.0, 58.0);
        assert_eq!(bounds.position, PhysicalPosition::new(105, 296));
    }

    #[test]
    fn bottom_anchored_modes_at_1_5x() {
        let geometry = geometry(1.5);
        assert_eq!(
            geometry.centered_bounds(WindowBounds { position: PhysicalPosition::new(400, 300), size: PhysicalSize::new(50, 50) }, 640.0, 58.0),
            WindowBounds {
                position: PhysicalPosition::new(100, 282),
                size: PhysicalSize::new(960, 87),
            }
        );
        assert_eq!(
            geometry.centered_bounds(WindowBounds { position: PhysicalPosition::new(400, 300), size: PhysicalSize::new(50, 50) }, 50.0, 50.0),
            WindowBounds {
                position: PhysicalPosition::new(388, 288),
                size: PhysicalSize::new(75, 75),
            }
        );
    }

    #[test]
    fn bottom_anchored_response_clamps_minimum_height() {
        let bounds = geometry(1.0).response_bounds(40.0);
        assert_eq!(bounds.position, PhysicalPosition::new(740, 938));
        assert_eq!(bounds.size, PhysicalSize::new(640, 120));
    }

    #[test]
    fn bottom_anchored_response_clamps_maximum_and_keeps_bottom_fixed() {
        let geometry = geometry(1.0);
        let minimum = geometry.response_bounds(120.0);
        let maximum = geometry.response_bounds(700.0);
        assert_eq!(maximum.position, PhysicalPosition::new(740, 498));
        assert_eq!(maximum.size, PhysicalSize::new(640, 560));
        assert_eq!(minimum.position.y + minimum.size.height as i32, 1058);
        assert_eq!(maximum.position.y + maximum.size.height as i32, 1058);
    }

    #[test]
    fn bottom_anchored_response_scales_requested_height() {
        let bounds = geometry(1.5).response_bounds(200.0);
        assert_eq!(bounds.position, PhysicalPosition::new(580, 722));
        assert_eq!(bounds.size, PhysicalSize::new(960, 300));
    }

    #[test]
    fn bottom_anchored_width_is_limited_to_small_work_area() {
        let geometry = SurfaceGeometry {
            work_area_position: PhysicalPosition::new(-900, 20),
            work_area_size: PhysicalSize::new(600, 800),
            scale_factor: 1.0,
        };
        let bounds = geometry.centered_bounds(WindowBounds { position: PhysicalPosition::new(-800, 400), size: PhysicalSize::new(50, 50) }, 640.0, 58.0);
        assert_eq!(bounds.position.x, -900);
        assert_eq!(bounds.size.width, 600);
    }

    #[test]
    fn settings_bounds_clamp_bottom_and_right_edges() {
        let current = WindowBounds {
            position: PhysicalPosition::new(1800, 1000),
            size: PhysicalSize::new(640, 58),
        };
        let bounds = geometry(1.0).settings_bounds(current);
        assert_eq!(bounds.position, PhysicalPosition::new(1560, 570));
        assert_eq!(bounds.size, PhysicalSize::new(460, 560));
    }

    #[test]
    fn settings_bounds_support_negative_monitor_coordinates_and_scale() {
        let geometry = SurfaceGeometry {
            work_area_position: PhysicalPosition::new(-1920, -120),
            work_area_size: PhysicalSize::new(1920, 1080),
            scale_factor: 1.5,
        };
        let current = WindowBounds {
            position: PhysicalPosition::new(-2000, 800),
            size: PhysicalSize::new(75, 75),
        };
        let bounds = geometry.settings_bounds(current);
        assert_eq!(bounds.position, PhysicalPosition::new(-1920, 120));
        assert_eq!(bounds.size, PhysicalSize::new(690, 840));
    }
}
