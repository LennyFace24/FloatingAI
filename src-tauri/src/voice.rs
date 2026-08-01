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

pub const MIMO_BASE_URL: &str = "https://api.xiaomimimo.com/v1";

pub fn mimo_chat_url(base_url: &str) -> String {
    format!("{}/chat/completions", base_url.trim_end_matches('/'))
}

/// MiMo ASR 走 chat/completions + input_audio 消息：音频 base64 嵌入 data URI。
/// language 为 auto 时不发送 asr_options（服务端自动检测）。
pub fn build_mimo_chat_body(
    audio: &[u8],
    mime: &str,
    model: &str,
    language: &str,
) -> serde_json::Value {
    use base64::Engine as _;
    let encoded = base64::engine::general_purpose::STANDARD.encode(audio);
    let data_uri = format!("data:{mime};base64,{encoded}");
    let mut body = serde_json::json!({
        "model": model,
        "messages": [{
            "role": "user",
            "content": [{
                "type": "input_audio",
                "input_audio": { "data": data_uri }
            }]
        }]
    });
    if language != "auto" {
        body["asr_options"] = serde_json::json!({ "language": language });
    }
    body
}

pub fn parse_mimo_transcript(body: &serde_json::Value) -> Option<String> {
    body.get("choices")?
        .as_array()?
        .first()?
        .get("message")?
        .get("content")?
        .as_str()
        .map(|content| content.to_string())
}

#[tauri::command]
pub async fn transcribe_audio(
    app: tauri::AppHandle,
    audio: Vec<u8>,
    mime: String,
) -> Result<String, String> {
    let stored = settings::load_settings(&app)?;
    if stored.stt_provider == "mimo" {
        transcribe_mimo(&stored, &audio, &mime).await
    } else {
        transcribe_openai(&stored, &audio, &mime).await
    }
}

async fn transcribe_openai(
    stored: &settings::StoredSettings,
    audio: &[u8],
    mime: &str,
) -> Result<String, String> {
    let api_key = resolve_api_key(stored)?;
    let url = stt_url(&stored.stt_base_url);
    let client = reqwest::Client::new();
    let mut form = reqwest::multipart::Form::new()
        .text("model", stored.stt_model.clone())
        .part("file", reqwest::multipart::Part::bytes(audio.to_vec()).mime_str(mime).map_err(|e| e.to_string())?.file_name("audio.webm"));
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

async fn transcribe_mimo(
    stored: &settings::StoredSettings,
    audio: &[u8],
    mime: &str,
) -> Result<String, String> {
    let api_key = resolve_api_key(stored)?;
    let url = mimo_chat_url(&stored.stt_base_url);
    let body = build_mimo_chat_body(audio, mime, &stored.stt_model, &stored.stt_language);
    let client = reqwest::Client::new();

    let response = client
        .post(&url)
        .bearer_auth(&api_key)
        .json(&body)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| map_stt_error(None, &e.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(map_stt_error(Some(status.as_u16()), ""));
    }
    let body: serde_json::Value = response.json().await.map_err(|e| format!("语音识别响应解析失败：{e}"))?;
    parse_mimo_transcript(&body).ok_or_else(|| "语音识别响应缺少文本".to_string())
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

    #[test]
    fn mimo_chat_url_appends_chat_completions() {
        assert_eq!(
            mimo_chat_url("https://api.xiaomimimo.com/v1"),
            "https://api.xiaomimimo.com/v1/chat/completions"
        );
        assert_eq!(
            mimo_chat_url("https://api.xiaomimimo.com/v1/"),
            "https://api.xiaomimimo.com/v1/chat/completions"
        );
    }

    #[test]
    fn mimo_body_embeds_base64_audio_with_data_uri() {
        let body = build_mimo_chat_body(b"abc", "audio/wav", "mimo-v2.5-asr", "zh");
        assert_eq!(body["model"], "mimo-v2.5-asr");
        let content = &body["messages"][0]["content"][0];
        assert_eq!(content["type"], "input_audio");
        assert_eq!(
            content["input_audio"]["data"],
            "data:audio/wav;base64,YWJj"
        );
        assert_eq!(body["asr_options"]["language"], "zh");
    }

    #[test]
    fn mimo_body_omits_asr_options_when_language_auto() {
        let body = build_mimo_chat_body(b"abc", "audio/webm", "mimo-v2.5-asr", "auto");
        assert_eq!(body.get("asr_options"), None);
    }

    #[test]
    fn mimo_body_maps_webm_mime_to_data_uri_prefix() {
        let body = build_mimo_chat_body(b"x", "audio/webm", "mimo-v2.5-asr", "auto");
        assert!(body["messages"][0]["content"][0]["input_audio"]["data"]
            .as_str()
            .unwrap()
            .starts_with("data:audio/webm;base64,"));
    }

    #[test]
    fn mimo_parse_transcript_extracts_message_content() {
        let json = serde_json::json!({
            "choices": [{ "message": { "content": "你好世界" } }]
        });
        assert_eq!(parse_mimo_transcript(&json), Some("你好世界".to_string()));
    }

    #[test]
    fn mimo_parse_transcript_returns_none_when_malformed() {
        assert_eq!(parse_mimo_transcript(&serde_json::json!({})), None);
        assert_eq!(
            parse_mimo_transcript(&serde_json::json!({ "choices": [] })),
            None
        );
        assert_eq!(
            parse_mimo_transcript(&serde_json::json!({
                "choices": [{ "message": {} }]
            })),
            None
        );
    }
}
