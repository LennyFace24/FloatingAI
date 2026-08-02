# 设置页拆页 + 小米 MiMo ASR 第二引擎设计

日期：2026-08-02
状态：草案

## 目标

1. 设置页重构为三视图：入口页（聊天设置 / 语音设置入口卡片）→ 聊天设置子页（现有字段）→ 语音设置子页（现有 STT 字段 + 服务类型下拉）
2. 语音识别新增第二引擎：小米 MiMo ASR（`mimo-v2.5-asr`），与现有 OpenAI 兼容引擎并列，设置页单下拉切换

## 需求摘要（用户决策）

| 维度 | 决策 |
| --- | --- |
| 设置页导航 | 二级入口页：入口页两卡片 → 子页，各自有返回 |
| 服务类型 | 语音设置页内单下拉切换 `OpenAI 兼容` / `小米 MiMo` |
| 聊天/语音模型 | 完全独立解耦（语音用语音模型，聊天用聊天模型） |
| MiMo 实时转写 | 与现状一致的分段全量重传（2.5s） |
| MiMo 配置 | Key + 语言 + 模型（可编辑）；base_url 固定默认 `https://api.xiaomimimo.com/v1` |
| 协议 | MiMo 走 `/chat/completions` + `input_audio` 消息（base64），非 multipart |

## 架构

```
前端设置页                          Rust
┌──────────────────────┐          ┌─────────────────────────────┐
│ 入口页 (root)         │          │ settings.rs                 │
│  ├ 聊天设置 → chat    │          │  StoredSettings             │
│  └ 语音设置 → voice   │          │   + stt_provider: "openai"  │
├──────────────────────┤          │       | "mimo"              │
│ 聊天子页 (chat)       │          │                             │
│  现有字段（不动）      │ save ──► │ voice.rs                     │
├──────────────────────┤          │  transcribe_audio           │
│ 语音子页 (voice)      │          │  ├ provider=="openai"        │
│  服务类型下拉          │          │  │  → multipart /audio/...   │
│  ├ OpenAI: Base/模型/Key/语言 │  │  └ provider=="mimo"          │
│  └ MiMo: Key/模型/语言 │          │     → JSON /chat/completions │
└──────────────────────┘          └─────────────────────────────┘
```

- 三视图共用 460×560 窗口；子页导航是纯前端状态切换，不触发窗口动画
- MiMo 协议：`POST {base_url}/chat/completions`，`Authorization: Bearer {key}`，JSON body
- 语音识别与聊天完全解耦：MiMo 只用于 STT，聊天仍走设置页聊天模型的 OpenAI 兼容配置

## 组件

### 1. Rust 设置项（`src-tauri/src/settings.rs`）

`StoredSettings` 新增：
```rust
pub stt_provider: String,   // "openai" | "mimo"，默认 "openai"
```

- `AppSettings` 加 `stt_provider`（透传）
- `SaveSettingsInput` 加 `stt_provider`（camelCase `sttProvider`），`into_stored` 空串保留 previous
- MiMo 固定 base_url 常量：`const MIMO_BASE_URL: &str = "https://api.xiaomimimo.com/v1";`（放 voice.rs，作为 stt_base_url 的默认值提示）

### 2. Rust voice 模块（`src-tauri/src/voice.rs`）

`transcribe_audio` 按 `stt_provider` 分支：

```rust
pub async fn transcribe_audio(app, audio: Vec<u8>, mime: String) -> Result<String, String> {
    let stored = settings::load_settings(&app)?;
    if stored.stt_provider == "mimo" {
        transcribe_mimo(&stored, &audio, &mime).await
    } else {
        transcribe_openai(&stored, &audio, &mime).await
    }
}
```

纯函数（可测）：
- `fn build_mimo_chat_body(audio: &[u8], mime: &str, model: &str, language: &str) -> serde_json::Value`
  ```json
  {
    "model": "mimo-v2.5-asr",
    "messages": [{
      "role": "user",
      "content": [{
        "type": "input_audio",
        "input_audio": { "data": "data:audio/wav;base64,<base64>" }
      }]
    }],
    "asr_options": { "language": "auto" }   // language != "auto" 时才含此字段
  }
  ```
- `fn parse_mimo_transcript(body: &serde_json::Value) -> Option<String>` — 取 `choices[0].message.content`

实现 `transcribe_mimo`：
```rust
async fn transcribe_mimo(stored, audio, mime) -> Result<String, String> {
    let key = stt_api_key 或回落 chat key，缺 → 错误;
    let url = format!("{}/chat/completions", stored.stt_base_url.trim_end_matches('/'));
    let body = build_mimo_chat_body(audio, mime, &stored.stt_model, &stored.stt_language);
    let resp = client.post(&url).bearer_auth(&key).json(&body)
        .timeout(30s).send().await.map_err(...)?;
    let status = resp.status();
    let json: Value = resp.json().await.map_err(...)?;
    if !status.is_success() { return Err(map_stt_error(...)); }
    parse_mimo_transcript(&json).ok_or("语音识别响应缺少文本")
}
```

