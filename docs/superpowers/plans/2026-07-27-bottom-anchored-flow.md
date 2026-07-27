# Bottom-Anchored Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将悬浮球改为无 IPC 积压的原生跟手拖动，并实现底部居中的输入条、加载球、首字展开、动态高度回复和连续对话。

**Architecture:** 保持单个 Tauri `floating` 窗口。Rust `windows` 模块拥有窗口边界、工作区定位、拖动会话和底边锚定尺寸；React 使用明确的 `prompt | waiting | response` 展示阶段。前端只发送离散状态和最新内容高度，不逐帧驱动拖动。

**Tech Stack:** Tauri 2、Rust 2021、windows-sys、React 19、TypeScript、Vitest、Testing Library。

## Global Constraints

- 单窗口标签继续使用 `floating`；禁止新增输入、加载或回复子窗口。
- 输入条逻辑尺寸固定为 640×58 px，底边距离当前显示器工作区底边 72 px。
- 加载球逻辑尺寸固定为 50×50 px。
- 回复窗口逻辑高度限制为 120–560 px，底边固定，仅向上增长。
- 首个非空流式字符到达后立即展开。
- 回复区与输入框在首字到达后同时常驻；同一时刻只允许一个请求。
- 保留 Graphite Terminal 纯黑灰视觉，禁止渐变、发光、噪声、雾化和闪烁。
- 原始 HTML 保持禁用；Markdown、代码高亮、复制和 LaTeX 保持可用。
- 每项行为变更使用红→绿测试循环；每个任务独立提交。

---

### Task 1: Native live drag session

**Files:**
- Modify: `src-tauri/src/windows.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src/bridge/commands.ts`
- Modify: `src/floating/FloatingBall.tsx`
- Modify: `src/floating/FloatingBall.test.tsx`
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Produces: Tauri command `start_floating_drag() -> Result<(), String>`。
- Consumes: 前端只在越过 4 px 阈值时调用 `commands.startFloatingDrag()` 一次。
- Invariant: JavaScript 不再调用 `outerPosition()`、`setPosition()` 或 `requestAnimationFrame()` 移动悬浮球。

- [ ] **Step 1: Write the failing frontend drag test**

将窗口 mock 改为 `startFloatingDrag` command mock，断言越过阈值只调用一次、后续 pointer move 不重复调用、click 被抑制；断言不再暴露或调用 `setPosition`。

```tsx
fireEvent.pointerDown(button, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
fireEvent.pointerMove(button, { clientX: 20, clientY: 20, pointerId: 1, buttons: 1 });
fireEvent.pointerMove(button, { clientX: 30, clientY: 30, pointerId: 1, buttons: 1 });
expect(startFloatingDrag).toHaveBeenCalledOnce();
```

- [ ] **Step 2: Run the frontend test and verify RED**

Run: `pnpm test src/floating/FloatingBall.test.tsx`

Expected: FAIL because `FloatingBall` still calls `outerPosition`/`setPosition` and no `startFloatingDrag` command exists.

- [ ] **Step 3: Add native drag geometry tests**

Extract pure helpers in `windows.rs`:

```rust
fn drag_position(cursor: PhysicalPosition<i32>, offset: PhysicalPosition<i32>) -> PhysicalPosition<i32>;
fn crossed_drag_threshold(start: PhysicalPosition<i32>, current: PhysicalPosition<i32>) -> bool;
```

Test exact offset preservation and 4 px threshold boundaries.

- [ ] **Step 4: Run Rust tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml windows::tests::drag_`

Expected: compilation FAIL because helpers do not exist.

- [ ] **Step 5: Implement `start_floating_drag`**

On Windows, obtain the HWND, capture current cursor and window origin, then run a native move loop that reads the latest cursor position and applies `SetWindowPos(..., SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER)` until the left button is released. Do not enqueue historical coordinates. Yield 1–4 ms between reads to avoid a busy loop. Other desktop platforms use Tauri native `start_dragging()` behind the same Rust command; no JavaScript position loop remains.

Register the command in `lib.rs`, expose `commands.startFloatingDrag()` in `commands.ts`, and remove the obsolete window position capability permissions.

- [ ] **Step 6: Replace FloatingBall movement logic**

Keep pointer threshold and click suppression. At first threshold crossing, clear pointer start and call `commands.startFloatingDrag()` once. Remove `PhysicalPosition`, `outerPosition`, `setPosition`, pending position, and frame refs.

- [ ] **Step 7: Verify Task 1 GREEN**

Run:

```text
pnpm test src/floating/FloatingBall.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml windows::tests::drag_
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all pass.

- [ ] **Step 8: Commit Task 1**

```text
git add src-tauri/src/windows.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/capabilities/default.json src/bridge/commands.ts src/floating/FloatingBall.tsx src/floating/FloatingBall.test.tsx
git commit -m "fix: move floating ball with native drag"
```

