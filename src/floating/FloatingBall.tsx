import { useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface FloatingBallProps {
  isBusy: boolean;
  onActivate: () => void;
}

interface PointerStart {
  x: number;
  y: number;
  dragged: boolean;
}

const DRAG_THRESHOLD_PX = 6;

export function FloatingBall({ isBusy, onActivate }: FloatingBallProps) {
  const pointerStart = useRef<PointerStart | null>(null);

  return (
    <button
      className="floating-ball"
      type="button"
      aria-label={isBusy ? 'AI 正在回复' : '打开 AI 对话'}
      onPointerDown={(event) => {
        pointerStart.current = {
          x: event.clientX,
          y: event.clientY,
          dragged: false,
        };
      }}
      onPointerMove={(event) => {
        const start = pointerStart.current;
        if (!start || start.dragged) return;

        const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        if (distance < DRAG_THRESHOLD_PX) return;

        start.dragged = true;
        void getCurrentWindow()
          .startDragging()
          .catch(() => {
            pointerStart.current = null;
          });
      }}
      onPointerUp={() => {
        const start = pointerStart.current;
        pointerStart.current = null;
        if (start && !start.dragged) onActivate();
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
