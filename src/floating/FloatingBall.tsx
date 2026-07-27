import { useWindowDrag } from '../window/useWindowDrag';
import { FLOATING_BALL_SIZE } from './floatingGeometry';

interface FloatingBallProps {
  isBusy: boolean;
  onActivate: () => void;
}

export function FloatingBall({ isBusy, onActivate }: FloatingBallProps) {
  const drag = useWindowDrag({ allowInteractiveRoot: true });

  return (
    <button
      className="floating-ball"
      style={{ width: FLOATING_BALL_SIZE, height: FLOATING_BALL_SIZE }}
      type="button"
      aria-label={isBusy ? 'AI 正在回复' : '打开 AI 对话'}
      {...drag.pointerProps}
      onClick={() => {
        if (!drag.consumeClick()) onActivate();
      }}
      data-busy={isBusy}
    >
      <span aria-hidden="true">AI</span>
    </button>
  );
}
