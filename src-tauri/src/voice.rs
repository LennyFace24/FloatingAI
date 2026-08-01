use std::time::Duration;

use crate::settings;

/// 返回独立配置的 STT API Key（为空视为未配置）。
pub fn resolve_stt_credentials(settings: &settings::StoredSettings) -> Option<String> {
    settings.stt_api_key.clone().filter(|key| !key.is_empty())
}

/// 解析语音识别使用的 API Key：优先 STT Key，回落聊天 Key；双空时返回引导性错误。
pub fn resolve_api_key(settings: &settings::StoredSettings) -> Result<String, String> {
    resolve_stt_credentials(settings)
        .or_else(|| settings.api_key.clone().filter(|key| !key.is_empty()))
        .ok_or_else(|| "请先在设置中配置 API Key 或 STT API Key".to_string())
}

pub fn stt_url(base_url: &str) -> String {
    format!("{}/audio/transcriptions", base_url.trim_end_matches('/'))
}

pub fn map_stt_error(status: Option<u16>, kind: &str) -> String {
    match status {
        Some(401) => "语音识别鉴权失败，请检查 API Key".to_string(),
        Some(404) => "语音识别端点不存在，请检查 STT Base URL".to_string(),
        Some(_) => format!("语音识别服务返回错误（HTTP {}）", status.unwrap()),
        None if kind.contains("timeout") => "语音识别请求超时，请重试".to_string(),
        None => format!("语音识别网络请求失败：{kind}"),
    }
}

#[tauri::command]
pub async fn transcribe_audio(
    app: tauri::AppHandle,
    audio: Vec<u8>,
    mime: String,
) -> Result<String, String> {
    let stored = settings::load_settings(&app)?;
    let api_key = resolve_api_key(&stored)?;

    let url = stt_url(&stored.stt_base_url);
    let client = reqwest::Client::new();
    let mut form = reqwest::multipart::Form::new()
        .text("model", stored.stt_model.clone())
        .part("file", reqwest::multipart::Part::bytes(audio).mime_str(&mime).map_err(|e| e.to_string())?.file_name("audio.webm"));
    if stored.stt_language != "auto" {
        form = form.text("language", stored.stt_language.clone());
    }

    let response = client
        .post(&url)
        .bearer_auth(&api_key)
        .multipart(form)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| map_stt_error(None, &e.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(map_stt_error(Some(status.as_u16()), ""));
    }
    // 2xx 但响应体不是合法 JSON：区别于网络失败单独提示
    let body: serde_json::Value = response.json().await.map_err(|e| format!("语音识别响应解析失败：{e}"))?;
    body.get("text")
        .and_then(|t| t.as_str())
        .map(|t| t.to_string())
        .ok_or_else(|| "语音识别响应缺少 text 字段".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::StoredSettings;

    #[test]
    fn stt_credentials_fall_back_to_chat_key_when_stt_blank() {
        let settings = StoredSettings {
            stt_api_key: None,
            api_key: Some("sk-chat".to_string()),
            ..StoredSettings::default()
        };
        assert_eq!(resolve_stt_credentials(&settings), None);
    }

    #[test]
    fn stt_credentials_prefer_own_key() {
        let settings = StoredSettings {
            stt_api_key: Some("sk-stt".to_string()),
            api_key: Some("sk-chat".to_string()),
            ..StoredSettings::default()
        };
        assert_eq!(resolve_stt_credentials(&settings), Some("sk-stt".to_string()));
    }

    #[test]
    fn api_key_falls_back_to_chat_key_when_stt_blank() {
        let settings = StoredSettings {
            stt_api_key: None,
            api_key: Some("sk-chat".to_string()),
            ..StoredSettings::default()
        };
        assert_eq!(resolve_api_key(&settings), Ok("sk-chat".to_string()));
    }

    #[test]
    fn api_key_missing_returns_guidance_error() {
        let settings = StoredSettings {
            stt_api_key: None,
            api_key: None,
            ..StoredSettings::default()
        };
        assert_eq!(
            resolve_api_key(&settings),
            Err("请先在设置中配置 API Key 或 STT API Key".to_string())
        );
    }

    #[test]
    fn api_key_blank_stt_and_chat_returns_guidance_error() {
        let settings = StoredSettings {
            stt_api_key: Some(String::new()),
            api_key: Some(String::new()),
            ..StoredSettings::default()
        };
        assert_eq!(
            resolve_api_key(&settings),
            Err("请先在设置中配置 API Key 或 STT API Key".to_string())
        );
    }

    #[test]
    fn stt_url_appends_audio_transcriptions() {
        assert_eq!(stt_url("https://api.openai.com/v1"), "https://api.openai.com/v1/audio/transcriptions");
        assert_eq!(stt_url("http://localhost:9000/v1/"), "http://localhost:9000/v1/audio/transcriptions");
    }

    #[test]
    fn stt_error_mapping_classifies_status() {
        assert!(map_stt_error(Some(401), "").contains("API Key"));
        assert!(map_stt_error(Some(404), "").contains("端点"));
        assert!(map_stt_error(None, "timeout").contains("超时"));
        assert!(map_stt_error(None, "connect").contains("网络"));
    }
}
