import { useRef } from 'react';
import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window';
import { FLOATING_BALL_SIZE } from './floatingGeometry';

interface FloatingBallProps {
  isBusy: boolean;
  onActivate: () => void;
}

interface PointerStart {
  pointerId: number;
  screenX: number;
  screenY: number;
  windowX?: number;
  windowY?: number;
  dragged: boolean;
}

const DRAG_THRESHOLD_PX = 4;

export function FloatingBall({ isBusy, onActivate }: FloatingBallProps) {
  const pointerStart = useRef<PointerStart | null>(null);

  return (
    <button
      className="floating-ball"
      style={{ width: FLOATING_BALL_SIZE, height: FLOATING_BALL_SIZE }}
      type="button"
      aria-label={isBusy ? 'AI 正在回复' : '打开 AI 对话'}
      onPointerDown={(event) => {
        if (event.button !== 0) return;

        event.currentTarget.setPointerCapture?.(event.pointerId);
        const start: PointerStart = {
          pointerId: event.pointerId,
          screenX: event.screenX,
          screenY: event.screenY,
          dragged: false,
        };
        pointerStart.current = start;

        void getCurrentWindow()
          .outerPosition()
          .then((position) => {
            if (pointerStart.current !== start) return;
            start.windowX = position.x;
            start.windowY = position.y;
          });
      }}
      onPointerMove={(event) => {
        const start = pointerStart.current;
        if (
          !start ||
          start.pointerId !== event.pointerId ||
          start.windowX === undefined ||
          start.windowY === undefined
        ) {
          return;
        }

        const deltaX = event.screenX - start.screenX;
        const deltaY = event.screenY - start.screenY;
        if (!start.dragged && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) return;

        start.dragged = true;
        void getCurrentWindow().setPosition(
          new PhysicalPosition(start.windowX + deltaX, start.windowY + deltaY),
        );
      }}
      onPointerUp={(event) => {
        const start = pointerStart.current;
        if (!start || start.pointerId !== event.pointerId) return;

        pointerStart.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        if (!start.dragged) onActivate();
      }}
      onPointerCancel={() => {
        pointerStart.current = null;
      }}
      data-busy={isBusy}
    >
      <span aria-hidden="true">AI</span>
    </button>
  );
}
