import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { showChatPanel } = vi.hoisted(() => ({
  showChatPanel: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    label: 'floating',
    startDragging: () => Promise.resolve(),
  }),
}));

vi.mock('./bridge/commands', () => ({
  commands: {
    showChatPanel,
    showFloatingBall: () => Promise.resolve(),
    showSettingsPanel: () => Promise.resolve(),
    getSettings: () => Promise.reject(new Error('not needed')),
    saveSettings: () => Promise.resolve(),
    startChat: () => Promise.resolve('request-id'),
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

describe('App floating click flow', () => {
  it('renders the chat panel after the show command succeeds', async () => {
    render(<App />);
    const ball = screen.getByRole('button', { name: '打开 AI 对话' });

    fireEvent.click(ball);

    await waitFor(() => expect(showChatPanel).toHaveBeenCalledOnce());
    expect(await screen.findByRole('region', { name: 'AI 对话' })).toBeInTheDocument();
    expect(screen.getByLabelText('输入问题')).toBeInTheDocument();
  });
});