---

### Task 2: Bottom-anchored native window modes

**Files:**
- Modify: `src-tauri/src/windows.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/bridge/commands.ts`
- Modify: `src/app/motion.ts`
- Modify: `src/app/motion.test.ts`

**Interfaces:**
- Produces: `show_prompt_bar(reduced_motion)`, `show_waiting_ball(reduced_motion)`, `resize_response_panel(content_height, reduced_motion)`。
- Produces pure Rust geometry functions returning physical `WindowBounds` from monitor work area, scale factor, and requested logical dimensions.
- Consumes: display work area from Tauri monitor APIs; Windows `SetWindowPos` remains the single bounds commit.

- [ ] **Step 1: Write failing Rust geometry tests**

Cover 1.0× and 1.5× scale factors. Assert:

```text
prompt = 640×58 logical, horizontally centered, bottom gap 72 logical
waiting = 50×50 logical, same bottom anchor
response = width 640, clamped height 120–560, same bottom anchor
```

Also test that a 700 px requested height clamps to 560 and raises the top edge without moving the bottom edge.

- [ ] **Step 2: Run Rust geometry tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml windows::tests::bottom_anchored`

Expected: FAIL because the bottom-anchored geometry API is absent.

- [ ] **Step 3: Implement bottom-anchored bounds**

Replace old fixed `expanded_bounds` with a `SurfaceGeometry`/pure helper accepting monitor work-area origin/size and scale. Clamp horizontal width if a small display cannot fit 640 logical px. Add the three Tauri commands and emit surface payloads `prompt`, `waiting`, and `response` before or after bounds changes according to the state transition.

- [ ] **Step 4: Add frontend motion constants**

Expose exact constants matching Rust dimensions in `motion.ts` and test their values. Keep reduced-motion behavior.

- [ ] **Step 5: Verify Task 2 GREEN**

Run:

```text
cargo test --manifest-path src-tauri/Cargo.toml windows::tests::bottom_anchored
pnpm test src/app/motion.test.ts
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all pass.

- [ ] **Step 6: Commit Task 2**

```text
git add src-tauri/src/windows.rs src-tauri/src/lib.rs src/bridge/commands.ts src/app/motion.ts src/app/motion.test.ts
git commit -m "feat: add bottom anchored window modes"
```

---

### Task 3: Prompt, waiting, and response state machine

