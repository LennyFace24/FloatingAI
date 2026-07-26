import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FLOATING_BALL_SIZE, FLOATING_WINDOW_SIZE } from './floatingGeometry';

const outerPosition = vi.fn(() => Promise.resolve({ x: 100, y: 200 }));
const setPosition = vi.fn(() => Promise.resolve());
const startDragging = vi.fn(() => Promise.resolve());

vi.mock('@tauri-apps/api/dpi', () => ({
  PhysicalPosition: class PhysicalPosition {
    constructor(public x: number, public y: number) {}
  },
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ outerPosition, setPosition, startDragging }),
}));

import { FloatingBall } from './FloatingBall';

describe('FloatingBall', () => {
  beforeEach(() => {
    outerPosition.mockClear();
    setPosition.mockClear();
    startDragging.mockClear();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
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

  it('moves the rendered window with the pointer without starting the Windows outline drag', async () => {
    const onActivate = vi.fn();
    render(<FloatingBall isBusy={false} onActivate={onActivate} />);
    const button = screen.getByRole('button', { name: '打开 AI 对话' });

    fireEvent.pointerDown(button, { clientX: 10, clientY: 10, screenX: 210, screenY: 310, pointerId: 1, button: 0 });
    await Promise.resolve();
    fireEvent.pointerMove(button, { clientX: 20, clientY: 20, screenX: 230, screenY: 345, pointerId: 1, buttons: 1 });

    expect(setPosition).toHaveBeenCalledWith(expect.objectContaining({ x: 120, y: 235 }));
    expect(startDragging).not.toHaveBeenCalled();
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
