import { FormEvent, useEffect, useRef, useState } from 'react';
import type { ChatMessage, ConversationStatus } from './conversation';

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
    <section className="chat-panel" aria-label="AI 对话">
      <header className="panel-header">
        <strong>Floating AI</strong>
        <div className="panel-actions">
          <button type="button" onClick={onOpenSettings} aria-label="打开设置">设置</button>
          <button type="button" onClick={onCollapse} aria-label="收起">收起</button>
        </div>
      </header>

      <div className="message-list" aria-live="polite" ref={listRef}>
        {messages.map((message) => (
          <article className={`message message-${message.role}`} key={message.id}>
            <p>{message.content || (message.role === 'assistant' ? '正在生成...' : '')}</p>
            {message.role === 'assistant' && message.content ? (
              <button type="button" onClick={() => void navigator.clipboard.writeText(message.content)}>
                复制
              </button>
            ) : null}
            {message.finishReason === 'stopped' ? <small>已停止</small> : null}
          </article>
        ))}
        {error ? <p role="alert">{error}</p> : null}
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          aria-label="输入问题"
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          rows={3}
        />
        <div className="composer-actions">
          <button type="button" onClick={onClear}>清空</button>
          {status === 'streaming' && activeRequestId ? (
            <button type="button" onClick={() => void onStop(activeRequestId)}>停止</button>
          ) : (
            <button type="submit">发送</button>
          )}
        </div>
      </form>
    </section>
  );
}
