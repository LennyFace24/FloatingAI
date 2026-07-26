import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COLLAPSE_DURATION_MS,
  EXPAND_DURATION_MS,
  prefersReducedMotion,
} from './motion';

describe('window motion', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses approved anchored morph durations', () => {
    expect(EXPAND_DURATION_MS).toBe(280);
    expect(COLLAPSE_DURATION_MS).toBe(180);
  });

  it('reads the reduced-motion media query', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true } as MediaQueryList);
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia });
    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });
});
