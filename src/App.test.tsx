import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  showPromptBar: vi.fn(() => Promise.resolve()),
  showWaitingBall: vi.fn(() => Promise.resolve()),
  resizeResponsePanel: vi.fn(() => Promise.resolve()),
  showFloatingBall: vi.fn(() => Promise.resolve()),
  showSettingsPanel: vi.fn(() => Promise.resolve()),
  startChat: vi.fn((_requestId: string, _messages: unknown[]) => Promise.resolve()),
  stopChat: vi.fn(() => Promise.resolve()),
  deltaHandler: undefined as undefined | ((payload: { requestId: string; content: string }) => void),
  doneHandler: undefined as undefined | ((payload: { requestId: string }) => void),
  errorHandler: undefined as undefined | ((payload: { requestId: string; message: string }) => void),
  surfaceHandler: undefined as undefined | ((surface: 'floating' | 'chat' | 'settings') => void),
  getSettings: vi.fn(() => Promise.resolve({
    apiKeyConfigured: false,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    globalShortcut: 'Alt+Space',
    autostartEnabled: false,
    floatingAlwaysOnTop: true,
  })),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'floating', startDragging: () => Promise.resolve() }),
}));

vi.mock('./bridge/commands', () => ({
  commands: {
    showPromptBar: mocks.showPromptBar,
    showWaitingBall: mocks.showWaitingBall,
    resizeResponsePanel: mocks.resizeResponsePanel,
    showFloatingBall: mocks.showFloatingBall,
    showSettingsPanel: mocks.showSettingsPanel,
    getSettings: mocks.getSettings,
    saveSettings: () => Promise.resolve(),
    startChat: mocks.startChat,
    stopChat: mocks.stopChat,
  },
}));

vi.mock('./bridge/events', () => ({
  events: {
    onSurfaceChanged: (handler: typeof mocks.surfaceHandler) => {
      mocks.surfaceHandler = handler;
      return Promise.resolve(() => undefined);
    },
    onChatDelta: (handler: typeof mocks.deltaHandler) => {
      mocks.deltaHandler = handler;
      return Promise.resolve(() => undefined);
    },
    onChatDone: (handler: typeof mocks.doneHandler) => {
      mocks.doneHandler = handler;
      return Promise.resolve(() => undefined);
    },
    onChatError: (handler: typeof mocks.errorHandler) => {
      mocks.errorHandler = handler;
      return Promise.resolve(() => undefined);
    },
  },
}));

import App from './App';

async function openAssistant() {
  fireEvent.click(screen.getByRole('button', { name: '打开 AI 对话' }));
  expect(await screen.findByRole('region', { name: 'AI 对话' })).toBeInTheDocument();
}

