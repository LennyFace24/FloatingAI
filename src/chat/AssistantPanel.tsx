import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowUp, Minus, Square, Trash2, Wrench } from '../ui/icons';
import { IconButton } from '../ui/IconButton';
import { deriveAssistantPhase } from './assistantSurface';
import type { ConversationState } from './conversation';
import { RichMessage } from './RichMessage';

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
}: AssistantPanelProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const phase = deriveAssistantPhase(conversation);
  const isStreaming = conversation.status === 'streaming';

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
          onClick={() => conversation.activeRequestId && void onStop(conversation.activeRequestId)}
        >
          <span className="waiting-indicator" aria-hidden="true" />
        </button>
      </section>
    );
  }

  const composer = (
    <form className="composer-area" onSubmit={handleSubmit}>
      <div className="composer">
        <textarea
          ref={inputRef}
          aria-label="输入问题"
          placeholder="> 输入问题…"
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          rows={phase === 'prompt' ? 1 : 2}
          disabled={isStreaming}
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
    <section className={`assistant-panel assistant-${phase} surface-panel`} aria-label="AI 对话">
      <header className="panel-header" data-tauri-drag-region>
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
        <div className="message-list" role="log" aria-live="polite">
          {conversation.messages.map((message) => (
            <article className={`message message-${message.role}`} key={message.id}>
              {message.role === 'assistant' ? <RichMessage content={message.content} /> : <p>{message.content}</p>}
              {message.finishReason === 'stopped' ? <small className="message-state">已停止</small> : null}
            </article>
          ))}
          {conversation.error ? <p className="chat-error" role="alert">{conversation.error}</p> : null}
        </div>
      ) : null}

      {composer}
    </section>
  );
}
