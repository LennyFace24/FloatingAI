# 语音输入实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Floating AI 增加语音输入：点击麦克风录音，边说话边转写实时上屏到输入框，停止后文本待确认发送；STT 支持自部署与第三方 OpenAI 兼容端点。

**Architecture:** 前端 getUserMedia+MediaRecorder 采集并累积音频 Blob；Rust `transcribe_audio` 命令读 STT 设置（独立 base_url/model/api_key/language，key 留空回落聊天 key），用 reqwest multipart POST `/v1/audio/transcriptions`；返回文本由前端实时 setInput。录音中每 2.5s 全量重传已录音频实现"边说边出字"。

**Tech Stack:** 前端 Web Audio API（getUserMedia/MediaRecorder）、React hook、Vitest；Rust reqwest（multipart）、tauri command、settings 扩展。

## Global Constraints

- 保持现有测试全绿：前端 67（Vitest）、Rust 31（cargo test）
- 遵循现有模式：Rust 命令在 `lib.rs` 注册、`windows.rs`/`ai.rs` 已有 `settings::load_settings` 用法；前端命令封装在 `src/bridge/commands.ts`，表单在 `src/settings/settings.ts` + `SettingsPanel.tsx`
- STT 端点统一 OpenAI 兼容：`{stt_base_url}/v1/audio/transcriptions`，multipart 字段 `file`/`model`/`language`
- API Key 只在 Rust 侧，绝不进前端（沿用 `api_key_configured` 模式）
- 录音中视为独占输入：分段转写结果覆盖输入框
- 语言参数：`auto` 时不发送 `language` 字段；否则发送
- 单次录音 60s 上限，自动停止并做最终转写
- 纯黑灰 Graphite 风格：麦克风按钮复用现有 `IconButton`，录音中用红色脉冲类（纯色，无渐变）
- 前端测试注入 mock：MediaRecorder/getUserMedia/定时器/`commands.transcribeAudio` 全部可替换

---

### Task 1: Rust 设置项扩展（stt_* 字段）

**Files:**
- Modify: `src-tauri/src/settings.rs`

**Interfaces:**
- Consumes: 无（独立任务）
- Produces:
  - `StoredSettings` 新增字段：`stt_base_url: String`、`stt_model: String`、`stt_api_key: Option<String>`、`stt_language: String`
  - `AppSettings` 新增：`stt_base_url`、`stt_model`、`stt_api_key_configured: bool`、`stt_language`
  - `SaveSettingsInput` 新增同名字段（camelCase：`sttBaseUrl`、`sttModel`、`sttApiKey`、`sttLanguage`）
  - `SaveSettingsInput::into_stored` 处理 stt key 空值保留逻辑

- [ ] **Step 1: 写失败测试**（追加到 `src-tauri/src/settings.rs` 的 `mod tests`）

```rust
#[test]
fn default_stt_settings_fall_back_to_chat_base_url() {
    let settings = StoredSettings::default();
    assert_eq!(settings.stt_base_url, "https://api.openai.com/v1");
    assert_eq!(settings.stt_model, "whisper-1");
    assert_eq!(settings.stt_language, "auto");
    assert!(settings.stt_api_key.is_none());
}

#[test]
fn public_settings_expose_stt_configured_flag_only() {
    let stored = StoredSettings {
        stt_api_key: Some("sk-stt-secret".to_string()),
        ..StoredSettings::default()
    };
    let json = serde_json::to_value(AppSettings::from(stored)).unwrap();
    assert_eq!(json["sttApiKeyConfigured"], true);
    assert!(!json.to_string().contains("sk-stt-secret"));
}

#[test]
fn save_input_keeps_previous_stt_key_when_blank() {
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
        autostart_enabled: false,
        floating_always_on_top: true,
    };
    let stored = input.into_stored(previous);
    assert_eq!(stored.stt_api_key.as_deref(), Some("sk-stt-old"));
    assert_eq!(stored.stt_base_url, "http://localhost:9000/v1");
    assert_eq!(stored.stt_model, "large-v3");
    assert_eq!(stored.stt_language, "zh");
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: FAIL（`stt_base_url` 等字段不存在）

- [ ] **Step 3: 实现**

`StoredSettings` 结构体加 4 字段；`Default` 中 `stt_base_url` 复用聊天 base_url 默认值（同字符串 `"https://api.openai.com/v1"`）、`stt_model: "whisper-1"`、`stt_language: "auto"`、`stt_api_key: None`；`AppSettings` 加 `stt_api_key_configured`（`stt_api_key.as_ref().is_some_and(|k| !k.is_empty())`）+ 3 个透传字段；`SaveSettingsInput` 加 4 字段；`into_stored` 中 stt_api_key 用与 api_key 相同的 trim/保留逻辑，stt_base_url trim + trim_end_matches('/')，其余 trim。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS（34 个测试：原 31 + 新 3）

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/settings.rs
git commit -m "feat: add STT settings fields to settings store"
```

