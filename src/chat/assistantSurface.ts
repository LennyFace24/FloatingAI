import type { ConversationState } from './conversation';

export type AssistantPhase = 'prompt' | 'waiting' | 'response';

export function deriveAssistantPhase(conversation: ConversationState): AssistantPhase {
  const currentAssistant = [...conversation.messages]
    .reverse()
    .find((message) => message.role === 'assistant');

  if (currentAssistant?.content || conversation.status === 'error') return 'response';
  if (conversation.status === 'streaming') return 'waiting';
  return 'prompt';
}
