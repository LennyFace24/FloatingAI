import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FLOATING_BALL_SIZE, FLOATING_WINDOW_SIZE } from './floatingGeometry';

const { startFloatingDrag, outerPosition, setPosition } = vi.hoisted(() => ({
  startFloatingDrag: vi.fn(() => Promise.resolve()),
  outerPosition: vi.fn(),
  setPosition: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ outerPosition, setPosition }),
}));

vi.mock('../bridge/commands', () => ({
  commands: { startFloatingDrag },
}));

import { FloatingBall } from './FloatingBall';

describe('FloatingBall', () => {
  beforeEach(() => {
    startFloatingDrag.mockClear();
    outerPosition.mockClear();
    setPosition.mockClear();
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

    const requestAnimationFrame = vi.spyOn(window, 'requestAnimationFrame');
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(button, { clientX: 13, clientY: 10, pointerId: 1, buttons: 1 });
    expect(startFloatingDrag).not.toHaveBeenCalled();

    fireEvent.pointerMove(button, { clientX: 14, clientY: 10, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(button, { clientX: 30, clientY: 30, pointerId: 1, buttons: 1 });

    expect(startFloatingDrag).toHaveBeenCalledOnce();
    expect(outerPosition).not.toHaveBeenCalled();
    expect(setPosition).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onActivate).not.toHaveBeenCalled();
    requestAnimationFrame.mockRestore();
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
