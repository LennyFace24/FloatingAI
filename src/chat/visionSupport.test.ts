import { describe, expect, it } from 'vitest';
import { modelSupportsVision } from './visionSupport';

describe('modelSupportsVision', () => {
  it('accepts known vision models', () => {
    expect(modelSupportsVision('gpt-4o')).toBe(true);
    expect(modelSupportsVision('gpt-4.1')).toBe(true);
    expect(modelSupportsVision('gemini-2.0-flash')).toBe(true);
    expect(modelSupportsVision('qwen2.5-vl-7b')).toBe(true);
    expect(modelSupportsVision('llava-v1.6')).toBe(true);
    expect(modelSupportsVision('claude-sonnet-4')).toBe(true);
  });

  it('rejects known text-only models', () => {
    expect(modelSupportsVision('deepseek-chat')).toBe(false);
    expect(modelSupportsVision('deepseek-reasoner')).toBe(false);
    expect(modelSupportsVision('gpt-3.5-turbo')).toBe(false);
    expect(modelSupportsVision('llama-3.1-8b')).toBe(false);
    expect(modelSupportsVision('mistral-small')).toBe(false);
    expect(modelSupportsVision('glm-4')).toBe(false);
  });

  it('defaults to optimistic for unknown models', () => {
    expect(modelSupportsVision('some-new-model-x')).toBe(true);
  });

  it('treats empty model as supported', () => {
    expect(modelSupportsVision('')).toBe(true);
  });
});
