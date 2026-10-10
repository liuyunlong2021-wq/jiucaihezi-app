import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-jiucaihezi-creation'
export const inject = ['tools']
export const Config = z.object({
  creation: z.boolean().default(false),
  allowPaid: z.boolean().default(false),
  capabilities: z.array(z.string()).default([]),
})

const discoveryPath = join(homedir(), '.jiucaihezi', 'mcp-bridge.json')
const jsonOutput = {
  schema: { type: 'json' },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) ?? 'null' }],
}
const textOutput = {
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: value }],
}

async function invokeApp(operation, params) {
  let discovery
  try {
    discovery = JSON.parse(await readFile(discoveryPath, 'utf8'))
  } catch (error) {
    throw new Error(`请先启动韭菜盒子 Desktop：${error instanceof Error ? error.message : String(error)}`)
  }
  const address = new URL(String(discovery.address || ''))
  if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || !address.port
    || typeof discovery.token !== 'string' || !discovery.token) {
    throw new Error('韭菜盒子本机桥接地址无效')
  }
  const response = await fetch(new URL('/v1/invoke', address), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${discovery.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ operation, params }),
    signal: AbortSignal.timeout(operation === 'call_harness_tool' ? 900_000 : 35_000),
  })
  let body
  try {
    body = await response.json()
  } catch {
    throw new Error(`韭菜盒子本机桥接返回无效响应 (${response.status})`)
  }
  if (!response.ok) throw new Error(body?.error || `韭菜盒子本机桥接请求失败 (${response.status})`)
  return body?.result
}

function registerCreationTool(ctx, name, description, parameters, execute) {
  ctx.tools.register(defineTool({
    name,
    description,
    parameters,
    output: jsonOutput,
    execute,
  }))
}

function registerCreationTools(ctx, allowPaid) {
  registerCreationTool(ctx, 'get_creation_context', '读取当前韭菜盒子项目、画布和提交上下文。', {},
    () => invokeApp('get_creation_context', {}))
  registerCreationTool(ctx, 'list_creation_models', '从韭菜盒子当前媒体模型表读取可用模型、参数、选项和价格。', {},
    () => invokeApp('list_creation_models', { capabilities: ['av'] }))
  registerCreationTool(ctx, 'get_creation_task', '查询韭菜盒子媒体任务的状态、进度和结果。', {
    taskId: { type: 'string', required: true },
  }, args => invokeApp('get_creation_task', args))
  registerCreationTool(ctx, 'list_creation_history', '分页读取创作面板中的媒体任务历史。', {
    offset: { type: 'integer' },
    limit: { type: 'integer' },
  }, args => invokeApp('list_creation_history', args))
  registerCreationTool(ctx, 'cancel_creation_task', '停止跟踪一项媒体任务；上游可能已经接收请求。', {
    taskId: { type: 'string', required: true },
  }, args => invokeApp('cancel_creation_task', args))
  registerCreationTool(ctx, 'retry_media_persistence', '重试保存已成功生成的结果，不会重新生成。', {
    taskId: { type: 'string', required: true },
  }, args => invokeApp('retry_media_persistence', args))
  registerCreationTool(ctx, 'add_creation_result_to_canvas', '把已保存的创作结果显式追加到当前画布。', {
    taskId: { type: 'string', required: true },
    contextVersion: { type: 'string', required: true },
  }, args => invokeApp('add_creation_result_to_canvas', args))
  if (allowPaid) {
    registerCreationTool(ctx, 'submit_creation_task', '使用韭菜盒子媒体模型提交一项图片、视频或音频生成任务。调用前先读取模型表和当前上下文；params 按模型字段传值，requestId 每次请求唯一。任务使用 App 已配置的媒体服务与 Key，并进入创作历史。', {
      requestId: { type: 'string', required: true },
      contextVersion: { type: 'string', required: true },
      modelId: { type: 'string', required: true },
      params: { type: 'object', additionalProperties: true, required: true },
      directory: { type: 'string' },
    }, args => invokeApp('submit_creation_task', { ...args, capabilities: ['av'] }))
  }
}

function schemaProperty(schema, required = false) {
  if (!schema || typeof schema !== 'object') return { type: 'json' }
  const common = {
    ...(required ? { required: true } : {}),
    ...(typeof schema.description === 'string' ? { description: schema.description } : {}),
  }
  if (Array.isArray(schema.enum) && schema.enum.length && schema.enum.every(value => typeof value === 'string')) {
    return { ...common, type: 'string', enum: schema.enum }
  }
  if (schema.type === 'string' || schema.type === 'number' || schema.type === 'integer' || schema.type === 'boolean') {
    return { ...common, type: schema.type }
  }
  if (schema.type === 'array') {
    return { ...common, type: 'array', items: schemaProperty(schema.items) }
  }
  if (schema.type === 'object') {
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
    const requiredFields = new Set(Array.isArray(schema.required) ? schema.required : [])
    return {
      ...common,
      type: 'object',
      properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, schemaProperty(value, requiredFields.has(key))])),
      additionalProperties: schema.additionalProperties === true,
    }
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length >= 2) {
    return { ...common, oneOf: schema.oneOf.map(item => schemaProperty(item)) }
  }
  return { ...common, type: 'json' }
}

function registerAppTools(ctx, capabilities, listed) {
  const tools = Array.isArray(listed?.tools) ? listed.tools : []
  for (const tool of tools) {
    if (typeof tool?.name !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(tool.name)) continue
    const rawSchema = tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : {}
    const properties = rawSchema.properties && typeof rawSchema.properties === 'object' ? rawSchema.properties : {}
    const requiredFields = new Set(Array.isArray(rawSchema.required) ? rawSchema.required : [])
    const parameters = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, schemaProperty(value, requiredFields.has(key))]))
    ctx.tools.register(defineTool({
      name: tool.name,
      description: String(tool.description || tool.name),
      parameters,
      output: textOutput,
      timeoutMs: tool.name === 'export_3d_scene_video' ? 900_000 : undefined,
      async execute(args) {
        const result = await invokeApp('call_harness_tool', {
          capabilities,
          name: tool.name,
          arguments: args,
        })
        if (result && typeof result === 'object' && 'content' in result) return String(result.content ?? '')
        return typeof result === 'string' ? result : JSON.stringify(result) ?? 'null'
      },
    }))
  }
}

export async function apply(ctx, config) {
  if (config.creation) registerCreationTools(ctx, config.allowPaid)
  const capabilities = [...new Set(config.capabilities.filter(item => item === 'media' || item === '3d'))]
  if (capabilities.length) {
    try {
      const listed = await invokeApp('list_harness_tools', { capabilities })
      registerAppTools(ctx, capabilities, listed)
    } catch (error) {
      console.error(`[jiucaihezi] 内置工具目录加载失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
