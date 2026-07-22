import assert from 'node:assert/strict'
import { test } from 'node:test'

import { projectNewApiForOpenCode, projectStoredNewApiForOpenCode, toOpenCodeModelProjection } from '../providerProjection'

const models = [
  { id: 'claude-sonnet-4-6', label: 'Claude', providerId: 'jiucaihezi' as const, capability: 'text' as const },
  { id: 'gpt-image-2', label: 'Image', providerId: 'jiucaihezi' as const, capability: 'image' as const },
]

test('projects dao as a minimal primary Agent with its model-first prompt', () => {
  const config = projectNewApiForOpenCode({
    currentModel: 'claude-sonnet-4-6',
    models,
    apiKey: 'sk-test',
  })

  const dao = (config as any).agent.dao
  assert.deepEqual(Object.keys(dao).sort(), ['description', 'mode', 'name', 'permission', 'prompt'])
  assert.equal(dao.name, 'dao')
  assert.equal(dao.description, '模型优先的韭菜盒子道模式')
  assert.equal(dao.mode, 'primary')
  assert.deepEqual(dao.permission, { question: 'allow' })
  assert.equal(dao.prompt, `你是韭菜盒子道模式。当前模型原生能力优先；工具、Skill 和 MCP 只在确有需要或用户明确要求时使用，不能成为模型直接回答的门槛。

1. 当任务涉及当前项目的事实、历史、架构、设定或连续性时，先查询项目 Wiki；没有 Wiki 或任务无关时直接继续。
2. 精准修改，只改变完成目标必须改变的内容。
3. 目标驱动执行，明确成功标准并持续工作，直到验证通过。
4. 需要行动时，可以主动使用 grep、glob、read 调查，使用 edit、write、bash 修改和执行，不能只讲方案。
5. 不输出、记录或泄露密钥和敏感信息；需要处理时只确认存在性并脱敏。破坏性操作和外部发布必须先获得用户授权。
6. 极简优先，采用满足目标的最简单方案；回复保持简洁，但用户要求的正文和交付物必须完整。`)
})

test('projects Jiucai NewAPI text models into OpenCode provider config', () => {
  const config = projectNewApiForOpenCode({
    currentModel: 'claude-sonnet-4-6',
    models,
    apiKey: 'sk-test',
  })

  assert.deepEqual(config.enabled_providers, ['jiucaihezi'])
  assert.equal(config.model, 'jiucaihezi/claude-sonnet-4-6')
  const provider = config.provider.jiucaihezi as any
  assert.equal(provider.npm, '@ai-sdk/openai-compatible')
  assert.equal(provider.api, 'https://api.jiucaihezi.studio/v1')
  assert.equal(provider.options.apiKey, 'sk-test')
  assert.ok(provider.models['claude-sonnet-4-6'])
  assert.equal(provider.models['claude-sonnet-4-6'].limit.context, 1_000_000)
  assert.equal(provider.models['claude-sonnet-4-6'].limit.output, 0)
  assert.equal(provider.models['claude-sonnet-4-6'].provider, undefined)
  assert.equal(provider.models['gpt-image-2'], undefined)
})

test('projects declared model input modalities instead of inferring every attachment from vision', () => {
  const config = projectNewApiForOpenCode({
    currentModel: 'gemini-3.5-flash',
    models: [{
      id: 'gemini-3.5-flash',
      label: 'Gemini',
      providerId: 'jiucaihezi',
      capability: 'text',
      inputModalities: ['text', 'image', 'video', 'audio', 'file'],
    }],
    apiKey: 'sk-test',
  })

  const model = (config.provider.jiucaihezi as any).models['gemini-3.5-flash']
  assert.deepEqual(model.modalities.input, ['text', 'image', 'video', 'audio', 'pdf'])
  assert.equal(model.provider, undefined)
})

test('projects a safe context limit for unknown text models so OpenCode can auto-compact', () => {
  const config = projectNewApiForOpenCode({
    currentModel: 'provider/unknown-text-model',
    models: [{ id: 'provider/unknown-text-model', label: 'Unknown', providerId: 'jiucaihezi', capability: 'text' }],
    apiKey: 'sk-test',
  })

  const model = (config.provider.jiucaihezi as any).models['provider/unknown-text-model']
  assert.equal(model.limit.context, 128_000)
  assert.equal(model.limit.output, 0)
})

