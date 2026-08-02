# 语音输入设计

日期：2026-08-01
状态：草案

## 目标

为 Floating AI 增加语音输入：点击麦克风开始录音，边说话边转写实时上屏到输入框，停止后文本留在输入框待确认，按 Enter 发送。STT 支持自部署服务与第三方 API 两种方式，统一走 OpenAI 兼容 `/v1/audio/transcriptions` 端点。

## 需求摘要（用户决策）

| 维度 | 决策 |
| --- | --- |
| STT 引擎 | 自部署 + 第三方 API 的 HTTP 端点，统一为 OpenAI 兼容格式 |
| 触发方式 | 点击开始/停止（输入条麦克风按钮） |
| 采集层 | 前端 Web API：getUserMedia + MediaRecorder（WebM/Opus） |
| STT 配置 | 独立 STT 区块（base_url / model / api_key / language），默认复用聊天 base_url |
| 结果处理 | 转写文本实时填入输入框待确认，不自动发送 |
| 实时性 | 分段实时转写：录音中每约 2.5s 全量重传已录音频，文本实时替换上屏 |
| 时长限制 | 单次最长 60s，自动停止并转写 |

## 架构

```
┌────────────┐   audio Blob    ┌──────────────┐  multipart POST  ┌──────────────────┐
│ 前端录音    │ ──────────────► │ Rust 命令     │ ───────────────► │ STT 端点          │
│ MediaRecorder│ invoke(...)   │ transcribe_audio │ reqwest       │ /v1/audio/transcriptions │
│ 累积 chunks │               │ 读 settings   │                │ 自部署/第三方     │
└────────────┘ ◄────────────── └──────────────┘ ◄─────────────── └──────────────────┘
       setInput(文本)            data.text
```

- 采集在 Web（零 Rust 音频依赖、跨平台）
- 转写请求在 Rust（API Key 不暴露给前端、无 CORS 限制、复用 settings 存储）
- 自部署（`http://localhost:9000`）与第三方（OpenAI/兼容端点）仅 `stt_base_url` 配置差异

## 组件

### 1. 设置项扩展（`src-tauri/src/settings.rs`）

`StoredSettings` 新增字段（带默认值，向后兼容）：

```rust
pub stt_base_url: String,          // 默认 = 聊天 base_url 的当前值
pub stt_model: String,             // 默认 "whisper-1"
pub stt_api_key: Option<String>,   // 默认 None；留空回落聊天 api_key
pub stt_language: String,          // 默认 "auto"
```

- `AppSettings`（前端可读）新增 `stt_base_url` / `stt_model` / `stt_language` / `stt_api_key_configured`（不返回 key 明文）
- `SaveSettingsInput` 同步扩展
- `Default` 实现中 `stt_base_url` 取聊天 base_url 默认值常量，避免两处硬编码

### 2. Rust 命令（新模块 `src-tauri/src/voice.rs`）

```rust
#[tauri::command]
pub async fn transcribe_audio(
    app: tauri::AppHandle,
    audio: Vec<u8>,
    mime: String,
) -> Result<String, String>
```

- 读 settings → `resolve_stt_credentials`（stt_api_key 为空则回落聊天 api_key）→ reqwest multipart 构造
- 表单字段：`file`（mime 映射扩展名）、`model`、`language`（非 auto 时）
- 返回 `data.text`；错误映射为可读中文
- 纯函数（可测）：
  - `resolve_stt_credentials(stt: &StoredSettings) -> (String, Option<String>)` — key 回落
  - `build_stt_form(file: &[u8], mime: &str, model: &str, language: &str) -> multipart 构造参数`
  - `map_stt_error(status: Option<u16>, io: &str) -> String` — 401/网络/超时分类

依赖：`reqwest`（features: multipart、json）。新增 `src-tauri/src/voice.rs`，`lib.rs` 注册命令。

### 3. 前端录音与实时转写（`src/voice/useVoiceInput.ts` 新 hook）

状态机：

```
idle → recording → (transcribing) → recording → … → idle
```

- `start()`：getUserMedia({ audio: true }) → MediaRecorder → `dataavailable` 累积 chunks（不停止，持续追加）
- 每 2.5s 定时器：合并累积 Blob → `invoke(transcribe_audio)` → 返回文本 `setInput(实时替换)`
- `stop()`：recorder.stop → 最后一次转写 → 文本留在输入框
- 单次最长 60s 自动 stop
- 录音中：麦克风按钮变红脉冲、输入框 placeholder 显示"正在聆听…"、发送按钮禁用
- 清理：组件卸载 / Esc 收起时停止录音并释放 stream

依赖注入以便测试：`MediaRecorder`/`getUserMedia`/定时器通过参数或工厂传入，Vitest 单测状态机。

### 4. 前端按钮（`src/chat/AssistantPanel.tsx` + `src/styles/app.css`）

- composer-actions 新增麦克风 `IconButton`（Mic 图标，录音中切换 MicOff/红色脉冲）
- prompt 态与 response 态都有（composer 复用）
- 点击 → hook.start/stop；录音中显示录音时长（可选，58px 高度内用 tooltip 或小标签）

### 5. 权限（tauri capability / lib.rs）

- `getUserMedia` 在 Tauri 2 需 permission handler 放行麦克风（`PermissionType::Media`）
- 在 `lib.rs` setup 注册；具体配置方式（capability JSON 或 on_page_load）实现时验证，WebView2 首次会弹系统权限请求
- 拒绝权限 → 按钮提示「无法访问麦克风」并回 idle

### 6. 错误处理

| 场景 | 行为 |
| --- | --- |
| 无麦克风/拒绝权限 | 按钮提示「无法访问麦克风」，回 idle |
| STT 网络失败/超时（>30s） | 输入框下方短暂错误提示，保留已转文本，可重试 |
| 401 | 提示检查 STT API Key |
| 转写空文本 | 不覆盖输入框已有内容 |

## 测试策略

- Rust（纯函数单测）：
  - key 回落（stt_api_key 空 → 聊天 api_key）
  - multipart 表单构造（字段/文件名/mime）
  - 错误映射（401 / 网络 / 超时 → 中文提示）
- 前端：
  - 录音状态机（注入 mock MediaRecorder + fake timers）
  - 定时转写触发 setInput 实时替换
  - 停止后文本保留、发送按钮状态
  - 错误回落与空文本保护
- 保持现有测试全绿（Rust 31、前端 67）

## 非目标（YAGNI）

- 不做流式 WebSocket 转写（自部署/第三方普遍只支持非流式端点；分段全量重传已满足实时感）
- 不做按住说话、不做快捷键触发
- 不做音频本地保存/回放
- 不做设备选择 UI（用系统默认麦克风）

## 风险

- WebView2 麦克风权限配置方式需实现时验证（Tauri 2 permission handler）
- 分段全量重传在慢速自部署服务上延迟叠加，2.5s 间隔可能需按实测调整
- 转写中用户手动输入会被下一次分段结果覆盖（接受：录音中视为独占输入）
