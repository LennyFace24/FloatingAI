import { useCallback, useEffect, useRef } from 'react';
import { type MultimodalContentPart } from '../bridge/commands';
import { IconButton } from '../ui/IconButton';
import { Minus, Wrench } from '../ui/icons';
import { deriveAssistantPhase } from './assistantSurface';
import type { ConversationState } from './conversation';
import { useResponseHeight } from './useResponseHeight';
import { useWindowDrag } from '../window/useWindowDrag';
import { Composer } from './Composer';
import { MessageList } from './MessageList';

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
  const drag = useWindowDrag({ allowInteractiveRoot: true });
  const messageListRef = useRef<HTMLDivElement>(null);
  const isPinnedToBottomRef = useRef(true);
  const phase = deriveAssistantPhase(conversation);
  const isStreaming = conversation.status === 'streaming';
  // contentKey 只含消息 id + 内容长度 + finishReason——不拼全文/图片 data URI，
  // 否则流式 delta 每帧重建整条历史字符串（图片消息可达数 MB），严重卡顿。
  const contentKey = `${conversation.status}:${conversation.error ?? ''}:${conversation.messages
    .map((message) => `${message.id}:${message.content.length}:${message.finishReason ?? ''}`)
    .join('|')}`;
  const latestRequestId = [...conversation.messages].reverse().find((message) => message.role === 'assistant')?.requestId;
  const responseRef = useResponseHeight({
    contentKey,
    measurementSessionKey: phase === 'response' ? `response:${latestRequestId ?? 'prompt'}` : phase,
    onHeight: onContentHeight,
  });


  // 稳定回调：MessageList memo 依赖它引用不变才跳过重渲染
  const handleScrollPinnedChange = useCallback(
    (pinned: boolean) => {
      isPinnedToBottomRef.current = pinned;
    },
    [isPinnedToBottomRef],
  );
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCollapse();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCollapse]);

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
        <MessageList
          conversation={conversation}
          contentKey={contentKey}
          messageListRef={messageListRef}
          isPinnedToBottomRef={isPinnedToBottomRef}
          onScrollPinnedChange={handleScrollPinnedChange}
        />
      ) : null}

      <Composer
        phase={phase}
        isStreaming={isStreaming}
        hasMessages={conversation.messages.length > 0}
        activeRequestId={conversation.activeRequestId}
        onSend={onSend}
        onStop={onStop}
        onClear={onClear}
        onCollapse={onCollapse}
        onOpenSettings={onOpenSettings}
      />
    </section>
  );
}
