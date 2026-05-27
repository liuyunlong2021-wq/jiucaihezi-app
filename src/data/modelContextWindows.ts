/**
 * modelContextWindows.ts — 模型上下文窗口大小映射表
 *
 * 用于 Token 水位计显示。当 NewAPI 返回的模型不在表中时，按模型族推断。
 * 所有值以 tokens 为单位。
 */

/** 已知模型的精确上下文窗口 */
const KNOWN_WINDOWS: Record<string, number> = {
  // ─── Claude ───
  'claude-opus-4-7': 200_000,
  'claude-opus-4-6': 200_000,
  'claude-opus-4-5': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-haiku-4-5': 200_000,
  'claude-3.5-sonnet': 200_000,
  'claude-3.5-haiku': 200_000,

  // ─── GPT ───
  'gpt-5.5': 128_000,
  'gpt-5.4': 128_000,
  'gpt-5.3': 128_000,
  'gpt-5.2': 128_000,
  'gpt-5.1': 128_000,
  'gpt-5': 128_000,
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'o1': 200_000,
  'o1-mini': 200_000,
  'o1-preview': 128_000,
  'o3-mini': 200_000,
  'o3': 200_000,
  'o4-mini': 200_000,

  // ─── Gemini ───
  'gemini-3.1-pro-preview': 1_000_000,
  'gemini-3.1-flash-lite-preview': 1_000_000,
  'gemini-3.0-pro': 1_000_000,
  'gemini-3.0-flash': 1_000_000,
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-2.0-flash': 1_000_000,

  // ─── DeepSeek ───
  'deepseek-v4-pro': 128_000,
  'deepseek-v4-flash': 128_000,
  'deepseek-v3': 128_000,
  'deepseek-r1': 128_000,
  'deepseek-chat': 128_000,

  // ─── Qwen ───
  'qwen3.6-plus': 128_000,
  'qwen3.6': 128_000,
  'qwen3.5': 128_000,
  'qwen3-235b': 128_000,
  'qwen2.5-72b': 128_000,

  // ─── Grok ───
  'grok-3': 131_072,
  'grok-3-mini': 131_072,

  // ─── OpenRouter Free ───
  'openai/gpt-oss-120b:free': 32_000,
  'google/gemma-4-31b-it:free': 32_000,

  // ─── 本地 Ollama ─── (默认值，用户可配置)
  // 本地模型通过 LOCAL_OLLAMA_PROVIDER_ID 标识，默认 4096
}

/**
 * 根据模型族前缀推断上下文窗口（未在 KNOWN_WINDOWS 中精确匹配时）
 */
function inferByFamily(modelId: string): number {
  const id = modelId.toLowerCase()
  if (id.includes('claude')) return 200_000
  if (id.includes('gpt-5')) return 128_000
  if (id.includes('gpt-4')) return 128_000
  if (id.includes('o1') || id.includes('o3') || id.includes('o4')) return 200_000
  if (id.includes('gemini')) return 1_000_000
  if (id.includes('deepseek')) return 128_000
  if (id.includes('qwen')) return 128_000
  if (id.includes('grok')) return 131_072
  if (id.includes('gemma')) return 32_000
  if (id.includes('llama')) return 128_000
  if (id.includes('mistral')) return 128_000
  if (id.includes('mixtral')) return 32_000
  // Free/OSS 模型通常较小
  if (id.includes(':free')) return 32_000
  return 128_000 // 默认 128K（最常见的窗口大小）
}

/**
 * 获取模型的上下文窗口大小
 * @returns tokens 数，未知模型返回 128K
 */
export function getModelContextWindow(modelId: string, providerId?: string): number {
  // 精确匹配
  if (KNOWN_WINDOWS[modelId]) return KNOWN_WINDOWS[modelId]

  // 本地模型默认 4096（Ollama 默认值）
  if (providerId === 'local-ollama' || providerId === 'local-mlx') return 4096

  // 按模型族推断
  return inferByFamily(modelId)
}

/**
 * 格式化大数字为人类可读
 * 128000 → "128K", 1000000 → "1M", 4096 → "4K"
 */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return `${tokens}`
}

/**
 * 格式化 token 数为人类可读
 * 2456 → "2.5K", 123456 → "123K"
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 10_000) return `${Math.round(tokens / 1_000)}K`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return `${tokens}`
}
