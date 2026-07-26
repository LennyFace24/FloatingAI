import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './SettingsPanel';

describe('SettingsPanel', () => {
  it('shows local-only API key copy and saves normalized settings', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <SettingsPanel
        initialSettings={{
          apiKey: '',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          globalShortcut: 'Alt+Space',
          autostartEnabled: false,
          floatingAlwaysOnTop: true,
        }}
        onSave={onSave}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText('API Key 仅保存在本机。')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Base URL'));
    await user.type(screen.getByLabelText('Base URL'), ' https://api.example.com/v1/ ');
    await user.click(screen.getByRole('button', { name: '保存设置' }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'https://api.example.com/v1' }),
    );
  });

  it('blocks save and shows errors when required fields are empty', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <SettingsPanel
        initialSettings={{
          apiKey: '',
          baseUrl: '',
          model: '',
          globalShortcut: '',
          autostartEnabled: false,
          floatingAlwaysOnTop: true,
        }}
        onSave={onSave}
        onClose={() => undefined}
      />,
    );

    await user.click(screen.getByRole('button', { name: '保存设置' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('请输入 Base URL')).toBeInTheDocument();
  });
});
