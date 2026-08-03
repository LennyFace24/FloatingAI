/** 常见纯文本模型关键词（无视觉能力）：命中的模型发送图片应被拦截提示。 */
const TEXT_ONLY_PATTERNS: RegExp[] = [
  /deepseek/i,
  /gpt-3[.-]?5/i,
  /llama/i,
  /mistral/i,
  /qwen\d+/i, // qwen 基础系列；qwen-vl 不匹配（含 vl）
  /gemma/i,
  /phi/i,
  /minicpm/i, // minicpm 基础文本；minicpm-v 不匹配
  /ernie/i,
  /glm/i,
  /kimi/i,
  /moonshot/i,
  /yi[-\s]/i,
];

/** 常见视觉模型关键词：命中的模型可发送图片（用于反向豁免）。 */
const VISION_PATTERNS: RegExp[] = [
  /vision/i,
  /-vl\b|_vl\b/i,
  /vl\b/i,
  /gpt-4o/i,
  /gpt-4\.1/i,
  /omni/i,
  /gemini/i,
  /llava/i,
  /internvl/i,
  /cogvlm/i,
  /qwen2?-?vl/i,
  /minicpm-v/i,
  /claude/i,
  /sensevoice/i, // 语音模型
];

/**
 * 判断模型是否支持图片输入。
 * 优先按视觉关键词豁免；否则若命中纯文本关键词则视为不支持；默认乐观视为支持
 * （避免误拦——OpenAI 兼容接口的模型名无法完全枚举）。
 */
export function modelSupportsVision(model: string): boolean {
  if (!model) return true;
  if (VISION_PATTERNS.some((re) => re.test(model))) return true;
  return !TEXT_ONLY_PATTERNS.some((re) => re.test(model));
}
