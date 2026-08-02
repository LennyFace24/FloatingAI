import { type FormEvent, useEffect, useRef, useState } from 'react';
import { events } from '../bridge/events';
import { commands, type MultimodalContentPart } from '../bridge/commands';
import { ArrowUp, Camera, ImagePlus, Mic, MicOff, Minus, Square, Trash2, Wrench } from '../ui/icons';
import { IconButton } from '../ui/IconButton';
import { deriveAssistantPhase } from './assistantSurface';
import type { ConversationState } from './conversation';
import { useVoiceInput, type VoiceStatus } from '../voice/useVoiceInput';
import { RichMessage } from './RichMessage';
import { isPinnedToBottom, useResponseHeight } from './useResponseHeight';
import { useWindowDrag } from '../window/useWindowDrag';

interface AssistantPanelProps {
  conversation: ConversationState;
  onSend: (content: string | MultimodalContentPart[]) => Promise<string>;
  onStop: (requestId: string) => Promise<void>;
  onClear: () => void;
  onCollapse: () => void;
  onOpenSettings: () => void;
  onContentHeight: (height: number) => void;
}

export function AssistantPanel({
  conversation,
  onSend,
  onStop,
  onClear,
  onCollapse,
  onOpenSettings,
  onContentHeight,
}: AssistantPanelProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  // 截图模式：全屏遮罩拖选矩形
  const [capturing, setCapturing] = useState(false);
  const captureStartRef = useRef<{ x: number; y: number } | null>(null);
  const [captureRect, setCaptureRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [captureError, setCaptureError] = useState('');
  const [voiceError, setVoiceError] = useState('');
  // ref 跟踪录音状态：onTranscript 闭包经 ref 读取最新值，避免捕获陈旧状态
  const voiceStatusRef = useRef<VoiceStatus>('idle');
  const { status: voiceStatus, start: startVoice, stop: stopVoice } = useVoiceInput({
    // 仅录音中写入：识别结果实时替换输入框；停止后残余回调被守卫拦截，用户编辑不被覆盖
    onTranscript: (text) => {
      if (voiceStatusRef.current === 'recording') setInput(text);
    },
    onError: setVoiceError,
  });
  voiceStatusRef.current = voiceStatus;
  const drag = useWindowDrag({ allowInteractiveRoot: true });
  const messageListRef = useRef<HTMLDivElement>(null);
  const isPinnedToBottomRef = useRef(true);
  const phase = deriveAssistantPhase(conversation);
  const isStreaming = conversation.status === 'streaming';
  const contentKey = `${conversation.status}:${conversation.error ?? ''}:${conversation.messages
    .map((message) => `${message.id}:${message.content}:${message.finishReason ?? ''}`)
    .join('|')}`;
  const latestRequestId = [...conversation.messages].reverse().find((message) => message.role === 'assistant')?.requestId;
  const responseRef = useResponseHeight({
    contentKey,
    measurementSessionKey: phase === 'response' ? `response:${latestRequestId ?? 'prompt'}` : phase,
    onHeight: onContentHeight,
  });

  useEffect(() => {
    if (isPinnedToBottomRef.current && messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [contentKey]);

  useEffect(() => {
    if (phase !== 'waiting') inputRef.current?.focus();
  }, [phase]);
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (capturing) {
          setCapturing(false);
          setCaptureRect(null);
          captureStartRef.current = null;
        } else {
          onCollapse();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [capturing, onCollapse]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void events
      .onQuickAskPrefill((text) => {
        if (disposed) return;
        setInput(text);
        inputRef.current?.focus();
      })
      .then((fn) => {
        if (disposed) unlisten = fn;
        else fn();
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if ((!text && !pendingImage) || isStreaming) return;
    setInput('');
    const image = pendingImage;
    setPendingImage(null);
    if (image) {
      await onSend([
        { type: 'text', text: text || '请描述这张图片' },
        { type: 'image_url', image_url: { url: image } },
      ]);
    } else {
      await onSend(text);
    }
  }

  // 截图拖选：记录起点，移动时更新矩形，松开时截图
  function onCapturePointerDown(event: React.PointerEvent) {
    if (capturing) return;
    setCapturing(true);
    setCaptureError('');
    captureStartRef.current = { x: event.clientX, y: event.clientY };
    setCaptureRect({ x: event.clientX, y: event.clientY, w: 0, h: 0 });
  }

  function onCapturePointerMove(event: React.PointerEvent) {
    const start = captureStartRef.current;
    if (!start) return;
    const x = Math.min(start.x, event.clientX);
    const y = Math.min(start.y, event.clientY);
    const w = Math.abs(event.clientX - start.x);
    const h = Math.abs(event.clientY - start.y);
    setCaptureRect({ x, y, w, h });
  }

  async function onCapturePointerUp(event: React.PointerEvent) {
    const start = captureStartRef.current;
    if (!start) return;
    captureStartRef.current = null;
    setCapturing(false);
    const x = Math.min(start.x, event.clientX);
    const y = Math.min(start.y, event.clientY);
    const w = Math.abs(event.clientX - start.x);
    const h = Math.abs(event.clientY - start.y);
    if (w < 4 || h < 4) {
      setCaptureRect(null);
      return;
    }
    try {
      // 遮罩铺满工作区且缩放 1:1，client 坐标即物理像素
      const dataUri = await commands.captureScreenRegion(
        Math.round(x * window.devicePixelRatio),
        Math.round(y * window.devicePixelRatio),
        Math.round(w * window.devicePixelRatio),
        Math.round(h * window.devicePixelRatio),
      );
      setPendingImage(dataUri);
      setCaptureRect(null);
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : String(error));
      setCaptureRect(null);
    }
  }

  /** 文件对话框选本地图片 → 读为 data URI → 预览。 */
  async function uploadImage() {
    setCaptureError('');
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      });
      if (!selected || typeof selected !== 'string') return;
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(selected);
      const base64 = btoa(
        bytes.reduce((acc, byte) => acc + String.fromCharCode(byte), ''),
      );
      const ext = selected.split('.').pop()?.toLowerCase() ?? 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
      setPendingImage(`data:${mime};base64,${base64}`);
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : String(error));
    }
  }

  if (phase === 'waiting') {
    return (
      <section className="assistant-panel assistant-waiting" aria-label="AI 对话">
        <button
          className="waiting-stop"
          type="button"
          aria-label="停止生成"
          title="停止生成"
          {...drag.pointerProps}
          onClick={() => {
            if (!drag.consumeClick() && conversation.activeRequestId) void onStop(conversation.activeRequestId);
          }}
        >
          <span className="waiting-indicator" aria-hidden="true" />
        </button>
      </section>
    );
  }

  const composer = (
    <form
      className="composer-area"
      data-response-composer={phase === 'response' ? '' : undefined}
      onSubmit={handleSubmit}
    >
      <div className="composer">

        <textarea
          ref={inputRef}
          aria-label="输入问题"
          placeholder={voiceStatus === 'recording' ? '正在聆听…' : '> 输入问题…'}
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          rows={phase === 'prompt' ? 1 : 2}
          disabled={isStreaming || voiceStatus === 'recording'}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSubmit(event as unknown as FormEvent);
            }
          }}
        />

        {pendingImage ? (
          <div className="image-preview">
            <img src={pendingImage} alt="待发送图片" />
            <button
              type="button"
              className="image-preview-remove"
              aria-label="移除图片"
              onClick={() => setPendingImage(null)}
            >
              ×
            </button>
          </div>
        ) : null}

        <IconButton
          label="上传图片"
          tooltip="上传图片"
          disabled={isStreaming || voiceStatus === 'recording'}
          onClick={() => void uploadImage()}
        >
          <ImagePlus size={16} />
        </IconButton>

        <IconButton
          label="截图提问"
          tooltip="截图提问"
          disabled={isStreaming || voiceStatus === 'recording' || capturing}
          onClick={() => {
            setCaptureError('');
            setCapturing(true);
            setCaptureRect(null);
            captureStartRef.current = null;
          }}
        >
          <Camera size={16} />
        </IconButton>

        <IconButton
          label={voiceStatus === 'recording' ? '停止录音' : '语音输入'}
          tooltip={voiceStatus === 'recording' ? '停止录音' : '语音输入'}
          className={voiceStatus === 'recording' ? 'voice-active' : undefined}
          disabled={isStreaming}
          onClick={() => {
            setVoiceError('');
            void (voiceStatus === 'recording' ? stopVoice() : startVoice());
          }}
        >
          {voiceStatus === 'recording' ? <MicOff size={16} /> : <Mic size={16} />}
        </IconButton>

        <div className="composer-actions">
          {phase === 'response' ? (
            <IconButton
              label="清空对话"
              tooltip="清空对话"
              onClick={onClear}
              disabled={conversation.messages.length === 0 || isStreaming}
            >
              <Trash2 size={15} />
            </IconButton>
          ) : null}
          {phase === 'prompt' ? (
            <>
              <IconButton label="打开设置" tooltip="设置" onClick={onOpenSettings}>
                <Wrench size={16} />
              </IconButton>
              <IconButton label="收起" tooltip="收起为悬浮球" onClick={onCollapse}>
                <Minus size={17} />
              </IconButton>
            </>
          ) : null}
          {isStreaming && conversation.activeRequestId ? (
            <IconButton
              className="primary-action"
              label="停止"
              tooltip="停止生成"
              onClick={() => void onStop(conversation.activeRequestId!)}
            >
              <Square size={14} fill="currentColor" />
            </IconButton>
          ) : (
            <IconButton className="primary-action" label="发送" tooltip="发送" type="submit" disabled={!input.trim() || voiceStatus === 'recording'}>
              <ArrowUp size={16} />
            </IconButton>
          )}
        </div>
      </div>
    </form>
  );

  return (
    <section
      ref={phase === 'response' ? responseRef : undefined}
      className={`assistant-panel assistant-${phase} surface-panel`}
      aria-label="AI 对话"
      data-testid={phase === 'response' ? 'response-shell' : undefined}
      {...drag.pointerProps}
    >
      <header className="panel-header" data-response-header={phase === 'response' ? '' : undefined}>
        <div className="panel-actions">
          <IconButton label="打开设置" tooltip="设置" onClick={onOpenSettings}>
            <Wrench size={16} />
          </IconButton>
          <IconButton label="收起" tooltip="收起为悬浮球" onClick={onCollapse}>
            <Minus size={17} />
          </IconButton>
        </div>
      </header>

      {phase === 'response' ? (
        <div
          ref={messageListRef}
          className="message-list"
          data-response-scroll
          data-window-drag-exclude
          role="log"
          aria-live="polite"
          onScroll={(event) => {
            isPinnedToBottomRef.current = isPinnedToBottom(event.currentTarget);
          }}
        >
          <div className="message-content" data-response-content>
            {conversation.messages.map((message) => (
              <article className={`message message-${message.role}`} key={message.id}>
                {message.role === 'assistant' ? <RichMessage content={message.content} /> : <p>{message.content}</p>}
                {message.finishReason === 'stopped' ? <small className="message-state">已停止</small> : null}
              </article>
            ))}
            {conversation.error ? <p className="chat-error" role="alert">{conversation.error}</p> : null}
          </div>
        </div>
      ) : null}

      {composer}

      {capturing ? (
        <div
          className="capture-overlay"
          data-window-drag-exclude
          role="presentation"
          onPointerDown={onCapturePointerDown}
          onPointerMove={onCapturePointerMove}
          onPointerUp={onCapturePointerUp}
        >
          <p className="capture-hint">按住并拖动选择截图区域，Esc 取消</p>
          {captureRect && captureRect.w > 0 ? (
            <div
              className="capture-rect"
              style={{
                left: captureRect.x,
                top: captureRect.y,
                width: captureRect.w,
                height: captureRect.h,
              }}
            />
          ) : null}
        </div>
      ) : null}
      {captureError ? (
        <p className="voice-error" role="alert">
          {captureError}
        </p>
      ) : null}
      {voiceError ? (
        <p className="voice-error" role="alert">
          {voiceError}
        </p>
      ) : null}
    </section>
  );
}
