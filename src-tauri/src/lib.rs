use std::sync::Arc;

mod ai;
mod screenshot;
mod settings;
mod shortcuts;
mod tray;
mod voice;
mod windows;

#[tauri::command]
async fn start_floating_drag(app: tauri::AppHandle) -> Result<(), String> {
    windows::start_floating_drag(&app)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn show_prompt_bar(app: tauri::AppHandle, reduced_motion: bool) -> Result<(), String> {
    windows::show_prompt_bar(&app, reduced_motion)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn show_waiting_ball(app: tauri::AppHandle, reduced_motion: bool) -> Result<(), String> {
    windows::show_waiting_ball(&app, reduced_motion)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn resize_response_panel(
    app: tauri::AppHandle,
    content_height: f64,
    reduced_motion: bool,
) -> Result<(), String> {
    windows::resize_response_panel(&app, content_height, reduced_motion)
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
async fn show_response_panel(
    app: tauri::AppHandle,
    content_height: f64,
    reduced_motion: bool,
) -> Result<(), String> {
    windows::show_response_panel(&app, content_height, reduced_motion)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn show_chat_panel(app: tauri::AppHandle, reduced_motion: bool) -> Result<(), String> {
    windows::show_chat_panel(&app, reduced_motion)
        .await
        .map_err(|error| {
            eprintln!("[floating-ai] show_chat_panel failed: {error}");
            error.to_string()
        })
}

#[tauri::command]
async fn show_floating_ball(app: tauri::AppHandle, reduced_motion: bool) -> Result<(), String> {
    windows::show_floating_ball(&app, reduced_motion)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn show_settings_panel(app: tauri::AppHandle, reduced_motion: bool) -> Result<(), String> {
    windows::show_settings_panel(&app, reduced_motion)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn hide_all_windows(app: tauri::AppHandle) -> Result<(), String> {
    windows::hide_all_windows(&app).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<settings::AppSettings, String> {
    settings::load_settings(&app).map(settings::AppSettings::from)
}

#[tauri::command]
fn save_settings(
    app: tauri::AppHandle,
    settings: settings::SaveSettingsInput,
) -> Result<settings::AppSettings, String> {
    let previous = crate::settings::load_settings(&app).unwrap_or_default();
    let stored = settings.into_stored(previous);

    shortcuts::unregister_all(&app);
    shortcuts::register_global_shortcut(&app, &stored.global_shortcut)?;

    crate::settings::save_settings(&app, &stored)?;

    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        let autostart = app.autolaunch();
        if stored.autostart_enabled {
            autostart.enable().map_err(|error| error.to_string())?;
        } else {
            let _ = autostart.disable();
        }
    }

    Ok(stored.into())
}

#[tauri::command]
async fn start_chat(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, Arc<ai::ChatRuntime>>,
    request_id: String,
    messages: Vec<ai::ProviderMessage>,
) -> Result<(), String> {
    ai::start_chat(app, runtime.inner().clone(), request_id, messages).await
}

#[tauri::command]
async fn stop_chat(
    runtime: tauri::State<'_, Arc<ai::ChatRuntime>>,
    request_id: String,
) -> Result<(), String> {
    ai::stop_chat(runtime.inner().clone(), request_id).await
}

/// WebView2 默认拦截 `getUserMedia`；为 floating 窗口注册 PermissionRequested
/// handler，放行麦克风（COREWEBVIEW2_PERMISSION_KIND_MICROPHONE）。
#[cfg(windows)]
fn allow_microphone_permission(app: &tauri::App) {
    use tauri::Manager;

    let Some(webview) = app.get_webview_window(windows::FLOATING_LABEL) else {
        eprintln!("floating webview not found; microphone permission handler not registered");
        return;
    };

    if let Err(error) = webview.with_webview(|platform_webview| {
        unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY,
            };
            use webview2_com::PermissionRequestedEventHandler;

            let controller = platform_webview.controller();
            let Ok(core) = controller.CoreWebView2() else {
                eprintln!("failed to get ICoreWebView2 from floating webview controller");
                return;
            };

            let mut token = 0i64;
            if let Err(error) = core.add_PermissionRequested(
                &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                    args.PermissionKind(&mut kind)?;
                    if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                        args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                        eprintln!("microphone permission granted for floating webview");
                    } else {
                        args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                    }
                    Ok(())
                })),
                &mut token,
            ) {
                eprintln!("failed to register microphone permission handler: {error}");
            }
        }
    }) {
        eprintln!("failed to access floating webview: {error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(ai::ChatRuntime::default()))
        .invoke_handler(tauri::generate_handler![
            start_floating_drag,
            show_prompt_bar,
            show_waiting_ball,
            resize_response_panel,
            show_response_panel,
            show_chat_panel,
            show_floating_ball,
            show_settings_panel,
            hide_all_windows,
            get_settings,
            save_settings,
            ai::list_models,
            screenshot::capture_screen_region,
            voice::transcribe_audio,
            stop_chat
        ])
        .setup(|app| {
            tray::setup_tray(app.handle())?;
            #[cfg(windows)]
            allow_microphone_permission(app);
            windows::restore_floating_position(app.handle());
            windows::attach_floating_position_persistence(app.handle());

            let stored = settings::load_settings(app.handle()).unwrap_or_default();
            if let Err(error) =
                shortcuts::register_global_shortcut(app.handle(), &stored.global_shortcut)
            {
                eprintln!("{error}");
            }
            if let Err(error) =
                shortcuts::register_quick_ask_shortcut(app.handle(), &stored.quick_ask_shortcut)
            {
                eprintln!("{error}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
