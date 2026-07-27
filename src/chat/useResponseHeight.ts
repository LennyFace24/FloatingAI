import { type RefCallback, useCallback, useEffect, useRef, useState } from 'react';

interface ResponseHeightOptions {
  containerRef: RefCallback<HTMLElement>;
  contentKey: string;
  measurementSessionKey: string;
  onHeight: (height: number) => void;
}

export function isPinnedToBottom(element: HTMLElement, epsilon = 2) {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= epsilon;
}

export function useResponseHeight({ contentKey, measurementSessionKey, onHeight }: Omit<ResponseHeightOptions, 'containerRef'>) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const containerNodeRef = useRef<HTMLElement | null>(null);
  const onHeightRef = useRef(onHeight);
  const frameRef = useRef<number | undefined>(undefined);
  const lastHeightRef = useRef<number | undefined>(undefined);
  onHeightRef.current = onHeight;
  const containerRef = useCallback<RefCallback<HTMLElement>>((node) => {
    containerNodeRef.current = node;
    setContainer(node);
  }, []);

  const scheduleMeasureRef = useRef<() => void>(() => undefined);
  scheduleMeasureRef.current = () => {
    if (frameRef.current !== undefined) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = undefined;
      const measuredContainer = containerNodeRef.current;
      if (!measuredContainer) return;
      const measuredParts = measuredContainer.querySelectorAll('[data-response-header], [data-response-content], [data-response-composer]');
      const contentHeight = Array.from(measuredParts).reduce(
        (total, part) => total + part.getBoundingClientRect().height,
        0,
      );
      const scroll = measuredContainer.querySelector('[data-response-scroll]');
      const scrollStyle = scroll ? getComputedStyle(scroll) : null;
      const containerStyle = getComputedStyle(measuredContainer);
      const chromeHeight =
        (Number.parseFloat(scrollStyle?.paddingTop ?? '') || 0) +
        (Number.parseFloat(scrollStyle?.paddingBottom ?? '') || 0) +
        (Number.parseFloat(containerStyle.borderTopWidth) || 0) +
        (Number.parseFloat(containerStyle.borderBottomWidth) || 0);
      const height = Math.round(contentHeight + chromeHeight);
      if (height === lastHeightRef.current) return;
      lastHeightRef.current = height;
      onHeightRef.current(height);
    });
  };

  useEffect(() => {
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
  }, [container]);

  useEffect(() => {
    lastHeightRef.current = undefined;
    scheduleMeasureRef.current();
  }, [measurementSessionKey]);

  useEffect(() => {
    scheduleMeasureRef.current();
  }, [contentKey]);

  return containerRef;
}
