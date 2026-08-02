import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceInput, type VoiceMediaRecorder, type VoiceMediaStream, type VoiceSpeechRecognition } from './useVoiceInput';

function createRecorderMock() {
  const recorder: VoiceMediaRecorder = {
    start: vi.fn(),
    stop: vi.fn(),
    ondataavailable: null,
    onstop: null,
  };
  // 模拟真实 MediaRecorder：调用 stop() 后触发 onstop 事件
  vi.mocked(recorder.stop).mockImplementation(() => {
    recorder.onstop?.();
  });
  return { recorder };
}

function createStreamMock() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as VoiceMediaStream;
  return { stream, track };
}

describe('useVoiceInput', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts recording and emits chunks, then stops with final transcript', async () => {
    const { recorder } = createRecorderMock();
    const { stream } = createStreamMock();
    const transcribe = vi.fn().mockResolvedValue('你好世界');
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useVoiceInput({
      onTranscript,
      transcribe,
      getUserMedia: vi.fn().mockResolvedValue(stream),
      mediaRecorderFactory: vi.fn().mockReturnValue(recorder),
    }));

    await act(async () => { await result.current.start(); });
    expect(recorder.start).toHaveBeenCalled();
    expect(result.current.status).toBe('recording');

    // 模拟 dataavailable 累积音频块
    act(() => { recorder.ondataavailable?.({ data: new Blob(['chunk1']) } as BlobEvent); });

    // 2.5s 定时触发分段转写
    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith('你好世界');

    // 停止后最后转写
    await act(async () => { await result.current.stop(); });
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('idle');
  });

  it('auto-stops at max duration and releases the stream', async () => {
    const { stream, track } = createStreamMock();
    const { recorder } = createRecorderMock();
    const { result } = renderHook(() => useVoiceInput({
      onTranscript: vi.fn(),
      transcribe: vi.fn().mockResolvedValue(''),
      getUserMedia: vi.fn().mockResolvedValue(stream),
      mediaRecorderFactory: vi.fn().mockReturnValue(recorder),
      maxDurationMs: 60_000,
    }));

    await act(async () => { await result.current.start(); });
    await act(async () => { vi.advanceTimersByTime(60_001); });
    expect(recorder.stop).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
  });

  it('clears the max-duration timeout on early stop so a new session is not killed by the old timer', async () => {
    const { recorder: recorder1 } = createRecorderMock();
    const { recorder: recorder2 } = createRecorderMock();
    const { stream: stream1, track: track1 } = createStreamMock();
    const { stream: stream2, track: track2 } = createStreamMock();
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(stream1)
      .mockResolvedValueOnce(stream2);
    const mediaRecorderFactory = vi.fn()
      .mockReturnValueOnce(recorder1)
      .mockReturnValueOnce(recorder2);
    const { result } = renderHook(() => useVoiceInput({
      onTranscript: vi.fn(),
      transcribe: vi.fn().mockResolvedValue(''),
      getUserMedia,
      mediaRecorderFactory,
      maxDurationMs: 60_000,
    }));

    // 第一段会话：运行 10s 后提前停止
    await act(async () => { await result.current.start(); });
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await act(async () => { await result.current.stop(); });
    expect(recorder1.stop).toHaveBeenCalled();
    expect(track1.stop).toHaveBeenCalled();

    // 60s 内重新开始第二段会话
    await act(async () => { await result.current.start(); });
    expect(result.current.status).toBe('recording');

    // 旧会话的 60s 超时点已过：新会话必须不被误杀
    await act(async () => { vi.advanceTimersByTime(50_001); });
    expect(recorder2.stop).not.toHaveBeenCalled();
    expect(track2.stop).not.toHaveBeenCalled();
    expect(result.current.status).toBe('recording');

    // 新会话自身的 60s 超时仍然生效
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(recorder2.stop).toHaveBeenCalled();
    expect(track2.stop).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('skips overlapping transcribe calls while one is in flight', async () => {
    const { recorder } = createRecorderMock();
    const { stream } = createStreamMock();
    let resolveTranscribe: (value: string) => void = () => {};
    const transcribe = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => { resolveTranscribe = resolve; }),
    );
    const { result } = renderHook(() => useVoiceInput({
      onTranscript: vi.fn(),
      transcribe,
      getUserMedia: vi.fn().mockResolvedValue(stream),
      mediaRecorderFactory: vi.fn().mockReturnValue(recorder),
    }));

    await act(async () => { await result.current.start(); });
    act(() => { recorder.ondataavailable?.({ data: new Blob(['chunk']) } as BlobEvent); });

    // 第一个间隔触发转写并挂起
    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(transcribe).toHaveBeenCalledTimes(1);

    // 转写仍在途时，下一个间隔必须被跳过（不叠加并发请求）
    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(transcribe).toHaveBeenCalledTimes(1);

    // 完成后恢复间隔节奏
    await act(async () => { resolveTranscribe('识别结果'); });
    await act(async () => { vi.advanceTimersByTime(2500); });
    expect(transcribe).toHaveBeenCalledTimes(2);
  });

  it('flips back to idle immediately on stop even when the final transcription is slow', async () => {
    const { recorder } = createRecorderMock();
    const { stream } = createStreamMock();
    let resolveTranscribe: (value: string) => void = () => {};
    const transcribe = vi.fn().mockImplementation(
      () => new Promise<string>((resolve) => { resolveTranscribe = resolve; }),
    );
    const { result } = renderHook(() => useVoiceInput({
      onTranscript: vi.fn(),
      transcribe,
      getUserMedia: vi.fn().mockResolvedValue(stream),
      mediaRecorderFactory: vi.fn().mockReturnValue(recorder),
    }));

    await act(async () => { await result.current.start(); });
    expect(result.current.status).toBe('recording');

    // 停止：MediaRecorder.stop() 同步触发 onstop；onstop 内最终转写挂起（慢网络）
    act(() => { void result.current.stop(); });
    // 状态必须立即回到 idle，不被慢转写阻塞
    expect(result.current.status).toBe('idle');

    // 慢转写完成后才回填文本
    await act(async () => { resolveTranscribe('最终结果'); });
  });

  it('streams interim and final speech results to onTranscript as the user speaks', async () => {
    const { recorder } = createRecorderMock();
    const { stream } = createStreamMock();
    const onTranscript = vi.fn();
    const speech: VoiceSpeechRecognition = {
      lang: '',
      continuous: false,
      interimResults: false,
      onresult: null,
      onend: null,
      onerror: null,
      start: vi.fn(),
      stop: vi.fn(),
    };
    const speechFactory = vi.fn().mockReturnValue(speech);

    const { result } = renderHook(() => useVoiceInput({
      onTranscript,
      getUserMedia: vi.fn().mockResolvedValue(stream),
      mediaRecorderFactory: vi.fn().mockReturnValue(recorder),
      speechRecognitionFactory: speechFactory,
    }));

    await act(async () => { await result.current.start(); });
    expect(speechFactory).toHaveBeenCalled();
    expect(speech.start).toHaveBeenCalled();
    expect(speech.lang).toBe('zh-CN');
    expect(speech.continuous).toBe(true);
    expect(speech.interimResults).toBe(true);

    // 中间结果：说「你好」→ interim 文本实时替换
    act(() => {
      speech.onresult?.({ results: { 0: [{ transcript: '你好' }], length: 1, isFinal: false } as unknown as SpeechRecognitionResultList });
    });
    expect(onTranscript).toHaveBeenLastCalledWith('你好');

    // 最终结果：追加「世界」
    act(() => {
      speech.onresult?.({ results: { 0: [{ transcript: '你好' }], 1: [{ transcript: '世界' }], length: 2, isFinal: true } as unknown as SpeechRecognitionResultList });
    });
    expect(onTranscript).toHaveBeenLastCalledWith('你好世界');

    // 停止：SpeechRecognition 停止
    await act(async () => { await result.current.stop(); });
    expect(speech.stop).toHaveBeenCalled();
  });

  it('reports speech recognition errors through onError', async () => {
    const { recorder } = createRecorderMock();
    const { stream } = createStreamMock();
    const onError = vi.fn();
    const speech: VoiceSpeechRecognition = {
      lang: '',
      continuous: false,
      interimResults: false,
      onresult: null,
      onend: null,
      onerror: null,
      start: vi.fn(),
      stop: vi.fn(),
    };
    const { result } = renderHook(() => useVoiceInput({
      onTranscript: vi.fn(),
      onError,
      getUserMedia: vi.fn().mockResolvedValue(stream),
      mediaRecorderFactory: vi.fn().mockReturnValue(recorder),
      speechRecognitionFactory: vi.fn().mockReturnValue(speech),
    }));
    await act(async () => { await result.current.start(); });
    act(() => { speech.onerror?.({ error: 'no-speech' }); });
    expect(onError).toHaveBeenCalled();
  });
});
