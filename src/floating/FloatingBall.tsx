import { getCurrentWindow } from '@tauri-apps/api/window';

interface FloatingBallProps {
  isBusy: boolean;
  onActivate: () => void;
}

function startDrag() {
  void getCurrentWindow()
    .startDragging()
    .catch(() => undefined);
}

export function FloatingBall({ isBusy, onActivate }: FloatingBallProps) {
  return (
    <button
      className="floating-ball"
      type="button"
      aria-label={isBusy ? 'AI 正在回复' : '打开 AI 对话'}
      onClick={onActivate}
      onPointerDown={startDrag}
      data-busy={isBusy}
    >
      <span aria-hidden="true">AI</span>
    </button>
  );
}