---

### Task 2: Rust voice 模块（transcribe_audio 命令 + 纯函数）

**Files:**
- Create: `src-tauri/src/voice.rs`
- Modify: `src-tauri/src/lib.rs`（注册命令 + `mod voice;`）
- Modify: `src-tauri/Cargo.toml`（reqwest 加 `multipart` feature）

**Interfaces:**
- Consumes: `settings::StoredSettings`（Task 1 的 stt_* 字段）、`settings::load_settings`
- Produces:
  - `pub async fn transcribe_audio(app: tauri::AppHandle, audio: Vec<u8>, mime: String) -> Result<String, String>`（tauri command）
  - `fn resolve_stt_credentials(settings: &StoredSettings) -> (String, Option<String>)` — 返回 (api_key, stt_api_key)，stt key 空回落聊天 key
  - `fn stt_url(base_url: &str) -> String` — `format!("{}/audio/transcriptions", base_url.trim_end_matches('/'))`
  - `fn map_stt_error(status: Option<u16>, kind: &str) -> String` — 中文错误分类

- [ ] **Step 1: 写失败测试**（`src-tauri/src/voice.rs` 底部 `#[cfg(test)] mod tests`）

```rust
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
        assert_eq!(resolve_stt_credentials(&settings), ("sk-chat".to_string(), None));
    }

    #[test]
    fn stt_credentials_prefer_own_key() {
        let settings = StoredSettings {
            stt_api_key: Some("sk-stt".to_string()),
            api_key: Some("sk-chat".to_string()),
            ..StoredSettings::default()
        };
        assert_eq!(resolve_stt_credentials(&settings), ("sk-chat".to_string(), Some("sk-stt".to_string())));
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml voice::tests`
Expected: FAIL（`resolve_stt_credentials` 等未定义）

- [ ] **Step 3: 实现 voice.rs**

```rust
use tauri::Emitter;
use crate::settings;

pub fn resolve_stt_credentials(settings: &settings::StoredSettings) -> (String, Option<String>) {
    let chat_key = settings.api_key.clone().unwrap_or_default();
    let stt_key = settings
        .stt_api_key
        .clone()
        .filter(|key| !key.is_empty());
    (chat_key, stt_key)
}

pub fn stt_url(base_url: &str) -> String {
    format!("{}/audio/transcriptions", base_url.trim_end_matches('/'))
}

pub fn map_stt_error(status: Option<u16>, kind: &str) -> String {
    match status {
        Some(401) => "语音识别鉴权失败，请检查 STT API Key".to_string(),
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
    let (_chat_key, stt_key) = resolve_stt_credentials(&stored);
    let api_key = stt_key.or_else(|| stored.api_key.clone().filter(|k| !k.is_empty()))
        .ok_or_else(|| "请先在设置中配置 API Key 或 STT API Key".to_string())?;

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
        .send()
        .await
        .map_err(|e| map_stt_error(None, &e.to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(map_stt_error(Some(status.as_u16()), ""));
    }
    let body: serde_json::Value = response.json().await.map_err(|e| map_stt_error(None, &e.to_string()))?;
    body.get("text")
        .and_then(|t| t.as_str())
        .map(|t| t.to_string())
        .ok_or_else(|| "语音识别响应缺少 text 字段".to_string())
}
```

- [ ] **Step 4: 注册命令**

`src-tauri/src/lib.rs`：
- 顶部加 `mod voice;`
- `pub fn run()` 的 `invoke_handler` 数组加 `voice::transcribe_audio`

`src-tauri/Cargo.toml`：`reqwest = { version = "0.12", default-features = false, features = ["json", "stream", "rustls-tls", "multipart"] }`

