import { useRef } from 'react';
import { commands } from '../bridge/commands';
import { FLOATING_BALL_SIZE } from './floatingGeometry';

interface FloatingBallProps {
  isBusy: boolean;
  onActivate: () => void;
}

interface PointerStart {
  pointerId: number;
  clientX: number;
  clientY: number;
}

const DRAG_THRESHOLD_PX = 4;

export function FloatingBall({ isBusy, onActivate }: FloatingBallProps) {
  const pointerStart = useRef<PointerStart | null>(null);
  const suppressClick = useRef(false);

  return (
    <button
      className="floating-ball"
      style={{ width: FLOATING_BALL_SIZE, height: FLOATING_BALL_SIZE }}
      type="button"
      aria-label={isBusy ? 'AI 正在回复' : '打开 AI 对话'}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onActivate();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        suppressClick.current = false;
        pointerStart.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
        };
      }}
      onPointerMove={(event) => {
        const start = pointerStart.current;
        if (!start || start.pointerId !== event.pointerId || (event.buttons & 1) === 0) return;
        const deltaX = event.clientX - start.clientX;
        const deltaY = event.clientY - start.clientY;
        if (Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) return;
        pointerStart.current = null;
        suppressClick.current = true;
        void commands.startFloatingDrag().catch((error) => console.error('移动悬浮球失败', error));
      }}
      onPointerUp={(event) => {
        if (pointerStart.current?.pointerId === event.pointerId) pointerStart.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
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
