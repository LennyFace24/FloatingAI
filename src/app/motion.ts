export const EXPAND_DURATION_MS = 280;
export const COLLAPSE_DURATION_MS = 180;

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
