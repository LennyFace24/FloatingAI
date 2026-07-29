import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowUp, Minus, Square, Trash2, Wrench } from '../ui/icons';
import { IconButton } from '../ui/IconButton';
import { deriveAssistantPhase } from './assistantSurface';
import type { ConversationState } from './conversation';
import { RichMessage } from './RichMessage';
import { isPinnedToBottom, useResponseHeight } from './useResponseHeight';
import { useWindowDrag } from '../window/useWindowDrag';

interface AssistantPanelProps {
  conversation: ConversationState;
  onSend: (content: string) => Promise<string>;
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
  const messageListRef = useRef<HTMLDivElement>(null);
  const isPinnedToBottomRef = useRef(true);
  const drag = useWindowDrag({ allowInteractiveRoot: true });
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
      if (event.key === 'Escape') onCollapse();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCollapse]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const content = input.trim();
    if (!content || isStreaming) return;
    setInput('');
    await onSend(content);
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
          placeholder="> 输入问题…"
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          rows={phase === 'prompt' ? 1 : 2}
          disabled={isStreaming}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSubmit(event as unknown as FormEvent);
            }
          }}
        />

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
            <IconButton className="primary-action" label="发送" tooltip="发送" type="submit" disabled={!input.trim()}>
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
    </section>
  );
}
