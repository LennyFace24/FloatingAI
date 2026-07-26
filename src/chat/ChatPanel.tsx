import { FormEvent, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ConversationStatus } from './conversation';
import { RichMessage } from './RichMessage';
import { IconButton } from '../ui/IconButton';
import { ArrowUp, Minus, Square, Trash2, Wrench } from '../ui/icons';


interface ChatPanelProps {
  messages: ChatMessage[];
  status: ConversationStatus;
  activeRequestId?: string;
  error?: string;
  onSend: (content: string) => Promise<string>;
  onStop: (requestId: string) => Promise<void>;
  onClear: () => void;
  onCollapse: () => void;
  onOpenSettings: () => void;
}

export function ChatPanel({
  messages,
  status,
  activeRequestId,
  error,
  onSend,
  onStop,
  onClear,
  onCollapse,
  onOpenSettings,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

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
    if (!content || status === 'streaming') return;
    setInput('');
    await onSend(content);
  }

  return (
    <section className="chat-panel surface-panel" aria-label="AI 对话">
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

      <div className="message-list" aria-live="polite" ref={listRef}>
        {messages.length === 0 ? (
          <div className="empty-state">
            <span className="empty-prompt">&gt;_</span>
            <p>输入问题开始对话</p>
          </div>
        ) : null}
        {messages.map((message) => (
          <article className={`message message-${message.role}`} key={message.id}>
            {message.role === 'assistant' ? (
              message.content ? <RichMessage content={message.content} /> : <p className="typing-state">正在生成</p>
            ) : (
              <p>{message.content}</p>
            )}
            {message.finishReason === 'stopped' ? <small className="message-state">已停止</small> : null}
          </article>
        ))}
        {error ? <p className="chat-error" role="alert">{error}</p> : null}
      </div>

      <form className="composer-area" onSubmit={handleSubmit}>
        <div className="composer">
          <textarea
            ref={inputRef}
            aria-label="输入问题"
            placeholder="> 输入问题…"
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            rows={2}
          />
          <div className="composer-actions">
            <IconButton label="清空对话" tooltip="清空对话" onClick={onClear} disabled={messages.length === 0}>
              <Trash2 size={15} />
            </IconButton>
            {status === 'streaming' && activeRequestId ? (
              <IconButton
                className="primary-action"
                label="停止"
                tooltip="停止生成"
                onClick={() => void onStop(activeRequestId)}
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
    </section>
  );
}
