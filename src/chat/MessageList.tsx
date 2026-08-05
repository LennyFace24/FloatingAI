import { memo, useEffect } from 'react';
import type { ConversationState } from './conversation';
import { RichMessage } from './RichMessage';
import { isPinnedToBottom } from './useResponseHeight';

interface MessageListProps {
  conversation: ConversationState;
  /** 消息变化信号（id+长度拼接），用于滚动到底部 */
  contentKey: string;
  onScrollPinnedChange: (pinned: boolean) => void;
  messageListRef: React.RefObject<HTMLDivElement | null>;
  isPinnedToBottomRef: React.RefObject<boolean>;
}

const MessageItem = memo(function MessageItem({
  id,
  role,
  content,
  imageUrl,
  finishReason,
}: {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  imageUrl?: string;
  finishReason?: 'done' | 'stopped' | 'error';
}) {
  return (
    <article className={`message message-${role}`} key={id}>
      {imageUrl ? <img className="message-image" src={imageUrl} alt="发送的图片" loading="lazy" /> : null}
      {role === 'assistant' ? <RichMessage content={content} /> : <p>{content}</p>}
      {finishReason === 'stopped' ? <small className="message-state">已停止</small> : null}
    </article>
  );
});

/** 消息列表：渲染 + 滚动到底部 + 错误提示。每条消息 memo，仅自身变化时重渲染。 */
export function MessageList({
  conversation,
  contentKey,
  onScrollPinnedChange,
  messageListRef,
  isPinnedToBottomRef,
}: MessageListProps) {
  useEffect(() => {
    if (isPinnedToBottomRef.current && messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [contentKey, messageListRef, isPinnedToBottomRef]);

  return (
    <div
      ref={messageListRef}
      className="message-list"
      data-response-scroll
      data-window-drag-exclude
      role="log"
      aria-live="polite"
      onScroll={(event) => {
        onScrollPinnedChange(isPinnedToBottom(event.currentTarget));
      }}
    >
      <div className="message-content" data-response-content>
        {conversation.messages.map((message) => (
          <MessageItem
            key={message.id}
            id={message.id}
            role={message.role}
            content={message.content}
            imageUrl={message.imageUrl}
            finishReason={message.finishReason}
          />
        ))}
        {conversation.error ? <p className="chat-error" role="alert">{conversation.error}</p> : null}
      </div>
    </div>
  );
}
