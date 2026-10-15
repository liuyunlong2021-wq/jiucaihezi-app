import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './tauriEnv'
import { isLocalNetworkHost } from './providerConfig'

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
  device?: string
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
  if (!saved) {
    write(storage, COMFY_UI_API_BASE_KEY, DEFAULT_COMFY_UI_API_BASE)
    return DEFAULT_COMFY_UI_API_BASE
  }
  return saved
}

export function normalizeComfyUiApiBase(baseUrl: string): string {
  const normalized = String(baseUrl || DEFAULT_COMFY_UI_API_BASE).trim().replace(/\/+$/, '')
  const parsed = new URL(normalized)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('服务地址必须是无账号、查询参数的 HTTP 或 HTTPS 地址')
  if (parsed.protocol === 'http:' && !isLocalNetworkHost(parsed.hostname)) throw new Error('公网工作流服务必须使用 HTTPS')
  return normalized
}

export function saveComfyUiApiBase(baseUrl: string, storage: ComfyUiStore = localStorage): string {
  const normalized = normalizeComfyUiApiBase(baseUrl)
  write(storage, COMFY_UI_API_BASE_KEY, normalized)
  return normalized
}

let comfyAccessCredential: { base: string; key: string } | null = null

export async function getComfyServiceAccessKey(): Promise<string> {
  if (!comfyAccessCredential && isTauriRuntime()) {
    const saved = String(await invoke('get_comfy_service_credential') || '')
    try { comfyAccessCredential = saved ? JSON.parse(saved) : { base: '', key: '' } } catch { comfyAccessCredential = { base: '', key: '' } }
  }
  return comfyAccessCredential?.base === getComfyUiApiBase() ? comfyAccessCredential.key : ''
}

export async function saveComfyServiceAccessKey(base: string, key: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error('工作流服务连接仅支持 Desktop')
  const credential = { base: base.trim().replace(/\/+$/, ''), key: key.trim() }
  await invoke('set_comfy_service_credential', { value: JSON.stringify(credential) })
  comfyAccessCredential = credential
}

export async function comfyServiceHeaders(url: string): Promise<Record<string, string>> {
  const key = await getComfyServiceAccessKey()
  const base = getComfyUiApiBase()
  return key && (url === base || url.startsWith(base + '/')) ? { Authorization: `Bearer ${key}` } : {}
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
  if (!isTauriRuntime()) throw new Error('工作流凭据仅支持 Desktop')
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
  const response = await fetch(`${normalized}/system_stats`, { method: 'GET', headers: await comfyServiceHeaders(normalized + '/system_stats'), signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return { connected: true, baseUrl: normalized, message: '已连接 ComfyUI。模型下载完成后即可配置工作流。' }
}

export async function probeComfyUi(baseUrl = getComfyUiApiBase()): Promise<ComfyUiRuntimeStatus> {
  const normalized = String(baseUrl || DEFAULT_COMFY_UI_API_BASE).trim().replace(/\/+$/, '')
  const headers = await comfyServiceHeaders(normalized + '/system_stats')
  const options = { headers, signal: AbortSignal.timeout(10000) }
  const [statsResponse, objectResponse, unetResponse, vaeResponse, clipResponse] = await Promise.all([
    fetch(`${normalized}/system_stats`, options),
    fetch(`${normalized}/object_info`, options),
    fetch(`${normalized}/models/unet`, options),
    fetch(`${normalized}/models/vae`, options),
    fetch(`${normalized}/models/clip`, options),
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
    device: devices.map((device: { name?: string; type?: string }) => device.name || device.type || '').filter(Boolean).join('、') || undefined,
    mps: devices.some((device: any) => String(device?.type || '').toLowerCase() === 'mps'),
    miniMaxH3: /minimax.?h3/i.test(modelNames) && /MiniMaxH3ImageToVideo/i.test(objectInfo),
    zImageTurbo: /z.?image/i.test(modelNames) && /qwen_3_4b/i.test(modelNames),
    message: 'ComfyUI 已连接',
  }
}
