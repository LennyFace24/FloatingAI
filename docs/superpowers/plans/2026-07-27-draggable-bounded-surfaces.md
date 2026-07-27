# Draggable Bounded Surfaces Implementation Plan

> **For agentic workers:** Execute inline in the main session. Steps use checkbox syntax for tracking.

**Goal:** 让输入条、等待球、回复页和设置页均可原生跟手拖动，并在程序打开设置页时保证窗口完整位于当前显示器工作区。

**Architecture:** 前端抽取共享的 4 px 指针阈值拖动 hook，复用现有 `start_floating_drag` 原生命令；交互控件与滚动区显式排除。Rust `SurfaceGeometry` 增加设置页夹紧纯函数，`show_settings_panel` 只在打开时一次提交合法位置和尺寸。

**Tech Stack:** React 19、TypeScript、Vitest、Tauri 2、Rust、windows-sys。

## Global Constraints

- 不使用子代理或子任务。
- 拖动达到 4 px 后只启动一次原生拖动；单击行为与拖动互斥。
- textarea、按钮、表单、复选框和消息滚动区不启动拖动。
- 设置页程序打开时完整位于当前显示器工作区；用户之后主动拖出屏幕不自动拉回。
- 目标设置尺寸 460×560 logical px；超出工作区时先缩小。
- 多显示器负坐标与缩放必须正确。

### Task 1: Shared native window drag gesture

**Files:**
- Create: `src/window/useWindowDrag.ts`
- Create: `src/window/useWindowDrag.test.tsx`
- Modify: `src/floating/FloatingBall.tsx`
- Modify: `src/floating/FloatingBall.test.tsx`
- Modify: `src/chat/AssistantPanel.tsx`
- Modify: `src/chat/AssistantPanel.test.tsx`
- Modify: `src/settings/SettingsPanel.tsx`
- Modify: `src/settings/SettingsPanel.test.tsx`

- [ ] 写失败测试：3 px 不拖动、4 px 只调用一次、拖动抑制 click、交互后代不拖动。
- [ ] 运行定向测试并确认因共享 hook/行为缺失失败。
- [ ] 实现共享 hook，并接入悬浮球、输入条、等待球、回复页和设置页。
- [ ] 标记消息列表和设置表单为拖动排除区。
- [ ] 运行定向测试确认通过。

### Task 2: Clamp settings bounds on programmatic open

**Files:**
- Modify: `src-tauri/src/windows.rs`

- [ ] 写失败 Rust 测试：底部越界、右侧越界、负坐标副屏、1.5× 缩放、目标大于工作区。
- [ ] 运行定向测试并确认夹紧函数缺失导致失败。
- [ ] 在 `SurfaceGeometry` 实现设置页 bounds 计算，尺寸先限制、位置再 clamp。
- [ ] 更新 `show_settings_panel` 使用一次 `set_window_bounds`，不在移动事件中持续夹紧。
- [ ] 运行定向 Rust 测试和 `cargo check`。

### Task 3: Verification and commit

- [ ] 运行 `pnpm test`。
- [ ] 运行 `pnpm build`。
- [ ] 运行 `cargo test --manifest-path src-tauri/Cargo.toml`。
- [ ] 运行 `cargo check --manifest-path src-tauri/Cargo.toml`。
- [ ] 启动桌面程序检查拖动和设置页位置；无法自动操作时明确记录限制。
- [ ] 检查工作区并提交，不自动推送。
