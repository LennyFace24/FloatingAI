use std::sync::Arc;

mod ai;
mod settings;
mod shortcuts;
mod tray;
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
fn show_settings_panel(app: tauri::AppHandle) -> Result<(), String> {
    windows::show_settings_panel(&app).map_err(|error| error.to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(ai::ChatRuntime::default()))
        .invoke_handler(tauri::generate_handler![
            start_floating_drag,
            show_prompt_bar,
            show_waiting_ball,
            resize_response_panel,
            show_chat_panel,
            show_floating_ball,
            show_settings_panel,
            hide_all_windows,
            get_settings,
            save_settings,
            start_chat,
            stop_chat
        ])
        .setup(|app| {
            tray::setup_tray(app.handle())?;
            windows::restore_floating_position(app.handle());
            windows::attach_floating_position_persistence(app.handle());

            let stored = settings::load_settings(app.handle()).unwrap_or_default();
            if let Err(error) =
                shortcuts::register_global_shortcut(app.handle(), &stored.global_shortcut)
            {
                eprintln!("{error}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