- [ ] **Step 5: 运行测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS（38 个测试）

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/voice.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat: add transcribe_audio command with STT credential fallback"
```

---

### Task 3: 前端命令封装 + 设置表单扩展

**Files:**
- Modify: `src/bridge/commands.ts`
- Modify: `src/settings/settings.ts`
- Modify: `src/settings/SettingsPanel.tsx`
- Modify: `src/App.tsx`（加载/保存 settings 时传递 stt 字段）

**Interfaces:**
- Consumes: Rust `get_settings`/`save_settings`（Task 1 的 stt 字段）、`transcribe_audio`（Task 2）
- Produces:
  - `commands.transcribeAudio(audio: Uint8Array, mime: string): Promise<string>`
  - `SettingsFormInput` 新增 `sttBaseUrl`/`sttModel`/`sttApiKey`/`sttLanguage`
  - `SettingsPanel` 新增「语音识别」区块表单

- [ ] **Step 1: 写失败测试**（`src/settings/settings.test.ts` 追加，若文件不存在则创建）

```ts
import { describe, expect, it } from 'vitest';
import { normalizeSettingsForm, validateSettingsForm, defaultSettingsForm, type SettingsFormInput } from './settings';

describe('settings form STT fields', () => {
  it('normalizes stt base url trailing slash and language trim', () => {
    const input: SettingsFormInput = {
      ...defaultSettingsForm,
      sttBaseUrl: 'http://localhost:9000/v1/',
      sttModel: ' large-v3 ',
      sttLanguage: ' zh ',
    };
    const normalized = normalizeSettingsForm(input);
    expect(normalized.sttBaseUrl).toBe('http://localhost:9000/v1');
    expect(normalized.sttModel).toBe('large-v3');
    expect(normalized.sttLanguage).toBe('zh');
  });

  it('accepts empty stt base url falling back to chat default', () => {
    const input: SettingsFormInput = { ...defaultSettingsForm, sttBaseUrl: '' };
    expect(validateSettingsForm(input)).not.toHaveProperty('sttBaseUrl');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test settings`
Expected: FAIL（`sttBaseUrl` 不存在）

- [ ] **Step 3: 实现前端设置字段**

`src/settings/settings.ts`：
```ts
export interface SettingsFormInput {
  apiKey: string;
  baseUrl: string;
  model: string;
  globalShortcut: string;
  autostartEnabled: boolean;
  floatingAlwaysOnTop: boolean;
  sttBaseUrl: string;
  sttModel: string;
  sttApiKey: string;
  sttLanguage: string;
}

export const defaultSettingsForm: SettingsFormInput = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  globalShortcut: 'Alt+Space',
  autostartEnabled: false,
  floatingAlwaysOnTop: true,
  sttBaseUrl: 'https://api.openai.com/v1',
  sttModel: 'whisper-1',
  sttApiKey: '',
  sttLanguage: 'auto',
};
```
`normalizeSettingsForm` 加：`sttBaseUrl: input.sttBaseUrl.trim().replace(/\/$/, '')`、`sttModel: input.sttModel.trim()`、`sttApiKey: input.sttApiKey.trim()`、`sttLanguage: input.sttLanguage.trim()`。

`src/bridge/commands.ts`：
- `AppSettings` 接口加 `sttBaseUrl: string; sttModel: string; sttApiKeyConfigured: boolean; sttLanguage: string;`
- `SaveSettingsInput` 加 `sttBaseUrl: string; sttModel: string; sttApiKey?: string; sttLanguage: string;`
- `commands` 加：`transcribeAudio: (audio: Uint8Array, mime: string) => invoke<string>('transcribe_audio', { audio, mime }),`

`src/settings/SettingsPanel.tsx` 在「始终置顶」checkbox 后加「语音识别」区块（aria-label 与现有命名风格一致）：
- STT Base URL（text，placeholder `http://localhost:9000/v1`）
- STT 模型（text，placeholder `whisper-1`）
- STT API Key（password，placeholder「留空则使用聊天 API Key」）
- 语言（select：auto / zh / en，aria-label「转写语言」）

`src/App.tsx`：settings 加载时把 `sttBaseUrl`/`sttModel`/`sttApiKeyConfigured`/`sttLanguage` 映射进 form（sttApiKey 初始为空字符串）；保存时把 `sttBaseUrl`/`sttModel`/`sttApiKey`/`sttLanguage` 传入 `saveSettings`（apiKeyConfigured 时 sttApiKey 传空字符串表示保留）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS（前端 67 + 新测试）

- [ ] **Step 5: 提交**

```bash
git add src/bridge/commands.ts src/settings/settings.ts src/settings/SettingsPanel.tsx src/App.tsx src/settings/settings.test.ts
git commit -m "feat: add STT settings form and transcribe command binding"
```

---

### Task 4: 前端 useVoiceInput hook（录音 + 分段实时转写）

**Files:**
- Create: `src/voice/useVoiceInput.ts`
- Create: `src/voice/useVoiceInput.test.ts`

**Interfaces:**
- Consumes: `commands.transcribeAudio`（Task 3）
- Produces:
  - `interface UseVoiceInputOptions { onTranscript: (text: string) => void; onError?: (message: string) => void; intervalMs?: number; maxDurationMs?: number; mediaRecorderFactory?: ... }`
  - `interface UseVoiceInputResult { status: 'idle' | 'recording'; start: () => Promise<void>; stop: () => Promise<void>; }`
  - 注入：`getUserMedia`、`MediaRecorder`、`setInterval`/`clearInterval`、`commands.transcribeAudio` 全部通过 options 可替换（默认用全局）

- [ ] **Step 1: 写失败测试**（mock MediaRecorder、fake timers、mock commands.transcribeAudio）

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVoiceInput, type VoiceMediaRecorder, type VoiceMediaStream } from './useVoiceInput';

function createRecorderMock() {
  const handlers: Record<string, () => void> = {};
  const recorder: VoiceMediaRecorder = {
    start: vi.fn(),
    stop: vi.fn(() => { handlers.onstop?.(); }),
    ondataavailable: null,
    onstop: null,
  };
  return { recorder, emit: (event: string) => handlers[event]?.() };
}

describe('useVoiceInput', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts recording and emits chunks, then stops with final transcript', async () => {
    const { recorder } = createRecorderMock();
    const transcribe = vi.fn().mockResolvedValue('你好世界');
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({
      onTranscript,
      transcribe,
      getUserMedia: vi.fn().mockResolvedValue({} as VoiceMediaStream),
      mediaRecorderFactory: vi.fn().mockReturnValue(recorder),
    }));

    await act(async () => { await result.current.start(); });
    expect(recorder.start).toHaveBeenCalled();
    expect(result.current.status).toBe('recording');

    // 模拟 dataavailable 累积音频块
    act(() => { recorder.ondataavailable?.({ data: new Blob(['chunk1']) } as BlobEvent); });

    // 2.5s 定时触发分段转写
    await act(async () => { vi.advanceTimersByTime(2500); });
    await waitFor(() => expect(transcribe).toHaveBeenCalled());
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('你好世界'));

    // 停止后最后转写
    act(() => { void result.current.stop(); });
    await waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
  });

  it('auto-stops at max duration and releases the stream', async () => {
    const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as VoiceMediaStream;
    const { recorder } = createRecorderMock();
    const { result } = renderHook(() => useVoiceInput({
      onTranscript: vi.fn(),
      transcribe: vi.fn().mockResolvedValue(''),
      getUserMedia: vi.fn().mockResolvedValue(stream),
      mediaRecorderFactory: vi.fn().mockReturnValue(recorder),
      maxDurationMs: 60_000,
    }));

    await act(async () => { await result.current.start(); });
    await act(async () => { vi.advanceTimersByTime(60_001); });
    expect(recorder.stop).toHaveBeenCalled();
    expect(stream.getTracks()[0].stop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test useVoiceInput`
Expected: FAIL（`useVoiceInput` 不存在）

- [ ] **Step 3: 实现 useVoiceInput.ts**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { commands } from '../bridge/commands';

export type VoiceStatus = 'idle' | 'recording';

export interface VoiceMediaStream { getTracks(): { stop(): void }[] }
export interface VoiceMediaRecorder {
  start(): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
}

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  intervalMs?: number;
  maxDurationMs?: number;
  transcribe?: (audio: Uint8Array, mime: string) => Promise<string>;
  getUserMedia?: (constraints: { audio: boolean }) => Promise<VoiceMediaStream>;
  mediaRecorderFactory?: (stream: VoiceMediaStream) => VoiceMediaRecorder;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export function useVoiceInput({
  onTranscript,
  onError,
  intervalMs = 2500,
  maxDurationMs = 60_000,
  transcribe = (audio, mime) => commands.transcribeAudio(audio, mime),
  getUserMedia = (constraints) => navigator.mediaDevices.getUserMedia(constraints) as Promise<VoiceMediaStream>,
  mediaRecorderFactory,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}: UseVoiceInputOptions) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const chunksRef = useRef<Blob[]>([]);
  const recorderRef = useRef<VoiceMediaRecorder | null>(null);
  const streamRef = useRef<VoiceMediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const transcribeRef = useRef(transcribe);
  transcribeRef.current = transcribe;

  const transcribeChunks = useCallback(async () => {
    const chunks = chunksRef.current;
    if (chunks.length === 0) return;
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    try {
      const text = await transcribeRef.current(buffer, blob.type);
      if (text.trim()) onTranscriptRef.current(text.trim());
    } catch (error) {
      onErrorRef.current?.(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const cleanup = useCallback(() => {
    if (intervalRef.current) {
      clearIntervalFn(intervalRef.current);
      intervalRef.current = null;
    }
    const recorder = recorderRef.current;
    if (recorder && typeof recorder.onstop === 'function') {
      // 保留 onstop 供最终转写使用
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, [clearIntervalFn]);

  const stop = useCallback(async () => {
    if (status !== 'recording') return;
    const recorder = recorderRef.current;
    recorder?.stop(); // 触发 onstop → 最终转写 + cleanup
  }, [status]);

  const start = useCallback(async () => {
    if (status !== 'idle') return;
    try {
      const stream = await getUserMedia({ audio: true });
      streamRef.current = stream;
      const RecorderCtor = mediaRecorderFactory;
      const recorder = RecorderCtor
        ? RecorderCtor(stream)
        : new (window as any).MediaRecorder(stream as MediaStream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        clearIntervalFn(intervalRef.current as ReturnType<typeof setInterval>);
        intervalRef.current = null;
        await transcribeChunks();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setStatus('idle');
      };
      recorder.start();
      setStatus('recording');
      intervalRef.current = setIntervalFn(() => { void transcribeChunks(); }, intervalMs);
      setIntervalFn(() => { void stop(); }, maxDurationMs); // 一次性超时停止
    } catch (error) {
      onErrorRef.current?.(error instanceof Error ? error.message : String(error));
      setStatus('idle');
    }
  }, [status, getUserMedia, mediaRecorderFactory, intervalMs, maxDurationMs, setIntervalFn, clearIntervalFn, transcribeChunks, stop]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearIntervalFn(intervalRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [clearIntervalFn]);

  return { status, start, stop };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test useVoiceInput`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/voice/useVoiceInput.ts src/voice/useVoiceInput.test.ts
git commit -m "feat: add live voice input hook with chunked transcription"
```

---

### Task 5: 输入条麦克风按钮接入

**Files:**
- Modify: `src/chat/AssistantPanel.tsx`
- Modify: `src/styles/app.css`
- Modify: `src/chat/AssistantPanel.test.tsx`

**Interfaces:**
- Consumes: `useVoiceInput`（Task 4）、`IconButton`、Mic/MicOff 图标（`src/ui/icons` 现有导出或新增）
- Produces: 无（终端 UI 任务）

- [ ] **Step 1: 写失败测试**（`src/chat/AssistantPanel.test.tsx` 追加）

```tsx
it('renders a mic button that starts live voice input', async () => {
  render(<AssistantPanel conversation={promptPhase} {...callbacks} />);
  expect(screen.getByRole('button', { name: '语音输入' })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test AssistantPanel`
Expected: FAIL（无「语音输入」按钮）

- [ ] **Step 3: 实现**

`src/chat/AssistantPanel.tsx`：
- 引入 `useVoiceInput`、`Mic`/`MicOff` 图标（`src/ui/icons` 中新增导出，仿现有 `Wrench`/`Minus` 的 lucide 图标导入方式）
- 在组件顶部：
```tsx
const [voiceError, setVoiceError] = useState('');
const { status: voiceStatus, start: startVoice, stop: stopVoice } = useVoiceInput({
  onTranscript: (text) => setInput((prev) => (prev ? prev : text) || text),
  onError: setVoiceError,
});
```
- composer 内 textarea 之后、actions 之前（或 actions 内最前）加：
```tsx
<IconButton
  label={voiceStatus === 'recording' ? '停止录音' : '语音输入'}
  tooltip={voiceStatus === 'recording' ? '停止录音' : '语音输入'}
  className={voiceStatus === 'recording' ? 'voice-active' : undefined}
  onClick={() => { void (voiceStatus === 'recording' ? stopVoice() : startVoice()); }}
>
  {voiceStatus === 'recording' ? <MicOff size={16} /> : <Mic size={16} />}
</IconButton>
```
- placeholder 录音中切换：`placeholder={voiceStatus === 'recording' ? '正在聆听…' : '> 输入问题…'}`
- 发送按钮禁用条件加 `|| voiceStatus === 'recording'`
- `voiceError` 显示：composer 下加 `<p className="voice-error" role="alert">{voiceError}</p>`（有值时）
- 录音中 textarea disabled

`src/styles/app.css` 加：
```css
.icon-button.voice-active { color: #ff6b6b; border-color: #7a3a3a; }
.voice-active .waiting-indicator { animation: voice-pulse 1.2s ease-in-out infinite; }
@keyframes voice-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.voice-error { margin: 0; padding: 4px 12px; color: #ff6b6b; font-size: 11px; }
```
（纯色脉冲，无渐变，符合 Graphite 约束）

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/chat/AssistantPanel.tsx src/styles/app.css src/chat/AssistantPanel.test.tsx src/ui/icons.tsx
git commit -m "feat: wire mic button to live voice input in composer"
```

---

### Task 6: 麦克风权限配置（capability）

**Files:**
- Modify: `src-tauri/capabilities/default.json`（或 desktop.json）
- Modify: `src-tauri/src/lib.rs`（setup 中注册权限处理，如需要）

**Interfaces:**
- Consumes: 无
- Produces: WebView2 `getUserMedia` 麦克风可用

- [ ] **Step 1: 确认权限机制**

Run: `pnpm tauri info` 或查 Tauri 2 文档确认当前版本（2.11.5）麦克风权限配置方式：capability 文件加权限，或 `App::run` 的 builder 用 `.setup(|app| ...)` 注册 `app.on_page_load` / `permission` handler。

Tauri 2 WebView2 上 `getUserMedia` 默认被 WebView2 拦截，需要在 capability 中加入 `"core:default"` 之外、与媒体相关的权限；若不存在对应 capability 权限，则在 `lib.rs` 的 `setup` 中注册 `tauri::WebviewWindowBuilder` 权限或使用 `app.on_page_load(|webview, _| { ... })` 处理 `PermissionType::Media` 请求并返回 `true`（允许）。

实现：在 `src-tauri/src/lib.rs` 的 `run()` 里 `.setup(|app| { ... })` 中为窗口注册媒体权限放行；具体以 Tauri 2.11 实际 API 为准（若 API 为 capability 权限字符串，则直接加到 `capabilities/default.json` 的 `permissions` 数组；若为运行时 handler，则注册 handler）。参考：Tauri 2 有 `tauri::window::PermissionType` 与 `Window::on_window_event` / `WebviewWindowBuilder` 的权限回调。

- [ ] **Step 2: 实现权限放行**

按 Step 1 确认的方式实现（capability 权限或运行时 handler），使 `navigator.mediaDevices.getUserMedia({ audio: true })` 在 `floating` 窗口可用。

- [ ] **Step 3: 编译验证**

Run: `cargo check --manifest-path src-tauri/Cargo.toml && pnpm build`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src-tauri/capabilities/default.json src-tauri/src/lib.rs
git commit -m "feat: allow microphone access for voice input"
```

---

### Task 7: 集成验证 + 全量回归

**Files:**
- 无新文件（验证 + 收尾）

**Interfaces:**
- Consumes: Task 1-6 全部

- [ ] **Step 1: 全量测试**

Run: `cargo test --manifest-path src-tauri/Cargo.toml && pnpm test && pnpm build && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: Rust 全绿（38+）、前端全绿（67+ 新测试）、build 通过

- [ ] **Step 2: 手动冒烟验证**

Run: `pnpm tauri dev`
手动验证清单：
1. 设置页 → 语音识别区块 → 填自部署地址（如 `http://localhost:9000/v1`）或第三方兼容地址，保存
2. 输入条点麦克风 → 系统弹麦克风权限请求 → 允许
3. 说话 → 约 2.5s 后输入框出现实时文本（边说边出字）
4. 停止 → 文本保留在输入框，可编辑，Enter 发送
5. 连续录音 60s → 自动停止
6. 拒绝麦克风权限 → 按钮提示「无法访问麦克风」
7. 填错误 STT 地址 → 出现中文错误提示
8. 缩小/放大路径、悬浮球拖动无回归

- [ ] **Step 3: 更新 README**

`README.md` 功能清单加「语音输入」；使用表加麦克风行；配置表加 STT 区块（Base URL / 模型 / API Key / 语言）。

- [ ] **Step 4: 提交**

```bash
git add README.md
git commit -m "docs: document voice input feature"
```
