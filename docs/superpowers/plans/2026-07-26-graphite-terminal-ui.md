# Graphite Terminal UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Floating AI to the approved Graphite Terminal · Pure Glass interface with Wrench/Minus controls, Anchored Morph window transitions, and safe Markdown/code/LaTeX rendering.

**Architecture:** Keep the existing single Tauri window and three React surfaces. Add a focused rich-message renderer for assistant output, a small icon-button primitive, semantic CSS tokens, and a Rust window-transition helper that animates the existing window without creating more webviews.

**Tech Stack:** React 19, TypeScript, Tauri v2, Rust, CSS, lucide-react, react-markdown, remark-gfm, remark-math, rehype-katex, KaTeX, react-syntax-highlighter light build, Vitest, Testing Library.

## Global Constraints

- Default theme is deep black and white.
- No radial gradients, glows, spray-painted gray, background grids, grain, noise, flashing decoration, neon colors, blue, green, or purple accents.
- Header contains no brand text, decorative circle, or status dot.
- Settings uses Lucide `Wrench`; collapse uses Lucide `Minus`; both have tooltip and aria-label.
- User and assistant bubbles use the same black/gray material family; user bubbles are never white.
- Composer contains exactly one actual input surface.
- Anchored Morph expands in about 280ms and collapses in about 180ms; reduced-motion mode skips complex movement.
- Raw HTML in Markdown stays disabled.
- Existing send, stop, clear, settings, collapse, floating drag, tray, and shortcut behaviors remain functional.
- Every task ends with tests, build checks, and a Git commit.

---

### Task 1: Add UI Dependencies and Semantic Primitives

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `src/ui/IconButton.tsx`
- Create: `src/ui/IconButton.test.tsx`
- Create: `src/ui/icons.ts`

**Interfaces:**
- Produces `IconButton({ label, tooltip, children, onClick, disabled })`.
- Produces named icon exports `Wrench`, `Minus`, `Copy`, `Check`, `ArrowUp`, `Square`, `Trash2`.

- [ ] Add dependencies:

```bash
pnpm add lucide-react react-markdown remark-gfm remark-math rehype-katex katex react-syntax-highlighter
pnpm add -D @types/react-syntax-highlighter
```

- [ ] Write `IconButton.test.tsx` asserting the button exposes the supplied `aria-label`, native `title`, disabled state, and click behavior.
- [ ] Run `pnpm test src/ui/IconButton.test.tsx`; expect failure because the component does not exist.
- [ ] Implement `IconButton.tsx` as a native `<button>` with class `icon-button`, `aria-label={label}`, `title={tooltip}`, and forwarded click/disabled behavior.
- [ ] Implement `icons.ts` as named re-exports from `lucide-react`.
- [ ] Run the focused test and `pnpm build`; both must pass.
- [ ] Commit:

```bash
git add package.json pnpm-lock.yaml src/ui
git commit -m "feat: add graphite ui primitives"
```

---

### Task 2: Implement Safe Rich Message Rendering

**Files:**
- Create: `src/chat/RichMessage.tsx`
- Create: `src/chat/RichMessage.test.tsx`
- Create: `src/chat/CodeBlock.tsx`
- Create: `src/chat/CodeBlock.test.tsx`
- Modify: `src/chat/ChatPanel.tsx`
- Modify: `src/styles/app.css`

**Interfaces:**
- Produces `RichMessage({ content: string })`.
- Produces `CodeBlock({ language?: string, code: string })`.
- `ChatPanel` renders assistant messages through `RichMessage`; user messages remain plain text.

- [ ] Write RichMessage tests with this content:

```md
## Binary search

- O(log n)
- Requires sorted input

Inline $O(1)$ and block:

$$T(n)=T(n/2)+O(1)$$

```ts
const mid = (left + right) >> 1;
```
```

Assert heading, list items, inline KaTeX output, block KaTeX output, `typescript` language label, and copy button appear. Also assert `<script>alert(1)</script>` is rendered as text or omitted, never mounted as a script element.

