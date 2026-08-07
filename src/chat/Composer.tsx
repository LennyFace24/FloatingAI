import { type FormEvent, useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { commands, type MultimodalContentPart } from '../bridge/commands';
import { ArrowUp, ImagePlus, Mic, MicOff, Minus, Square, Trash2, Wrench } from '../ui/icons';
import { IconButton } from '../ui/IconButton';
import { useVoiceInput, type VoiceStatus } from '../voice/useVoiceInput';
import type { AssistantPhase } from './assistantSurface';

interface ComposerProps {
  phase: AssistantPhase;
  isStreaming: boolean;
  hasMessages: boolean;
  activeRequestId?: string;
  onSend: (content: string | MultimodalContentPart[]) => Promise<string>;
  onStop: (requestId: string) => Promise<void>;
  onClear: () => void;
  onCollapse: () => void;
  onOpenSettings: () => void;
}

/** 输入条：textarea + 图片上传/预览 + 语音 + 操作按钮组。 */
export function Composer({
  phase,
  isStreaming,
  hasMessages,
  activeRequestId,
  onSend,
  onStop,
  onClear,
  onCollapse,
  onOpenSettings,
}: ComposerProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [voiceError, setVoiceError] = useState('');
  // ref 跟踪录音状态：onTranscript 闭包经 ref 读取最新值，避免捕获陈旧状态
  const voiceStatusRef = useRef<VoiceStatus>('idle');
  const { status: voiceStatus, start: startVoice, stop: stopVoice } = useVoiceInput({
    onTranscript: (text) => {
      if (voiceStatusRef.current === 'recording') setInput(text);
    },
    onError: setVoiceError,
  });
  voiceStatusRef.current = voiceStatus;

  useEffect(() => {
    if (phase !== 'waiting') inputRef.current?.focus();
  }, [phase]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if ((!text && !pendingImage) || isStreaming) return;
    setInput('');
    const image = pendingImage;
    setPendingImage(null);
    if (image) {
      await onSend([
        { type: 'text', text: text || '请描述这张图片' },
        { type: 'image_url', image_url: { url: image } },
      ]);
    } else {
      await onSend(text);
    }
  }

  /** 文件对话框选本地图片 → Rust 读为 data URI → 预览。 */
  async function uploadImage() {
    setUploadError('');
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      });
      if (!selected || typeof selected !== 'string') return;
      const dataUri = await commands.readImageFile(selected);
      setPendingImage(dataUri);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <form
      className="composer-area"
      data-response-composer={phase === 'response' ? '' : undefined}
      onSubmit={handleSubmit}
    >
      <div className="composer">
        {pendingImage ? (
          <div className="image-preview">
            <img src={pendingImage} alt="待发送图片" />
            <button
              type="button"
              className="image-preview-remove"
              aria-label="移除图片"
              title="移除图片"
              onClick={() => setPendingImage(null)}
            >
              ×
            </button>
          </div>
        ) : null}

        <textarea
          ref={inputRef}
          aria-label="输入问题"
          placeholder={voiceStatus === 'recording' ? '正在聆听…' : '> 输入问题…'}
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          rows={phase === 'prompt' ? 1 : 2}
          disabled={isStreaming || voiceStatus === 'recording'}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSubmit(event as unknown as FormEvent);
            }
          }}
        />

        <IconButton
          label="上传图片"
          tooltip="上传图片"
          disabled={isStreaming || voiceStatus === 'recording'}
          onClick={() => void uploadImage()}
        >
          <ImagePlus size={16} />
        </IconButton>

        <IconButton
          label={voiceStatus === 'recording' ? '停止录音' : '语音输入'}
          tooltip={voiceStatus === 'recording' ? '停止录音' : '语音输入'}
          className={voiceStatus === 'recording' ? 'voice-active' : undefined}
          disabled={isStreaming}
          onClick={() => {
            setVoiceError('');
            void (voiceStatus === 'recording' ? stopVoice() : startVoice());
          }}
        >
          {voiceStatus === 'recording' ? <MicOff size={16} /> : <Mic size={16} />}
        </IconButton>

        <div className="composer-actions">
          {phase === 'response' ? (
            <IconButton
              label="清空对话"
              tooltip="清空对话"
              onClick={onClear}
              disabled={!hasMessages || isStreaming}
            >
              <Trash2 size={15} />
            </IconButton>
          ) : null}
          {phase === 'prompt' ? (
            <>
              <IconButton label="打开设置" tooltip="设置" onClick={onOpenSettings}>
                <Wrench size={16} />
              </IconButton>
              <IconButton label="收起" tooltip="收起为悬浮球" onClick={onCollapse}>
                <Minus size={17} />
              </IconButton>
            </>
          ) : null}
          {isStreaming && activeRequestId ? (
            <IconButton
              className="primary-action"
              label="停止"
              tooltip="停止生成"
              onClick={() => void onStop(activeRequestId)}
            >
              <Square size={14} fill="currentColor" />
            </IconButton>
          ) : (
            <IconButton
              className="primary-action"
              label="发送"
              tooltip="发送"
              type="submit"
              disabled={!input.trim() || voiceStatus === 'recording'}
            >
              <ArrowUp size={16} />
            </IconButton>
          )}
        </div>
      </div>
      {uploadError ? (
        <p className="voice-error" role="alert">
          {uploadError}
        </p>
      ) : null}
      {voiceError ? (
        <p className="voice-error" role="alert">
          {voiceError}
        </p>
      ) : null}
    </form>
  );
}
