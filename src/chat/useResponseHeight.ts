import { type RefCallback, useCallback, useRef } from 'react';

export function useResponseHeight(onHeight: (height: number) => void): RefCallback<HTMLDivElement> {
  const onHeightRef = useRef(onHeight);
  const cleanupRef = useRef<() => void>(() => undefined);
  onHeightRef.current = onHeight;

  return useCallback((response) => {
    cleanupRef.current();
    cleanupRef.current = () => undefined;
    if (!response) return;

    let frame: number | undefined;
    const observer = new ResizeObserver(() => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        onHeightRef.current(response.scrollHeight);
      });
    });
    observer.observe(response);

    cleanupRef.current = () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);
}
