import type { McpServerConfig } from '@/stores/mcpStore'
import type { MediaResult } from '@/api/media-generation'
import { isLocalNetworkHost } from '@/utils/providerConfig'

export const COMFY_MCP_VERSION = '0.10.0'
export const COMFY_CLI_VERSION = '1.20.0'
export const COMFY_MCP_INSTALL = `pip install comfy-mcp==${COMFY_MCP_VERSION} comfy-cli==${COMFY_CLI_VERSION}`
export const COMFY_MCP_DOCS = 'https://github.com/Comfy-Org/comfy-mcp'

export function isComfyMcpServer(server: Pick<McpServerConfig, 'transport' | 'command'>): boolean {
  return server.transport === 'stdio' && /(?:^|\/)comfy-mcp(?:\.exe)?$/i.test((server.command || '').replaceAll('\\', '/'))
}

export function comfyMcpConfig(target = 'http://127.0.0.1:8188'): Omit<McpServerConfig, 'status' | 'enabled' | 'error'> {
  const url = new URL(target.trim())
  if (url.protocol !== 'http:' || !isLocalNetworkHost(url.hostname) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('官方 ComfyUI MCP 当前仅支持本机或局域网裸 HTTP 地址，不支持 HTTPS、路径前缀或地址中的凭据；原配置已保留。')
  }
  return { id: 'comfyui', name: 'ComfyUI（官方）', transport: 'stdio', command: 'comfy-mcp', args: [],
    env: { COMFY_LOCAL_URL: url.origin, COMFYUI_URL: '', COMFYUI_HOST: '', COMFYUI_PORT: '' } }
}

export type ComfySubmitted = { taskId: string; pollUrl: string; pollKind: 'image' | 'video' }
export interface ComfyWorkflowIO {
  serverId: string
  target: string
  call(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<any>
  write(id: string, name: string, dataBase64: string): Promise<string>
  read(path: string, type: 'image' | 'video'): Promise<string>
  removeWorkflow(id: string): Promise<void>
}

async function connectedIO(serverId?: string): Promise<ComfyWorkflowIO> {
  const { useMcpStore } = await import('@/stores/mcpStore')
  const { callMcpToolResult } = await import('./mcpClient')
  const { invoke } = await import('@tauri-apps/api/core')
  const { readFile, remove } = await import('@tauri-apps/plugin-fs')
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  const store = useMcpStore()
  await store.ensureLoaded()
  const candidates = store.connectedServers.filter(isComfyMcpServer)
  const server = serverId ? candidates.find(s => s.id === serverId) : candidates.length === 1 ? candidates[0] : undefined
  if (!server) throw new Error('请在设置 → MCP 连接并选择唯一的 ComfyUI 官方服务。任务不会自动重提。')
  if (!server.env?.COMFY_LOCAL_URL || server.env.COMFYUI_URL || server.env.COMFYUI_HOST || server.env.COMFYUI_PORT) {
    throw new Error('请在设置 → MCP → ComfyUI 保存明确的服务地址，避免官方 CLI 的多个地址配置指向不同服务')
  }
  const target = server.env.COMFY_LOCAL_URL
  comfyMcpConfig(target)
  return {
    serverId: server.id, target,
    async call(name, args, signal) {
      const result = await callMcpToolResult(server.id, name, args, signal)
      if (result.structuredContent) return result.structuredContent.result ?? result.structuredContent
      const texts = result.content.filter(c => c.type === 'text').map(c => c.text)
      // FastMCP may wrap a list result in one text block per element.
      const values = texts.map(text => { try { return JSON.parse(text) } catch { return text } })
      return values.length === 1 ? values[0] : values
    },
    write: (id, name, dataBase64) => invoke<string>('comfy_mcp_write_input', { id, name, dataBase64 }),
    async read(path, type) {
      const root = await join(await appDataDir(), 'comfy-mcp')
      const normalized = path.replaceAll('\\', '/')
      if (!normalized.startsWith(root.replaceAll('\\', '/') + '/') || normalized.split('/').includes('..')) throw new Error('官方 MCP 返回了工作目录之外的结果')
      const bytes = await readFile(path)
      if (!bytes.length) throw new Error('官方 MCP 输出文件为空')
      let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      const ext = path.split('.').at(-1)?.toLowerCase()
      const mime = type === 'video' ? (ext === 'webm' ? 'video/webm' : 'video/mp4') : (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png')
      return `data:${mime};base64,${btoa(binary)}`
    },
    async removeWorkflow(id) {
      const path = await join(await appDataDir(), 'comfy-mcp', id, 'workflow.json')
      await remove(path)
    },
  }
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) { const error = new Error('任务已取消'); error.name = 'AbortError'; throw error }
}

export async function runComfyWorkflow(input: {
  type: 'image' | 'video'
  references?: string[]
  buildWorkflow(names: string[]): unknown
  signal?: AbortSignal
  onProgress?: (elapsed: number, status: string) => void
  onSubmitted?: (submitted: ComfySubmitted) => void | Promise<void>
}, io?: ComfyWorkflowIO): Promise<MediaResult> {
  io ||= await connectedIO()
  checkAbort(input.signal)
  const id = crypto.randomUUID()
  let workflowWritten = false
  const names: string[] = []
  try {
    for (const [index, image] of (input.references || []).entries()) {
      checkAbort(input.signal)
      const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s.exec(image)
      if (!match) throw new Error(`参考图 ${index + 1} 不是可上传的 PNG、JPEG 或 WebP`)
      const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1]
      const path = await io.write(id, `reference-${index}.${extension}`, match[2])
      const uploaded = await io.call('upload_file', { paths: [path], overwrite: false }, input.signal)
      const item = uploaded.uploads?.[0]
      if (!item?.cloud_name) throw new Error('官方 MCP 未返回上传文件名')
      names.push(item.subfolder ? `${item.subfolder}/${item.cloud_name}` : item.cloud_name)
    }
    const text = JSON.stringify(input.buildWorkflow(names))
    const bytes = new TextEncoder().encode(text)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    const path = await io.write(id, 'workflow.json', btoa(binary))
    workflowWritten = true
    checkAbort(input.signal)
    input.onProgress?.(0, '通过官方 ComfyUI MCP 提交...')
    // Submission must finish returning its ID even if the user cancels meanwhile.
    const submitted = await io.call('run_workflow', { workflow_path: path, wait: false })
    if (!submitted.prompt_id) throw new Error('官方 MCP 未返回任务 ID；结果未知，请勿重复提交')
    const pollUrl = `comfy-mcp://task?${new URLSearchParams({ server: io.serverId, target: io.target, workspace: id, prompt: submitted.prompt_id })}`
    try {
      await input.onSubmitted?.({ taskId: submitted.prompt_id, pollUrl, pollKind: input.type })
    } finally {
      await io.removeWorkflow(id)
      workflowWritten = false
    }
    return await resumeComfyWorkflow(pollUrl, submitted.prompt_id, input.type, input.onProgress, input.signal, io)
  } finally {
    if (workflowWritten) await io.removeWorkflow(id)
  }
}

