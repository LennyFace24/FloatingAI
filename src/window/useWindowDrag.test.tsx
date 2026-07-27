import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { startFloatingDrag } = vi.hoisted(() => ({
  startFloatingDrag: vi.fn(() => Promise.resolve()),
}));

vi.mock('../bridge/commands', () => ({
  commands: { startFloatingDrag },
}));

import { useWindowDrag } from './useWindowDrag';

function Harness({ allowRootClick = false }: { allowRootClick?: boolean }) {
  const drag = useWindowDrag({ allowInteractiveRoot: allowRootClick });
  return (
    <button
      type="button"
      aria-label="拖动表面"
      {...drag.pointerProps}
      onClick={(event) => {
        if (drag.consumeClick()) event.preventDefault();
      }}
    >
      <span>空白区域</span>
      <input aria-label="交互输入" data-window-drag-exclude />
    </button>
  );
}

describe('useWindowDrag', () => {
  beforeEach(() => startFloatingDrag.mockClear());

  it('starts native drag once at four pixels but not three', () => {
    render(<Harness allowRootClick />);
    const surface = screen.getByRole('button', { name: '拖动表面' });

    fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(surface, { clientX: 13, clientY: 10, pointerId: 1, buttons: 1 });
    expect(startFloatingDrag).not.toHaveBeenCalled();

    fireEvent.pointerMove(surface, { clientX: 14, clientY: 10, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(surface, { clientX: 30, clientY: 30, pointerId: 1, buttons: 1 });
    expect(startFloatingDrag).toHaveBeenCalledOnce();
  });

  it('does not drag from excluded interactive descendants', () => {
    render(<Harness allowRootClick />);
    const input = screen.getByLabelText('交互输入');

    fireEvent.pointerDown(input, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(input, { clientX: 20, clientY: 20, pointerId: 1, buttons: 1 });
    expect(startFloatingDrag).not.toHaveBeenCalled();
  });

  it('suppresses the click after a drag', () => {
    render(<Harness allowRootClick />);
    const surface = screen.getByRole('button', { name: '拖动表面' });

    fireEvent.pointerDown(surface, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerMove(surface, { clientX: 14, clientY: 10, pointerId: 1, buttons: 1 });
    expect(usePreventedClick(surface)).toBe(true);
    expect(usePreventedClick(surface)).toBe(false);
  });
});

function usePreventedClick(element: HTMLElement) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event.defaultPrevented;
}
