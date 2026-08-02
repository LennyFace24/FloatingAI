import { FormEvent, useState } from 'react';
import { commands } from '../bridge/commands';
import { normalizeSettingsForm, type SettingsFormInput, validateSettingsForm } from './settings';
import { IconButton } from '../ui/IconButton';
import { ArrowLeft, ChevronRight, Eye, EyeOff, Minus, RefreshCw } from '../ui/icons';
import { useWindowDrag } from '../window/useWindowDrag';

/** 密码输入框 + 显示/隐藏切换按钮（用于查看已保存的 API Key 原文）。 */
function PasswordField({
  ariaLabel,
  value,
  onChange,
  placeholder,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="model-input-row">
      <input
        aria-label={ariaLabel}
        type={visible ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <IconButton
        label={visible ? '隐藏密钥' : '显示密钥'}
        tooltip={visible ? '隐藏密钥' : '显示密钥'}
        onClick={() => setVisible((previous) => !previous)}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </IconButton>
    </div>
  );
}

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
  onSaveSettings: () => Promise<boolean>;
}

/** 「获取模型」按钮 + 展开的下拉列表；选择后填充模型输入框。获取前先保存当前配置，确保后端读到最新 base_url/provider。 */
function ModelPicker({ scope, currentValue, onSelect, onSaveSettings }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function fetchModels() {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const saved = await onSaveSettings();
      if (!saved) return;
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
        aria-busy={loading}
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

  /** 规范化当前表单并保存；托管服务自动填默认 Base URL。供保存按钮与「获取模型列表」共用。
   * 校验失败时返回 false（不抛错，字段错误由 errors 展示）。 */
  async function saveCurrentForm(): Promise<boolean> {
    const normalized = normalizeSettingsForm(form);
    const managedBaseUrl = MANAGED_PROVIDER_BASE_URL[normalized.sttProvider];
    const finalForm: SettingsFormInput =
      managedBaseUrl && !normalized.sttBaseUrl
        ? { ...normalized, sttBaseUrl: managedBaseUrl }
        : normalized;
    const nextErrors = validateSettingsForm(finalForm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return false;
    }
    setSaveError('');
    await onSave(finalForm);
    return true;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await saveCurrentForm();
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
            <PasswordField
              ariaLabel="API Key"
              value={form.apiKey}
              placeholder="留空则保留已保存的 Key"
              onChange={(value) => setField('apiKey', value)}
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
              <ModelPicker scope="chat" currentValue={form.model} onSelect={(model) => setField('model', model)} onSaveSettings={saveCurrentForm} />
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
            <ModelPicker scope="voice" currentValue={form.sttModel} onSelect={(model) => setField('sttModel', model)} onSaveSettings={saveCurrentForm} />
          </div>
        </label>

        <label>
          STT API Key
          <PasswordField
            ariaLabel="STT API Key"
            value={form.sttApiKey}
            placeholder="留空则保留已保存的 Key"
            onChange={(value) => setField('sttApiKey', value)}
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
