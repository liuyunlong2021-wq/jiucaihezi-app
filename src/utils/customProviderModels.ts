import { normalizeCustomProviderApiBase, type CustomProviderConfig } from './providerConfig'

export interface CustomModelCapabilities {
  contextWindow?: number
  maxOutputTokens?: number
  inputModalities?: Array<'text' | 'image'>
}

const capacity = (...values: unknown[]): number | undefined => values.find(
  value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0,
) as number | undefined

/** Strata 与 OpenAI 兼容端点的只读能力发现，不加载或修改服务端模型。 */
export async function discoverCustomProviderModels(provider: Pick<CustomProviderConfig, 'apiBase' | 'apiKey'>) {
  const base = normalizeCustomProviderApiBase(provider.apiBase)
  const headers = provider.apiKey?.trim() ? { Authorization: `Bearer ${provider.apiKey.trim()}` } : undefined
  const get = async (path: string) => {
    const response = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }
  const data = await get('/v1/models')
  if (!Array.isArray(data?.data)) throw new Error('服务未返回 OpenAI 兼容模型列表')
  const modelCapabilities: Record<string, CustomModelCapabilities> = Object.create(null)
  for (const model of data.data) {
    if (typeof model?.id !== 'string' || !model.id.trim()) continue
    const contextWindow = capacity(model.contextWindow, model.context_window, model.context_length, model.meta?.n_ctx)
    const modalities = model.input_modalities || model.architecture?.input_modalities
    modelCapabilities[model.id] = {
      contextWindow,
      maxOutputTokens: capacity(model.maxOutputTokens, model.max_output_tokens, model.top_provider?.max_completion_tokens),
      ...(Array.isArray(modalities) ? { inputModalities: modalities.includes('image') ? ['text', 'image'] : ['text'] } : {}),
    }
  }
  // Strata/llama.cpp 的 props 提供实际生成配置；普通兼容端点可以没有此接口。
  await Promise.all(Object.entries(modelCapabilities).map(async ([id, model]) => {
    try {
      const props = await get(`/props?model=${encodeURIComponent(id)}`)
      const settings = props?.default_generation_settings
      model.contextWindow = capacity(settings?.n_ctx, model.contextWindow)
      const output = settings?.params?.n_predict
      model.maxOutputTokens = capacity(output, model.maxOutputTokens)
      if (output === -1 && model.contextWindow) {
        // SDK 压缩必须预留有限输出预算；窗口一半留给输入，其余可用于思考和回答。
        model.maxOutputTokens = Math.floor(model.contextWindow / 2)
      }
    } catch { /* 可选接口不可用时保留模型目录声明。 */ }
  }))
  return { modelIds: Object.keys(modelCapabilities), modelCapabilities: Object.fromEntries(Object.entries(modelCapabilities)) }
}
