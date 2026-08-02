import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface ChatDeltaPayload {
  requestId: string;
  content: string;
}

export interface ChatDonePayload {
  requestId: string;
}

export interface ChatErrorPayload {
  requestId: string;
  message: string;
}

export type SurfaceChangedPayload = 'floating' | 'chat' | 'settings';

export const events = {
  onChatDelta: (handler: (payload: ChatDeltaPayload) => void): Promise<UnlistenFn> =>
    listen<ChatDeltaPayload>('chat://delta', (event) => handler(event.payload)),
  onChatDone: (handler: (payload: ChatDonePayload) => void): Promise<UnlistenFn> =>
    listen<ChatDonePayload>('chat://done', (event) => handler(event.payload)),
  onChatError: (handler: (payload: ChatErrorPayload) => void): Promise<UnlistenFn> =>
    listen<ChatErrorPayload>('chat://error', (event) => handler(event.payload)),
  onSurfaceChanged: (handler: (payload: SurfaceChangedPayload) => void): Promise<UnlistenFn> =>
    listen<SurfaceChangedPayload>('surface://changed', (event) => handler(event.payload)),
  onSurfaceShowRequested: (handler: () => void): Promise<UnlistenFn> =>
    listen('surface://show-requested', () => handler()),
  onQuickAskPrefill: (handler: (text: string) => void): Promise<UnlistenFn> =>
    listen<string>('quick-ask://prefill', (event) => handler(event.payload)),
};
