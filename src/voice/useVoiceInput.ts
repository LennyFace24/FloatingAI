import { useCallback, useEffect, useRef, useState } from 'react';
import { commands } from '../bridge/commands';

export type VoiceStatus = 'idle' | 'recording';
/** setInterval 返回的定时器句柄（DOM 环境为 number） */
type TimerId = ReturnType<typeof setInterval>;

export interface VoiceMediaStream { getTracks(): { stop(): void }[] }
export interface VoiceMediaRecorder {
  start(): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
}

interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
  onError?: (message: string) => void;
  intervalMs?: number;
  maxDurationMs?: number;
  transcribe?: (audio: Uint8Array, mime: string) => Promise<string>;
  getUserMedia?: (constraints: { audio: boolean }) => Promise<VoiceMediaStream>;
  mediaRecorderFactory?: (stream: VoiceMediaStream) => VoiceMediaRecorder;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export function useVoiceInput({
  onTranscript,
  onError,
  intervalMs = 2500,
  maxDurationMs = 60_000,
  transcribe = (audio, mime) => commands.transcribeAudio(audio, mime),
  getUserMedia = (constraints) => navigator.mediaDevices.getUserMedia(constraints) as Promise<VoiceMediaStream>,
  mediaRecorderFactory,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}: UseVoiceInputOptions) {
  const [status, setStatus] = useState<VoiceStatus>('idle');
  // 超时停止回调由 start 时的闭包创建，直接读 status 会捕获陈旧值；经 ref 读取最新状态
  const statusRef = useRef<VoiceStatus>('idle');
  statusRef.current = status;
  const chunksRef = useRef<Blob[]>([]);
  const recorderRef = useRef<VoiceMediaRecorder | null>(null);
  const streamRef = useRef<VoiceMediaStream | null>(null);
  const intervalRef = useRef<TimerId | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const transcribeRef = useRef(transcribe);
  transcribeRef.current = transcribe;

  const transcribeChunks = useCallback(async () => {
    const chunks = chunksRef.current;
    if (chunks.length === 0) return;
    const blob = new Blob(chunks, { type: 'audio/webm' });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    try {
      const text = await transcribeRef.current(buffer, blob.type);
      if (text.trim()) onTranscriptRef.current(text.trim());
    } catch (error) {
      onErrorRef.current?.(error instanceof Error ? error.message : String(error));
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
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        clearIntervalFn(intervalRef.current as TimerId);
        intervalRef.current = null;
        await transcribeChunks();
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setStatus('idle');
      };
      recorder.start();
      setStatus('recording');
      intervalRef.current = setIntervalFn(() => { void transcribeChunks(); }, intervalMs);
      setIntervalFn(() => { void stop(); }, maxDurationMs); // 一次性超时停止
    } catch (error) {
      onErrorRef.current?.(error instanceof Error ? error.message : String(error));
      setStatus('idle');
    }
  }, [status, getUserMedia, mediaRecorderFactory, intervalMs, maxDurationMs, setIntervalFn, clearIntervalFn, transcribeChunks, stop]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearIntervalFn(intervalRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [clearIntervalFn]);

  return { status, start, stop };
}
