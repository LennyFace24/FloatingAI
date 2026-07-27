import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPinnedToBottom, useResponseHeight } from './useResponseHeight';

let resizeCallback: ResizeObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();
const createObserver = vi.fn();
let frames: FrameRequestCallback[];

class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    createObserver();
    resizeCallback = callback;
  }

  observe = observe;
  disconnect = disconnect;
}

function Harness({
  contentKey,
  measurementSessionKey = 'response-1',
  onHeight,
  visible = true,
}: {
  contentKey: string;
  measurementSessionKey?: string;
  onHeight: (height: number) => void;
  visible?: boolean;
}) {
  const containerRef = useResponseHeight({ contentKey, measurementSessionKey, onHeight });
  return visible ? (
    <div ref={containerRef} data-testid="container">
      <header data-response-header />
      <div data-response-scroll>
        <div data-response-content />
      </div>
      <form data-response-composer />
    </div>
  ) : null;
}

function setMeasuredHeight(element: Element, height: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ height } as DOMRect);
}

function flushFrame() {
  act(() => {
    while (frames.length > 0) {
      const pending = frames;
      frames = [];
      pending.forEach((callback) => callback(0));
    }
  });
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
    createObserver.mockClear();
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

  it('does not recreate the observer when callback ref receives the same node across rerenders', () => {
    const onHeight = vi.fn();
    const { rerender } = render(<Harness contentKey="a" onHeight={onHeight} />);
    rerender(<Harness contentKey="ab" onHeight={onHeight} />);
    rerender(<Harness contentKey="abc" onHeight={onHeight} />);
    expect(createObserver).toHaveBeenCalledOnce();
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('re-emits an equal height when a new response measurement session starts', () => {
    const onHeight = vi.fn();
    const { rerender } = render(<Harness contentKey="same" measurementSessionKey="response-1" onHeight={onHeight} />);
    flushFrame();
    expect(onHeight).toHaveBeenCalledTimes(1);

    rerender(<Harness contentKey="same" measurementSessionKey="response-2" onHeight={onHeight} />);
    flushFrame();
    expect(onHeight).toHaveBeenCalledTimes(2);
  });

  it('starts observing when the container changes from null to a response node', () => {
    const onHeight = vi.fn();
    const { rerender } = render(<Harness contentKey="waiting" onHeight={onHeight} visible={false} />);
    expect(observe).not.toHaveBeenCalled();

    rerender(<Harness contentKey="response" onHeight={onHeight} />);
    expect(observe).toHaveBeenCalledWith(screen.getByTestId('container').querySelector('[data-response-content]'));
  });

  it('includes scroll padding and surface borders in the target height', () => {
    const onHeight = vi.fn();
    render(<Harness contentKey="a" onHeight={onHeight} />);
    const container = screen.getByTestId('container');
    setMeasuredHeight(container.querySelector('[data-response-header]')!, 48);
    setMeasuredHeight(container.querySelector('[data-response-content]')!, 80);
    setMeasuredHeight(container.querySelector('[data-response-composer]')!, 58);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => ({
      paddingTop: element.hasAttribute('data-response-scroll') ? '16px' : '0px',
      paddingBottom: element.hasAttribute('data-response-scroll') ? '16px' : '0px',
      borderTopWidth: element === container ? '1px' : '0px',
      borderBottomWidth: element === container ? '1px' : '0px',
    } as CSSStyleDeclaration));

    flushFrame();
    expect(onHeight).toHaveBeenCalledWith(220);
  });

  it('disconnects and cancels a pending frame on unmount', () => {
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const { unmount } = render(<Harness contentKey="a" onHeight={vi.fn()} />);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledWith(1);
  });
});
