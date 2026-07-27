use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::settings;

#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::POINT,
    UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON},
        WindowsAndMessaging::{
            GetCursorPos, GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER,
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
    fn bottom_anchored_bounds(self, logical_width: f64, logical_height: f64) -> WindowBounds {
        let requested_width = (logical_width * self.scale_factor).round() as u32;
        let width = requested_width.min(self.work_area_size.width);
        let height = (logical_height * self.scale_factor).round() as u32;
        let bottom_gap = (BOTTOM_GAP * self.scale_factor).round() as i32;
        let position = PhysicalPosition::new(
            self.work_area_position.x + (self.work_area_size.width - width) as i32 / 2,
            self.work_area_position.y + self.work_area_size.height as i32 - bottom_gap
                - height as i32,
        );
        WindowBounds {
            position,
            size: PhysicalSize::new(width, height),
        }
    }

    fn prompt_bounds(self) -> WindowBounds {
        self.bottom_anchored_bounds(SURFACE_WIDTH, PROMPT_HEIGHT)
    }

    fn waiting_bounds(self) -> WindowBounds {
        self.bottom_anchored_bounds(WAITING_SIZE, WAITING_SIZE)
    }

    fn response_bounds(self, content_height: f64) -> WindowBounds {
        self.bottom_anchored_bounds(
            SURFACE_WIDTH,
            content_height.clamp(RESPONSE_MIN_HEIGHT, RESPONSE_MAX_HEIGHT),
        )
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

async fn animate_window_bounds(
    window: &WebviewWindow,
    target: WindowBounds,
    duration: Duration,
    reduced_motion: bool,
) -> tauri::Result<AnimationOutcome> {
    let generation = ANIMATION_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let start = current_bounds(window)?;

    if let TransitionPlan::Direct([exact_target]) = transition_plan(reduced_motion, target) {
        set_window_bounds(window, exact_target)?;
        return Ok(AnimationOutcome::Completed);
    }

    let started = Instant::now();
    loop {
        let outcome = animation_outcome(generation, ANIMATION_GENERATION.load(Ordering::SeqCst));
        if !outcome.should_finish_transition() {
            return Ok(outcome);
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
            return Ok(AnimationOutcome::Completed);
        }
        tokio::time::sleep(FRAME_DURATION).await;
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
    let outcome = show_bottom_anchored(app, |geometry| geometry.prompt_bounds(), reduced_motion).await?;
    if let Some(mode) = completed_mode(WindowMode::Prompt, outcome) {
        set_window_mode(mode);
    }
    Ok(())
}
pub async fn show_waiting_ball(app: &AppHandle, reduced_motion: bool) -> tauri::Result<()> {
    let outcome = show_bottom_anchored(app, |geometry| geometry.waiting_bounds(), reduced_motion).await?;
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
    let target = surface_geometry(&window)?.response_bounds(content_height);
    let outcome = animate_window_bounds(&window, target, EXPAND_DURATION, reduced_motion).await?;
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
    window.set_resizable(false)?;
    window.emit("surface://changed", "chat")?;
    window.show()?;
    resize_response_panel(app, content_height, reduced_motion).await
}
async fn show_bottom_anchored<F: FnOnce(SurfaceGeometry) -> WindowBounds>(
    app: &AppHandle,
    bounds: F,
    reduced_motion: bool,
) -> tauri::Result<AnimationOutcome> {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };
    let target = bounds(surface_geometry(&window)?);
    window.set_resizable(false)?;
    window.emit("surface://changed", "chat")?;
    window.show()?;
    let outcome = animate_window_bounds(&window, target, EXPAND_DURATION, reduced_motion).await?;
    if outcome.should_finish_transition() {
        window.set_focus()?;
    }
    Ok(outcome)
}

pub async fn show_chat_panel(app: &AppHandle, reduced_motion: bool) -> tauri::Result<()> {
    show_prompt_bar(app, reduced_motion).await
}

pub async fn show_floating_ball(app: &AppHandle, reduced_motion: bool) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };
    let current = current_bounds(&window)?;
    let size = logical_size(&window, FLOATING_SIZE, FLOATING_SIZE)?;
    let target = WindowBounds { position: current.position, size };
    window.set_resizable(false)?;
    let outcome = animate_window_bounds(&window, target, COLLAPSE_DURATION, reduced_motion).await?;
    if !outcome.should_finish_transition() {
        return Ok(());
    }
    window.emit("surface://changed", "floating")?;
    let always_on_top = settings::load_settings(app)
        .map(|stored| stored.floating_always_on_top)
        .unwrap_or(true);
    window.set_always_on_top(always_on_top)?;
    window.show()?;
    window.set_focus()?;
    set_window_mode(WindowMode::Floating);
    Ok(())
}

pub fn show_settings_panel(app: &AppHandle) -> tauri::Result<()> {
    cancel_window_animation();
    let Some(window) = app.get_webview_window(FLOATING_LABEL) else {
        return Err(tauri::Error::WindowNotFound);
    };
    window.set_size(logical_size(&window, SETTINGS_WIDTH, SETTINGS_HEIGHT)?)?;
    window.set_resizable(false)?;
    window.emit("surface://changed", "settings")?;
    window.show()?;
    window.set_focus()?;
    set_window_mode(WindowMode::Settings);
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
        let bounds = geometry(1.0).prompt_bounds();
        assert_eq!(bounds.position, PhysicalPosition::new(740, 1000));
        assert_eq!(bounds.size, PhysicalSize::new(640, 58));
    }

    #[test]
    fn bottom_anchored_modes_at_1_5x() {
        let geometry = geometry(1.5);
        assert_eq!(
            geometry.prompt_bounds(),
            WindowBounds {
                position: PhysicalPosition::new(580, 935),
                size: PhysicalSize::new(960, 87),
            }
        );
        assert_eq!(
            geometry.waiting_bounds(),
            WindowBounds {
                position: PhysicalPosition::new(1022, 947),
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
        let bounds = geometry.prompt_bounds();
        assert_eq!(bounds.position.x, -900);
        assert_eq!(bounds.size.width, 600);
    }
}
