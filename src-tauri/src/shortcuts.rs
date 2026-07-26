use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::windows;

pub fn register_global_shortcut(app: &AppHandle, shortcut_text: &str) -> Result<(), String> {
    let shortcut = parse_shortcut(shortcut_text)?;
    app.global_shortcut()
        .on_shortcut(shortcut, move |app_handle, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = windows::toggle_chat_panel(app_handle);
            }
        })
        .map_err(|error| format!("快捷键注册失败：{error}"))?;
    Ok(())
}

pub fn unregister_all(app: &AppHandle) {
    let _ = app.global_shortcut().unregister_all();
}

pub fn parse_shortcut(input: &str) -> Result<Shortcut, String> {
    input
        .trim()
        .parse::<Shortcut>()
        .map_err(|error| format!("无法识别的快捷键格式 {input}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_default_shortcut() {
        assert!(parse_shortcut("Alt+Space").is_ok());
    }

    #[test]
    fn accepts_common_modifier_combo() {
        assert!(parse_shortcut("Ctrl+Shift+K").is_ok());
    }

    #[test]
    fn rejects_unknown_shortcut_format() {
        assert!(parse_shortcut("NotAKey+???").is_err());
    }
}
