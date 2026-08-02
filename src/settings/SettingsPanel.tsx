import { FormEvent, useState } from 'react';
import { commands } from '../bridge/commands';
import { normalizeSettingsForm, type SettingsFormInput, validateSettingsForm } from './settings';
import { IconButton } from '../ui/IconButton';
import { ArrowLeft, ChevronRight, Minus, RefreshCw } from '../ui/icons';
import { useWindowDrag } from '../window/useWindowDrag';

interface SettingsPanelProps {
  initialSettings: SettingsFormInput;
  onSave: (settings: SettingsFormInput) => Promise<void>;
  onClose: () => void;
}

type SettingsView = 'root' | 'chat' | 'voice';

const MIMO_BASE_URL = 'https://api.xiaomimimo.com/v1';
const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';
const SILICONFLOW_DEFAULT_MODEL = 'FunAudioLLM/SenseVoiceSmall';

const MANAGED_PROVIDER_BASE_URL: Record<string, string> = {
  mimo: MIMO_BASE_URL,
  siliconflow: SILICONFLOW_BASE_URL,
};

interface ModelPickerProps {
  scope: 'chat' | 'voice';
  currentValue: string;
  onSelect: (model: string) => void;
}

/** 「获取模型」按钮 + 展开的下拉列表；选择后填充模型输入框。 */
function ModelPicker({ scope, currentValue, onSelect }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function fetchModels() {
    setLoading(true);
    setError('');
    try {
      const list = await commands.listModels(scope);
      setModels(list);
      setOpen(true);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }

  function choose(model: string) {
    onSelect(model);
    setOpen(false);
  }

  return (
    <div className="model-picker">
      <IconButton
        label={`获取${scope === 'chat' ? '聊天' : '语音'}模型列表`}
        tooltip="获取模型列表"
        onClick={() => { void fetchModels(); }}
        disabled={loading}
      >
        <RefreshCw size={14} className={loading ? 'spin' : undefined} />
      </IconButton>
      {open ? (
        <div className="model-picker-dropdown">
          {models.length === 0 ? (
            <p className="model-picker-empty">未获取到模型</p>
          ) : (
            <ul>
              {models.map((model) => (
                <li key={model}>
                  <button type="button" onClick={() => choose(model)}>{model}</button>
                </li>
              ))}
            </ul>
          )}
          <p className="model-picker-current">当前：{currentValue || '未设置'}</p>
        </div>
      ) : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}
export function SettingsPanel({ initialSettings, onSave, onClose }: SettingsPanelProps) {
  const [view, setView] = useState<SettingsView>('root');
  const [form, setForm] = useState(initialSettings);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const drag = useWindowDrag();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // 托管服务（MiMo/硅基流动）固定 Base URL：provider 属于托管且 sttBaseUrl 为空时填入默认地址
    const normalized = normalizeSettingsForm(form);
    const managedBaseUrl = MANAGED_PROVIDER_BASE_URL[normalized.sttProvider];
    const finalForm: SettingsFormInput =
      managedBaseUrl && !normalized.sttBaseUrl
        ? { ...normalized, sttBaseUrl: managedBaseUrl }
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
            <div className="model-input-row">
              <input
                aria-label="模型名"
                type="text"
                value={form.model}
                onChange={(event) => setField('model', event.currentTarget.value)}
              />
              <ModelPicker scope="chat" currentValue={form.model} onSelect={(model) => setField('model', model)} />
            </div>
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
  const isManagedProvider = form.sttProvider in MANAGED_PROVIDER_BASE_URL;
  const modelPlaceholder =
    form.sttProvider === 'siliconflow'
      ? SILICONFLOW_DEFAULT_MODEL
      : form.sttProvider === 'mimo'
        ? 'mimo-v2.5-asr'
        : 'whisper-1';
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
            <option value="siliconflow">硅基流动</option>
          </select>
        </label>

        {!isManagedProvider ? (
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
          <p className="field-note">
            使用{form.sttProvider === 'mimo' ? '小米 MiMo' : '硅基流动'}官方接口（
            {MANAGED_PROVIDER_BASE_URL[form.sttProvider]}）。
          </p>
        )}

        <label>
          STT 模型
          <div className="model-input-row">
            <input
              aria-label="STT 模型"
              type="text"
              value={form.sttModel}
              placeholder={modelPlaceholder}
              onChange={(event) => setField('sttModel', event.currentTarget.value)}
            />
            <ModelPicker scope="voice" currentValue={form.sttModel} onSelect={(model) => setField('sttModel', model)} />
          </div>
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