- [ ] Run focused tests; expect failure because renderer components do not exist.
- [ ] Implement `RichMessage` with `react-markdown`, `remark-gfm`, `remark-math`, and `rehype-katex`. Do not install or enable `rehype-raw`.
- [ ] Implement `CodeBlock` with the light syntax-highlighter build. Register TypeScript, JavaScript, JSON, Rust, Python, Bash, CSS, HTML/XML, and Markdown only.
- [ ] Copy button uses Lucide `Copy`, then `Check` for 1.5 seconds after successful clipboard write. On clipboard failure retain `Copy` and expose an accessible error title.
- [ ] Import `katex/dist/katex.min.css` once from `src/main.tsx`.
- [ ] Update `ChatPanel` assistant message rendering:

```tsx
{message.role === 'assistant' ? (
  <RichMessage content={message.content} />
) : (
  <p>{message.content}</p>
)}
```

- [ ] Add CSS for headings, lists, blockquotes, tables, links, inline code, code blocks, and `.katex-display` horizontal overflow using only approved gray tokens.
- [ ] Run focused tests, `pnpm test`, and `pnpm build`.
- [ ] Commit:

```bash
git add src/chat src/main.tsx src/styles/app.css package.json pnpm-lock.yaml
git commit -m "feat: render markdown code and latex"
```

---

### Task 3: Apply Graphite Terminal Pure Glass Interface

**Files:**
- Modify: `src/chat/ChatPanel.tsx`
- Modify: `src/settings/SettingsPanel.tsx`
- Modify: `src/floating/FloatingBall.tsx`
- Modify: `src/styles/app.css`
- Modify: `src/chat/ChatPanel.test.tsx`
- Modify: `src/settings/SettingsPanel.test.tsx`
- Modify: `src/floating/FloatingBall.test.tsx`

**Interfaces:**
- Header actions use `IconButton` with Wrench and Minus.
- Composer remains one `<textarea>` inside one `.composer` surface.
- CSS semantic tokens live in `:root` and are reused across chat/settings/floating surfaces.

- [ ] Extend ChatPanel tests:
  - Header does not contain `Floating AI`.
  - Wrench button has label `打开设置` and title `设置`.
  - Minus button has label `收起` and title `收起为悬浮球`.
  - Composer contains exactly one textarea and no nested element with composer-input styling.
  - User and assistant messages have distinct role classes.

- [ ] Run focused tests and verify expected failures.
- [ ] Replace text buttons with icon buttons:

```tsx
<IconButton label="打开设置" tooltip="设置" onClick={onOpenSettings}>
  <Wrench size={16} />
</IconButton>
<IconButton label="收起" tooltip="收起为悬浮球" onClick={onCollapse}>
  <Minus size={16} />
</IconButton>
```

- [ ] Replace Clear/Send/Stop controls with Lucide Trash2/ArrowUp/Square while retaining visible tooltips and aria labels.
- [ ] Define exact CSS tokens:

```css
:root {
  --void: #050505;
  --glass: rgb(8 8 8 / 92%);
  --input: #101010;
  --inline: #181818;
  --text-primary: #f2f2f2;
  --text-secondary: #a0a0a0;
  --border: rgb(255 255 255 / 12%);
  --bubble-user: rgb(255 255 255 / 8.5%);
  --bubble-assistant: rgb(255 255 255 / 5%);
}
```

- [ ] Remove every `gradient`, decorative grid, colored bubble, green busy state, and blue hover state from application CSS.
- [ ] Apply `background: var(--glass)` and `backdrop-filter: blur(28px)` to chat/settings panels.
- [ ] User bubble: right aligned, `var(--bubble-user)`, border, subtle shadow, bottom-right cut corner. Assistant bubble: left aligned, `var(--bubble-assistant)`, weaker border, top-left cut corner.
- [ ] Composer: one `#101010` surface; textarea transparent with no extra background/border; right-side action controls only.
- [ ] Update SettingsPanel to share the same header, fields, buttons, border, and glass tokens.
- [ ] Update floating ball to pure grayscale with no gradient or colored busy state.
- [ ] Add `:focus-visible` outlines and 40px minimum hit regions for header controls.
- [ ] Run focused tests, full frontend tests, and build.
- [ ] Commit:

```bash
git add src/chat src/settings src/floating src/styles src/ui
git commit -m "feat: apply graphite terminal glass ui"
```

---

