import { invoke } from '@tauri-apps/api/core';

export interface AppSettings {
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
  globalShortcut: string;
  autostartEnabled: boolean;
  floatingAlwaysOnTop: boolean;
}

export interface SaveSettingsInput {
  apiKey?: string;
  baseUrl: string;
  model: string;
  globalShortcut: string;
  autostartEnabled: boolean;
  floatingAlwaysOnTop: boolean;
}

export interface ChatMessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export const commands = {
  startFloatingDrag: () => invoke<void>('start_floating_drag'),
  showChatPanel: (reducedMotion = false) => invoke<void>('show_chat_panel', { reducedMotion }),
  showFloatingBall: (reducedMotion = false) => invoke<void>('show_floating_ball', { reducedMotion }),
  showSettingsPanel: () => invoke<void>('show_settings_panel'),
  hideAllWindows: () => invoke<void>('hide_all_windows'),
  getSettings: () => invoke<AppSettings>('get_settings'),
  saveSettings: (settings: SaveSettingsInput) => invoke<AppSettings>('save_settings', { settings }),
  startChat: (requestId: string, messages: ChatMessageInput[]) =>
    invoke<void>('start_chat', { requestId, messages }),
  stopChat: (requestId: string) => invoke<void>('stop_chat', { requestId }),
};
