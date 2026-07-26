import { describe, expect, it } from 'vitest';
import { transitionSurface } from './appState';

describe('transitionSurface', () => {
  it('opens chat from floating ball on activate', () => {
    expect(transitionSurface('floating-ball', { type: 'activate' })).toBe('chat-panel');
  });

  it('collapses chat to floating ball on escape', () => {
    expect(transitionSurface('chat-panel', { type: 'collapse' })).toBe('floating-ball');
  });

  it('opens settings from visible surfaces', () => {
    expect(transitionSurface('floating-ball', { type: 'open-settings' })).toBe('settings-panel');
    expect(transitionSurface('chat-panel', { type: 'open-settings' })).toBe('settings-panel');
  });

  it('hides any visible surface', () => {
    expect(transitionSurface('floating-ball', { type: 'hide' })).toBe('hidden');
    expect(transitionSurface('chat-panel', { type: 'hide' })).toBe('hidden');
    expect(transitionSurface('settings-panel', { type: 'hide' })).toBe('hidden');
  });

  it('restores hidden state to floating ball', () => {
    expect(transitionSurface('hidden', { type: 'restore' })).toBe('floating-ball');
  });
});