**Files:**
- Create: `src/chat/assistantSurface.ts`
- Create: `src/chat/assistantSurface.test.ts`
- Create: `src/chat/AssistantPanel.tsx`
- Create: `src/chat/AssistantPanel.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Remove: `src/chat/ChatPanel.tsx`
- Remove: `src/chat/ChatPanel.test.tsx`

**Interfaces:**
- Produces: `AssistantPhase = 'prompt' | 'waiting' | 'response'`。
- Produces: `deriveAssistantPhase(conversation): AssistantPhase` where streaming with an empty current assistant message is `waiting`, first non-empty delta is `response`, and idle with no messages is `prompt`.
- Produces: `AssistantPanel` with existing send/stop/clear/settings/collapse callbacks plus `onContentHeight(height: number)`.
- Consumes: existing `ConversationState`, `RichMessage`, and icon primitives.

- [ ] **Step 1: Write failing phase reducer tests**

Test initial prompt, waiting immediately after send, response on first non-empty delta, response after completion, prompt after a first-token stop, and response after stopping with partial content.

- [ ] **Step 2: Run phase tests and verify RED**

Run: `pnpm test src/chat/assistantSurface.test.ts`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement minimal phase derivation**

Derive the visible phase from conversation state and the current assistant message instead of maintaining duplicate mutable phase state.

- [ ] **Step 4: Write failing component tests**

Test:

- prompt renders one input surface and no empty message list;
- waiting renders a labelled loading/stop ball and hides the composer;
- response renders rich messages plus a bottom composer;
- streaming response disables input and exposes stop;
- settings and collapse controls retain aria labels/tooltips.

- [ ] **Step 5: Run component tests and verify RED**

Run: `pnpm test src/chat/AssistantPanel.test.tsx`

Expected: FAIL because `AssistantPanel` is absent.

- [ ] **Step 6: Implement AssistantPanel and App transitions**

Replace `ChatPanel` with phase-specific markup under one component. `App` calls:

```text
activate → showPromptBar
send → local dispatch then startChat, phase becomes waiting and showWaitingBall
first non-empty delta → show/resize response panel
content height changes → resizeResponsePanel
collapse/Escape → showFloatingBall
```

Coalesce first-delta transition so repeated deltas do not repeatedly trigger initial expansion. Settings close returns to the derived prior assistant phase.

- [ ] **Step 7: Verify Task 3 GREEN**

Run:

```text
pnpm test src/chat/assistantSurface.test.ts src/chat/AssistantPanel.test.tsx src/App.test.tsx
pnpm build
```

Expected: all pass and no references to `ChatPanel` remain.

- [ ] **Step 8: Commit Task 3**

```text
git add src/App.tsx src/App.test.tsx src/chat
git commit -m "feat: add morphing assistant surface states"
```

---

### Task 4: Dynamic response height and scroll ownership

**Files:**
- Create: `src/chat/useResponseHeight.ts`
- Create: `src/chat/useResponseHeight.test.tsx`
- Modify: `src/chat/AssistantPanel.tsx`
- Modify: `src/chat/AssistantPanel.test.tsx`
- Modify: `src/styles/app.css`

**Interfaces:**
- Produces: `useResponseHeight({ containerRef, contentKey, onHeight })` using `ResizeObserver` and one `requestAnimationFrame` slot.
- Produces: `isPinnedToBottom(element, epsilon = 2): boolean`.
- Consumes: `onContentHeight` from Task 3 and 120–560 px native clamp from Task 2.

- [ ] **Step 1: Write failing height and scroll tests**

Test that multiple ResizeObserver callbacks in one frame cause one latest-height callback; pinned-to-bottom content auto-scrolls; a user-scrolled list retains its scrollTop; returning to bottom restores following.

- [ ] **Step 2: Run hook tests and verify RED**

Run: `pnpm test src/chat/useResponseHeight.test.tsx`

Expected: FAIL because the hook is absent.

- [ ] **Step 3: Implement coalesced height reporting**

Observe the response shell, round the newest `scrollHeight`, and call `onHeight` at most once per animation frame. Cancel the pending frame during unmount. Track pinned state from scroll events rather than forcing `scrollTop = scrollHeight` on every delta.

- [ ] **Step 4: Apply exact layout styles**

Add phase classes for 640×58 prompt bar, 50×50 waiting ball, response panel, fixed bottom composer, and message-only vertical scrolling at the 560 px native cap. Keep solid black/gray surfaces and existing rich-text overflow rules.

- [ ] **Step 5: Verify Task 4 GREEN**

Run:

```text
pnpm test src/chat/useResponseHeight.test.tsx src/chat/AssistantPanel.test.tsx
pnpm build
```

Expected: all pass.

- [ ] **Step 6: Commit Task 4**

```text
git add src/chat/useResponseHeight.ts src/chat/useResponseHeight.test.tsx src/chat/AssistantPanel.tsx src/chat/AssistantPanel.test.tsx src/styles/app.css
git commit -m "feat: grow response panel with streamed content"
```

---

### Task 5: Errors, cancellation, compatibility, and end-to-end verification

**Files:**
- Modify: `src/chat/conversation.ts`
- Modify: `src/chat/conversation.test.ts`
- Modify: `src/chat/AssistantPanel.tsx`
- Modify: `src/chat/AssistantPanel.test.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src-tauri/src/windows.rs`

**Interfaces:**
- Consumes all earlier task interfaces.
- Produces no new public interface; locks down edge-state behavior from the design spec.

- [ ] **Step 1: Write failing edge-state tests**

Cover first-token error, partial-stream error, first-token stop removing an empty assistant placeholder, partial stop retaining content, Escape from every assistant phase, settings round-trip, tray/shortcut prompt toggle, and reduced-motion direct bounds changes.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```text
pnpm test src/chat/conversation.test.ts src/chat/AssistantPanel.test.tsx src/App.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml windows::tests
```

Expected: at least the new edge-state assertions fail.

- [ ] **Step 3: Implement minimal edge-state corrections**

Remove empty assistant placeholders on stop/error before first content when appropriate; preserve partial output otherwise. Update tray/shortcut toggle to open prompt mode rather than the removed fixed chat panel. Ensure reduced motion bypasses interpolation while preserving exact target bounds.

- [ ] **Step 4: Run full verification**

Run:

```text
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: frontend tests, frontend production build, Rust tests, and Rust check all pass.

- [ ] **Step 5: Desktop smoke test**

Run `pnpm tauri dev` and exercise:

1. Fast drag in multiple directions; ball remains under cursor with no outline.
2. Click ball; only bottom-centered prompt appears.
3. Send against the mock OpenAI stream; prompt becomes loading ball, then expands on first character.
4. Verify bottom anchor remains fixed while height grows.
5. Stream beyond 560 px; only message list scrolls.
6. Scroll upward during streaming; position is retained.
7. Stop before and after first content; verify both specified outcomes.
8. Open/close settings; return to prior assistant phase.

- [ ] **Step 6: Commit Task 5**

```text
git add src src-tauri/src/windows.rs
git commit -m "fix: cover assistant flow edge states"
```

- [ ] **Step 7: Confirm clean branch**

Run: `git status -sb`

Expected: clean feature branch with commits not pushed unless explicitly authorized.
