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
const createObserver = vi.fn();

class ResizeObserverStub {
  constructor(callback: ResizeObserverCallback) {
    createObserver();
    resizeCallback = callback;
  }
  observe() {}
  disconnect() {}
}

function flushFrame() {
  const callback = frameCallback;
  frameCallback = undefined;
  callback?.(0);
}

function setHeight(element: Element, height: number) {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ height } as DOMRect);
}

function response(content: string): ConversationState {
  return {
    status: 'streaming',
    activeRequestId: 'req-1',
    messages: [
      { id: 'u1', role: 'user', content: 'hello' },
      { id: 'a1', role: 'assistant', content, requestId: 'req-1' },
    ],
  };
}

describe('AssistantPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    createObserver.mockClear();
    frameCallback = undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frameCallback = callback;
      return 1;
    });
  });

  it('renders one prompt input surface with visible settings and collapse actions', () => {
    render(<AssistantPanel conversation={idle} {...callbacks} />);
    expect(screen.getAllByLabelText('输入问题')).toHaveLength(1);
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    const composer = screen.getByLabelText('输入问题').closest('form');
    expect(composer).toContainElement(screen.getAllByRole('button', { name: '打开设置' }).find((button) => composer?.contains(button)) ?? null);
    expect(composer).toContainElement(screen.getAllByRole('button', { name: '收起' }).find((button) => composer?.contains(button)) ?? null);
  });

  it('renders only a labelled loading stop ball while waiting', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn(() => Promise.resolve());
    const waiting: ConversationState = {
      status: 'streaming', activeRequestId: 'req-1',
      messages: [{ id: 'u1', role: 'user', content: 'hello' }, { id: 'a1', role: 'assistant', content: '', requestId: 'req-1' }],
    };
    render(<AssistantPanel conversation={waiting} {...callbacks} onStop={onStop} />);
    expect(screen.getByRole('button', { name: '停止生成' })).toHaveAttribute('title', '停止生成');
    expect(screen.queryByLabelText('输入问题')).not.toBeInTheDocument();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '停止生成' }));
    expect(onStop).toHaveBeenCalledWith('req-1');
  });

  it('renders rich response messages with a bottom composer and one overflow owner', () => {
    render(<AssistantPanel conversation={response('**answer**')} {...callbacks} />);
    const shell = screen.getByTestId('response-shell');
    expect(screen.getByRole('log')).toHaveTextContent('hello');
    expect(screen.getByRole('strong')).toHaveTextContent('answer');
    expect(screen.getByLabelText('输入问题')).toBeInTheDocument();
    expect(shell.querySelector('[data-response-header]')).toBeInTheDocument();
    expect(shell.querySelector('[data-response-content]')).toBeInTheDocument();
    expect(shell.querySelector('[data-response-composer]')).toBeInTheDocument();
    expect(screen.getByRole('log')).toContainElement(shell.querySelector('[data-response-content]'));
  });

  it('disables response input and exposes stop while streaming', () => {
    render(<AssistantPanel conversation={response('a')} {...callbacks} />);
    expect(screen.getByLabelText('输入问题')).toBeDisabled();
    expect(screen.getByRole('button', { name: '停止' })).toHaveAttribute('title', '停止生成');
  });

  it('rerenders streamed deltas and reports header, natural content, and composer height', () => {
    const onContentHeight = vi.fn();
    const { rerender } = render(<AssistantPanel conversation={response('a')} {...callbacks} onContentHeight={onContentHeight} />);
    const shell = screen.getByTestId('response-shell');
    setHeight(shell.querySelector('[data-response-header]')!, 48);
    const contentRect = vi
      .spyOn(shell.querySelector('[data-response-content]')!, 'getBoundingClientRect')
      .mockReturnValue({ height: 44 } as DOMRect);
    setHeight(shell.querySelector('[data-response-composer]')!, 80);

    flushFrame();
    contentRect.mockReturnValue({ height: 132 } as DOMRect);

    rerender(<AssistantPanel conversation={response('a streamed delta')} {...callbacks} onContentHeight={onContentHeight} />);
    flushFrame();

    expect(onContentHeight).toHaveBeenCalledWith(260);
  });

  it('keeps one measurement session through done and re-emits an equal height for a new request', () => {
    const onContentHeight = vi.fn();
    const firstStreaming = response('same height');
    const { rerender } = render(<AssistantPanel conversation={firstStreaming} {...callbacks} onContentHeight={onContentHeight} />);
    flushFrame();
    expect(onContentHeight).toHaveBeenCalledTimes(1);

    const firstDone: ConversationState = {
      status: 'idle',
      messages: firstStreaming.messages.map((message) =>
        message.role === 'assistant' ? { ...message, finishReason: 'done' as const } : message,
      ),
    };
    rerender(<AssistantPanel conversation={firstDone} {...callbacks} onContentHeight={onContentHeight} />);
    flushFrame();
    expect(onContentHeight).toHaveBeenCalledTimes(1);

    const secondStreaming: ConversationState = {
      status: 'streaming',
      activeRequestId: 'req-2',
      messages: [
        ...firstDone.messages,
        { id: 'u2', role: 'user', content: 'again' },
        { id: 'a2', role: 'assistant', content: 'same height', requestId: 'req-2' },
      ],
    };
    rerender(<AssistantPanel conversation={secondStreaming} {...callbacks} onContentHeight={onContentHeight} />);
    flushFrame();
    expect(onContentHeight).toHaveBeenCalledTimes(2);
    expect(createObserver).toHaveBeenCalledOnce();
  });

  it('follows rerendered streamed deltas only while pinned to bottom', () => {
    const { rerender } = render(<AssistantPanel conversation={response('a')} {...callbacks} />);
    const list = screen.getByRole('log');
    let scrollHeight = 300;
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
    });
    list.scrollTop = 200;
    flushFrame();
    resizeCallback([], {} as ResizeObserver);
    flushFrame();

    list.scrollTop = 140;
    fireEvent.scroll(list);
    scrollHeight = 340;
    rerender(<AssistantPanel conversation={response('a delta')} {...callbacks} />);
    flushFrame();
    expect(list.scrollTop).toBe(140);

    list.scrollTop = 238;
    fireEvent.scroll(list);
    resizeCallback([], {} as ResizeObserver);
    flushFrame();
    scrollHeight = 380;
    rerender(<AssistantPanel conversation={response('a second delta')} {...callbacks} />);
    flushFrame();
    expect(list.scrollTop).toBe(380);
  });

  it.each([
    ['prompt', idle],
    ['waiting', { status: 'streaming', activeRequestId: 'req-1', messages: [
      { id: 'u1', role: 'user', content: 'hello' },
      { id: 'a1', role: 'assistant', content: '', requestId: 'req-1' },
    ] } satisfies ConversationState],
    ['response', response('partial')],
    ['error', { status: 'error', error: 'failed', messages: [
      { id: 'u1', role: 'user', content: 'hello' },
    ] } satisfies ConversationState],
  ])('collapses the %s phase on Escape', async (_phase, conversation) => {
    const user = userEvent.setup();
    const onCollapse = vi.fn();
    render(<AssistantPanel conversation={conversation} {...callbacks} onCollapse={onCollapse} />);
    await user.keyboard('{Escape}');
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
