import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { commands } from '../bridge/commands';

const DRAG_THRESHOLD_PX = 4;
const INTERACTIVE_SELECTOR = 'button, input, textarea, select, a, [contenteditable="true"], [data-window-drag-exclude]';

interface PointerStart {
  pointerId: number;
  x: number;
  y: number;
}

interface WindowDragOptions {
  allowInteractiveRoot?: boolean;
}

export function useWindowDrag({ allowInteractiveRoot = false }: WindowDragOptions = {}) {
  const pointerStart = useRef<PointerStart | null>(null);
  const suppressClick = useRef(false);

  function isExcluded(target: EventTarget | null, currentTarget: HTMLElement) {
    if (!(target instanceof Element)) return true;
    const interactive = target.closest(INTERACTIVE_SELECTOR);
    return interactive !== null && !(allowInteractiveRoot && interactive === currentTarget);
  }

  return {
    pointerProps: {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (event.button !== 0 || isExcluded(event.target, event.currentTarget)) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        pointerStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        suppressClick.current = false;
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        const start = pointerStart.current;
        if (!start || start.pointerId !== event.pointerId || (event.buttons & 1) === 0) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < DRAG_THRESHOLD_PX) return;
        suppressClick.current = true;
        pointerStart.current = null;
        void commands.startFloatingDrag().catch((error) => {
          suppressClick.current = false;
          console.error('拖动窗口失败', error);
        });
      },
      onPointerUp(event: ReactPointerEvent<HTMLElement>) {
        if (pointerStart.current?.pointerId === event.pointerId) pointerStart.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      },
      onPointerCancel() {
        pointerStart.current = null;
      },
    },
    consumeClick() {
      if (!suppressClick.current) return false;
      suppressClick.current = false;
      return true;
    },
  };
}
