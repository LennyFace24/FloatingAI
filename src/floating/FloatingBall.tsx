import { useRef } from 'react';
import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { FLOATING_BALL_SIZE } from './floatingGeometry';

interface FloatingBallProps {
  isBusy: boolean;
  onActivate: () => void;
}

interface PointerStart {
  pointerId: number;
  screenX: number;
  screenY: number;
  windowX: number;
  windowY: number;
}

const DRAG_THRESHOLD_PX = 4;

export function FloatingBall({ isBusy, onActivate }: FloatingBallProps) {
  const pointerStart = useRef<PointerStart | null>(null);
  const suppressClick = useRef(false);
  const pendingPosition = useRef<PhysicalPosition | null>(null);
  const frameId = useRef<number | null>(null);
  const appWindow = getCurrentWindow();

  function schedulePosition(position: PhysicalPosition) {
    pendingPosition.current = position;
    if (frameId.current !== null) return;
    frameId.current = window.requestAnimationFrame(() => {
      frameId.current = null;
      const next = pendingPosition.current;
      pendingPosition.current = null;
      if (next) void appWindow.setPosition(next).catch((error) => console.error('移动悬浮球失败', error));
    });
  }

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
        const { pointerId, screenX, screenY } = event;
        void appWindow.outerPosition().then((position) => {
          pointerStart.current = {
            pointerId,
            screenX,
            screenY,
            windowX: position.x,
            windowY: position.y,
          };
        }).catch((error) => console.error('读取悬浮球位置失败', error));
      }}
      onPointerMove={(event) => {
        const start = pointerStart.current;
        if (!start || start.pointerId !== event.pointerId || (event.buttons & 1) === 0) return;
        const deltaX = event.screenX - start.screenX;
        const deltaY = event.screenY - start.screenY;
        if (!suppressClick.current && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) return;
        suppressClick.current = true;
        schedulePosition(new PhysicalPosition(start.windowX + deltaX, start.windowY + deltaY));
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
