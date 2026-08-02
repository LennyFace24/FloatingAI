use tauri::AppHandle;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::windows;

pub fn register_global_shortcut(app: &AppHandle, shortcut_text: &str) -> Result<(), String> {
    let shortcut = parse_shortcut(shortcut_text)?;
    app.global_shortcut()
        .on_shortcut(shortcut, move |app_handle, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                windows::request_toggle_chat_panel(app_handle);
            }
        })
        .map_err(|error| format!("快捷键注册失败：{error}"))?;
    Ok(())
}

/// 注册「快速提问」快捷键：按快捷键时读取剪贴板文本，非空则唤起输入条并预填。
pub fn register_quick_ask_shortcut(app: &AppHandle, shortcut_text: &str) -> Result<(), String> {
    let shortcut = parse_shortcut(shortcut_text)?;
    app.global_shortcut()
        .on_shortcut(shortcut, move |app_handle, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                windows::request_quick_ask(app_handle);
            }
        })
        .map_err(|error| format!("快捷键注册失败：{error}"))?;
    Ok(())
}

/// 读取剪贴板文本（供快速提问预填）。
pub fn read_clipboard_text(app: &AppHandle) -> Option<String> {
    match app.clipboard().read_text() {
        Ok(text) if !text.trim().is_empty() => Some(text),
        _ => None,
    }
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
    fn accepts_quick_ask_shortcut() {
        assert!(parse_shortcut("Ctrl+Shift+Q").is_ok());
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

