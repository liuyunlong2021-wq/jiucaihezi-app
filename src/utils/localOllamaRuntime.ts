import {
  LOCAL_OLLAMA_API_BASE,
  LOCAL_OLLAMA_PROVIDER_ID,
  saveLocalOllamaModels,
  type JcModelRef,
} from './providerConfig'

export interface LocalOllamaModel {
  name: string
  model?: string
  size?: number
  modified_at?: string
}

export interface LocalOllamaConnectResult {
  connected: boolean
  models: JcModelRef[]
  message: string
}

function formatOllamaModelLabel(name: string): string {
  return name.replace(/:latest$/, '')
}

export async function listLocalOllamaModels(): Promise<JcModelRef[]> {
  const response = await fetch(`${LOCAL_OLLAMA_API_BASE}/api/tags`, {
    method: 'GET',
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  const models = Array.isArray(data?.models) ? data.models : []
  return models
    .map((model: LocalOllamaModel) => {
      const id = String(model.name || model.model || '').trim()
      if (!id) return null
      return {
        id,
        label: formatOllamaModelLabel(id),
        providerId: LOCAL_OLLAMA_PROVIDER_ID,
      }
    })
    .filter(Boolean) as JcModelRef[]
}

export async function connectLocalOllama(): Promise<LocalOllamaConnectResult> {
  const models = await listLocalOllamaModels()
  saveLocalOllamaModels(models)
  if (models.length === 0) {
    return {
      connected: true,
      models,
      message: '已连接 Ollama，但还没有识别到本地模型。请先在 Ollama 中安装模型。',
    }
  }
  return {
    connected: true,
    models,
    message: `已连接 Ollama，识别到 ${models.length} 个本地模型。`,
  }
}
