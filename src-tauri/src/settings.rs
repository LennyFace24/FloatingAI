use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;

const SETTINGS_FILE: &str = "settings.json";
const SETTINGS_KEY: &str = "appSettings";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct StoredSettings {
    pub api_key: Option<String>,
    pub base_url: String,
    pub model: String,
    pub global_shortcut: String,
    pub quick_ask_shortcut: String,
    pub autostart_enabled: bool,
    pub floating_always_on_top: bool,
    pub floating_position: Option<WindowPosition>,
    pub stt_base_url: String,
    pub stt_model: String,
    pub stt_api_key: Option<String>,
    pub stt_language: String,
    pub stt_provider: String,
}

impl Default for StoredSettings {
    fn default() -> Self {
        Self {
            api_key: None,
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4o-mini".to_string(),
            global_shortcut: "Alt+Space".to_string(),
            quick_ask_shortcut: "Ctrl+Shift+Q".to_string(),
            autostart_enabled: false,
            floating_always_on_top: true,
            floating_position: None,
            stt_base_url: "https://api.openai.com/v1".to_string(),
            stt_model: "whisper-1".to_string(),
            stt_api_key: None,
            stt_language: "auto".to_string(),
            stt_provider: "openai".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub api_key_configured: bool,
    /// API Key 明文（仅本机返回，供设置页「显示」按钮查看）
    pub api_key: Option<String>,
    pub base_url: String,
    pub model: String,
    pub global_shortcut: String,
    pub quick_ask_shortcut: String,
    pub autostart_enabled: bool,
    pub floating_always_on_top: bool,
    pub stt_base_url: String,
    pub stt_model: String,
    pub stt_api_key_configured: bool,
    /// STT API Key 明文（仅本机返回，供设置页「显示」按钮查看）
    pub stt_api_key: Option<String>,
    pub stt_language: String,
    pub stt_provider: String,
}

impl From<StoredSettings> for AppSettings {
    fn from(value: StoredSettings) -> Self {
        Self {
            api_key_configured: value.api_key.as_ref().is_some_and(|key| !key.is_empty()),
            api_key: value
                .api_key
                .clone()
                .filter(|key| !key.is_empty()),
            base_url: value.base_url,
            model: value.model,
            global_shortcut: value.global_shortcut,
            quick_ask_shortcut: value.quick_ask_shortcut,
            autostart_enabled: value.autostart_enabled,
            floating_always_on_top: value.floating_always_on_top,
            stt_base_url: value.stt_base_url,
            stt_model: value.stt_model,
            stt_api_key_configured: value
                .stt_api_key
                .as_ref()
                .is_some_and(|key| !key.is_empty()),
            stt_api_key: value
                .stt_api_key
                .clone()
                .filter(|key| !key.is_empty()),
            stt_language: value.stt_language,
            stt_provider: value.stt_provider,
        }
    }
}



#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SaveSettingsInput {
    pub api_key: Option<String>,
    pub base_url: String,
    pub model: String,
    pub global_shortcut: String,
    pub quick_ask_shortcut: String,
    pub autostart_enabled: bool,
    pub floating_always_on_top: bool,
    pub stt_api_key: Option<String>,
    pub stt_base_url: String,
    pub stt_model: String,
    pub stt_language: String,
    pub stt_provider: String,
}

impl SaveSettingsInput {
    pub fn into_stored(self, previous: StoredSettings) -> StoredSettings {
        // key 留空即清除（不再保留 previous）——用户可主动清空已保存的密钥
        let api_key = self
            .api_key
            .map(|key| key.trim().to_string())
            .filter(|key| !key.is_empty());
        let stt_api_key = self
            .stt_api_key
            .map(|key| key.trim().to_string())
            .filter(|key| !key.is_empty());

        StoredSettings {
            api_key,
            base_url: self.base_url.trim().trim_end_matches('/').to_string(),
            model: self.model.trim().to_string(),
            global_shortcut: self.global_shortcut.trim().to_string(),
            quick_ask_shortcut: if self.quick_ask_shortcut.trim().is_empty() {
                previous.quick_ask_shortcut
            } else {
                self.quick_ask_shortcut.trim().to_string()
            },
            autostart_enabled: self.autostart_enabled,
            floating_always_on_top: self.floating_always_on_top,
            floating_position: previous.floating_position,
            stt_base_url: if self.stt_base_url.trim().is_empty() {
                previous.stt_base_url
            } else {
                self.stt_base_url.trim().trim_end_matches('/').to_string()
            },
            stt_model: if self.stt_model.trim().is_empty() {
                previous.stt_model
            } else {
                self.stt_model.trim().to_string()
            },
            stt_api_key,
            stt_language: if self.stt_language.trim().is_empty() {
                previous.stt_language
            } else {
                self.stt_language.trim().to_string()
            },
            stt_provider: if self.stt_provider.trim().is_empty() {
                previous.stt_provider
            } else {
                self.stt_provider.trim().to_string()
            },
        }
    }
}

pub fn load_settings(app: &tauri::AppHandle) -> Result<StoredSettings, String> {
    let store = app.store(SETTINGS_FILE).map_err(|error| error.to_string())?;
    let settings = store
        .get(SETTINGS_KEY)
        .and_then(|value| serde_json::from_value::<StoredSettings>(value.clone()).ok())
        .unwrap_or_default();
    Ok(settings)
}

pub fn save_settings(app: &tauri::AppHandle, settings: &StoredSettings) -> Result<(), String> {
    let store = app.store(SETTINGS_FILE).map_err(|error| error.to_string())?;
    store.set(
        SETTINGS_KEY,
        serde_json::to_value(settings).map_err(|error| error.to_string())?,
    );
    store.save().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_are_valid() {
        let settings = StoredSettings::default();
        assert_eq!(settings.base_url, "https://api.openai.com/v1");
        assert_eq!(settings.model, "gpt-4o-mini");
        assert_eq!(settings.global_shortcut, "Alt+Space");
        assert!(settings.floating_always_on_top);
        assert!(settings.floating_position.is_none());
    }

    #[test]
    fn public_settings_expose_api_key_for_viewing() {
        let stored = StoredSettings {
            api_key: Some("sk-secret".to_string()),
            ..StoredSettings::default()
        };
        let json = serde_json::to_value(AppSettings::from(stored)).unwrap();
        assert_eq!(json["apiKeyConfigured"], true);
        assert_eq!(json["apiKey"], "sk-secret");
    }

    #[test]
    fn save_input_clears_previous_key_when_blank() {
        let previous = StoredSettings {
            api_key: Some("sk-old".to_string()),
            ..StoredSettings::default()
        };
        let input = SaveSettingsInput {
            api_key: Some("   ".to_string()),
            base_url: "https://api.example.com/v1/".to_string(),
            model: " gpt-test ".to_string(),
            global_shortcut: " Alt+Space ".to_string(),
            quick_ask_shortcut: " Ctrl+Shift+Q ".to_string(),
            autostart_enabled: true,
            floating_always_on_top: false,
            stt_api_key: Some("   ".to_string()),
            stt_base_url: "https://api.example.com/v1/".to_string(),
            stt_model: " whisper-test ".to_string(),
            stt_language: " auto ".to_string(),
            stt_provider: "openai".to_string(),
        };

        let stored = input.into_stored(previous);
        assert_eq!(stored.api_key, None);
        assert_eq!(stored.stt_api_key, None);
        assert_eq!(stored.base_url, "https://api.example.com/v1");
        assert_eq!(stored.model, "gpt-test");
        assert!(stored.autostart_enabled);
        assert!(!stored.floating_always_on_top);
    }

    #[test]
    fn default_stt_settings_fall_back_to_chat_base_url() {
        let settings = StoredSettings::default();
        assert_eq!(settings.stt_base_url, "https://api.openai.com/v1");
        assert_eq!(settings.stt_model, "whisper-1");
        assert_eq!(settings.stt_language, "auto");
        assert!(settings.stt_api_key.is_none());
    }

    fn public_settings_expose_stt_api_key_for_viewing() {
        let stored = StoredSettings {
            stt_api_key: Some("sk-stt-secret".to_string()),
            ..StoredSettings::default()
        };
        let json = serde_json::to_value(AppSettings::from(stored)).unwrap();
        assert_eq!(json["sttApiKeyConfigured"], true);
        assert_eq!(json["sttApiKey"], "sk-stt-secret");
    }

    #[test]
    fn save_input_clears_previous_stt_key_when_blank() {
        let previous = StoredSettings {
            stt_api_key: Some("sk-stt-old".to_string()),
            ..StoredSettings::default()
        };
        let input = SaveSettingsInput {
            stt_api_key: Some("   ".to_string()),
            stt_base_url: "http://localhost:9000/v1".to_string(),
            stt_model: " large-v3 ".to_string(),
            stt_language: " zh ".to_string(),
            api_key: None,
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4o-mini".to_string(),
            global_shortcut: "Alt+Space".to_string(),
            quick_ask_shortcut: "Ctrl+Shift+Q".to_string(),
            autostart_enabled: false,
            floating_always_on_top: true,
            stt_provider: "openai".to_string(),
        };
        let stored = input.into_stored(previous);
        assert_eq!(stored.stt_api_key, None);
        assert_eq!(stored.stt_base_url, "http://localhost:9000/v1");
        assert_eq!(stored.stt_model, "large-v3");
        assert_eq!(stored.stt_language, "zh");
    }


    #[test]
    fn save_input_accepts_missing_stt_fields() {
        let input: SaveSettingsInput = serde_json::from_str(
            r#"{"apiKey":null,"baseUrl":"https://api.openai.com/v1","model":"gpt-4o-mini","globalShortcut":"Alt+Space","autostartEnabled":false,"floatingAlwaysOnTop":true}"#,
        )
        .unwrap();
        assert_eq!(input.stt_base_url, "");
        assert_eq!(input.stt_model, "");
        assert_eq!(input.stt_language, "");
        assert!(input.stt_api_key.is_none());
    }

    #[test]
    fn save_input_keeps_previous_stt_strings_when_blank() {
        let previous = StoredSettings {
            stt_base_url: "http://localhost:9000/v1".to_string(),
            stt_model: "large-v3".to_string(),
            stt_language: "zh".to_string(),
            ..StoredSettings::default()
        };
        let input = SaveSettingsInput {
            stt_api_key: None,
            stt_base_url: "  ".to_string(),
            stt_model: " ".to_string(),
            stt_language: "".to_string(),
            api_key: None,
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4o-mini".to_string(),
            global_shortcut: "Alt+Space".to_string(),
            quick_ask_shortcut: "Ctrl+Shift+Q".to_string(),
            autostart_enabled: false,
            floating_always_on_top: true,
            stt_provider: "openai".to_string(),
        };
        let stored = input.into_stored(previous);
        assert_eq!(stored.stt_base_url, "http://localhost:9000/v1");
        assert_eq!(stored.stt_model, "large-v3");
        assert_eq!(stored.stt_language, "zh");
    }

    #[test]
    fn default_stt_provider_is_openai() {
        assert_eq!(StoredSettings::default().stt_provider, "openai");
    }

    #[test]
    fn save_input_keeps_previous_stt_provider_when_blank() {
        let previous = StoredSettings {
            stt_provider: "mimo".to_string(),
            ..StoredSettings::default()
        };
        let stored = SaveSettingsInput {
            stt_provider: "  ".to_string(),
            stt_api_key: None,
            stt_base_url: "".to_string(),
            stt_model: "".to_string(),
            stt_language: "".to_string(),
            api_key: None,
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4o-mini".to_string(),
            global_shortcut: "Alt+Space".to_string(),
            quick_ask_shortcut: "Ctrl+Shift+Q".to_string(),
            autostart_enabled: false,
            floating_always_on_top: true,
        }
        .into_stored(previous);
        assert_eq!(stored.stt_provider, "mimo");
    }
}
