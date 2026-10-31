export type ComfyWorkflowKind = 'image' | 'video' | 'audio'

export interface ComfyWorkflowDefault {
  name: string
  path: string
}

export type ComfyWorkflowDefaults = Partial<Record<ComfyWorkflowKind, ComfyWorkflowDefault>>

const STORAGE_KEY = 'jc_comfy_workflow_defaults'
export const COMFY_WORKFLOW_DEFAULTS_CHANGED = 'jc:comfy-workflow-defaults-changed'

export function loadComfyWorkflowDefaults(): ComfyWorkflowDefaults {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as ComfyWorkflowDefaults
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item?.name && item?.path))
  } catch {
    return {}
  }
}

export function saveComfyWorkflowDefault(kind: ComfyWorkflowKind, workflow?: ComfyWorkflowDefault) {
  const defaults = loadComfyWorkflowDefaults()
  if (workflow) defaults[kind] = workflow
  else delete defaults[kind]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults))
  window.dispatchEvent(new CustomEvent(COMFY_WORKFLOW_DEFAULTS_CHANGED))
}

export function detectComfyWorkflowKind(message: string): ComfyWorkflowKind | undefined {
  if (/音频|音乐|歌曲|配音|声音|audio|music|voice/i.test(message)) return 'audio'
  if (/视频|动画|动起来|首尾帧|video|animate/i.test(message)) return 'video'
  if (/图片|图像|生图|绘制|画一|海报|照片|插画|image|photo|poster/i.test(message)) return 'image'
  return undefined
}

export function resolveComfyWorkflow(message: string): { kind: ComfyWorkflowKind; workflow?: ComfyWorkflowDefault } | undefined {
  const kind = detectComfyWorkflowKind(message)
  return kind ? { kind, workflow: loadComfyWorkflowDefaults()[kind] } : undefined
}

export function comfyWorkflowExecutionPrompt(message: string): string {
  const resolved = resolveComfyWorkflow(message)
  if (!resolved?.workflow) return message
  return [
    `【本轮指定的 ComfyUI 工作流】${resolved.workflow.name}`,
    `【工作流绝对路径】${resolved.workflow.path}`,
    '必须使用这个工作流作为唯一基础：读取该 API 工作流 JSON，按本轮需求只更新必要输入并写入临时副本，再将临时副本交给 run_workflow。不得改用、搜索、生成或选择其他工作流，不得覆盖原文件。',
    '【用户需求】',
    message,
  ].join('\n\n')
}
