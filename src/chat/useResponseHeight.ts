import { type RefObject, useEffect, useRef } from 'react';

interface ResponseHeightOptions {
  containerRef: RefObject<HTMLElement | null>;
  contentKey: string;
  onHeight: (height: number) => void;
}

export function isPinnedToBottom(element: HTMLElement, epsilon = 2) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= epsilon;
}

export function useResponseHeight({ containerRef, contentKey, onHeight }: ResponseHeightOptions) {
  const onHeightRef = useRef(onHeight);
  const frameRef = useRef<number | undefined>(undefined);
  const lastHeightRef = useRef<number | undefined>(undefined);
  onHeightRef.current = onHeight;

  const scheduleMeasureRef = useRef<() => void>(() => undefined);
  scheduleMeasureRef.current = () => {
    if (frameRef.current !== undefined) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined;
      const container = containerRef.current;
      if (!container) return;
      const measuredParts = container.querySelectorAll(
        '[data-response-header], [data-response-content], [data-response-composer]',
      );
      const height = Math.round(
        Array.from(measuredParts).reduce((total, part) => total + part.getBoundingClientRect().height, 0),
      );
      if (height === lastHeightRef.current) return;
      lastHeightRef.current = height;
      onHeightRef.current(height);
    });
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => scheduleMeasureRef.current());
    container
      .querySelectorAll('[data-response-header], [data-response-content], [data-response-composer]')
      .forEach((part) => observer.observe(part));
    scheduleMeasureRef.current();
    return () => {
      observer.disconnect();
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    };
  }, [containerRef]);

  useEffect(() => {
    scheduleMeasureRef.current();
  }, [contentKey]);
}
