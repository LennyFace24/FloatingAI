import { FormEvent, useState } from 'react';
import { normalizeSettingsForm, type SettingsFormInput, validateSettingsForm } from './settings';
import { IconButton } from '../ui/IconButton';
import { Minus } from '../ui/icons';

interface SettingsPanelProps {
  initialSettings: SettingsFormInput;
  onSave: (settings: SettingsFormInput) => Promise<void>;
  onClose: () => void;
}

export function SettingsPanel({ initialSettings, onSave, onClose }: SettingsPanelProps) {
  const [form, setForm] = useState(initialSettings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeSettingsForm(form);
    const nextErrors = validateSettingsForm(normalized);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    setSaveError('');
    try {
      await onSave(normalized);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-panel surface-panel" aria-label="设置">
      <header className="panel-header settings-header">
        <h1>设置</h1>
        <IconButton label="关闭设置" tooltip="返回对话" onClick={onClose}>
          <Minus size={17} />
        </IconButton>
      </header>
      <form className="settings-form" onSubmit={handleSubmit}>
        <label>
          API Key
          <input
            aria-label="API Key"
            type="password"
            value={form.apiKey}
            placeholder="留空则保留已保存的 Key"
            onChange={(event) => setForm({ ...form, apiKey: event.currentTarget.value })}
          />
        </label>
        <p className="field-note">API Key 仅保存在本机。</p>

        <label>
          Base URL
          <input
            aria-label="Base URL"
            type="text"
            value={form.baseUrl}
            onChange={(event) => setForm({ ...form, baseUrl: event.currentTarget.value })}
          />
        </label>
        {errors.baseUrl ? <p className="field-error" role="alert">{errors.baseUrl}</p> : null}

        <label>
          模型名
          <input
            aria-label="模型名"
            type="text"
            value={form.model}
            onChange={(event) => setForm({ ...form, model: event.currentTarget.value })}
          />
        </label>
        {errors.model ? <p className="field-error" role="alert">{errors.model}</p> : null}

        <label>
          全局快捷键
          <input
            aria-label="全局快捷键"
            type="text"
            value={form.globalShortcut}
            onChange={(event) => setForm({ ...form, globalShortcut: event.currentTarget.value })}
          />
        </label>
        {errors.globalShortcut ? <p className="field-error" role="alert">{errors.globalShortcut}</p> : null}

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.autostartEnabled}
            onChange={(event) => setForm({ ...form, autostartEnabled: event.currentTarget.checked })}
          />
          开机自启
        </label>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={form.floatingAlwaysOnTop}
            onChange={(event) => setForm({ ...form, floatingAlwaysOnTop: event.currentTarget.checked })}
          />
          悬浮球置顶
        </label>

        {saveError ? <p className="field-error" role="alert">{saveError}</p> : null}
        <button className="save-button" type="submit" disabled={saving}>
          {saving ? '保存中' : '保存设置'}
        </button>
      </form>
    </section>
  );
}
