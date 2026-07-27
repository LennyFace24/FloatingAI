import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantPanel } from './AssistantPanel';
import type { ConversationState } from './conversation';

const idle: ConversationState = { status: 'idle', messages: [] };
const callbacks = {
  onSend: vi.fn(() => Promise.resolve('req-2')),
  onStop: vi.fn(() => Promise.resolve()),
  onClear: vi.fn(),
  onCollapse: vi.fn(),
  onOpenSettings: vi.fn(),
  onContentHeight: vi.fn(),
};

let resizeCallback: ResizeObserverCallback;
let frameCallback: FrameRequestCallback | undefined;

function notifyResize() {
  resizeCallback([], {} as ResizeObserver);
  const callback = frameCallback;
  frameCallback = undefined;
  callback?.(0);
}

class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  observe() {}
  disconnect() {}
}

describe('AssistantPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    frameCallback = undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallback = callback;
      return 1;
    });
  });
  it('renders one prompt input surface without an empty message list', () => {
    render(<AssistantPanel conversation={idle} {...callbacks} />);

    expect(screen.getAllByLabelText('输入问题')).toHaveLength(1);
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开设置' })).toHaveAttribute('title', '设置');
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('title', '收起为悬浮球');
  });

  it('renders only a labelled loading stop ball while waiting', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn(() => Promise.resolve());
    const waiting: ConversationState = {
      status: 'streaming',
      activeRequestId: 'req-1',
      messages: [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: '', requestId: 'req-1' },
      ],
    };
    render(<AssistantPanel conversation={waiting} {...callbacks} onStop={onStop} />);

    expect(screen.getByRole('button', { name: '停止生成' })).toHaveAttribute('title', '停止生成');
    expect(screen.queryByLabelText('输入问题')).not.toBeInTheDocument();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '停止生成' }));
    expect(onStop).toHaveBeenCalledWith('req-1');
  });

  it('renders rich response messages with a bottom composer', () => {
    const response: ConversationState = {
      status: 'idle',
      messages: [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: '**answer**', requestId: 'req-1', finishReason: 'done' },
      ],
    };
    render(<AssistantPanel conversation={response} {...callbacks} />);

    expect(screen.getByRole('log')).toHaveTextContent('hello');
    expect(screen.getByRole('strong')).toHaveTextContent('answer');
    expect(screen.getByLabelText('输入问题')).toBeInTheDocument();
  });

  it('disables response input and exposes stop while streaming', () => {
    const response: ConversationState = {
      status: 'streaming',
      activeRequestId: 'req-1',
      messages: [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: 'a', requestId: 'req-1' },
      ],
    };
    render(<AssistantPanel conversation={response} {...callbacks} />);

    expect(screen.getByLabelText('输入问题')).toBeDisabled();
    expect(screen.getByRole('button', { name: '停止' })).toHaveAttribute('title', '停止生成');
  });

  it('reports the response shell scroll height without a duplicate minimum callback', () => {
    const onContentHeight = vi.fn();
    render(<AssistantPanel conversation={{ status: 'error', error: 'failed', messages: [] }} {...callbacks} onContentHeight={onContentHeight} />);
    const shell = screen.getByTestId('response-shell');
    Object.defineProperty(shell, 'scrollHeight', { configurable: true, value: 238 });

    notifyResize();

    expect(onContentHeight).toHaveBeenCalledOnce();
    expect(onContentHeight).toHaveBeenCalledWith(238);
  });

  it('follows streamed content only while the message list is pinned to bottom', () => {
    const response: ConversationState = {
      status: 'streaming',
      activeRequestId: 'req-1',
      messages: [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: 'answer', requestId: 'req-1' },
      ],
    };
    render(<AssistantPanel conversation={response} {...callbacks} />);
    const list = screen.getByRole('log');
    let scrollHeight = 300;
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
    });
    list.scrollTop = 200;

    notifyResize();
    expect(list.scrollTop).toBe(300);

    list.scrollTop = 140;
    fireEvent.scroll(list);
    scrollHeight = 340;
    notifyResize();
    expect(list.scrollTop).toBe(140);

    list.scrollTop = 238;
    fireEvent.scroll(list);
    scrollHeight = 380;
    notifyResize();
    expect(list.scrollTop).toBe(380);
  });

  it('collapses on Escape', async () => {
    const user = userEvent.setup();
    const onCollapse = vi.fn();
    render(<AssistantPanel conversation={idle} {...callbacks} onCollapse={onCollapse} />);

    await user.keyboard('{Escape}');
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
