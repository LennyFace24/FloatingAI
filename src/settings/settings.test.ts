import { describe, expect, it } from 'vitest';
import { defaultSettingsForm, normalizeSettingsForm, validateSettingsForm, type SettingsFormInput } from './settings';

describe('settings form helpers', () => {
  it('trims base URL, model, and shortcut', () => {
    expect(
      normalizeSettingsForm({
        apiKey: '  sk-test  ',
        baseUrl: '  https://api.example.com/v1  ',
        model: '  gpt-test  ',
        globalShortcut: '  Alt+Space  ',
        autostartEnabled: false,
        floatingAlwaysOnTop: true,
        sttBaseUrl: 'https://api.openai.com/v1',
        sttModel: 'whisper-1',
        sttApiKey: '',
        sttLanguage: 'auto',
      }),
    ).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-test',
      globalShortcut: 'Alt+Space',
      autostartEnabled: false,
      floatingAlwaysOnTop: true,
      sttBaseUrl: 'https://api.openai.com/v1',
      sttModel: 'whisper-1',
      sttApiKey: '',
      sttLanguage: 'auto',
    });
  });

  it('strips trailing slash from base URL', () => {
    const normalized = normalizeSettingsForm({
      apiKey: '',
      baseUrl: 'https://api.example.com/v1/',
      model: 'gpt-test',
      globalShortcut: 'Alt+Space',
      autostartEnabled: false,
      floatingAlwaysOnTop: true,
      sttBaseUrl: 'https://api.openai.com/v1',
      sttModel: 'whisper-1',
      sttApiKey: '',
      sttLanguage: 'auto',
    });
    expect(normalized.baseUrl).toBe('https://api.example.com/v1');
  });

  it('requires base URL, model, and shortcut', () => {
    expect(
      validateSettingsForm({
        apiKey: '',
        baseUrl: '',
        model: '',
        globalShortcut: '',
        autostartEnabled: false,
        floatingAlwaysOnTop: true,
        sttBaseUrl: 'https://api.openai.com/v1',
        sttModel: 'whisper-1',
        sttApiKey: '',
        sttLanguage: 'auto',
      }),
    ).toEqual({
      baseUrl: '请输入 Base URL',
      model: '请输入模型名',
      globalShortcut: '请输入全局快捷键',
    });
  });
});

describe('settings form STT fields', () => {
  it('normalizes stt base url trailing slash and language trim', () => {
    const input: SettingsFormInput = {
      ...defaultSettingsForm,
      sttBaseUrl: 'http://localhost:9000/v1/',
      sttModel: ' large-v3 ',
      sttLanguage: ' zh ',
    };
    const normalized = normalizeSettingsForm(input);
    expect(normalized.sttBaseUrl).toBe('http://localhost:9000/v1');
    expect(normalized.sttModel).toBe('large-v3');
    expect(normalized.sttLanguage).toBe('zh');
  });

  it('accepts empty stt base url falling back to chat default', () => {
    const input: SettingsFormInput = { ...defaultSettingsForm, sttBaseUrl: '' };
    expect(validateSettingsForm(input)).not.toHaveProperty('sttBaseUrl');
  });
});
