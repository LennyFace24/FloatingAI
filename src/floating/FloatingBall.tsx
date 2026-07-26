import { useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { FLOATING_BALL_SIZE } from './floatingGeometry';

interface FloatingBallProps {
  isBusy: boolean;
  onActivate: () => void;
}

interface PointerStart {
  x: number;
  y: number;
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
        pointerStart.current = { x: event.clientX, y: event.clientY };
        suppressClick.current = false;
      }}
      onPointerMove={(event) => {
        const start = pointerStart.current;
        if (!start || suppressClick.current || (event.buttons & 1) === 0) return;

        const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        if (distance < DRAG_THRESHOLD_PX) return;

        suppressClick.current = true;
        pointerStart.current = null;
        void getCurrentWindow()
          .startDragging()
          .catch((error) => {
            suppressClick.current = false;
            console.error('拖动悬浮球失败', error);
          });
      }}
      onPointerUp={() => {
        pointerStart.current = null;
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
