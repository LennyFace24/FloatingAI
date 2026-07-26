import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FLOATING_BALL_SIZE, FLOATING_WINDOW_SIZE } from './floatingGeometry';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startDragging = vi.fn(() => Promise.resolve());

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging }),
}));

import { FloatingBall } from './FloatingBall';

describe('FloatingBall', () => {
  beforeEach(() => {
    startDragging.mockClear();
  });

  it('activates chat when clicked', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();

    render(<FloatingBall isBusy={false} onActivate={onActivate} />);
    await user.click(screen.getByRole('button', { name: '打开 AI 对话' }));

    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('does not start native drag for a click', () => {
    const onActivate = vi.fn();
    render(<FloatingBall isBusy={false} onActivate={onActivate} />);
    const button = screen.getByRole('button', { name: '打开 AI 对话' });

    fireEvent.pointerDown(button, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(button, { clientX: 10, clientY: 10, pointerId: 1 });

    expect(startDragging).not.toHaveBeenCalled();
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('starts native drag only after pointer moves beyond threshold', () => {
    const onActivate = vi.fn();
    render(<FloatingBall isBusy={false} onActivate={onActivate} />);
    const button = screen.getByRole('button', { name: '打开 AI 对话' });

    fireEvent.pointerDown(button, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(button, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(button, { clientX: 20, clientY: 20, pointerId: 1 });

    expect(startDragging).toHaveBeenCalledOnce();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('shows busy state without large text', () => {
    render(<FloatingBall isBusy={true} onActivate={() => undefined} />);

    expect(screen.getByRole('button', { name: 'AI 正在回复' })).toBeInTheDocument();
    expect(screen.queryByText(/正在生成中，请稍候/)).not.toBeInTheDocument();
  });

  it('reserves enough window padding to keep the circle visible', () => {
    expect((FLOATING_WINDOW_SIZE - FLOATING_BALL_SIZE) / 2).toBeGreaterThanOrEqual(6);
  });
});