describe('App assistant surface state flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deltaHandler = undefined;
    mocks.doneHandler = undefined;
    mocks.errorHandler = undefined;
    mocks.surfaceHandler = undefined;
    mocks.showPromptBar.mockResolvedValue();
    mocks.showWaitingBall.mockResolvedValue();
    mocks.resizeResponsePanel.mockResolvedValue();
    mocks.showFloatingBall.mockResolvedValue();
    mocks.showSettingsPanel.mockResolvedValue();
    mocks.startChat.mockResolvedValue();
  });

  it('opens prompt, waits after send, and expands only on the first non-empty delta', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openAssistant();
    expect(mocks.showPromptBar).toHaveBeenCalledOnce();

    await user.type(screen.getByLabelText('输入问题'), '测试消息');
    await user.click(screen.getByRole('button', { name: '发送' }));
    await waitFor(() => expect(mocks.showWaitingBall).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: '停止生成' })).toBeInTheDocument();

    const requestId = mocks.startChat.mock.calls[0][0];
    act(() => mocks.deltaHandler?.({ requestId, content: '' }));
    expect(mocks.resizeResponsePanel).not.toHaveBeenCalled();
    act(() => mocks.deltaHandler?.({ requestId, content: '首' }));
    await waitFor(() => expect(mocks.resizeResponsePanel).toHaveBeenCalledOnce());
    expect(await screen.findByRole('log')).toHaveTextContent('首');
    act(() => mocks.deltaHandler?.({ requestId, content: '字' }));
    expect(mocks.resizeResponsePanel).toHaveBeenCalledOnce();
  });

  it('syncs done and error events to prompt or response and ignores stale requests', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openAssistant();
    await user.type(screen.getByLabelText('输入问题'), 'first');
    await user.click(screen.getByRole('button', { name: '发送' }));
    const requestId = mocks.startChat.mock.calls[0][0];

    act(() => mocks.doneHandler?.({ requestId: 'stale' }));
    expect(screen.getByRole('button', { name: '停止生成' })).toBeInTheDocument();
    expect(mocks.showPromptBar).toHaveBeenCalledOnce();
    act(() => mocks.doneHandler?.({ requestId }));
    await waitFor(() => expect(mocks.showPromptBar).toHaveBeenCalledTimes(2));
    await user.type(screen.getByLabelText('输入问题'), 'after done');
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(mocks.startChat.mock.calls[1][1]).toEqual([{ role: 'user', content: 'after done' }]);

    const secondId = mocks.startChat.mock.calls[1][0];
    act(() => mocks.errorHandler?.({ requestId: secondId, message: 'failed' }));
    await waitFor(() => expect(mocks.resizeResponsePanel).toHaveBeenCalledOnce());
    expect(await screen.findByRole('alert')).toHaveTextContent('failed');
  });

  it('keeps response shape for done and error after content', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openAssistant();
    await user.type(screen.getByLabelText('输入问题'), 'done content');
    await user.click(screen.getByRole('button', { name: '发送' }));
    const doneId = mocks.startChat.mock.calls[0][0];
    act(() => mocks.deltaHandler?.({ requestId: doneId, content: 'answer' }));
    act(() => mocks.doneHandler?.({ requestId: doneId }));
    expect(await screen.findByRole('log')).toHaveTextContent('answer');

    await user.type(screen.getByLabelText('输入问题'), 'error content');
    await user.click(screen.getByRole('button', { name: '发送' }));
    const errorId = mocks.startChat.mock.calls[1][0];
    act(() => mocks.deltaHandler?.({ requestId: errorId, content: 'partial' }));
    act(() => mocks.errorHandler?.({ requestId: errorId, message: 'failed later' }));
    expect(await screen.findByRole('log')).toHaveTextContent('partial');
    expect(screen.getByRole('alert')).toHaveTextContent('failed later');
  });

  it('uses the latest delta when stop resolves and ignores stale deltas', async () => {
    let resolveStop!: () => void;
    mocks.stopChat.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveStop = resolve; }));
    const user = userEvent.setup();
    render(<App />);
    await openAssistant();
    await user.type(screen.getByLabelText('输入问题'), 'race');
    await user.click(screen.getByRole('button', { name: '发送' }));
    const requestId = mocks.startChat.mock.calls[0][0];
    await user.click(screen.getByRole('button', { name: '停止生成' }));
    act(() => mocks.deltaHandler?.({ requestId: 'stale', content: 'ignored' }));
    expect(mocks.resizeResponsePanel).not.toHaveBeenCalled();
    act(() => mocks.deltaHandler?.({ requestId, content: 'last' }));
    act(() => resolveStop());
    await waitFor(() => expect(mocks.resizeResponsePanel).toHaveBeenCalled());
    expect(screen.getByRole('log')).toHaveTextContent('last');
  });

  it('recovers when switching to waiting fails', async () => {
    mocks.showWaitingBall.mockRejectedValueOnce(new Error('window failed'));
    const user = userEvent.setup();
    render(<App />);
    await openAssistant();
    await user.type(screen.getByLabelText('输入问题'), 'hello');
    await user.click(screen.getByRole('button', { name: '发送' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('window failed');
    await waitFor(() => expect(mocks.resizeResponsePanel).toHaveBeenCalledOnce());
    expect(mocks.startChat).not.toHaveBeenCalled();
  });

  it('returns from settings to waiting and response phases', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openAssistant();
    await user.type(screen.getByLabelText('输入问题'), 'hello');
    await user.click(screen.getByRole('button', { name: '发送' }));
    const requestId = mocks.startChat.mock.calls[0][0];

    act(() => mocks.surfaceHandler?.('settings'));
    expect(await screen.findByRole('region', { name: '设置' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关闭设置' }));
    await waitFor(() => expect(mocks.showWaitingBall).toHaveBeenCalledTimes(2));

    act(() => mocks.deltaHandler?.({ requestId, content: 'answer' }));
    act(() => mocks.surfaceHandler?.('settings'));
    expect(await screen.findByRole('region', { name: '设置' })).toBeInTheDocument();
    const resizeCount = mocks.resizeResponsePanel.mock.calls.length;
    await user.click(screen.getByRole('button', { name: '关闭设置' }));
    await waitFor(() => expect(mocks.resizeResponsePanel).toHaveBeenCalledTimes(resizeCount + 1));
    expect(await screen.findByRole('log')).toHaveTextContent('answer');
  });

  it('keeps the user message visible when starting the request fails', async () => {
    const user = userEvent.setup();
    mocks.startChat.mockRejectedValueOnce(new Error('请先在设置中配置 API Key'));
    render(<App />);
    await openAssistant();

    await user.type(screen.getByLabelText('输入问题'), '测试消息');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('测试消息')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('请先在设置中配置 API Key');
  });

  it('returns from settings to the derived phase and collapses to the ball', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openAssistant();

    await user.click(screen.getByRole('button', { name: '打开设置' }));
    expect(await screen.findByRole('region', { name: '设置' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关闭设置' }));
    await waitFor(() => expect(mocks.showPromptBar).toHaveBeenCalledTimes(2));

    await user.click(screen.getByRole('button', { name: '收起' }));
    await waitFor(() => expect(mocks.showFloatingBall).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: '打开 AI 对话' })).toBeInTheDocument();
  });
});
