use std::collections::HashMap;
use std::sync::Arc;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};

use crate::settings;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProviderMessage {
    pub role: String,
    /// 文本字符串，或 OpenAI 多模态数组：
    /// `[{ "type": "text", "text": "..." }, { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }]`
    pub content: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct ChatCompletionsRequest {
    pub model: String,
    pub stream: bool,
    pub messages: Vec<ProviderMessage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDeltaPayload {
    pub request_id: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatDonePayload {
    pub request_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatErrorPayload {
    pub request_id: String,
    pub message: String,
}

#[derive(Default)]
pub struct ChatRuntime {
    cancellations: Mutex<HashMap<String, oneshot::Sender<()>>>,
}

pub fn chat_completions_url(base_url: &str) -> String {
    format!("{}/chat/completions", base_url.trim_end_matches('/'))
}

pub fn models_url(base_url: &str) -> String {
    format!("{}/models", base_url.trim_end_matches('/'))
}

pub fn models_url_with_filter(base_url: &str, sub_type: Option<&str>) -> String {
    match sub_type {
        Some(sub_type) => format!("{}/models?sub_type={}", base_url.trim_end_matches('/'), sub_type),
        None => models_url(base_url),
    }
}

/// 从 OpenAI 兼容的 /models 响应中提取模型 id（过滤空 id 与缺失 id）。
pub fn parse_model_ids(body: &serde_json::Value) -> Vec<String> {
    body.get("data")
        .and_then(|data| data.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(|id| id.as_str()))
                .filter(|id| !id.is_empty())
                .map(|id| id.to_string())
                .collect()
        })
        .unwrap_or_default()
}

/// 根据聊天/语音作用域解析模型列表请求的目标：返回 (base_url, api_key, sub_type 过滤)。
/// chat：聊天配置；voice：语音配置（硅基流动按 speech-to-text 过滤）。
pub fn resolve_models_target(
    stored: &settings::StoredSettings,
    scope: &str,
) -> Result<(String, String, Option<String>), String> {
    match scope {
        "chat" => {
            let api_key = stored
                .api_key
                .clone()
                .filter(|key| !key.is_empty())
                .ok_or_else(|| "请先在设置中配置 API Key".to_string())?;
            let sub_type = if stored.base_url.contains("siliconflow") {
                Some("chat".to_string())
            } else {
                None
            };
            Ok((stored.base_url.clone(), api_key, sub_type))
        }
        "voice" => {
            let api_key = stored
                .stt_api_key
                .clone()
                .filter(|key| !key.is_empty())
                .or_else(|| stored.api_key.clone().filter(|key| !key.is_empty()))
                .ok_or_else(|| "请先在设置中配置 API Key 或 STT API Key".to_string())?;
            let sub_type = if stored.stt_provider == "siliconflow" {
                Some("speech-to-text".to_string())
            } else {
                None
            };
            Ok((stored.stt_base_url.clone(), api_key, sub_type))
        }
        _ => Err("未知的模型作用域".to_string()),
    }
}

#[tauri::command]
pub async fn list_models(
    app: AppHandle,
    scope: String,
) -> Result<Vec<String>, String> {
    let stored = settings::load_settings(&app)?;
    let (base_url, api_key, sub_type) = resolve_models_target(&stored, &scope)?;
    let url = models_url_with_filter(&base_url, sub_type.as_deref());
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .bearer_auth(&api_key)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("获取模型列表失败：{e}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("获取模型列表失败（HTTP {}）", status.as_u16()));
    }
    let body: serde_json::Value = response.json().await.map_err(|e| format!("模型列表响应解析失败：{e}"))?;
    Ok(parse_model_ids(&body))
}

pub async fn start_chat(
    app: AppHandle,
    runtime: Arc<ChatRuntime>,
    request_id: String,
    messages: Vec<ProviderMessage>,
) -> Result<(), String> {
    let stored = settings::load_settings(&app)?;
    let api_key = stored
        .api_key
        .clone()
        .filter(|key| !key.is_empty())
        .ok_or_else(|| "请先在设置中配置 API Key".to_string())?;

    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    runtime
        .cancellations
        .lock()
        .await
        .insert(request_id.clone(), cancel_tx);

    let client = reqwest::Client::new();
    let url = chat_completions_url(&stored.base_url);
    let body = ChatCompletionsRequest {
        model: stored.model,
        stream: true,
        messages,
    };
    let spawned_app = app.clone();
    let spawned_request_id = request_id.clone();

    tauri::async_runtime::spawn(async move {
        let result = stream_chat_response(
            spawned_app.clone(),
            spawned_request_id.clone(),
            client,
            url,
            api_key,
            body,
            cancel_rx,
        )
        .await;

        runtime
            .cancellations
            .lock()
            .await
            .remove(&spawned_request_id);

        if let Err(message) = result {
            let _ = spawned_app.emit(
                "chat://error",
                ChatErrorPayload {
                    request_id: spawned_request_id,
                    message,
                },
            );
        }
    });

    Ok(())
}

pub async fn stop_chat(runtime: Arc<ChatRuntime>, request_id: String) -> Result<(), String> {
    if let Some(cancel) = runtime.cancellations.lock().await.remove(&request_id) {
        let _ = cancel.send(());
    }
    Ok(())
}

/// 最多尝试次数：1 次初始请求 + 2 次重试。
const MAX_ATTEMPTS: u32 = 3;

/// 该状态码/网络错误是否值得重试。
/// - `None`：网络层错误（连接失败/超时），值得重试
/// - `Some(429)`：限流，值得重试
/// - `Some(408)`：请求超时，值得重试
/// - `Some(5xx)`：服务端错误，值得重试
/// - 其余 4xx（401/403/400 等）为客户端/认证错误，重试无意义
fn should_retry(status: Option<u16>, attempt: u32) -> bool {
    if attempt >= MAX_ATTEMPTS - 1 {
        return false;
    }
    match status {
        None => true,
        Some(status) => status == 429 || status == 408 || (500..=599).contains(&status),
    }
}

/// 第 `attempt`（1 起）次重试前的退避：1s、2s 指数增长，叠加确定性微抖。
/// 抖动由 attempt 推导（`attempt * 37 % 100` ms），无时间依赖，可稳定测试。
fn retry_delay(attempt: u32, _now: std::time::Instant) -> std::time::Duration {
    let base_ms = 1000u64 * (1u64 << attempt.saturating_sub(1).min(6));
    let jitter_ms = (attempt * 37 % 100) as u64;
    std::time::Duration::from_millis(base_ms + jitter_ms)
}

async fn stream_chat_response(
    app: AppHandle,
    request_id: String,
    client: reqwest::Client,
    url: String,
    api_key: String,
    body: ChatCompletionsRequest,
    mut cancel_rx: oneshot::Receiver<()>,
) -> Result<(), String> {
    let started = std::time::Instant::now();
    let mut last_error: Option<String> = None;
    let mut response = None;

    // 首请求建立阶段重试：网络错误 / 429 / 408 / 5xx，指数退避。
    // 流已开始后的中断不重试——SSE 已输出的内容无法去重，重试会造成重复回复。
    for attempt in 0..MAX_ATTEMPTS {
        match client
            .post(&url)
            .bearer_auth(&api_key)
            .json(&body)
            .send()
            .await
        {
            Ok(res) => {
                let status = res.status();
                if status.is_success() {
                    response = Some(res);
                    break;
                }
                let text = res.text().await.unwrap_or_default();
                let summary: String = text.chars().take(300).collect();
                if !should_retry(Some(status.as_u16()), attempt) {
                    return Err(format!("AI 服务返回错误 {status}: {summary}"));
                }
                last_error = Some(format!("AI 服务返回错误 {status}: {summary}"));
            }
            Err(error) => {
                if !should_retry(None, attempt) {
                    return Err(format!("网络请求失败：{error}"));
                }
                last_error = Some(format!("网络请求失败：{error}"));
            }
        }

        let delay = retry_delay(attempt + 1, started);
        tokio::select! {
            _ = &mut cancel_rx => return Ok(()),
            _ = tokio::time::sleep(delay) => {}
        }
    }

    let Some(response) = response else {
        return Err(last_error.unwrap_or_else(|| "AI 服务请求失败".to_string()));
    };

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    loop {
        tokio::select! {
            _ = &mut cancel_rx => {
                return Ok(());
            }
            next = stream.next() => {
                let Some(chunk) = next else { break; };
                let chunk = chunk.map_err(|error| format!("读取流式响应失败：{error}"))?;
                buffer.push_str(&String::from_utf8_lossy(&chunk));

                while let Some(index) = buffer.find("\n\n") {
                    let frame = buffer[..index].to_string();
                    buffer.drain(..index + 2);
                    handle_sse_frame(&app, &request_id, &frame)?;
                }
            }
        }
    }

    app.emit(
        "chat://done",
        ChatDonePayload {
            request_id: request_id.clone(),
        },
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn handle_sse_frame(app: &AppHandle, request_id: &str, frame: &str) -> Result<(), String> {
    for line in frame.lines() {
        let Some(data) = line.strip_prefix("data: ") else {
            continue;
        };
        if data == "[DONE]" {
            continue;
        }

        let Ok(parsed) = serde_json::from_str::<serde_json::Value>(data) else {
            continue;
        };
        let content = parsed["choices"][0]["delta"]["content"]
            .as_str()
            .unwrap_or_default();
        if !content.is_empty() {
            app.emit(
                "chat://delta",
                ChatDeltaPayload {
                    request_id: request_id.to_string(),
                    content: content.to_string(),
                },
            )
            .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_chat_completions_url_without_double_slash() {
        assert_eq!(
            chat_completions_url("https://api.example.com/v1/"),
            "https://api.example.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completions_url("https://api.example.com/v1"),
            "https://api.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn request_body_uses_streaming_chat_completions_shape() {
        let body = ChatCompletionsRequest {
            model: "gpt-test".to_string(),
            stream: true,
            messages: vec![ProviderMessage {
                role: "user".to_string(),
                content: serde_json::json!("hello"),
            }],
        };
        let json = serde_json::to_value(body).unwrap();
        assert_eq!(json["model"], "gpt-test");
        assert_eq!(json["stream"], true);
        assert_eq!(json["messages"][0]["role"], "user");
        assert_eq!(json["messages"][0]["content"], "hello");
    }

    #[test]
    fn models_url_appends_models_endpoint() {
        assert_eq!(
            models_url("https://api.example.com/v1/"),
            "https://api.example.com/v1/models"
        );
        assert_eq!(
            models_url("https://api.example.com/v1"),
            "https://api.example.com/v1/models"
        );
    }

    #[test]
    fn models_url_appends_subtype_filter_for_siliconflow_chat() {
        assert_eq!(
            models_url_with_filter("https://api.siliconflow.cn/v1", Some("chat")),
            "https://api.siliconflow.cn/v1/models?sub_type=chat"
        );
        assert_eq!(
            models_url_with_filter("https://api.siliconflow.cn/v1", Some("speech-to-text")),
            "https://api.siliconflow.cn/v1/models?sub_type=speech-to-text"
        );
    }

    #[test]
    fn models_url_omits_filter_when_none() {
        assert_eq!(
            models_url_with_filter("https://api.example.com/v1", None),
            "https://api.example.com/v1/models"
        );
    }

    #[test]
    fn parses_model_ids_from_standard_response() {
        let json = serde_json::json!({
            "object": "list",
            "data": [
                { "id": "model-a", "object": "model" },
                { "id": "model-b" },
                { "id": "" },
                {}
            ]
        });
        assert_eq!(parse_model_ids(&json), vec!["model-a".to_string(), "model-b".to_string()]);
    }

    #[test]
    fn parses_model_ids_returns_empty_on_malformed() {
        assert_eq!(parse_model_ids(&serde_json::json!({})), Vec::<String>::new());
        assert_eq!(parse_model_ids(&serde_json::json!({ "data": "nope" })), Vec::<String>::new());
    }
}

#[cfg(test)]
mod retry_tests {
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn retries_network_error_and_retryable_statuses() {
        // None = 网络层错误（连接失败）
        assert!(should_retry(None, 0));
        // 429 限流
        assert!(should_retry(Some(429), 0));
        // 5xx 服务端错误
        assert!(should_retry(Some(500), 0));
        assert!(should_retry(Some(503), 1));
        // 408 请求超时
        assert!(should_retry(Some(408), 0));
    }

    #[test]
    fn does_not_retry_auth_or_client_errors() {
        assert!(!should_retry(Some(401), 0));
        assert!(!should_retry(Some(403), 0));
        assert!(!should_retry(Some(400), 0));
        assert!(!should_retry(Some(404), 0));
    }

    #[test]
    fn stops_retrying_after_max_attempts() {
        // attempt 从 0 数起；attempt 2 已是第 3 次（最后）尝试，不再重试
        assert!(should_retry(Some(500), 1));
        assert!(!should_retry(Some(500), 2));
        assert!(!should_retry(None, 2));
    }

    #[test]
    fn retry_delay_grows_exponentially() {
        let now = Instant::now();
        let first = retry_delay(1, now);
        let second = retry_delay(2, now);
        // 指数：第 2 次重试等待 ≥ 第 1 次
        assert!(second >= first, "delay should grow: {second:?} >= {first:?}");
        // 第 1 次重试 ~1s，第 2 次 ~2s（允许抖动 ±10ms）
        assert!(first >= Duration::from_millis(990));
        assert!(first <= Duration::from_millis(1100));
        assert!(second >= Duration::from_millis(1990));
        assert!(second <= Duration::from_millis(2100));
    }

    #[test]
    fn retry_delay_is_deterministic_for_same_instant() {
        let now = Instant::now();
        let a = retry_delay(1, now);
        let b = retry_delay(1, now);
        assert_eq!(a, b);
    }
}
