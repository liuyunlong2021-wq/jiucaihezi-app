import {
  LOCAL_MLX_PROVIDER_ID,
  normalizeLocalMlxApiBase,
  saveLocalMlxApiBase,
  saveLocalMlxModels,
  type JcModelRef,
  type KeyValueStore,
} from './providerConfig'
import { safeFetch } from './httpClient'

export { normalizeLocalMlxApiBase } from './providerConfig'

export interface LocalMlxConnectResult {
  models: JcModelRef[]
  message: string
}

export async function connectLocalMlx(
  value: string,
  store: KeyValueStore = localStorage,
  fetcher: typeof fetch = safeFetch,
): Promise<LocalMlxConnectResult> {
  const apiBase = normalizeLocalMlxApiBase(value)
  const response = await fetcher(`${apiBase}/v1/models`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = await response.json()
  if (!Array.isArray(data?.data)) throw new Error('MLX 服务未返回有效模型列表')
  const models = data.data
    .map((item: { id?: unknown }) => String(item?.id || '').trim())
    .filter(Boolean)
    .map((id: string) => ({
      id,
      label: id.startsWith('/') ? id.split('/').filter(Boolean).slice(-2).join('/') : id,
      providerId: LOCAL_MLX_PROVIDER_ID,
    }))
  if (!models.length) throw new Error('MLX 服务没有可用模型')
  saveLocalMlxApiBase(apiBase, store)
  saveLocalMlxModels(models, store)
  return { models, message: `已连接 MLX，识别到 ${models.length} 个本地模型。` }
}
