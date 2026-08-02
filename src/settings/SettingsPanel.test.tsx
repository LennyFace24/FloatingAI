import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './SettingsPanel';

const chatSettings = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  globalShortcut: 'Alt+Space',
  autostartEnabled: false,
  floatingAlwaysOnTop: true,
  sttBaseUrl: 'https://api.openai.com/v1',
  sttModel: 'whisper-1',
  sttApiKey: '',
  sttLanguage: 'auto',
  sttProvider: 'openai',
};

describe('SettingsPanel', () => {
  it('renders a root menu with chat and voice entries', () => {
    render(
      <SettingsPanel initialSettings={chatSettings} onSave={vi.fn()} onClose={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: '聊天设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '语音设置' })).toBeInTheDocument();
  });

  it('shows local-only API key copy and saves normalized settings from chat view', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <SettingsPanel initialSettings={chatSettings} onSave={onSave} onClose={() => undefined} />,
    );
    await user.click(screen.getByRole('button', { name: '聊天设置' }));

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
        initialSettings={{ ...chatSettings, baseUrl: '', model: '', globalShortcut: '' }}
        onSave={onSave}
        onClose={() => undefined}
      />,
    );
    await user.click(screen.getByRole('button', { name: '聊天设置' }));

    await user.click(screen.getByRole('button', { name: '保存设置' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('请输入 Base URL')).toBeInTheDocument();
  });

  it('hides STT Base URL and fills MiMo default when provider is mimo', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <SettingsPanel initialSettings={chatSettings} onSave={onSave} onClose={() => undefined} />,
    );
    await user.click(screen.getByRole('button', { name: '语音设置' }));

    // 清空 Base URL，切换服务类型为 MiMo → Base URL 隐藏
    await user.clear(screen.getByLabelText('STT Base URL'));
    await user.selectOptions(screen.getByLabelText('语音服务类型'), 'mimo');
    expect(screen.queryByLabelText('STT Base URL')).not.toBeInTheDocument();

    // 保存：sttBaseUrl 为空 → 填 MiMo 默认地址
    await user.click(screen.getByRole('button', { name: '保存设置' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sttProvider: 'mimo',
        sttBaseUrl: 'https://api.xiaomimimo.com/v1',
      }),
    );
  });

  it('navigates back to root from a sub-view', async () => {
    const user = userEvent.setup();
    render(
      <SettingsPanel initialSettings={chatSettings} onSave={vi.fn()} onClose={() => undefined} />,
    );
    await user.click(screen.getByRole('button', { name: '语音设置' }));
    expect(screen.getByLabelText('语音服务类型')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '返回设置首页' }));
    expect(screen.getByRole('button', { name: '聊天设置' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '语音设置' })).toBeInTheDocument();
  });

  it('supports siliconflow provider with managed base url and model hint', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <SettingsPanel initialSettings={chatSettings} onSave={onSave} onClose={() => undefined} />,
    );
    await user.click(screen.getByRole('button', { name: '语音设置' }));

    await user.clear(screen.getByLabelText('STT Base URL'));
    await user.selectOptions(screen.getByLabelText('语音服务类型'), 'siliconflow');
    expect(screen.queryByLabelText('STT Base URL')).not.toBeInTheDocument();
    expect(screen.getByText(/硅基流动官方接口/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '保存设置' }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        sttProvider: 'siliconflow',
        sttBaseUrl: 'https://api.siliconflow.cn/v1',
      }),
    );
  });
});
