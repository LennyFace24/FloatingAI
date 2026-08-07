import { useEffect, useRef, useState } from 'react';
import { commands, type MultimodalContentPart } from '../bridge/commands';
import { events } from '../bridge/events';
import { modelSupportsVision } from './visionSupport';
import { deriveAssistantPhase, type AssistantPhase } from './assistantSurface';
import {
  buildProviderMessages,
  conversationReducer,
  initialConversationState,
  type ConversationAction,
  type ConversationState,
} from './conversation';
export interface ChatSession {
  conversation: ConversationState;
  assistantPhase: AssistantPhase;
  dispatch: (action: ConversationAction) => ConversationState;
  sendMessage: (content: string | MultimodalContentPart[]) => Promise<string>;
  stopMessage: (requestId: string) => Promise<void>;
  clear: () => void;
}

interface ChatSessionOptions {
  model: string;
  onShowPhase: (phase: AssistantPhase) => Promise<void>;
}

/**
 * 聊天会话状态管理：conversation + reducer + 事件监听 + 发送/停止。
 * 从 App 抽出，App 只负责 surface 调度。
 */
export function useChatSession({ model, onShowPhase }: ChatSessionOptions): ChatSession {
  const conversationRef = useRef<ConversationState>(initialConversationState);
  const [conversation, setConversation] = useState<ConversationState>(initialConversationState);
  const onShowPhaseRef = useRef(onShowPhase);
  onShowPhaseRef.current = onShowPhase;
  const modelRef = useRef(model);
  modelRef.current = model;

  function dispatch(action: ConversationAction): ConversationState {
    const next = conversationReducer(conversationRef.current, action);
    conversationRef.current = next;
    setConversation(next);
    return next;
  }

  function clear() {
    dispatch({ type: 'clear' });
  }

  async function syncPhase(phase: AssistantPhase) {
    await onShowPhaseRef.current(phase);
  }

  async function sendMessage(content: string | MultimodalContentPart[]) {
    const requestId = crypto.randomUUID();
    // 提取文本与图片 data URI（本地展示用）
    const textPart = Array.isArray(content)
      ? content
          .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
          .map((part) => part.text)
          .join(' ')
          .trim()
      : content;
    const imageUrl = Array.isArray(content)
      ? content.find(
          (part): part is { type: 'image_url'; image_url: { url: string } } => part.type === 'image_url',
        )?.image_url.url
      : undefined;

    // 带图消息：模型不支持图片时拦截——先入列用户消息并进入 loading，
    // 再 dispatch error（错误入列 assistant 消息，带入后续上下文）。
    if (Array.isArray(content) && !modelSupportsVision(modelRef.current)) {
      dispatch({ type: 'send', requestId, content: textPart || '[图片]', imageUrl });
      try {
        await syncPhase('waiting');
      } finally {
        dispatch({
          type: 'error',
          requestId,
          message: `当前模型（${modelRef.current}）不支持图片输入，请更换支持视觉的模型或移除图片。`,
        });
        await syncPhase('response').catch(() => undefined);
      }
      return requestId;
    }

    const providerMessages = [
      ...buildProviderMessages(conversationRef.current.messages),
      { role: 'user' as const, content },
    ];

    dispatch({ type: 'send', requestId, content: textPart || '[图片]', imageUrl });
    try {
      await syncPhase('waiting');
      await commands.startChat(requestId, providerMessages);
    } catch (error) {
      dispatch({
        type: 'error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return requestId;
  }

  async function stopMessage(requestId: string) {
    await commands.stopChat(requestId);
    if (conversationRef.current.activeRequestId !== requestId) return;
    const next = dispatch({ type: 'stopped', requestId });
    if (deriveAssistantPhase(next) === 'prompt') await syncPhase('prompt');
  }

  // 事件监听：流式 delta / done / error
  useEffect(() => {
    const unlisten = Promise.all([
      events.onChatDelta((payload) => {
        dispatch({ type: 'delta', ...payload });
      }),
      events.onChatDone((payload) => {
        if (conversationRef.current.activeRequestId !== payload.requestId) return;
        const next = dispatch({ type: 'done', ...payload });
        if (deriveAssistantPhase(next) === 'prompt') void syncPhase('prompt');
      }),
      events.onChatError((payload) => {
        if (conversationRef.current.activeRequestId !== payload.requestId) return;
        dispatch({ type: 'error', requestId: payload.requestId, message: payload.message });
      }),
    ]);
    return () => {
      void unlisten.then((listeners) => listeners.forEach((listener) => listener()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    conversation,
    assistantPhase: deriveAssistantPhase(conversation),
    dispatch,
    sendMessage,
    stopMessage,
    clear,
  };
}