test('account session without scoped key is explicit Wave 2 blocker', () => {
  assert.throws(
    () => projectNewApiForOpenCode({
      currentModel: 'claude-sonnet-4-6',
      models,
      apiKey: '',
      gatewaySessionToken: 'sess-user',
    }),
    /短期 NewAPI API Key/,
  )
})

test('maps selected model to OpenCode SDK model projection', () => {
  assert.deepEqual(toOpenCodeModelProjection('claude-sonnet-4-6'), {
    providerID: 'jiucaihezi',
    modelID: 'claude-sonnet-4-6',
  })
})

test('projects Ollama-only catalog without requiring NewAPI auth', async () => {
  const config = await projectStoredNewApiForOpenCode({
    currentModel: 'gpt-oss:20b',
    models: [
      { id: 'gpt-oss:20b', label: 'GPT OSS 20B', providerId: 'local-ollama', capability: 'text' },
    ],
  })

  assert.deepEqual(config.enabled_providers, ['local-ollama'])
  assert.equal(config.model, 'local-ollama/gpt-oss:20b')
  assert.equal(config.provider.jiucaihezi, undefined)
  const provider = config.provider['local-ollama'] as any
  assert.equal(provider.api, 'http://127.0.0.1:11434/v1')
  assert.equal(provider.options.apiKey, undefined)
  assert.equal(provider.models['gpt-oss:20b'].tool_call, true)
})

test('keeps local Ollama thinking opt-in instead of enabling it by default', () => {
  const config = projectNewApiForOpenCode({
    currentModel: 'qwen3.6:35b-a3b',
    models: [
      { id: 'qwen3.6:35b-a3b', label: 'Qwen', providerId: 'local-ollama', capability: 'text' },
    ],
    apiKey: '',
  })

  const model = (config.provider['local-ollama'] as any).models['qwen3.6:35b-a3b']
  assert.deepEqual(model.options, { reasoning_effort: 'none' })
})

test('advertises native tool calls for tool-capable cloud models', () => {
  const config = projectNewApiForOpenCode({
    currentModel: 'tencent/hy3:free',
    models: [
      { id: 'tencent/hy3:free', label: 'HY3', providerId: 'jiucaihezi', capability: 'text' },
      { id: 'deepseek-v4-flash', label: 'DeepSeek Flash', providerId: 'jiucaihezi', capability: 'text' },
      { id: 'claude-sonnet-4-6', label: 'Claude', providerId: 'jiucaihezi', capability: 'text' },
    ],
    apiKey: 'sk-test',
  })

  const models = (config.provider.jiucaihezi as any).models
  assert.equal(models['tencent/hy3:free'].tool_call, true)
  assert.equal(models['deepseek-v4-flash'].tool_call, true)
  assert.equal(models['claude-sonnet-4-6'].tool_call, true)
})

test('uses current local model as OpenCode default when cloud models are also present', () => {
  const config = projectNewApiForOpenCode({
    currentModel: 'gpt-oss:20b',
    models: [
      ...models,
      { id: 'gpt-oss:20b', label: 'GPT OSS 20B', providerId: 'local-ollama', capability: 'text' },
    ],
    apiKey: 'sk-test',
  })

  assert.deepEqual(config.enabled_providers, ['jiucaihezi', 'local-ollama'])
  assert.equal(config.model, 'local-ollama/gpt-oss:20b')
})

test('selected Ollama model ignores cached cloud catalog when NewAPI auth is missing', async () => {
  const config = await projectStoredNewApiForOpenCode({
    currentModel: 'gpt-oss:20b',
    gatewaySessionToken: 'sess-user',
    models: [
      ...models,
      { id: 'gpt-oss:20b', label: 'GPT OSS 20B', providerId: 'local-ollama', capability: 'text' },
    ],
  })

  assert.deepEqual(config.enabled_providers, ['local-ollama'])
  assert.equal(config.model, 'local-ollama/gpt-oss:20b')
  assert.equal(config.provider.jiucaihezi, undefined)
})
