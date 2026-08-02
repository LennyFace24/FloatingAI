import { useCallback, useEffect, useRef, useState } from 'react';
import { commands } from '../bridge/commands';

export type VoiceStatus = 'idle' | 'recording';
/** setInterval 返回的定时器句柄（DOM 环境为 number） */
type TimerId = ReturnType<typeof setInterval>;

/** WebView2/Edge 的 SpeechRecognition（含 webkit 前缀）。不可用时返回 null。 */
function defaultSpeechRecognition(): VoiceSpeechRecognition | null {
  const globalWindow = window as unknown as Record<string, unknown>;
  const ctor = globalWindow.SpeechRecognition ?? globalWindow.webkitSpeechRecognition;
  if (typeof ctor === 'function') {
    return new (ctor as new () => VoiceSpeechRecognition)();
  }
  return null;
}

export interface VoiceMediaStream { getTracks(): { stop(): void }[] }
export interface VoiceMediaRecorder {
  start(): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
}

/** 浏览器原生 SpeechRecognition 的最小接口（WebView2/Edge 支持，Windows 走系统语音识别）。 */
export interface VoiceSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: SpeechRecognitionResultList }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  intervalMs?: number;
  maxDurationMs?: number;
  speechLang?: string;
  transcribe?: (audio: Uint8Array, mime: string) => Promise<string>;
  getUserMedia?: (constraints: { audio: boolean }) => Promise<VoiceMediaStream>;
  mediaRecorderFactory?: (stream: VoiceMediaStream) => VoiceMediaRecorder;
  speechRecognitionFactory?: () => VoiceSpeechRecognition | null;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export function useVoiceInput({
  onTranscript,
  onError,
  intervalMs = 2500,
  maxDurationMs = 60_000,
  speechLang = 'zh-CN',
  transcribe = (audio, mime) => commands.transcribeAudio(audio, mime),
  getUserMedia = (constraints) => navigator.mediaDevices.getUserMedia(constraints) as Promise<VoiceMediaStream>,
  mediaRecorderFactory,
  speechRecognitionFactory,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}: UseVoiceInputOptions) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  // 超时停止回调由 start 时的闭包创建，直接读 status 会捕获陈旧值；经 ref 读取最新状态
  const statusRef = useRef<VoiceStatus>('idle');
  statusRef.current = status;
  const chunksRef = useRef<Blob[]>([]);
  const recorderRef = useRef<VoiceMediaRecorder | null>(null);
  const speechRef = useRef<VoiceSpeechRecognition | null>(null);
  // 已确认（final）的识别文本，与当前中间结果拼接后整体回调
  const finalSpeechRef = useRef('');
  const streamRef = useRef<VoiceMediaStream | null>(null);
  const intervalRef = useRef<TimerId | null>(null);
  const timeoutRef = useRef<TimerId | null>(null);
  // 转写请求在途标记：慢响应时跳过重叠调用，避免乱序覆盖与请求叠加
  const busyRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const transcribeRef = useRef(transcribe);
  transcribeRef.current = transcribe;

  const transcribeChunks = useCallback(async () => {
    if (busyRef.current) return;
    const chunks = chunksRef.current;
    if (chunks.length === 0) return;
    busyRef.current = true;
    try {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const buffer = new Uint8Array(await blob.arrayBuffer());
      const text = await transcribeRef.current(buffer, blob.type);
      if (text.trim()) onTranscriptRef.current(text.trim());
    } catch (error) {
      onErrorRef.current?.(error instanceof Error ? error.message : String(error));
    } finally {
      busyRef.current = false;
    }
  }, []);

  const stop = useCallback(async () => {
    if (statusRef.current !== 'recording') return;
    recorderRef.current?.stop(); // 触发 onstop → 最终转写 + cleanup
  }, []);

  const start = useCallback(async () => {
    if (status !== 'idle') return;
    try {
      const stream = await getUserMedia({ audio: true });
      streamRef.current = stream;
      const RecorderCtor = mediaRecorderFactory;
      // DOM MediaRecorder 的 ondataavailable/onstop 事件签名与最小注入接口不兼容，
      // 属库类型边界差异，做一次窄化转换（生产默认路径，测试均注入 factory）
      const recorder: VoiceMediaRecorder = RecorderCtor
        ? RecorderCtor(stream)
        : (new MediaRecorder(stream as MediaStream) as unknown as VoiceMediaRecorder);
      recorderRef.current = recorder;
      chunksRef.current = [];
      finalSpeechRef.current = '';
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        clearIntervalFn(intervalRef.current as TimerId);
        intervalRef.current = null;
        clearIntervalFn(timeoutRef.current as TimerId);
        timeoutRef.current = null;
        // 结束原生流式识别
        speechRef.current?.stop();
        speechRef.current = null;
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        // 先翻转状态：停止的 UI 反馈（按钮/placeholder）不被慢转写阻塞，
        // 最终转写在后台完成，结果仍通过 onTranscript 回填输入框
        setStatus('idle');
        await transcribeChunks();
      };
      recorder.start();
      setStatus('recording');
      // 原生流式识别：文字跟随说话速度实时回调（final 追加 + interim 替换）
      const speech = speechRecognitionFactory ? speechRecognitionFactory() : defaultSpeechRecognition();
      if (speech) {
        speech.lang = speechLang;
        speech.continuous = true;
        speech.interimResults = true;
        speech.onresult = (event) => {
          let interim = '';
          for (let i = 0; i < event.results.length; i += 1) {
            const result = event.results[i];
            if (result.isFinal) {
              finalSpeechRef.current += result[0].transcript;
            } else {
              interim += result[0].transcript;
            }
          }
          const combined = (finalSpeechRef.current + interim).trim();
          if (combined) onTranscriptRef.current(combined);
        };
        speech.onerror = (event) => {
          onErrorRef.current?.(`语音识别失败：${event.error}`);
        };
        speechRef.current = speech;
        try {
          speech.start();
        } catch {
          speechRef.current = null;
          onErrorRef.current?.('语音识别启动失败（系统语音识别不可用）');
        }
      }
      intervalRef.current = setIntervalFn(() => { void transcribeChunks(); }, intervalMs);
      timeoutRef.current = setIntervalFn(() => { void stop(); }, maxDurationMs); // 一次性超时停止
    } catch (error) {
      onErrorRef.current?.(error instanceof Error ? error.message : String(error));
      // getUserMedia 成功后 recorder.start() 等后续步骤抛异常时，释放已获得的媒体流
      if (intervalRef.current) {
        clearIntervalFn(intervalRef.current);
        intervalRef.current = null;
      }
      if (timeoutRef.current) {
        clearIntervalFn(timeoutRef.current);
        timeoutRef.current = null;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      setStatus('idle');
    }
  }, [status, getUserMedia, mediaRecorderFactory, intervalMs, maxDurationMs, setIntervalFn, clearIntervalFn, transcribeChunks, stop]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearIntervalFn(intervalRef.current);
      if (timeoutRef.current) clearIntervalFn(timeoutRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [clearIntervalFn]);

  return { status, start, stop };
}
