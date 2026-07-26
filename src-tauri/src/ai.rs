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
    pub content: String,
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

async fn stream_chat_response(
    app: AppHandle,
    request_id: String,
    client: reqwest::Client,
    url: String,
    api_key: String,
    body: ChatCompletionsRequest,
    mut cancel_rx: oneshot::Receiver<()>,
) -> Result<(), String> {
    let response = client
        .post(url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("网络请求失败：{error}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        let summary: String = text.chars().take(300).collect();
        return Err(format!("AI 服务返回错误 {status}: {summary}"));
    }

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
                content: "hello".to_string(),
            }],
        };
        let json = serde_json::to_value(body).unwrap();
        assert_eq!(json["model"], "gpt-test");
        assert_eq!(json["stream"], true);
        assert_eq!(json["messages"][0]["role"], "user");
        assert_eq!(json["messages"][0]["content"], "hello");
    }
}