### Task 4: Implement Anchored Morph Window Motion

**Files:**
- Modify: `src-tauri/src/windows.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/bridge/commands.ts`
- Modify: `src/App.tsx`
- Create: `src/app/motion.ts`
- Create: `src/app/motion.test.ts`
- Modify: `src/styles/app.css`

**Interfaces:**
- `show_chat_panel(reduced_motion: bool)` expands to 480×620.
- `show_floating_ball(reduced_motion: bool)` collapses to 50×50.
- `motion.ts` exports `prefersReducedMotion(): boolean` and duration constants.

- [ ] Write `motion.test.ts` asserting duration constants are 280ms expand and 180ms collapse, and media-query reduction returns true when mocked.
- [ ] Run focused test; expect failure because module does not exist.
- [ ] Implement motion constants and reduced-motion helper.
- [ ] Change frontend command bridge signatures:

```ts
showChatPanel: (reducedMotion: boolean) => invoke('show_chat_panel', { reducedMotion })
showFloatingBall: (reducedMotion: boolean) => invoke('show_floating_ball', { reducedMotion })
```

- [ ] Update Rust commands to accept `reduced_motion: bool` and pass it to window functions.
- [ ] Implement a Rust `animate_window_bounds` helper:
  - Read starting position/size.
  - Interpolate position and size using ease-out cubic.
  - Expand for 280ms; collapse for 180ms.
  - Target roughly 60fps but skip stale frames if scheduling is late.
  - Reduced motion sets final bounds immediately.
  - Never sleep or block the UI thread; run animation through Tauri async runtime and window setters.
- [ ] Expand position remains anchored to the floating-ball corner and clamped to current monitor bounds.
- [ ] Emit surface change before/after animation so React applies `.surface-entering` and `.surface-leaving` opacity/transform classes without exposing unpainted space.
- [ ] CSS content reveal starts after 35% of expansion; collapse fades content in the first 60ms.
- [ ] Add `@media (prefers-reduced-motion: reduce)` disabling transitions and transforms.
- [ ] Run Rust tests/check, frontend tests/build, and manual Tauri smoke test for repeated rapid open/close.
- [ ] Commit:

```bash
git add src-tauri/src src/App.tsx src/app src/bridge src/styles/app.css
git commit -m "feat: add anchored morph window motion"
```

---

### Task 5: Visual and Functional Acceptance

**Files:**
- Modify only files required by observed verification failures.

- [ ] Run full automated verification:

```bash
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

- [ ] Start `pnpm tauri dev` and verify:
  - Floating ball is grayscale and draggable.
  - Expand feels anchored and completes near 280ms.
  - Collapse completes near 180ms.
  - Rapid repeated clicks do not strand the window at an intermediate size.
  - Reduced-motion Windows/browser setting removes complex motion.
  - Header has only Wrench and Minus; no brand, decorative circle, or status dot.
  - Background is pure and stable with no gradient, glow, grid, grain, spray gray, or flicker.
  - User bubble is dark gray, never white.
  - Composer has one input surface.
  - Markdown headings/lists/table/quote/link render.
  - Code block highlights, shows language, scrolls, and copies.
  - Inline and block LaTeX render.
  - Send/stop/clear/settings/collapse still work.

- [ ] Inspect idle CPU usage in Task Manager for at least 15 seconds after animations finish; it must return near idle and show no perpetual requestAnimationFrame loop.
- [ ] Fix only observed acceptance failures and rerun their focused checks.
- [ ] Commit final acceptance fixes:

```bash
git add -A
git commit -m "chore: verify graphite terminal ui"
```

## Self-Review

- Spec coverage: visual tokens, pure background, minimal header, Wrench/Minus, dark bubbles, single composer, Anchored Morph, reduced motion, Markdown/GFM, code copy/highlight, LaTeX, and preserved functionality all map to Tasks 1–5.
- Security: raw HTML remains disabled; no `rehype-raw` dependency is added.
- Performance: syntax languages are registered explicitly; motion ends after each transition; no idle animation loop.
- Type consistency: frontend `reducedMotion` maps to Rust `reduced_motion` through Tauri camelCase argument conversion; request/message interfaces stay unchanged.
- No unresolved markers or vague implementation steps remain.
