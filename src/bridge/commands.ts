import { invoke } from '@tauri-apps/api/core';

export interface AppSettings {
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
  globalShortcut: string;
  autostartEnabled: boolean;
  floatingAlwaysOnTop: boolean;
  sttBaseUrl: string;
  sttModel: string;
  sttApiKeyConfigured: boolean;
  sttLanguage: string;
}

export interface SaveSettingsInput {
  apiKey?: string;
  baseUrl: string;
  model: string;
  globalShortcut: string;
  autostartEnabled: boolean;
  floatingAlwaysOnTop: boolean;
  sttBaseUrl: string;
  sttModel: string;
  sttApiKey?: string;
  sttLanguage: string;
}

export interface ChatMessageInput {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export const commands = {
  startFloatingDrag: () => invoke<void>('start_floating_drag'),
  showPromptBar: (reducedMotion = false) => invoke<void>('show_prompt_bar', { reducedMotion }),
  showWaitingBall: (reducedMotion = false) => invoke<void>('show_waiting_ball', { reducedMotion }),
  resizeResponsePanel: (contentHeight: number, reducedMotion = false) =>
    invoke<void>('resize_response_panel', { contentHeight, reducedMotion }),
  showResponsePanel: (contentHeight: number, reducedMotion = false) =>
    invoke<void>('show_response_panel', { contentHeight, reducedMotion }),
  showChatPanel: (reducedMotion = false) => invoke<void>('show_chat_panel', { reducedMotion }),
  showFloatingBall: (reducedMotion = false) => invoke<void>('show_floating_ball', { reducedMotion }),
  showSettingsPanel: (reducedMotion = false) => invoke<void>('show_settings_panel', { reducedMotion }),
  hideAllWindows: () => invoke<void>('hide_all_windows'),
  getSettings: () => invoke<AppSettings>('get_settings'),
  saveSettings: (settings: SaveSettingsInput) => invoke<AppSettings>('save_settings', { settings }),
  transcribeAudio: (audio: Uint8Array, mime: string) =>
    invoke<string>('transcribe_audio', { audio, mime }),
  startChat: (requestId: string, messages: ChatMessageInput[]) =>
    invoke<void>('start_chat', { requestId, messages }),
  stopChat: (requestId: string) => invoke<void>('stop_chat', { requestId }),
};
