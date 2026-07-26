export type AppSurface = 'floating-ball' | 'chat-panel' | 'settings-panel' | 'hidden';

export type SurfaceEvent =
  | { type: 'activate' }
  | { type: 'collapse' }
  | { type: 'open-settings' }
  | { type: 'hide' }
  | { type: 'restore' };

export function transitionSurface(current: AppSurface, event: SurfaceEvent): AppSurface {
  switch (event.type) {
    case 'activate':
      return 'chat-panel';
    case 'collapse':
      return 'floating-ball';
    case 'open-settings':
      return 'settings-panel';
    case 'hide':
      return 'hidden';
    case 'restore':
      return current === 'hidden' ? 'floating-ball' : current;
  }
}
