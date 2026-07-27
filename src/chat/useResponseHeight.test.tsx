import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useResponseHeight } from './useResponseHeight';

let resizeCallback: ResizeObserverCallback;
const observe = vi.fn();
const disconnect = vi.fn();

class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  observe = observe;
  disconnect = disconnect;
}

function Harness({ onHeight, visible = true }: { onHeight: (height: number) => void; visible?: boolean }) {
  const responseRef = useResponseHeight(onHeight);
  return visible ? <div ref={responseRef} data-testid="response-shell" /> : null;
}

describe('useResponseHeight', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    observe.mockClear();
    disconnect.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('coalesces resize notifications and reports the latest scroll height', () => {
    const onHeight = vi.fn();
    let frame: FrameRequestCallback | undefined;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame = callback;
      return 41;
    });
    render(<Harness onHeight={onHeight} />);
    const shell = screen.getByTestId('response-shell');
    let scrollHeight = 180;
    Object.defineProperty(shell, 'scrollHeight', { configurable: true, get: () => scrollHeight });

    resizeCallback([], {} as ResizeObserver);
    scrollHeight = 260;
    resizeCallback([], {} as ResizeObserver);

    expect(requestFrame).toHaveBeenCalledOnce();
    expect(onHeight).not.toHaveBeenCalled();
    frame?.(0);
    expect(onHeight).toHaveBeenCalledOnce();
    expect(onHeight).toHaveBeenCalledWith(260);
  });

  it('starts observing when the response shell appears after mount', () => {
    const onHeight = vi.fn();
    const { rerender } = render(<Harness onHeight={onHeight} visible={false} />);

    rerender(<Harness onHeight={onHeight} />);

    expect(observe).toHaveBeenCalledWith(screen.getByTestId('response-shell'));
  });

  it('disconnects observation and cancels a pending frame on unmount', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(73);
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const { unmount } = render(<Harness onHeight={vi.fn()} />);

    resizeCallback([], {} as ResizeObserver);
    unmount();

    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledWith(73);
  });
});
