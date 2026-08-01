import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVoiceInput, type VoiceMediaRecorder, type VoiceMediaStream } from './useVoiceInput';

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
});