export async function resumeComfyWorkflow(pollUrl: string, taskId: string, type: 'image' | 'video', onProgress?: (elapsed: number, status: string) => void, signal?: AbortSignal, io?: ComfyWorkflowIO): Promise<MediaResult> {
  let descriptor = new URL(pollUrl)
  if (descriptor.protocol === 'http:' && descriptor.pathname === `/history/${encodeURIComponent(taskId)}`) {
    io ||= await connectedIO()
    if (io.target !== descriptor.origin) throw new Error('旧任务的 ComfyUI 服务地址与当前官方连接不同，请恢复原连接')
    // The official CLI can query an existing local history ID without resubmission.
    descriptor = new URL(`comfy-mcp://task?${new URLSearchParams({ server: io.serverId, target: io.target, workspace: crypto.randomUUID(), prompt: taskId })}`)
    pollUrl = descriptor.toString()
  }
  if (descriptor.protocol !== 'comfy-mcp:' || !descriptor.searchParams.get('server')) throw new Error('旧 ComfyUI 任务缺少官方 MCP 恢复信息；已保留原任务，请在官方服务中核查，不会自动重提。')
  io ||= await connectedIO(descriptor.searchParams.get('server')!)
  if (io.serverId !== descriptor.searchParams.get('server') || io.target !== descriptor.searchParams.get('target')) throw new Error('ComfyUI 服务地址已改变，请恢复原连接后查询原任务')
  if (descriptor.searchParams.get('prompt') !== taskId) throw new Error('ComfyUI 恢复任务 ID 不一致')
  const id = descriptor.searchParams.get('workspace') || ''
  if (!/^[\da-f-]{36}$/i.test(id)) throw new Error('ComfyUI 恢复工作目录无效')
  const started = Date.now()
  let completed: any
  try {
    for (;;) {
      checkAbort(signal)
      const result = await io.call('job', { action: 'wait', prompt_id: taskId, timeout_seconds: 25 }, signal)
      checkAbort(signal)
      const status = typeof result.status === 'string' ? result.status : result.status?.status
      if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
        throw Object.assign(new Error(`ComfyUI 工作流${status}: ${result.error?.message || JSON.stringify(result.error || '')}`), { terminalCreationTask: true })
      }
      if (!result.timed_out && ['completed', 'success', 'succeeded', 'complete', 'done'].includes(status)) { completed = result; break }
      if (!result.timed_out) throw new Error('官方 MCP 未返回可识别的任务终态；保留任务 ID，请查询原任务')
      onProgress?.((Date.now() - started) / 1000, '官方 ComfyUI 生成中...')
    }
    // Custom API nodes can emit a CDN video URL as text rather than a Comfy file.
    if (type === 'video') {
      const url = JSON.stringify(completed.text_outputs || {}).match(/https?:\\?\/\\?\/[^"\\\s]+\.mp4(?:\?[^"\\\s]*)?/i)?.[0]?.replaceAll('\\/', '/')
      if (url) return { url, type, taskId, pollUrl, pollKind: type }
    }
    const rootPath = await io.write(id, 'result.marker', '')
    const outDir = rootPath.replace(/[\\/][^\\/]+$/, '') + '/outputs'
    const result = await io.call('fetch_outputs', { prompt_id: taskId, out_dir: outDir }, signal)
    const metadata = Array.isArray(result) ? result.find(v => v?.files) : result
    const file = metadata?.files?.find((f: any) => typeof f.path === 'string' && (type === 'video' ? /\.(mp4|webm|mov)$/i : /\.(png|jpe?g|webp)$/i).test(f.path))
    if (!file) throw new Error('官方 MCP 未返回对应媒体文件；任务与输出已保留')
    const url = await io.read(file.path, type)
    return { url, type, taskId, pollUrl, pollKind: type }
  } catch (error) {
    if (signal?.aborted) {
      await io.call('job', { action: 'cancel', prompt_id: taskId }).catch(() => undefined)
      checkAbort(signal)
    }
    throw error
  }
}
