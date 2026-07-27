import type { ChatMessageInput } from '../bridge/commands';

export type ChatRole = 'user' | 'assistant' | 'system';
export type ConversationStatus = 'idle' | 'streaming' | 'error';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
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
  | { type: 'send'; requestId: string; content: string }
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
          { id: `user-${action.requestId}`, role: 'user', content: action.content },
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
    case 'error':
      return {
        ...state,
        status: 'error',
        activeRequestId: undefined,
        error: action.message,
        messages: state.messages.map((message) =>
          message.requestId === action.requestId ? { ...message, finishReason: 'error' } : message,
        ),
      };
    case 'clear':
      return initialConversationState;
  }
}

export function buildProviderMessages(messages: ChatMessage[]): ChatMessageInput[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}
