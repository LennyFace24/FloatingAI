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
  showChatPanel: () => invoke<void>('show_chat_panel'),
  showFloatingBall: () => invoke<void>('show_floating_ball'),
  showSettingsPanel: () => invoke<void>('show_settings_panel'),
  hideAllWindows: () => invoke<void>('hide_all_windows'),
  getSettings: () => invoke<AppSettings>('get_settings'),
  saveSettings: (settings: SaveSettingsInput) => invoke<AppSettings>('save_settings', { settings }),
  startChat: (messages: ChatMessageInput[]) => invoke<string>('start_chat', { messages }),
  stopChat: (requestId: string) => invoke<void>('stop_chat', { requestId }),
};
