import { invoke } from '@tauri-apps/api/core'
import {
  DEFAULT_LOCAL_MLX_MODEL_ID,
  LOCAL_MLX_MODEL_CATALOG,
  LOCAL_MLX_PROVIDER_ID,
  getLocalMlxModelDefinition,
  getLocalMlxModels,
  isLocalMlxModelHidden as readLocalMlxModelHidden,
  registerLocalMlxModel,
  unregisterLocalMlxModel,
  type LocalMlxModelDefinition,
} from './providerConfig'
import { isTauriRuntime } from './tauriEnv'

export interface LocalMlxStatus {
  supported: boolean
  providerId: string
  modelId: string
  modelLabel: string
  modelRepo: string
  modelSource: string
  installed: boolean
  running: boolean
  apiBase: string
  message: string
}

export interface LocalMlxProgress {
  event: 'status' | 'log' | 'done' | 'error'
  message?: string
  progress?: number
  downloadedBytes?: number
  totalBytes?: number
}

export const LOCAL_MLX_MODELS = LOCAL_MLX_MODEL_CATALOG.map(model => ({
  ...model,
  providerId: LOCAL_MLX_PROVIDER_ID,
  capability: 'text' as const,
}))

export function getInstalledLocalMlxModels() {
  return getLocalMlxModels().map(model => ({
    id: model.id,
    label: model.label || getLocalMlxModelDefinition(model.id)?.label || model.id,
    providerId: LOCAL_MLX_PROVIDER_ID,
    capability: 'text' as const,
  }))
}

function requireLocalMlxModel(modelId: string): LocalMlxModelDefinition {
  const model = getLocalMlxModelDefinition(modelId)
  if (!model) throw new Error(`未知本地模型：${modelId}`)
  return model
}

export function markLocalMlxModelInstalled(modelId: string) {
  return registerLocalMlxModel(modelId)
}

export function markLocalMlxModelRemoved(modelId: string) {
  return unregisterLocalMlxModel(modelId)
}

export async function removeLocalMlxModel(modelId: string): Promise<LocalMlxStatus> {
  if (!isTauriRuntime()) throw new Error('本地模型只支持桌面版')
  const model = requireLocalMlxModel(modelId)
  const status = await invoke<LocalMlxStatus>('local_mlx_remove_model', {
    input: localMlxInput(model.id),
  })
  markLocalMlxModelRemoved(model.id)
  return status
}

export async function scanLocalMlxModels(modelId = DEFAULT_LOCAL_MLX_MODEL_ID): Promise<LocalMlxStatus> {
  if (!isTauriRuntime()) throw new Error('本地模型只支持桌面版')
  const model = requireLocalMlxModel(modelId)
  const status = await invoke<LocalMlxStatus>('local_mlx_scan_models', {
    input: localMlxInput(model.id),
  })
  if (status.installed) markLocalMlxModelInstalled(model.id)
  return status
}

export function isLocalMlxModelInstalled(modelId: string): boolean {
  return getLocalMlxModels().some(model => model.id === modelId)
}

export function isLocalMlxModelHidden(modelId: string): boolean {
  return readLocalMlxModelHidden(modelId)
}

function localMlxInput(modelId: string) {
  const model = requireLocalMlxModel(modelId)
  return {
    modelId: model.id,
    modelLabel: model.label,
    modelRepo: model.repo,
    downloadBytesHint: model.downloadBytesHint,
  }
}

export async function getLocalMlxStatus(modelId = DEFAULT_LOCAL_MLX_MODEL_ID): Promise<LocalMlxStatus> {
  const model = requireLocalMlxModel(modelId)
  if (!isTauriRuntime()) {
    return {
      supported: false,
      providerId: LOCAL_MLX_PROVIDER_ID,
      modelId: model.id,
      modelLabel: model.label,
      modelRepo: model.repo,
      modelSource: model.repo,
      installed: isLocalMlxModelInstalled(model.id),
      running: false,
      apiBase: '',
      message: '本地模型只支持桌面版。',
    }
  }

  return invoke<LocalMlxStatus>('local_mlx_status', { input: localMlxInput(model.id) })
}

export async function prepareLocalMlxModel(
  modelId: string,
  onProgress?: (progress: LocalMlxProgress) => void,
): Promise<LocalMlxStatus> {
  if (!isTauriRuntime()) throw new Error('本地模型只支持桌面版')
  const model = requireLocalMlxModel(modelId)
  const { Channel } = await import('@tauri-apps/api/core')
  const channel = new Channel<LocalMlxProgress>()
  if (onProgress) channel.onmessage = onProgress
  const status = await invoke<LocalMlxStatus>('local_mlx_prepare_model', {
    input: localMlxInput(model.id),
    onProgress: channel,
  })
  if (status.installed) markLocalMlxModelInstalled(model.id)
  return status
}

export async function ensureLocalMlxServer(modelId = DEFAULT_LOCAL_MLX_MODEL_ID): Promise<LocalMlxStatus> {
  if (!isTauriRuntime()) throw new Error('本地模型只支持桌面版')
  const model = requireLocalMlxModel(modelId)
  return invoke<LocalMlxStatus>('local_mlx_ensure_server', { input: localMlxInput(model.id) })
}

export async function openLocalMlxModelDir(): Promise<void> {
  if (!isTauriRuntime()) throw new Error('本地模型只支持桌面版')
  await invoke('local_mlx_open_model_dir')
}

export async function stopLocalMlxServer(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('local_mlx_stop_server')
}
