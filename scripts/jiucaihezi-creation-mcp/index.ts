import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

interface Discovery {
  version: number
  address: string
  token: string
}

type InvokeBridge = (operation: string, params: Record<string, unknown>) => Promise<unknown>

const discoveryPath = join(homedir(), '.jiucaihezi', 'mcp-bridge.json')
const resultSchema = { result: z.unknown() }

async function invokeBridge(operation: string, params: Record<string, unknown>): Promise<unknown> {
  let discovery: Discovery
  try {
    const [raw, metadata] = await Promise.all([readFile(discoveryPath, 'utf8'), stat(discoveryPath)])
    if (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0) throw new Error('发现文件权限不是 600')
    discovery = JSON.parse(raw) as Discovery
  } catch (error) {
    throw new Error(`请先启动韭菜盒子 Desktop（无法读取 ${discoveryPath}：${error instanceof Error ? error.message : error}）`)
  }
  const url = new URL('/v1/invoke', discovery.address)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) {
    throw new Error('韭菜盒子 MCP 发现文件中的本机地址无效')
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${discovery.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ operation, params }),
    signal: AbortSignal.timeout(35_000),
  }).catch(error => {
    throw new Error(`无法连接韭菜盒子 Desktop：${error instanceof Error ? error.message : error}`)
  })
  const body = await response.json() as { result?: unknown; error?: string }
  if (!response.ok) throw new Error(body.error || `韭菜盒子桥接返回 HTTP ${response.status}`)
  return body.result
}

function toolResult(result: unknown) {
  const structuredContent = { result }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    structuredContent,
  }
}

function toolError(error: unknown) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
  }
}

export function createCreationMcpServer(callBridge: InvokeBridge = invokeBridge): McpServer {
  const server = new McpServer({ name: 'jiucaihezi-creation-mcp-server', version: '1.0.0' })
  const register = (
    name: string,
    title: string,
    description: string,
    inputSchema: z.ZodObject,
    annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean },
  ) => server.registerTool(name, { title, description, inputSchema, outputSchema: resultSchema, annotations }, async params => {
    try { return toolResult(await callBridge(name, params as Record<string, unknown>)) }
    catch (error) { return toolError(error) }
  })

  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  register('get_creation_context', '获取韭菜盒子创作上下文', '返回当前项目、画布和提交所需的 contextVersion。', z.object({}).strict(), readOnly)
  register('list_creation_models', '列出韭菜盒子创作模型', '从运行中的韭菜盒子模型注册表返回模型、字段、选项、默认值与价格。', z.object({}).strict(), readOnly)
  register('get_creation_task', '查询韭菜盒子创作任务', '查询一个创作任务的状态、进度、错误和稳定本地结果。', z.object({ taskId: z.string().min(1).max(120) }).strict(), readOnly)
  register('list_creation_history', '列出韭菜盒子创作历史', '分页读取与创作面板右上角相同的历史记录。', z.object({
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(20),
  }).strict(), readOnly)
  register('submit_creation_task', '提交韭菜盒子创作任务', '付费操作。使用模型表中的 modelId 和 params 提交图片、视频或音频任务；同一 requestId 幂等。参考图可传本机绝对路径、data URL 或 HTTPS URL，数量和大小由韭菜盒子模型表校验；可传 directory 指定输出目录。', z.object({
    requestId: z.string().min(8).max(120),
    contextVersion: z.string().min(1).max(1000),
    modelId: z.string().min(1).max(200),
    params: z.record(z.string(), z.unknown()),
    directory: z.string().min(1).max(4000).optional(),
  }).strict(), { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true })
  register('cancel_creation_task', '取消韭菜盒子创作任务', '停止跟踪仍在执行的任务；上游可能已接收请求。', z.object({ taskId: z.string().min(1).max(120) }).strict(), {
    readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true,
  })
  register('retry_media_persistence', '重新保存韭菜盒子创作结果', '重试把已成功生成但未落盘的结果保存到当前任务所属项目，不重新生成。', z.object({ taskId: z.string().min(1).max(120) }).strict(), {
    readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true,
  })
  register('add_creation_result_to_canvas', '将韭菜盒子创作结果放入画布', '把已成功且已落盘的任务结果显式追加到当前画布。', z.object({
    taskId: z.string().min(1).max(120),
    contextVersion: z.string().min(1).max(1000),
  }).strict(), { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false })
  return server
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const server = createCreationMcpServer()
  server.connect(new StdioServerTransport()).catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
