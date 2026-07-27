import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPinnedToBottom, useResponseHeight } from './useResponseHeight';

let resizeCallback: ResizeObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();
let frames: FrameRequestCallback[];

class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  observe = observe;
  disconnect = disconnect;
}

function Harness({ contentKey, onHeight }: { contentKey: string; onHeight: (height: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useResponseHeight({ containerRef, contentKey, onHeight });
  return (
    <div ref={containerRef} data-testid="container">
      <header data-response-header />
      <div data-response-content />
      <form data-response-composer />
    </div>
  );
}

function setMeasuredHeight(element: Element, height: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ height } as DOMRect);
}

function flushFrame() {
  const pending = frames;
  frames = [];
  act(() => pending.forEach((callback) => callback(0)));
}

describe('isPinnedToBottom', () => {
  it('uses a two pixel epsilon by default', () => {
    const element = { scrollHeight: 300, scrollTop: 198, clientHeight: 100 } as HTMLElement;
    expect(isPinnedToBottom(element)).toBe(true);
    element.scrollTop = 197.9;
    expect(isPinnedToBottom(element)).toBe(false);
  });
});

describe('useResponseHeight', () => {
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    observe.mockClear();
    disconnect.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('measures header, natural message content, and composer after each content delta', () => {
    const onHeight = vi.fn();
    const { rerender } = render(<Harness contentKey="a" onHeight={onHeight} />);
    setMeasuredHeight(screen.getByTestId('container').querySelector('[data-response-header]')!, 48.4);
    setMeasuredHeight(screen.getByTestId('container').querySelector('[data-response-content]')!, 80.2);
    setMeasuredHeight(screen.getByTestId('container').querySelector('[data-response-composer]')!, 58.1);

    rerender(<Harness contentKey="answer delta" onHeight={onHeight} />);
    flushFrame();

    expect(onHeight).toHaveBeenCalledWith(187);
  });

  it('coalesces a frame to the latest height and suppresses duplicate rounded targets', () => {
    const onHeight = vi.fn();
    const { rerender } = render(<Harness contentKey="a" onHeight={onHeight} />);
    const content = screen.getByTestId('container').querySelector('[data-response-content]')!;
    setMeasuredHeight(screen.getByTestId('container').querySelector('[data-response-header]')!, 48);
    const contentRect = vi.spyOn(content, 'getBoundingClientRect').mockReturnValue({ height: 40 } as DOMRect);
    setMeasuredHeight(screen.getByTestId('container').querySelector('[data-response-composer]')!, 58);

    rerender(<Harness contentKey="ab" onHeight={onHeight} />);
    contentRect.mockReturnValue({ height: 90 } as DOMRect);
    rerender(<Harness contentKey="abc" onHeight={onHeight} />);
    expect(frames).toHaveLength(1);
    flushFrame();
    expect(onHeight).toHaveBeenCalledTimes(1);
    expect(onHeight).toHaveBeenLastCalledWith(196);

    resizeCallback([], {} as ResizeObserver);
    flushFrame();
    expect(onHeight).toHaveBeenCalledTimes(1);
  });

  it('disconnects and cancels a pending frame on unmount', () => {
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const { unmount } = render(<Harness contentKey="a" onHeight={vi.fn()} />);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledWith(1);
  });
});
