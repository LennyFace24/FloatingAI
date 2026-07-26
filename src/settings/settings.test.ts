import { describe, expect, it } from 'vitest';
import { normalizeSettingsForm, validateSettingsForm } from './settings';

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
      }),
    ).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com/v1',
      model: 'gpt-test',
      globalShortcut: 'Alt+Space',
      autostartEnabled: false,
      floatingAlwaysOnTop: true,
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
      }),
    ).toEqual({
      baseUrl: '请输入 Base URL',
      model: '请输入模型名',
      globalShortcut: '请输入全局快捷键',
    });
  });
});
