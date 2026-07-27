export const SURFACE_WIDTH = 640;
export const PROMPT_HEIGHT = 58;
export const WAITING_SIZE = 50;
export const RESPONSE_MIN_HEIGHT = 120;
export const RESPONSE_MAX_HEIGHT = 560;
export const BOTTOM_GAP = 72;

export const EXPAND_DURATION_MS = 280;
export const COLLAPSE_DURATION_MS = 180;

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
