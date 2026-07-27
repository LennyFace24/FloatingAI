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

  it('records errors without dropping conversation', () => {
    const streaming = conversationReducer(initialConversationState, {
      type: 'send',
      requestId: 'req-1',
      content: 'hello',
    });
    const failed = conversationReducer(streaming, {
      type: 'error',
      requestId: 'req-1',
      message: '网络请求失败',
    });

    expect(failed.status).toBe('error');
    expect(failed.error).toBe('网络请求失败');
    expect(failed.messages).toHaveLength(2);
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
