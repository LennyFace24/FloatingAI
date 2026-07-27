import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BOTTOM_GAP,
  COLLAPSE_DURATION_MS,
  EXPAND_DURATION_MS,
  PROMPT_HEIGHT,
  RESPONSE_MAX_HEIGHT,
  RESPONSE_MIN_HEIGHT,
  SURFACE_WIDTH,
  WAITING_SIZE,
  prefersReducedMotion,
} from './motion';

describe('window motion', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses approved anchored morph durations', () => {
    expect(EXPAND_DURATION_MS).toBe(280);
    expect(COLLAPSE_DURATION_MS).toBe(180);
  });

  it('matches native bottom-anchored surface dimensions', () => {
    expect(SURFACE_WIDTH).toBe(640);
    expect(PROMPT_HEIGHT).toBe(58);
    expect(WAITING_SIZE).toBe(50);
    expect(RESPONSE_MIN_HEIGHT).toBe(120);
    expect(RESPONSE_MAX_HEIGHT).toBe(560);
    expect(BOTTOM_GAP).toBe(72);
  });

  it('reads the reduced-motion media query', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true } as MediaQueryList);
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia });
    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });
});
