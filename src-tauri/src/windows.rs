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
const EXPAND_DURATION: Duration = Duration::from_millis(280);
const COLLAPSE_DURATION: Duration = Duration::from_millis(180);

const FRAME_DURATION: Duration = Duration::from_millis(8);
static ANIMATION_GENERATION: AtomicU64 = AtomicU64::new(0);
static MOVE_PERSISTENCE_GENERATION: AtomicU64 = AtomicU64::new(0);
const MOVE_PERSISTENCE_DELAY: Duration = Duration::from_millis(120);

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
/// 跨平台的矩形（Linux 上无 Windows RECT；Windows 动画循环里转 RECT）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RegionRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

struct ExpandGeometry {
    /// 窗口起始位置：最终窗口中心对齐当前窗口中心
    anchor_position: PhysicalPosition<i32>,
    /// 初始可见矩形（窗口内坐标），以窗口中心为中心、等于当前窗口尺寸
    initial_region: RegionRect,
    /// 最终可见矩形 = 整个窗口客户区
    full_region: RegionRect,
}

fn expand_geometry(current: WindowBounds, target: WindowBounds) -> ExpandGeometry {
    let anchor_position = PhysicalPosition::new(
        current.position.x + current.size.width as i32 / 2 - target.size.width as i32 / 2,
        current.position.y + current.size.height as i32 / 2 - target.size.height as i32 / 2,
    );
    let left = ((target.size.width as f64 - current.size.width as f64) / 2.0).round() as i32;
    let top = ((target.size.height as f64 - current.size.height as f64) / 2.0).round() as i32;
    let initial_region = RegionRect {
        left,
        top,
        right: left + current.size.width as i32,
        bottom: top + current.size.height as i32,
    };
    let full_region = RegionRect {
        left: 0,
        top: 0,
        right: target.size.width as i32,
        bottom: target.size.height as i32,
    };
    ExpandGeometry { anchor_position, initial_region, full_region }
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



fn animation_outcome(generation: u64, current_generation: u64) -> AnimationOutcome {
    if generation == current_generation {
        AnimationOutcome::Completed
    } else {
        AnimationOutcome::Cancelled
    }
}

fn cancel_window_animation() {
    ANIMATION_GENERATION.fetch_add(1, Ordering::SeqCst);
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TransitionPlan {
    Direct([WindowBounds; 1]),
    Interpolated,
}

fn transition_plan(reduced_motion: bool, target: WindowBounds) -> TransitionPlan {
    if reduced_motion {
        TransitionPlan::Direct([target])
    } else {
        TransitionPlan::Interpolated
    }
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

async fn animate_window_bounds(
    app: &AppHandle,
    window: &WebviewWindow,
    start: WindowBounds,
    target: WindowBounds,
    duration: Duration,
    reduced_motion: bool,
) -> tauri::Result<AnimationOutcome> {

    if let TransitionPlan::Direct([exact_target]) = transition_plan(reduced_motion, target) {
        set_window_bounds(window, exact_target)?;
        restore_transparent_background(app, window);
        return Ok(AnimationOutcome::Completed);
    }
    let generation = ANIMATION_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    #[cfg(windows)]
    {
        let hwnd = window.hwnd()?.0 as isize;
        // 动画完成后重设 WebView2 透明背景（缩小/微调路径同样会表面重建）
        let app = app.clone();
        let webview = window.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            let started = Instant::now();
            loop {
                if ANIMATION_GENERATION.load(Ordering::SeqCst) != generation {
                    return Ok(AnimationOutcome::Cancelled);
                }
                let elapsed = started.elapsed().as_secs_f64();
                let raw = (elapsed / duration.as_secs_f64()).min(1.0);
                let p = ease_out_cubic(raw);
                let x = interpolate_i32(start.position.x, target.position.x, p);
                let y = interpolate_i32(start.position.y, target.position.y, p);
                let w = interpolate_u32(start.size.width, target.size.width, p) as i32;
                let h = interpolate_u32(start.size.height, target.size.height, p) as i32;
                let r = unsafe { SetWindowPos(hwnd as _, std::ptr::null_mut(), x, y, w, h, SWP_NOACTIVATE | SWP_NOZORDER | SWP_ASYNCWINDOWPOS) };
                if r == 0 { return Err(tauri::Error::Io(std::io::Error::last_os_error())); }
                if raw >= 1.0 {
                    // 收尾：同步 SetWindowPos（不带 SWP_ASYNCWINDOWPOS），阻塞等待 UI 线程
                    // 处理完动画期间积压的 WM_SIZE 消息，使 WebView2 子窗口 bounds 与父窗口
                    // 最终尺寸对齐；SWP_NOCOPYBITS 丢弃客户区位图复制，新扩展区域立即重绘。
                    let r = unsafe {
                        SetWindowPos(
                            hwnd as _,
                            std::ptr::null_mut(),
                            target.position.x,
                            target.position.y,
                            target.size.width as i32,
                            target.size.height as i32,
                            SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOCOPYBITS,
                        )
                    };
                    if r == 0 {
                        return Err(tauri::Error::Io(std::io::Error::last_os_error()));
                    }
                    // 重设 WebView2 透明背景：resize（表面重建）后 DefaultBackgroundColor 会重置
                    // 为默认白色，导致圆角外透明区域短暂显示白色尖角。
                    let _ = app.run_on_main_thread(move || {
                        let _ = webview
                            .as_ref()
                            .set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
                    });
                    return Ok(AnimationOutcome::Completed);
                }
                std::thread::sleep(Duration::from_millis(4));
            }
        })
        .await
        .map_err(|e| tauri::Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?
    }

    #[cfg(not(windows))]
    {
        let started = Instant::now();
        loop {
            let outcome = animation_outcome(generation, ANIMATION_GENERATION.load(Ordering::SeqCst));
            if !outcome.should_finish_transition() { return Ok(outcome); }
            let raw = (started.elapsed().as_secs_f64() / duration.as_secs_f64()).min(1.0);
            let p = ease_out_cubic(raw);
            set_window_bounds(window, WindowBounds {
                position: PhysicalPosition::new(interpolate_i32(start.position.x, target.position.x, p), interpolate_i32(start.position.y, target.position.y, p)),
                size: PhysicalSize::new(interpolate_u32(start.size.width, target.size.width, p), interpolate_u32(start.size.height, target.size.height, p)),
            })?;
            if raw >= 1.0 { return Ok(AnimationOutcome::Completed); }
            tokio::time::sleep(FRAME_DURATION).await;
        }
    }
}

/// 放大路径动画：窗口立即设为最终尺寸（WebView2 视口一次 resize、内容整体栅格化一次），
/// 动画期间用 SetWindowRgn 逐步扩张可见矩形，位置从当前中心锚点平移到目标位置。
/// 避免逐帧 resize 视口导致的 Chromium tile 逐块补渲染。
async fn animate_expand_with_region(
    app: &AppHandle,
    window: &WebviewWindow,
    current: WindowBounds,
    target: WindowBounds,
    duration: Duration,
    reduced_motion: bool,
) -> tauri::Result<AnimationOutcome> {
    if let TransitionPlan::Direct([exact_target]) = transition_plan(reduced_motion, target) {
        set_window_bounds(window, exact_target)?;
        return Ok(AnimationOutcome::Completed);
    }

    let ExpandGeometry {
        anchor_position,
        initial_region,
        full_region,
    } = expand_geometry(current, target);
    let generation = ANIMATION_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    #[cfg(windows)]
    {
        let hwnd = window.hwnd()?.0 as isize;
        // resize 后重设 WebView2 默认背景透明：WebView2 在窗口 resize（表面重建）后
        // DefaultBackgroundColor 会重置为默认白色，导致圆角外透明区域短暂显示白色尖角。
        let app = app.clone();
        let webview = window.clone();
        return tauri::async_runtime::spawn_blocking(move || {
            // 同步设最终尺寸与锚点位置：等待 WM_SIZE 处理完，WebView2 视口一次 resize。
            if unsafe {
                SetWindowPos(
                    hwnd as _,
                    std::ptr::null_mut(),
                    anchor_position.x,
                    anchor_position.y,
                    target.size.width as i32,
                    target.size.height as i32,
                    SWP_NOACTIVATE | SWP_NOZORDER,
                )
            } == 0
            {
                return Err(tauri::Error::Io(std::io::Error::last_os_error()));
            }
            restore_transparent_background(&app, &webview);

            let mut has_region = false;
            let initial_hrgn = unsafe {
                CreateRectRgn(
                    initial_region.left,
                    initial_region.top,
                    initial_region.right,
                    initial_region.bottom,
                )
            };
            if initial_hrgn != std::ptr::null_mut() && unsafe { SetWindowRgn(hwnd as _, initial_hrgn, 1) } != 0 {
                has_region = true;
            }

            let started = Instant::now();
            loop {
                if ANIMATION_GENERATION.load(Ordering::SeqCst) != generation {
                    if has_region {
                        unsafe { SetWindowRgn(hwnd as _, std::ptr::null_mut(), 1) };
                    }
                    return Ok(AnimationOutcome::Cancelled);
                }
                let elapsed = started.elapsed().as_secs_f64();
                let raw = (elapsed / duration.as_secs_f64()).min(1.0);
                let p = ease_out_cubic(raw);
                let x = interpolate_i32(anchor_position.x, target.position.x, p);
                let y = interpolate_i32(anchor_position.y, target.position.y, p);
                let region = RECT {
                    left: interpolate_i32(initial_region.left, 0, p),
                    top: interpolate_i32(initial_region.top, 0, p),
                    right: interpolate_i32(initial_region.right, full_region.right, p),
                    bottom: interpolate_i32(initial_region.bottom, full_region.bottom, p),
                };
                if unsafe {
                    SetWindowPos(
                        hwnd as _,
                        std::ptr::null_mut(),
                        x,
                        y,
                        0,
                        0,
                        SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER | SWP_ASYNCWINDOWPOS,
                    )
                } == 0
                {
                    if has_region {
                        unsafe { SetWindowRgn(hwnd as _, std::ptr::null_mut(), 1) };
                    }
                    return Err(tauri::Error::Io(std::io::Error::last_os_error()));
                }
                let hrgn =
                    unsafe { CreateRectRgn(region.left, region.top, region.right, region.bottom) };
                if hrgn != std::ptr::null_mut() && unsafe { SetWindowRgn(hwnd as _, hrgn, 1) } != 0 {
                    has_region = true;
                }
                if raw >= 1.0 {
                    if has_region {
                        unsafe { SetWindowRgn(hwnd as _, std::ptr::null_mut(), 1) };
                    }
                    return Ok(AnimationOutcome::Completed);
                }
                std::thread::sleep(Duration::from_millis(4));
            }
        })
        .await
        .map_err(|e| tauri::Error::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?
    }

    #[cfg(not(windows))]
    {
        animate_window_bounds(app, window, current, target, duration, reduced_motion).await
    }
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
    let from_waiting = current_window_mode() == WindowMode::Waiting;
    let outcome = if from_waiting {
        animate_expand_with_region(app, &window, current, target, EXPAND_DURATION, reduced_motion).await?
    } else {
        animate_window_bounds(app, &window, current, target, EXPAND_DURATION, reduced_motion).await?
    };
    if let Some(mode) = completed_mode(WindowMode::Response, outcome) {
        set_window_mode(mode);
    }
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
    if !from_settings {
        window.emit("surface://changed", "chat")?;
        window.show()?;
    }
    // 设置页→输入条：宽度 460→640 属放大方向，逐帧 resize 会让右半区域 tile 逐块补渲染。
    // 与放大路径一致用 region 动画（视口一次到位 + region 扩张），emit 仍推迟到动画后。
    let outcome = animate_expand_with_region(app, &window, current, target, EXPAND_DURATION, reduced_motion).await?;
    if outcome.should_finish_transition() {
        if from_settings {
            window.emit("surface://changed", "chat")?;
            window.show()?;
        }
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
    let outcome = animate_window_bounds(app, &window, current, target, COLLAPSE_DURATION, reduced_motion).await?;
    if !outcome.should_finish_transition() {
        return Ok(());
    }
    window.emit("surface://changed", "floating")?;
    apply_always_on_top(app, &window);
    window.show()?;
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
    let outcome = animate_expand_with_region(app, &window, current, target, EXPAND_DURATION, reduced_motion).await?;
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
    fn reduced_motion_commits_the_exact_target_once() {
        let target = WindowBounds {
            position: PhysicalPosition::new(120, 340),
            size: PhysicalSize::new(640, 280),
        };
        assert_eq!(transition_plan(true, target), TransitionPlan::Direct([target]));
        let TransitionPlan::Direct(commits) = transition_plan(true, target) else { unreachable!() };
        assert_eq!(commits, [target]);
        assert_eq!(commits.len(), 1);
        assert_eq!(transition_plan(false, target), TransitionPlan::Interpolated);
    }

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
    #[test]
    fn bottom_anchored_cancelled_animation_skips_completion_side_effects() {
        assert_eq!(animation_outcome(7, 8), AnimationOutcome::Cancelled);
        assert_eq!(animation_outcome(8, 8), AnimationOutcome::Completed);
        assert!(!animation_outcome(7, 8).should_finish_transition());
        assert!(animation_outcome(8, 8).should_finish_transition());
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
    fn settings_transition_animates_unless_reduced_motion_is_requested() {
        let target = WindowBounds {
            position: PhysicalPosition::new(120, 80),
            size: PhysicalSize::new(460, 560),
        };
        assert_eq!(transition_plan(false, target), TransitionPlan::Interpolated);
        assert_eq!(transition_plan(true, target), TransitionPlan::Direct([target]));
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
    #[test]
    fn expand_geometry_keeps_final_center_on_current_center() {
        let current = WindowBounds {
            position: PhysicalPosition::new(400, 300),
            size: PhysicalSize::new(50, 50),
        };
        let target = WindowBounds {
            position: PhysicalPosition::new(105, 296),
            size: PhysicalSize::new(640, 58),
        };
        let geometry = expand_geometry(current, target);
        assert_eq!(geometry.anchor_position, PhysicalPosition::new(105, 296));
        let initial = geometry.initial_region;
        assert_eq!((initial.left, initial.top, initial.right, initial.bottom), (295, 4, 345, 54));
        let full = geometry.full_region;
        assert_eq!((full.left, full.top, full.right, full.bottom), (0, 0, 640, 58));
    }

    #[test]
    fn expand_geometry_region_may_overflow_when_a_dimension_shrinks() {
        let current = WindowBounds {
            position: PhysicalPosition::new(100, 950),
            size: PhysicalSize::new(640, 58),
        };
        let target = WindowBounds {
            position: PhysicalPosition::new(150, 490),
            size: PhysicalSize::new(460, 560),
        };
        let geometry = expand_geometry(current, target);
        assert_eq!(geometry.anchor_position, PhysicalPosition::new(190, 699));
        let initial = geometry.initial_region;
        assert_eq!((initial.left, initial.top, initial.right, initial.bottom), (-90, 251, 550, 309));
    }

    #[test]
    fn expand_geometry_centers_odd_dimensions() {
        let current = WindowBounds {
            position: PhysicalPosition::new(400, 300),
            size: PhysicalSize::new(50, 50),
        };
        let target = WindowBounds {
            position: PhysicalPosition::new(388, 288),
            size: PhysicalSize::new(75, 75),
        };
        let geometry = expand_geometry(current, target);
        let initial = geometry.initial_region;
        assert_eq!((initial.left, initial.top, initial.right, initial.bottom), (13, 13, 63, 63));
    }
}
