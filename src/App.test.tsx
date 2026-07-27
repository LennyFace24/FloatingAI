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
    onSurfaceChanged: () => Promise.resolve(() => undefined),
    onChatDelta: (handler: typeof mocks.deltaHandler) => {
      mocks.deltaHandler = handler;
      return Promise.resolve(() => undefined);
    },
    onChatDone: () => Promise.resolve(() => undefined),
    onChatError: () => Promise.resolve(() => undefined),
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
