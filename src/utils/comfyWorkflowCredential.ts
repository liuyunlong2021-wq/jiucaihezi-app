import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from './tauriEnv'

const COMFY_WORKFLOW_API_KEY_SESSION_KEY = 'jcComfyWorkflowApiKeySession'
let comfyWorkflowApiKeyMemory: string | null = null

export async function getComfyWorkflowApiKey(): Promise<string> {
  if (comfyWorkflowApiKeyMemory !== null) return comfyWorkflowApiKeyMemory
  if (!isTauriRuntime()) return ''
  const saved = String(await invoke('get_comfy_workflow_api_key') || '').trim()
  const legacy = String(sessionStorage.getItem(COMFY_WORKFLOW_API_KEY_SESSION_KEY) || '').trim()
  if (!saved && legacy) await invoke('set_comfy_workflow_api_key', { value: legacy })
  comfyWorkflowApiKeyMemory = saved || legacy
  if (legacy) sessionStorage.removeItem(COMFY_WORKFLOW_API_KEY_SESSION_KEY)
  return comfyWorkflowApiKeyMemory
}

export async function saveComfyWorkflowApiKey(value: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error('工作流凭据仅支持 Desktop')
  await invoke('set_comfy_workflow_api_key', { value: value.trim() })
  comfyWorkflowApiKeyMemory = value.trim()
  sessionStorage.removeItem(COMFY_WORKFLOW_API_KEY_SESSION_KEY)
}
