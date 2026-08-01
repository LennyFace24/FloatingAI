import { FormEvent, useState } from 'react';
import { normalizeSettingsForm, type SettingsFormInput, validateSettingsForm } from './settings';
import { IconButton } from '../ui/IconButton';
import { ArrowLeft, ChevronRight, Minus } from '../ui/icons';
import { useWindowDrag } from '../window/useWindowDrag';

interface SettingsPanelProps {
  initialSettings: SettingsFormInput;
  onSave: (settings: SettingsFormInput) => Promise<void>;
  onClose: () => void;
}

type SettingsView = 'root' | 'chat' | 'voice';

const MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1';

export function SettingsPanel({ initialSettings, onSave, onClose }: SettingsPanelProps) {
  const [view, setView] = useState<SettingsView>('root');
  const [form, setForm] = useState(initialSettings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const drag = useWindowDrag();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // MiMo 固定 Base URL：provider=mimo 且 sttBaseUrl 为空时填入 MiMo 默认地址
    const normalized = normalizeSettingsForm(form);
    const finalForm: SettingsFormInput =
      normalized.sttProvider === 'mimo' && !normalized.sttBaseUrl
        ? { ...normalized, sttBaseUrl: MIMO_BASE_URL }
        : normalized;
    const nextErrors = validateSettingsForm(finalForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setSaveError('');
    try {
      await onSave(finalForm);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function setField<K extends keyof SettingsFormInput>(key: K, value: SettingsFormInput[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  const header = (
    <header className="panel-header settings-header">
      {view === 'root' ? (
        <h1>设置</h1>
      ) : (
        <IconButton label="返回设置首页" tooltip="返回" onClick={() => setView('root')}>
          <ArrowLeft size={16} />
        </IconButton>
      )}
      <IconButton label="关闭设置" tooltip="返回对话" onClick={onClose}>
        <Minus size={17} />
      </IconButton>
    </header>
  );

  if (view === 'root') {
    return (
      <section className="settings-panel surface-panel" aria-label="设置" {...drag.pointerProps}>
        {header}
        <div className="settings-menu" data-window-drag-exclude>
          <button type="button" className="settings-menu-item" aria-label="聊天设置" onClick={() => setView('chat')}>
            <span className="settings-menu-label">聊天设置</span>
            <span className="settings-menu-hint">模型 · API · 快捷键</span>
            <ChevronRight size={16} />
          </button>
          <button type="button" className="settings-menu-item" aria-label="语音设置" onClick={() => setView('voice')}>
            <span className="settings-menu-label">语音设置</span>
            <span className="settings-menu-hint">语音识别引擎 · 语言</span>
            <ChevronRight size={16} />
          </button>
        </div>
      </section>
    );
  }

  if (view === 'chat') {
    return (
      <section className="settings-panel surface-panel" aria-label="聊天设置" {...drag.pointerProps}>
        {header}
        <form className="settings-form" data-window-drag-exclude onSubmit={handleSubmit}>
          <label>
            API Key
            <input
              aria-label="API Key"
              type="password"
              value={form.apiKey}
              placeholder="留空则保留已保存的 Key"
              onChange={(event) => setField('apiKey', event.currentTarget.value)}
            />
          </label>
          <p className="field-note">API Key 仅保存在本机。</p>

          <label>
            Base URL
            <input
              aria-label="Base URL"
              type="text"
              value={form.baseUrl}
              onChange={(event) => setField('baseUrl', event.currentTarget.value)}
            />
          </label>
          {errors.baseUrl ? <p className="field-error" role="alert">{errors.baseUrl}</p> : null}

          <label>
            模型名
            <input
              aria-label="模型名"
              type="text"
              value={form.model}
              onChange={(event) => setField('model', event.currentTarget.value)}
            />
          </label>
          {errors.model ? <p className="field-error" role="alert">{errors.model}</p> : null}

          <label>
            全局快捷键
            <input
              aria-label="全局快捷键"
              type="text"
              value={form.globalShortcut}
              onChange={(event) => setField('globalShortcut', event.currentTarget.value)}
            />
          </label>
          {errors.globalShortcut ? <p className="field-error" role="alert">{errors.globalShortcut}</p> : null}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.autostartEnabled}
              onChange={(event) => setField('autostartEnabled', event.currentTarget.checked)}
            />
            开机自启
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.floatingAlwaysOnTop}
              onChange={(event) => setField('floatingAlwaysOnTop', event.currentTarget.checked)}
            />
            始终置顶
          </label>

          {saveError ? <p className="field-error" role="alert">{saveError}</p> : null}
          <button className="save-button" type="submit" disabled={saving}>
            {saving ? '保存中' : '保存设置'}
          </button>
        </form>
      </section>
    );
  }

  // view === 'voice'
  const isMimo = form.sttProvider === 'mimo';
  return (
    <section className="settings-panel surface-panel" aria-label="语音设置" {...drag.pointerProps}>
      {header}
      <form className="settings-form" data-window-drag-exclude onSubmit={handleSubmit}>
        <label>
          语音服务类型
          <select
            aria-label="语音服务类型"
            value={form.sttProvider}
            onChange={(event) => setField('sttProvider', event.currentTarget.value)}
          >
            <option value="openai">OpenAI 兼容</option>
            <option value="mimo">小米 MiMo</option>
          </select>
        </label>

        {!isMimo ? (
          <label>
            STT Base URL
            <input
              aria-label="STT Base URL"
              type="text"
              value={form.sttBaseUrl}
              placeholder="http://localhost:9000/v1"
              onChange={(event) => setField('sttBaseUrl', event.currentTarget.value)}
            />
          </label>
        ) : (
          <p className="field-note">使用小米 MiMo 官方接口（{MIMO_BASE_URL}）。</p>
        )}

        <label>
          STT 模型
          <input
            aria-label="STT 模型"
            type="text"
            value={form.sttModel}
            placeholder={isMimo ? 'mimo-v2.5-asr' : 'whisper-1'}
            onChange={(event) => setField('sttModel', event.currentTarget.value)}
          />
        </label>

        <label>
          STT API Key
          <input
            aria-label="STT API Key"
            type="password"
            value={form.sttApiKey}
            placeholder="留空则保留已保存的 Key"
            onChange={(event) => setField('sttApiKey', event.currentTarget.value)}
          />
        </label>

        <label>
          语言
          <select
            aria-label="转写语言"
            value={form.sttLanguage}
            onChange={(event) => setField('sttLanguage', event.currentTarget.value)}
          >
            <option value="auto">auto</option>
            <option value="zh">zh</option>
            <option value="en">en</option>
          </select>
        </label>

        {saveError ? <p className="field-error" role="alert">{saveError}</p> : null}
        <button className="save-button" type="submit" disabled={saving}>
          {saving ? '保存中' : '保存设置'}
        </button>
      </form>
    </section>
  );
}
