import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FLOATING_BALL_SIZE, FLOATING_WINDOW_SIZE } from './floatingGeometry';

const outerPosition = vi.fn(() => Promise.resolve({ x: 100, y: 200 }));
const setPosition = vi.fn((_position: { x: number; y: number }) => Promise.resolve());

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ outerPosition, setPosition }),
  PhysicalPosition: class PhysicalPosition {
    constructor(public x: number, public y: number) {}
  },
}));

import { FloatingBall } from './FloatingBall';

describe('FloatingBall', () => {
  beforeEach(() => {
    outerPosition.mockClear();
    setPosition.mockClear();
  });

  it('activates chat after a stationary pointer release', async () => {
    const onActivate = vi.fn();
    render(<FloatingBall isBusy={false} onActivate={onActivate} />);
    const button = screen.getByRole('button', { name: '打开 AI 对话' });

    fireEvent.pointerDown(button, {
      clientX: 10,
      clientY: 10,
      screenX: 510,
      screenY: 410,
      pointerId: 1,
      button: 0,
    });
    await waitFor(() => expect(outerPosition).toHaveBeenCalledOnce());
    fireEvent.pointerUp(button, {
      clientX: 10,
      clientY: 10,
      screenX: 510,
      screenY: 410,
      pointerId: 1,
      button: 0,
    });

    expect(setPosition).not.toHaveBeenCalled();
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('moves the window and does not activate after dragging', async () => {
    const onActivate = vi.fn();
    render(<FloatingBall isBusy={false} onActivate={onActivate} />);
    const button = screen.getByRole('button', { name: '打开 AI 对话' });

    fireEvent.pointerDown(button, {
      clientX: 10,
      clientY: 10,
      screenX: 510,
      screenY: 410,
      pointerId: 1,
      button: 0,
    });
    await waitFor(() => expect(outerPosition).toHaveBeenCalledOnce());
    fireEvent.pointerMove(button, {
      clientX: 20,
      clientY: 20,
      screenX: 530,
      screenY: 440,
      pointerId: 1,
      buttons: 1,
    });

    await waitFor(() => expect(setPosition).toHaveBeenCalledOnce());
    expect(setPosition.mock.calls[0][0]).toMatchObject({ x: 120, y: 230 });

    fireEvent.pointerUp(button, {
      clientX: 20,
      clientY: 20,
      screenX: 530,
      screenY: 440,
      pointerId: 1,
      button: 0,
    });
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
