import { buildHeaders, resolveApiConfig, resolveLocalOllamaApiConfig } from '@/utils/api'
import { safeFetch } from '@/utils/httpClient'
import { LOCAL_OLLAMA_PROVIDER_ID, resolveModelProviderId } from '@/utils/providerConfig'
import { useAgentStore } from '@/stores/agentStore'
import { useFileStore } from '@/composables/useFileStore'
import type { CanvasLlmNodeData, CanvasNode } from '@/types/canvas'
import { buildFinalPrompt, mergePromptInputs } from './canvasInputs'

/** Skill SKILL.md 最大允许大小（防止超大内容注入） */
const MAX_SKILL_SIZE = 50_000
/** skill:// URI 允许的 ID 格式：仅字母数字、连字符、下划线、斜杠 */
const SKILL_ID_PATTERN = /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/

async function resolveSkillPrompt(raw: string | undefined, fallbackName = 'Skill'): Promise<string> {
  const content = String(raw || '').trim()
  if (!content.startsWith('skill://')) return content

  const skillId = content.replace('skill://', '').trim()

  // 白名单校验：skill ID 只允许安全字符，防止路径遍历
  if (!SKILL_ID_PATTERN.test(skillId)) {
    return `## ${fallbackName}\n\nSkill标识无效，使用默认角色完成用户任务。`
  }

  // 优先从 agentStore 查找已缓存的Skill内容（已验证/已加载）
  try {
    const agentStore = useAgentStore()
    const cached = agentStore.agents.find(
      a => a.id === skillId || a.skillContent === content,
    )
    if (cached?.skillContent && !cached.skillContent.startsWith('skill://')) {
      const text = String(cached.skillContent).trim()
      if (text.length <= MAX_SKILL_SIZE) return text
    }
  } catch { /* store 不可用时继续 */ }

  // 仅允许从 app 自身的 public/skills/ 目录加载预设Skill
  try {
    const safePath = `/skills/${skillId}/SKILL.md`
    const res = await fetch(safePath)
    if (!res.ok) throw new Error('Skill not found')

    // 校验响应类型必须是文本
    const contentType = (res.headers.get('content-type') || '').toLowerCase()
    if (contentType && !contentType.includes('text/') && !contentType.includes('markdown')) {
      throw new Error('Invalid content type')
    }

    const text = await res.text()
    if (text.length > MAX_SKILL_SIZE) {
      throw new Error('Skill too large')
    }
    return text
  } catch {
    return `## ${fallbackName}\n\n请按这个Skill的角色要求完成用户任务。`
  }
}

export async function runCanvasLlmNode(input: {
  node: CanvasNode
  nodes: CanvasNode[]
  edges: any[]
  /** 流式回调，接收累积的完整内容（每个 token 到达后调用） */
  onToken?: (accumulated: string) => void
}): Promise<{ content: string; fileId?: string }> {
  const data = input.node.data as CanvasLlmNodeData
  const merged = await mergePromptInputs(input.nodes, input.edges, input.node.id)
  const finalPrompt = buildFinalPrompt(merged.text, data.prompt)
  if (!finalPrompt.trim()) throw new Error('这个 AI 文本节点没有输入内容。')

  const agentStore = useAgentStore()
  const skill = data.agentId ? agentStore.agents.find(item => item.id === data.agentId) : null
  let systemPrompt = data.systemPrompt
    || await resolveSkillPrompt(skill?.skillContent, skill?.name)
    || '你是韭菜盒子的Skill，请用中文回复。'
  if (merged.missing.length) {
    systemPrompt += `\n\n以下画布输入缺失，回答时不要假装读到了它们：${merged.missing.join('、')}`
  }

  const modelFromStore = data.modelId
    ? agentStore.availableModels.find(item => item.id === data.modelId)
    : null
  const providerId = data.modelId
    ? resolveModelProviderId(modelFromStore || data.modelId)
    : data.modelProviderId
  const config = providerId === LOCAL_OLLAMA_PROVIDER_ID
    ? await resolveLocalOllamaApiConfig(data.modelId)
    : data.modelId
      ? await resolveApiConfig({ forceCloud: true })
      : await resolveApiConfig()
  if (data.modelId && config.providerId !== LOCAL_OLLAMA_PROVIDER_ID) config.model = data.modelId

  const content = config.providerId === LOCAL_OLLAMA_PROVIDER_ID
    ? await callOllama(config.apiBase, config.model, systemPrompt, finalPrompt)
    : input.onToken
      ? await callOpenAiCompatibleStream(config, systemPrompt, finalPrompt, input.onToken)
      : await callOpenAiCompatible(config, systemPrompt, finalPrompt)

  const fileStore = useFileStore()
  const file = await fileStore.addText(`${data.label || 'AI 文本'}.md`, content)
  return { content, fileId: file.id }
}

async function callOpenAiCompatible(
  config: { apiBase: string; model: string; apiKey: string; providerId: string },
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const res = await safeFetch(`${config.apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 8192,
      stream: false,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AI 文本生成失败：${res.status} ${text.slice(0, 180)}`)
  }
  const data = await res.json()
  return String(data?.choices?.[0]?.message?.content || data?.choices?.[0]?.message?.reasoning_content || '').trim()
}

async function callOpenAiCompatibleStream(
  config: { apiBase: string; model: string; apiKey: string; providerId: string },
  systemPrompt: string,
  userPrompt: string,
  onToken: (accumulated: string) => void,
): Promise<string> {
  const res = await safeFetch(`${config.apiBase}/v1/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(config),
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 8192,
      stream: true,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`AI 文本生成失败：${res.status} ${text.slice(0, 180)}`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('流式响应不可读')
  const decoder = new TextDecoder()
  let accumulated = ''
  let buffer = ''
  let streamDone = false
  try {
    while (!streamDone) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') { streamDone = true; break }
        try {
          const parsed = JSON.parse(data)
          const delta = String(parsed?.choices?.[0]?.delta?.content || '')
          if (delta) {
            accumulated += delta
            onToken(accumulated)
          }
        } catch { /* 忽略非 JSON 行 */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
  return accumulated.trim()
}

async function callOllama(apiBase: string, model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch(`${apiBase.replace(/\/+$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      keep_alive: '10m',
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Ollama 生成失败：${res.status} ${text.slice(0, 180)}`)
  }
  const data = await res.json()
  return String(data?.message?.content || data?.response || '').trim()
}
