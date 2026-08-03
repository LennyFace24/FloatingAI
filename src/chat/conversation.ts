import type { ChatMessageInput } from '../bridge/commands';

export type ChatRole = 'user' | 'assistant' | 'system';
export type ConversationStatus = 'idle' | 'streaming' | 'error';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** 用户消息附带的图片 data URI（发送后本地展示用） */
  imageUrl?: string;
  requestId?: string;
  finishReason?: 'done' | 'stopped' | 'error';
}

export interface ConversationState {
  status: ConversationStatus;
  activeRequestId?: string;
  error?: string;
  messages: ChatMessage[];
}

export type ConversationAction =
  | { type: 'send'; requestId: string; content: string; imageUrl?: string }
  | { type: 'delta'; requestId: string; content: string }
  | { type: 'done'; requestId: string }
  | { type: 'stopped'; requestId: string }
  | { type: 'error'; requestId: string; message: string }
  | { type: 'clear' };

export const initialConversationState: ConversationState = {
  status: 'idle',
  messages: [],
};

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  if (action.type !== 'send' && action.type !== 'clear' && action.requestId !== state.activeRequestId) {
    return state;
  }

  switch (action.type) {
    case 'send':
      return {
        status: 'streaming',
        activeRequestId: action.requestId,
        messages: [
          ...state.messages,
          {
            id: `user-${action.requestId}`,
            role: 'user',
            content: action.content,
            imageUrl: action.imageUrl,
          },
          { id: `assistant-${action.requestId}`, role: 'assistant', content: '', requestId: action.requestId },
        ],
      };
    case 'delta':
      return {
        ...state,
        messages: state.messages.map((message) =>
          message.requestId === action.requestId
            ? { ...message, content: message.content + action.content }
            : message,
        ),
      };
    case 'done':
      if (!state.messages.some((message) => message.requestId === action.requestId && message.content)) {
        return {
          status: 'idle',
          messages: state.messages.filter(
            (message) => message.id !== `user-${action.requestId}` && message.requestId !== action.requestId,
          ),
        };
      }
      return {
        ...state,
        status: 'idle',
        activeRequestId: undefined,
        messages: state.messages.map((message) =>
          message.requestId === action.requestId ? { ...message, finishReason: 'done' } : message,
        ),
      };
    case 'stopped':
      if (!state.messages.some((message) => message.requestId === action.requestId && message.content)) {
        return {
          status: 'idle',
          messages: state.messages.filter(
            (message) => message.id !== `user-${action.requestId}` && message.requestId !== action.requestId,
          ),
        };
      }
      return {
        ...state,
        status: 'idle',
        activeRequestId: undefined,
        messages: state.messages.map((message) =>
          message.requestId === action.requestId ? { ...message, finishReason: 'stopped' } : message,
        ),
      };
    case 'error': {
      const hasPartialContent = state.messages.some(
        (message) => message.requestId === action.requestId && message.content,
      );
      if (hasPartialContent) {
        // 有部分内容：保留（用户可见），标记 error；错误信息存入 error 字段
        return {
          status: 'error',
          error: action.message,
          messages: state.messages.map((message) =>
            message.requestId === action.requestId
              ? { ...message, finishReason: 'error' as const }
              : message,
          ),
        };
      }
      // 无部分内容：保留 user 消息，移除该 requestId 的 assistant 占位，
      // 追加错误消息（带入后续上下文）
      return {
        status: 'error',
        error: action.message,
        messages: state.messages
          .filter(
            (message) =>
              !(message.role === 'assistant' && message.requestId === action.requestId),
          )
          .concat([
            {
              id: `assistant-${action.requestId}`,
              role: 'assistant' as const,
              content: action.message,
              requestId: action.requestId,
              finishReason: 'error' as const,
            },
          ]),
      };
    }
    case 'clear':
      return initialConversationState;
  }
}

export function buildProviderMessages(messages: ChatMessage[]): ChatMessageInput[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}
