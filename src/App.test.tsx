import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  showChatPanel: vi.fn(() => Promise.resolve()),
  showFloatingBall: vi.fn(() => Promise.resolve()),
  showSettingsPanel: vi.fn(() => Promise.resolve()),
  startChat: vi.fn(() => Promise.resolve()),
  getSettings: vi.fn(() =>
    Promise.resolve({
      apiKeyConfigured: false,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      globalShortcut: 'Alt+Space',
      autostartEnabled: false,
      floatingAlwaysOnTop: true,
    }),
  ),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    label: 'floating',
    startDragging: () => Promise.resolve(),
  }),
}));

vi.mock('./bridge/commands', () => ({
  commands: {
    showChatPanel: mocks.showChatPanel,
    showFloatingBall: mocks.showFloatingBall,
    showSettingsPanel: mocks.showSettingsPanel,
    getSettings: mocks.getSettings,
    saveSettings: () => Promise.resolve(),
    startChat: mocks.startChat,
    stopChat: () => Promise.resolve(),
  },
}));

vi.mock('./bridge/events', () => ({
  events: {
    onSurfaceChanged: () => Promise.resolve(() => undefined),
    onChatDelta: () => Promise.resolve(() => undefined),
    onChatDone: () => Promise.resolve(() => undefined),
    onChatError: () => Promise.resolve(() => undefined),
  },
}));

import App from './App';

async function openChat() {
  fireEvent.click(screen.getByRole('button', { name: '打开 AI 对话' }));
  expect(await screen.findByRole('region', { name: 'AI 对话' })).toBeInTheDocument();
}

describe('App main window state flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.showChatPanel.mockResolvedValue();
    mocks.showFloatingBall.mockResolvedValue();
    mocks.showSettingsPanel.mockResolvedValue();
    mocks.startChat.mockResolvedValue();
  });

  it('renders the chat panel after the show command succeeds', async () => {
    render(<App />);
    await openChat();

    expect(mocks.showChatPanel).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('输入问题')).toBeInTheDocument();
  });

  it('keeps the user message visible when starting the request fails', async () => {
    const user = userEvent.setup();
    mocks.startChat.mockRejectedValueOnce(new Error('请先在设置中配置 API Key'));
    render(<App />);
    await openChat();

    await user.type(screen.getByLabelText('输入问题'), '测试消息');
    await user.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByText('测试消息')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('请先在设置中配置 API Key');
  });

  it('opens settings in the main window and returns to chat on close', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChat();

    await user.click(screen.getByRole('button', { name: '打开设置' }));
    expect(await screen.findByRole('region', { name: '设置' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '关闭设置' }));
    expect(await screen.findByRole('region', { name: 'AI 对话' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '收起' }));
    await waitFor(() => expect(mocks.showFloatingBall).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: '打开 AI 对话' })).toBeInTheDocument();
  });
});
