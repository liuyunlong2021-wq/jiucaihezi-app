/**
 * modelContextWindows.ts — 模型上下文窗口大小映射表
 *
 * 用于 Token 水位计显示。Gateway 未声明能力时，云端统一采用产品默认值。
 * 所有值以 tokens 为单位。
 */

export const DEFAULT_CLOUD_CONTEXT_WINDOW = 1_000_000
export const DEFAULT_CLOUD_MAX_OUTPUT_TOKENS = 128_000
export const DEFAULT_LOCAL_CONTEXT_WINDOW = 32_768
export const DEFAULT_LOCAL_MAX_OUTPUT_TOKENS = 4_096

/**
 * 获取模型的上下文窗口大小
 * @returns tokens 数，未知云端模型返回 1M
 */
export function getModelContextWindow(modelId: string, providerId?: string): number {
  // 本地运行时保守使用 32K，避免把云端默认能力误用于本机模型。
  if (providerId === 'local-ollama' || providerId === 'local-mlx') return DEFAULT_LOCAL_CONTEXT_WINDOW

  if (modelId.toLowerCase().includes(':free')) return 32_000
  return DEFAULT_CLOUD_CONTEXT_WINDOW
}

/** 单次输出默认上限；真实 Gateway 元数据优先于此兜底值。 */
export function getModelMaxOutputTokens(modelId: string, providerId?: string): number {
  if (providerId === 'local-ollama' || providerId === 'local-mlx') return DEFAULT_LOCAL_MAX_OUTPUT_TOKENS
  if (modelId.toLowerCase().includes(':free')) return 32_000
  return DEFAULT_CLOUD_MAX_OUTPUT_TOKENS
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
