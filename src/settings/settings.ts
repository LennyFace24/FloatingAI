export interface SettingsFormInput {
  apiKey: string;
  baseUrl: string;
  model: string;
  globalShortcut: string;
  autostartEnabled: boolean;
  floatingAlwaysOnTop: boolean;
}

export type SettingsErrors = Partial<Record<'baseUrl' | 'model' | 'globalShortcut', string>>;

export const defaultSettingsForm: SettingsFormInput = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  globalShortcut: 'Alt+Space',
  autostartEnabled: false,
  floatingAlwaysOnTop: true,
};

export function normalizeSettingsForm(input: SettingsFormInput): SettingsFormInput {
  return {
    apiKey: input.apiKey.trim(),
    baseUrl: input.baseUrl.trim().replace(/\/$/, ''),
    model: input.model.trim(),
    globalShortcut: input.globalShortcut.trim(),
    autostartEnabled: input.autostartEnabled,
    floatingAlwaysOnTop: input.floatingAlwaysOnTop,
  };
}

export function validateSettingsForm(input: SettingsFormInput): SettingsErrors {
  const normalized = normalizeSettingsForm(input);
  const errors: SettingsErrors = {};

  if (!normalized.baseUrl) errors.baseUrl = '请输入 Base URL';
  if (!normalized.model) errors.model = '请输入模型名';
  if (!normalized.globalShortcut) errors.globalShortcut = '请输入全局快捷键';

  return errors;
}
