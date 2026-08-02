import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceInput, type VoiceMediaRecorder, type VoiceMediaStream, type VoiceSpeechRecognition } from './useVoiceInput';

function createRecorderMock() {
  const recorder: VoiceMediaRecorder = {
    start: vi.fn(),
    stop: vi.fn(),
    onstop: null,
  };
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

function createSpeechMock() {
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
  return { speech };
}

describe('useVoiceInput', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts recording and stops cleanly with status flips', async () => {
    const { recorder } = createRecorderMock();
    const { stream } = createStreamMock();
    const { speech } = createSpeechMock();
    const { result } = renderHook(() => useVoiceInput({
      onTranscript: vi.fn(),
      getUserMedia: vi.fn().mockResolvedValue(stream),
      mediaRecorderFactory: vi.fn().mockReturnValue(recorder),
      speechRecognitionFactory: vi.fn().mockReturnValue(speech),
    }));

    await act(async () => { await result.current.start(); });
    expect(recorder.start).toHaveBeenCalled();
    expect(speech.start).toHaveBeenCalled();
    expect(result.current.status).toBe('recording');

    await act(async () => { await result.current.stop(); });
    expect(speech.stop).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('auto-stops at max duration and releases the stream', async () => {
    const { recorder } = createRecorderMock();
    const { stream } = createStreamMock();
    const { speech } = createSpeechMock();
    const { result } = renderHook(() => useVoiceInput({
      onTranscript: vi.fn(),
      getUserMedia: vi.fn().mockResolvedValue(stream),
      mediaRecorderFactory: vi.fn().mockReturnValue(recorder),
      speechRecognitionFactory: vi.fn().mockReturnValue(speech),
      maxDurationMs: 60_000,
    }));

    await act(async () => { await result.current.start(); });
    await act(async () => { vi.advanceTimersByTime(60_001); });
    expect(recorder.stop).toHaveBeenCalled();
    expect(stream.getTracks()[0].stop).toHaveBeenCalled();
  });

  it('streams interim and final speech results to onTranscript as the user speaks', async () => {
    const { recorder } = createRecorderMock();
    const { stream } = createStreamMock();
    const onTranscript = vi.fn();
    const { speech } = createSpeechMock();
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
      speech.onresult?.({ results: { 0: [{ transcript: '你好' }], length: 1 } as unknown as SpeechRecognitionResultList });
    });
    expect(onTranscript).toHaveBeenLastCalledWith('你好');

    // 最终结果：追加「世界」
    act(() => {
      speech.onresult?.({ results: { 0: [{ transcript: '你好' }], 1: [{ transcript: '世界' }], length: 2 } as unknown as SpeechRecognitionResultList });
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
    const { speech } = createSpeechMock();
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
