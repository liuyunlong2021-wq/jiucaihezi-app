import {
  LOCAL_MLX_DEFAULT_MODEL,
  LOCAL_MLX_PROVIDER_ID,
  normalizeLocalMlxApiBase,
  saveLocalMlxApiBase,
  saveLocalMlxModelPath,
  saveLocalMlxModels,
  type JcModelRef,
  type KeyValueStore,
} from './providerConfig'
import { safeFetch } from './httpClient'
import { getLocalMlxModelPath } from './providerConfig'
import { invoke } from '@tauri-apps/api/core'

export { normalizeLocalMlxApiBase } from './providerConfig'

export interface LocalMlxConnectResult {
  models: JcModelRef[]
  model: JcModelRef
  message: string
}

function modelMatchesTarget(id: string, target: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const normalizedId = normalize(id)
  const normalizedTarget = normalize(target)
  return normalizedId.includes(normalizedTarget) || normalizedTarget.includes(normalizedId)
}

export async function connectLocalMlx(
  value: string,
  store: KeyValueStore = localStorage,
  fetcher: typeof fetch = safeFetch,
  targetModel = LOCAL_MLX_DEFAULT_MODEL,
): Promise<LocalMlxConnectResult> {
  const apiBase = normalizeLocalMlxApiBase(value)
  const response = await fetcher(`${apiBase}/v1/models`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  if (!Array.isArray(data?.data)) throw new Error('MLX 服务未返回有效模型列表')
  const models: JcModelRef[] = data.data
    .map((item: { id?: unknown }) => String(item?.id || '').trim())
    .filter(Boolean)
    .map((id: string) => ({
      id,
      label: id.startsWith('/') ? id.split('/').filter(Boolean).slice(-2).join('/') : id,
      providerId: LOCAL_MLX_PROVIDER_ID,
    }))
  if (!models.length) throw new Error('MLX 服务没有可用模型')
  const model = targetModel
    ? models.find(item => modelMatchesTarget(item.id, targetModel))
    : models[0]
  if (!model) {
    throw new Error(
      `MLX 已连接，但不是默认模型 ${targetModel}。请检查服务端口或高级设置中的模型路径。`,
    )
  }
  saveLocalMlxApiBase(apiBase, store)
  saveLocalMlxModels(models, store)
  if (!getLocalMlxModelPath(store)) saveLocalMlxModelPath(models[0]!.id, store)
  return { models, model, message: `已连接 MLX，识别到 ${models.length} 个本地模型。` }
}

export async function startLocalMlx(modelPath: string, apiBase: string): Promise<string> {
  return await invoke<string>('start_mlx_service', { modelPath, apiBase })
}