- mime → data URI 前缀映射：`audio/wav → audio/wav`、`audio/webm → audio/webm`、`audio/mp3 → audio/mpeg`、其他原样
- 复用现有 `resolve_api_key`、`map_stt_error`、`.timeout(30s)` 模式

### 3. 前端设置页三视图（`src/settings/SettingsPanel.tsx` + `settings.ts` + `app.css`）

`settings.ts`：
```ts
export type SettingsView = 'root' | 'chat' | 'voice';

export interface SettingsFormInput {
  // 现有字段 ...
  sttProvider: string;          // "openai" | "mimo"
  // 现有 stt 字段（sttBaseUrl/sttModel/sttApiKey/sttLanguage）
}
export const defaultSettingsForm = {
  // ...
  sttProvider: 'openai',
  sttBaseUrl: 'https://api.openai.com/v1',  // OpenAI 默认；选 mimo 时表单显示 MIMO_BASE_URL
  sttModel: 'whisper-1',
  sttApiKey: '',
  sttLanguage: 'auto',
};
```

`SettingsPanel.tsx`：
- 新增 `view` state（`useState<SettingsView>('root')`）
- `view === 'root'`：渲染两个入口卡片（`聊天设置` / `语音设置`，点击 `setView('chat'|'voice')`），沿用 surface-panel 布局
- `view === 'chat'`：现有完整表单（API Key/Base URL/模型/快捷键/自启动/置顶），header 加返回箭头（← 回 root）
- `view === 'voice'`：语音表单（服务类型下拉 + 按类型显示字段），header 加返回箭头
- 保存按钮只在 chat/voice 子页显示（root 页无保存）

语音子页字段（按 sttProvider）：
- 服务类型 `<select aria-label="语音服务类型">`：`OpenAI 兼容`(openai) / `小米 MiMo`(mimo)
- 选 `openai`：STT Base URL / STT 模型 / STT API Key / 语言
- 选 `mimo`：STT 模型（默认 `mimo-v2.5-asr`，可编辑）/ STT API Key / 语言（Base URL 隐藏，固定用 MIMO_BASE_URL——保存时若 provider=mimo 且 sttBaseUrl 为空则填 MIMO_BASE_URL）

`App.tsx`：
- 加载：`sttProvider` 映射进表单
- 保存：`sttProvider` 透传；若 provider=mimo 且 sttBaseUrl 空 → 填 `https://api.xiaomimimo.com/v1`

`app.css`：入口卡片样式（纯黑灰 Graphite，遵循现有 card/button 模式）+ 返回箭头 IconButton 复用现有图标（`ArrowLeft` 或 `ChevronLeft`，仿 Wrench 导出）。

### 4. 错误处理

| 场景 | 行为 |
| --- | --- |
| MiMo key 缺失 | 提示「请先配置 API Key 或语音 API Key」（复用现有） |
| MiMo 401/404/超时 | 复用 `map_stt_error`（401→API Key、404→端点、超时→中文提示） |
| 响应缺 `choices[0].message.content` | 「语音识别响应缺少文本」 |
| 服务类型切换 | 表单字段即时切换显示；切换不清空已填字段（保留两套配置） |

### 5. 测试策略

- Rust（纯函数）：
  - `build_mimo_chat_body`：audio base64 编码正确、data URI 前缀、model/language 字段、language=auto 时不发 asr_options
  - `parse_mimo_transcript`：正常取 content、缺 choices/缺 content 返回 None
  - `transcribe_mimo` 的 key 回落（stt key 空 → chat key）
- 前端：
  - SettingsPanel 三视图：root 渲染两卡片、点击进 chat/voice、返回回 root
  - 服务类型切换：选 mimo 显示 Key/模型/语言、隐藏 Base URL；选 openai 显示全部
  - 保存时 provider=mimo 且 baseUrl 空 → 填 MIMO_BASE_URL
- 保持现有测试全绿（Rust 43、前端 77）

## 非目标（YAGNI）

- 不做 MiMo 的 SSE 流式识别（分段全量重传已满足实时感，与 OpenAI 路径统一）
- 不做聊天模型的 MiMo 引擎（用户明确：语音用语音模型、聊天用聊天模型，聊天保持 OpenAI 兼容）
- 不做 TTS（文字转语音）——那是另一个方向，本次仅 STT 第二引擎

## 风险

- MiMo 文档的 `asr_options` 在 body 顶层 vs `extra_body`：OpenAI SDK 的 extra_body 会并入请求体顶层，所以 body 顶层 `asr_options` 正确（SDK 示例证实）
- `input_audio.data` 的 mime 前缀：MiMo 示例用 `audio/wav`，前端 MediaRecorder 默认产出 `audio/webm`——若 MiMo 不接受 webm 需转 wav 或接受。实现时先按文档格式传 `audio/webm`（若失败，报错提示换 OpenAI 引擎）；文档示例明确只给了 wav，标为已知风险
- `stt_base_url` 在 provider=mimo 时若用户填了别的值，拼接 `/chat/completions` 可能指向错误端点——表单在 mimo 时隐藏 Base URL 且保存时强制 MIMO_BASE_URL，规避此风险
