import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FLOATING_BALL_SIZE, FLOATING_WINDOW_SIZE } from './floatingGeometry';

const { startFloatingDrag } = vi.hoisted(() => ({
  startFloatingDrag: vi.fn(() => Promise.resolve()),
}));

vi.mock('../bridge/commands', () => ({
  commands: { startFloatingDrag },
}));

import { FloatingBall } from './FloatingBall';

describe('FloatingBall', () => {
  beforeEach(() => {
    startFloatingDrag.mockClear();
  });

  it('activates only through the button click event', () => {
    const onActivate = vi.fn();
    render(<FloatingBall isBusy={false} onActivate={onActivate} />);
    const button = screen.getByRole('button', { name: '打开 AI 对话' });

    fireEvent.pointerDown(button, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerUp(button, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    expect(onActivate).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('starts one native drag after crossing the threshold and suppresses click', () => {
    const onActivate = vi.fn();
    render(<FloatingBall isBusy={false} onActivate={onActivate} />);
    const button = screen.getByRole('button', { name: '打开 AI 对话' });

    fireEvent.pointerDown(button, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(button, { clientX: 12, clientY: 12, pointerId: 1, buttons: 1 });
    expect(startFloatingDrag).not.toHaveBeenCalled();

    fireEvent.pointerMove(button, { clientX: 20, clientY: 20, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(button, { clientX: 30, clientY: 30, pointerId: 1, buttons: 1 });

    expect(startFloatingDrag).toHaveBeenCalledOnce();
    fireEvent.click(button);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('shows busy state without large text', () => {
    render(<FloatingBall isBusy={true} onActivate={() => undefined} />);

    expect(screen.getByRole('button', { name: 'AI 正在回复' })).toBeInTheDocument();
    expect(screen.queryByText(/正在生成中，请稍候/)).not.toBeInTheDocument();
  });

  it('reserves enough window padding to keep the circle visible', () => {
    expect((FLOATING_WINDOW_SIZE - FLOATING_BALL_SIZE) / 2).toBeGreaterThanOrEqual(4);
  });
});
