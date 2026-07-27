import { describe, expect, it } from 'vitest';
import type { ConversationState } from './conversation';
import { deriveAssistantPhase } from './assistantSurface';

function conversation(overrides: Partial<ConversationState> = {}): ConversationState {
  return { status: 'idle', messages: [], ...overrides };
}

describe('deriveAssistantPhase', () => {
  it('shows prompt initially', () => {
    expect(deriveAssistantPhase(conversation())).toBe('prompt');
  });

  it('shows waiting immediately after send', () => {
    expect(deriveAssistantPhase(conversation({
      status: 'streaming',
      activeRequestId: 'req-1',
      messages: [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: '', requestId: 'req-1' },
      ],
    }))).toBe('waiting');
  });

  it('shows response on the first non-empty delta and after completion', () => {
    const messages = [
      { id: 'u1', role: 'user' as const, content: 'hello' },
      { id: 'a1', role: 'assistant' as const, content: 'H', requestId: 'req-1' },
    ];
    expect(deriveAssistantPhase(conversation({ status: 'streaming', activeRequestId: 'req-1', messages }))).toBe('response');
    expect(deriveAssistantPhase(conversation({ messages }))).toBe('response');
  });

  it('returns to prompt after stopping before the first token', () => {
    expect(deriveAssistantPhase(conversation({
      messages: [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: '', requestId: 'req-1', finishReason: 'stopped' },
      ],
    }))).toBe('prompt');
  });

  it('keeps response after stopping with partial content', () => {
    expect(deriveAssistantPhase(conversation({
      messages: [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: 'partial', requestId: 'req-1', finishReason: 'stopped' },
      ],
    }))).toBe('response');
  });
});
