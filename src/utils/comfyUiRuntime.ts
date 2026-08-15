import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './tauriEnv'

export const COMFY_UI_API_BASE_KEY = 'jcComfyUiApiBase'
export const DEFAULT_COMFY_UI_API_BASE = 'http://127.0.0.1:8000'
const COMFY_WORKFLOW_API_KEY_SESSION_KEY = 'jcComfyWorkflowApiKeySession'
let comfyWorkflowApiKeyMemory = ''

export interface ComfyUiConnectResult {
  connected: boolean
  baseUrl: string
  message: string
}

export interface ComfyUiRuntimeStatus {
  connected: boolean
  version?: string
  mps: boolean
  miniMaxH3: boolean
  zImageTurbo: boolean
  message: string
}

type ComfyUiStore = Pick<Storage, 'getItem' | 'setItem'> | Map<string, string>

function read(storage: ComfyUiStore, key: string): string | null {
  return storage instanceof Map ? storage.get(key) || null : storage.getItem(key)
}

function write(storage: ComfyUiStore, key: string, value: string): void {
  if (storage instanceof Map) storage.set(key, value)
  else storage.setItem(key, value)
}

export function getComfyUiApiBase(storage: ComfyUiStore = localStorage): string {
  const saved = String(read(storage, COMFY_UI_API_BASE_KEY) || '').trim().replace(/\/+$/, '')
  if (!saved || /:8188$/i.test(saved)) {
    write(storage, COMFY_UI_API_BASE_KEY, DEFAULT_COMFY_UI_API_BASE)
    return DEFAULT_COMFY_UI_API_BASE
  }
  return saved
}

export function saveComfyUiApiBase(baseUrl: string, storage: ComfyUiStore = localStorage): string {
  const normalized = String(baseUrl || DEFAULT_COMFY_UI_API_BASE).trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(normalized)) throw new Error('ComfyUI 地址必须以 http:// 或 https:// 开头')
  write(storage, COMFY_UI_API_BASE_KEY, normalized)
  return normalized
}

export async function getComfyWorkflowApiKey(): Promise<string> {
  if (comfyWorkflowApiKeyMemory) return comfyWorkflowApiKeyMemory
  comfyWorkflowApiKeyMemory = String(sessionStorage.getItem(COMFY_WORKFLOW_API_KEY_SESSION_KEY) || '').trim()
  if (comfyWorkflowApiKeyMemory) return comfyWorkflowApiKeyMemory
  if (!isTauriRuntime()) return ''
  comfyWorkflowApiKeyMemory = String(await invoke('get_comfy_workflow_api_key') || '').trim()
  return comfyWorkflowApiKeyMemory
}

export async function saveComfyWorkflowApiKey(value: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error('本机 ComfyUI 仅支持 Desktop')
  comfyWorkflowApiKeyMemory = value.trim()
  if (comfyWorkflowApiKeyMemory) sessionStorage.setItem(COMFY_WORKFLOW_API_KEY_SESSION_KEY, comfyWorkflowApiKeyMemory)
  else sessionStorage.removeItem(COMFY_WORKFLOW_API_KEY_SESSION_KEY)
  try {
    await invoke('set_comfy_workflow_api_key', { value: comfyWorkflowApiKeyMemory })
  } catch (error) {
    comfyWorkflowApiKeyMemory = ''
    sessionStorage.removeItem(COMFY_WORKFLOW_API_KEY_SESSION_KEY)
    throw error
  }
}

export async function connectComfyUi(baseUrl = getComfyUiApiBase()): Promise<ComfyUiConnectResult> {
  const normalized = saveComfyUiApiBase(baseUrl)
  const response = await fetch(`${normalized}/system_stats`, { method: 'GET' })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return { connected: true, baseUrl: normalized, message: '已连接 ComfyUI。模型下载完成后即可配置工作流。' }
}

export async function probeComfyUi(baseUrl = getComfyUiApiBase()): Promise<ComfyUiRuntimeStatus> {
  const normalized = String(baseUrl || DEFAULT_COMFY_UI_API_BASE).trim().replace(/\/+$/, '')
  const [statsResponse, objectResponse, unetResponse, vaeResponse, clipResponse] = await Promise.all([
    fetch(`${normalized}/system_stats`),
    fetch(`${normalized}/object_info`),
    fetch(`${normalized}/models/unet`),
    fetch(`${normalized}/models/vae`),
    fetch(`${normalized}/models/clip`),
  ])
  if (!statsResponse.ok) throw new Error(`HTTP ${statsResponse.status}`)
  if (!objectResponse.ok) throw new Error(`HTTP ${objectResponse.status}`)
  const stats = await statsResponse.json()
  const objectInfo = await objectResponse.text()
  const modelNames = [
    ...(unetResponse.ok ? await unetResponse.json() : []),
    ...(vaeResponse.ok ? await vaeResponse.json() : []),
    ...(clipResponse.ok ? await clipResponse.json() : []),
  ].join('\n')
  const devices = Array.isArray(stats?.devices) ? stats.devices : []
  return {
    connected: true,
    version: String(stats?.system?.comfyui_version || '').trim() || undefined,
    mps: devices.some((device: any) => String(device?.type || '').toLowerCase() === 'mps'),
    miniMaxH3: /minimax.?h3/i.test(modelNames) && /MiniMaxH3ImageToVideo/i.test(objectInfo),
    zImageTurbo: /z.?image/i.test(modelNames) && /qwen_3_4b/i.test(modelNames),
    message: 'ComfyUI 已连接',
  }
}
