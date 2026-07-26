import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: () => Promise.resolve(),
  }),
}));

import { FloatingBall } from './FloatingBall';

describe('FloatingBall', () => {
  it('activates chat when clicked', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();

    render(<FloatingBall isBusy={false} onActivate={onActivate} />);
    await user.click(screen.getByRole('button', { name: '打开 AI 对话' }));

    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('shows busy state without large text', () => {
    render(<FloatingBall isBusy={true} onActivate={() => undefined} />);

    expect(screen.getByRole('button', { name: 'AI 正在回复' })).toBeInTheDocument();
    expect(screen.queryByText(/正在生成中，请稍候/)).not.toBeInTheDocument();
  });
});
