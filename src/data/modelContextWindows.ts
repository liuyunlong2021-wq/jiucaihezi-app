/**
 * modelContextWindows.ts — 模型上下文窗口大小映射表
 *
 * Runtime 与设置共用的容量预设；不是对中转站实际开放容量的探测结果。
 * 所有值以 tokens 为单位。
 */

// shortcut: 未登记型号按32K估算；新增常用型号时核验并补入精确预设。
export const DEFAULT_CLOUD_CONTEXT_WINDOW = 32_768
export const DEFAULT_CLOUD_MAX_OUTPUT_TOKENS = 4_096
export const DEFAULT_LOCAL_CONTEXT_WINDOW = 32_768
export const DEFAULT_LOCAL_MAX_OUTPUT_TOKENS = 4_096

export interface ModelCapacity {
  contextWindow: number
  maxOutputTokens: number
  contextWindowSource: 'declared' | 'preset' | 'estimated' | 'manual'
  maxOutputTokensSource: 'declared' | 'preset' | 'estimated' | 'manual'
  contextWindowEstimated: boolean
}

type CapacityMetadata = Partial<ModelCapacity>

// OpenAI Docs /api/docs/models/<id>：2026-10-15 核验窗口与输出均为1050000/128000。
const OPENAI_LONG_CONTEXT_MODELS = new Set([
  'gpt-5.4', 'gpt-5.5', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
  'gpt-6-sol', 'gpt-6-astra', 'gpt-6.1-sol',
])

// shortcut: 以下是用户常用中转型号的1M产品预设，不冒充官方或通道探测；通道限额可手动覆盖。
const RELAY_LONG_CONTEXT_MODELS = new Set([
  'opus', 'sonnet', 'opus-4.7',
  'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-opus-5', 'claude-opus-5-5',
  'claude-sonnet-4-6', 'claude-sonnet-5', 'claude-fable-5', 'claude-fable-5-1',
  'gemini-3.5-flash', 'g-3.1-pro', 'gemini-3.1-pro', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash',
  'gemini-4-argon-medium', 'gemini-4-argon-low', 'gemini-4-argon-high',
  'kimi-k3', 'glm-5.3-flash', 'glm-5.2',
  'deepseek-v4-flash', 'deepseek-v4-flash-0731', 'deepseek-v4.1-flash', 'deepseek-flash',
  'grok-4.5', 'grok-4.6', 'grok-4.7', 'grok-4.7-build-fast',
  'doubao-seed-2-1-turbo-260628', 'doubao-seed-evolving', 'doubao-seed-2-1-pro-260628',
  'qwen3.8-flash-next-iq3_xxs', 'qwen3.8-flash', 'qwen3.7-plus', 'qwen3.7-max',
])

function modelPreset(modelId: string, providerId?: string): { contextWindow: number; maxOutputTokens: number } | undefined {
  if (providerId === 'local-ollama' || providerId === 'local-mlx') return undefined
  // 只剥离已知厂商前缀与完整日期快照，不猜测 mini/量化/未知中转前缀。
  const id = modelId.trim().toLowerCase().replace(/^(openai|anthropic|google|deepseek|zhipu|x-ai|qwen)\//, '')
  const base = id.replace(/-\d{4}-\d{2}-\d{2}$/, '')
  if (OPENAI_LONG_CONTEXT_MODELS.has(base)) return { contextWindow: 1_050_000, maxOutputTokens: 128_000 }
  // https://platform.claude.com/docs/en/models/haiku-4-5/overview
  if (id === 'claude-haiku-4-5' || id === 'claude-haiku-4-5-20251001') return { contextWindow: 200_000, maxOutputTokens: 64_000 }
  if (['claude-haiku-5-5', 'claude-haiku-5.5', 'claude-haiku-5-5:batch', 'claude-haiku-5.5:batch'].includes(id)) return { contextWindow: 1_000_000, maxOutputTokens: 128_000 }
  if (RELAY_LONG_CONTEXT_MODELS.has(id)) return { contextWindow: 1_000_000, maxOutputTokens: DEFAULT_CLOUD_MAX_OUTPUT_TOKENS }
  return undefined
}

function positiveTokens(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

export function resolveModelCapacity(modelId: string, providerId?: string, metadata: CapacityMetadata = {}): ModelCapacity {
  const preset = modelPreset(modelId, providerId)
  const fromCatalog = metadata.contextWindowSource !== 'preset' && metadata.contextWindowSource !== 'estimated'
    && metadata.contextWindowEstimated !== true
  const declaredContext = fromCatalog && positiveTokens(metadata.contextWindow) && metadata.contextWindow > 1
  const outputFromCatalog = metadata.maxOutputTokensSource
    ? metadata.maxOutputTokensSource === 'declared'
    : fromCatalog
  const declaredOutput = outputFromCatalog && positiveTokens(metadata.maxOutputTokens)
  const contextWindow = declaredContext ? metadata.contextWindow!
    : preset?.contextWindow ?? getModelContextWindow(modelId, providerId)
  return {
    contextWindow,
    maxOutputTokens: Math.min(declaredOutput ? metadata.maxOutputTokens! : preset?.maxOutputTokens ?? getModelMaxOutputTokens(modelId, providerId), contextWindow - 1),
    contextWindowSource: declaredContext ? 'declared' : preset ? 'preset' : 'estimated',
    maxOutputTokensSource: declaredOutput ? 'declared' : preset ? 'preset' : 'estimated',
    contextWindowEstimated: !declaredContext && !preset,
  }
}

/**
 * 获取模型的上下文窗口大小
 * @returns tokens 数，未知容量保守估算32K，不代表已探测成功
 */
export function getModelContextWindow(modelId: string, providerId?: string): number {
  // 本地运行时保守使用 32K，避免把云端默认能力误用于本机模型。
  if (providerId === 'local-ollama' || providerId === 'local-mlx') return DEFAULT_LOCAL_CONTEXT_WINDOW

  if (modelId.toLowerCase().includes(':free')) return 32_000
  return modelPreset(modelId, providerId)?.contextWindow ?? DEFAULT_CLOUD_CONTEXT_WINDOW
}

/** 单次输出默认上限；真实 Gateway 元数据优先于此兜底值。 */
export function getModelMaxOutputTokens(modelId: string, providerId?: string): number {
  if (providerId === 'local-ollama' || providerId === 'local-mlx') return DEFAULT_LOCAL_MAX_OUTPUT_TOKENS
  if (modelId.toLowerCase().includes(':free')) return 32_000
  return modelPreset(modelId, providerId)?.maxOutputTokens ?? DEFAULT_CLOUD_MAX_OUTPUT_TOKENS
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
