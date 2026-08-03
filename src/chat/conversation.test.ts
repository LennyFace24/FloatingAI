import { describe, expect, it } from 'vitest';
import { buildProviderMessages, conversationReducer, initialConversationState } from './conversation';

describe('conversationReducer', () => {
  it('adds a user message and pending assistant message', () => {
    const state = conversationReducer(initialConversationState, {
      type: 'send',
      requestId: 'req-1',
      content: 'hello',
    });

    expect(state.status).toBe('streaming');
    expect(state.messages).toMatchObject([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '', requestId: 'req-1' },
    ]);
  });

  it('appends stream deltas to matching assistant message', () => {
    const streaming = conversationReducer(initialConversationState, {
      type: 'send',
      requestId: 'req-1',
      content: 'hello',
    });
    const state = conversationReducer(streaming, {
      type: 'delta',
      requestId: 'req-1',
      content: 'world',
    });

    expect(state.messages[1].content).toBe('world');
  });

  it('removes a hidden round when done or stopped before the first token', () => {
    for (const type of ['done', 'stopped'] as const) {
      const streaming = conversationReducer(initialConversationState, { type: 'send', requestId: 'req-empty', content: 'hidden' });
      const finished = conversationReducer(streaming, { type, requestId: 'req-empty' });
      expect(finished).toEqual(initialConversationState);
      expect(buildProviderMessages(finished.messages)).toEqual([]);
    }
  });

  it('marks stopped generation without losing partial content', () => {
    const streaming = conversationReducer(initialConversationState, {
      type: 'send',
      requestId: 'req-1',
      content: 'hello',
    });
    const partial = conversationReducer(streaming, {
      type: 'delta',
      requestId: 'req-1',
      content: 'partial',
    });
    const stopped = conversationReducer(partial, { type: 'stopped', requestId: 'req-1' });

    expect(stopped.status).toBe('idle');
    expect(stopped.messages[1].content).toBe('partial');
    expect(stopped.messages[1].finishReason).toBe('stopped');
  });

  it('replaces the empty assistant placeholder with the error message (kept in context)', () => {
    const streaming = conversationReducer(initialConversationState, {
      type: 'send', requestId: 'req-1', content: 'hello',
    });
    const failed = conversationReducer(streaming, {
      type: 'error', requestId: 'req-1', message: '网络请求失败',
    });

    expect(failed).toEqual({
      status: 'error',
      error: '网络请求失败',
      messages: [
        { id: 'user-req-1', role: 'user', content: 'hello' },
        {
          id: 'assistant-req-1',
          role: 'assistant',
          content: '网络请求失败',
          requestId: 'req-1',
          finishReason: 'error',
        },
      ],
    });
  });

  it('preserves partial assistant content on a streaming error', () => {
    const streaming = conversationReducer(initialConversationState, {
      type: 'send', requestId: 'req-1', content: 'hello',
    });
    const partial = conversationReducer(streaming, {
      type: 'delta', requestId: 'req-1', content: 'partial',
    });
    const failed = conversationReducer(partial, {
      type: 'error', requestId: 'req-1', message: '网络请求失败',
    });

    expect(failed.messages[1]).toMatchObject({
      role: 'assistant', content: 'partial', finishReason: 'error',
    });
  });

  it('ignores late events from an inactive request', () => {
    const first = conversationReducer(initialConversationState, { type: 'send', requestId: 'req-1', content: 'first' });
    const second = conversationReducer(first, { type: 'send', requestId: 'req-2', content: 'second' });

    for (const action of [
      { type: 'delta' as const, requestId: 'req-1', content: 'late' },
      { type: 'done' as const, requestId: 'req-1' },
      { type: 'stopped' as const, requestId: 'req-1' },
      { type: 'error' as const, requestId: 'req-1', message: 'late error' },
    ]) {
      expect(conversationReducer(second, action)).toBe(second);
    }
  });

  it('builds provider messages without local metadata', () => {
    const state = conversationReducer(initialConversationState, {
      type: 'send',
      requestId: 'req-1',
      content: 'hello',
    });

    expect(buildProviderMessages(state.messages)).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '' },
    ]);
  });
});
