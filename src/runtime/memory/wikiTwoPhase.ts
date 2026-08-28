import {
  parseWikiReadPlan,
  parseWikiSynthesisAndChangePlan,
  WIKI_READ_PLAN_SYSTEM_PROMPT,
  WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT,
  type WikiReadPlan,
  type WikiSynthesisAndChangePlan,
} from './wikiPlans'
import type {
  DirectApiMessage,
  DirectRunMetrics,
  DirectToolCall,
  DirectToolExecutor,
} from '@/runtime/direct/directTypes'
import {
  resolveDirectCompletionText,
  runDirectChatCompletion,
  type DirectChatCompletionRequest,
} from '@/runtime/direct/directEngine'
import { validateTaskEnvelope, type TaskEnvelope } from '@/runtime/agent/taskProtocol'
import { createWikiAgentState, recordWikiRetrieval } from './wikiAgent'

const WIKI_AGENT = [{ id: 'wiki', readKinds: ['context'], actionKinds: ['apply'] }] as const

export interface WikiTwoPhaseResult {
  text: string
  plan: WikiSynthesisAndChangePlan
  metrics: DirectRunMetrics
  readPaths: string[]
  applyResult?: string
  envelope?: TaskEnvelope
}

function sumMetrics(first: DirectRunMetrics, second: DirectRunMetrics): DirectRunMetrics {
  return {
    modelRequests: first.modelRequests + second.modelRequests,
    modelRequestDurationMs: [...first.modelRequestDurationMs, ...second.modelRequestDurationMs],
    toolRounds: first.toolRounds + second.toolRounds,
    totalDurationMs: first.totalDurationMs + second.totalDurationMs,
  }
}

const EMPTY_METRICS: DirectRunMetrics = {
  modelRequests: 0,
  modelRequestDurationMs: [],
  toolRounds: 0,
  totalDurationMs: 0,
}

function normalizeWikiPath(path: string): string {
  return path
    .replace(/^[`./]+/, '')
    .replace(/^wiki\//, '')
    .replace(/\\/g, '/')
}

function explicitTaskPaths(task: string): Set<string> {
  return new Set(
    [...task.matchAll(/(?:wiki\/)?[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_.-]+)*\.md/gu)].map(match =>
      normalizeWikiPath(match[0]!),
    ),
  )
}

function indexedPaths(sourceText: string): Set<string> | null {
  const paths = new Set<string>()
  let parsed = 0
  for (const chunk of sourceText.split(/\n\n(?=\{)/u)) {
    let value: any
    try {
      value = JSON.parse(chunk)
    } catch {
      continue
    }
    const entries = [value?.entry, ...(Array.isArray(value?.sources) ? value.sources : [])].filter(
      item => item && typeof item === 'object',
    )
    for (const entry of entries) {
      parsed += 1
      const sourcePath = normalizeWikiPath(String(entry.path || ''))
      const base = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : ''
      const content = String(entry.content || '')
      for (const match of content.matchAll(/\[\[([^\]|#]+)|\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
        const raw = String(match[1] || match[2] || '').trim()
        if (!raw || raw.startsWith('http')) continue
        const target = normalizeWikiPath(raw)
        const resolved = target.includes('/') ? target : `${base}/${target}`.replace(/^\//, '')
        paths.add(resolved.endsWith('.md') ? resolved : `${resolved}.md`)
        if (!resolved.endsWith('/index.md')) paths.add(`${resolved.replace(/\.md$/i, '')}/index.md`)
      }
    }
  }
  return parsed && paths.size ? paths : null
}

async function requestJson(input: {
  messages: DirectApiMessage[]
  sendChatCompletion: (request: DirectChatCompletionRequest) => Promise<Response>
  signal?: AbortSignal
}): Promise<{ text: string; metrics: DirectRunMetrics }> {
  const result = await runDirectChatCompletion({
    messages: input.messages,
    sendChatCompletion: input.sendChatCompletion,
    onText: () => {},
    signal: input.signal,
    allowToolCalls: false,
    continueOnLength: false,
  })
  return {
    text: resolveDirectCompletionText(result.text, result.finishReason, '模型没有返回结构化计划'),
    metrics: result.metrics,
  }
}

export async function runWikiTwoPhase(input: {
  runId?: string
  messages: DirectApiMessage[]
  task: string
  entryResult: string
  sendChatCompletion: (request: DirectChatCompletionRequest) => Promise<Response>
  executeWiki: DirectToolExecutor
  signal?: AbortSignal
}): Promise<WikiTwoPhaseResult> {
  const state = createWikiAgentState({
    runId: input.runId || 'wiki-run',
    wikiRoot: 'wiki',
    requiresMutation: /(?:写入|创建|更新|填充|移动|整理|删除|修正)/u.test(input.task),
  })
  let sources = input.entryResult
  let latestObservation = input.entryResult
  let readPlan: WikiReadPlan = { paths: [], missing: [], sufficient: false }
  let readMetrics: DirectRunMetrics = EMPTY_METRICS
  const readPaths: string[] = []
  const maxReadRounds = 12
  let readStopReason: 'complete' | 'limit_reached' | 'failed' | 'stalled' = 'complete'
  const warnings: string[] = []
  let wikiToolRounds = 0
  const executeReadPaths = async (paths: string[]) => {
    if (!paths.length) return
    const signature = JSON.stringify([...paths].sort())
    if (!recordWikiRetrieval(state, signature, paths))
      throw new Error('相同 Wiki 读取计划已执行，拒绝重复读取')
    validateTaskEnvelope(
      {
        version: 1,
        runId: input.runId || 'wiki-run',
        source: 'program',
        status: 'needs_observation',
        capabilities: ['wiki'],
        reads: [{ id: 'wiki_read_plan', agent: 'wiki', kind: 'context', arguments: { paths } }],
        actions: [],
      },
      WIKI_AGENT,
      ['wiki'],
      'program',
    )
    const readCall: DirectToolCall = {
      id: 'wiki_read_plan',
      type: 'function',
      function: {
        name: 'wiki_context',
        arguments: JSON.stringify({ action: 'read', paths }),
      },
    }
    try {
      wikiToolRounds += 1
      const result = await input.executeWiki(readCall, input.signal)
      latestObservation = result.content || ''
      try {
        const payload = JSON.parse(result.content || '{}') as { missingRoutes?: unknown }
        if (Array.isArray(payload.missingRoutes))
          warnings.push(...payload.missingRoutes.filter(item => typeof item === 'string'))
      } catch {
        // Non-JSON tool output remains valid evidence; no structured warning to extract.
      }
      sources = [
        sources,
        result.status && result.status !== 'succeeded'
          ? `[Wiki 读取${result.status === 'cancelled' ? '已取消' : '失败'}]\n${result.content || '无详细信息'}`
          : result.content,
      ]
        .filter(Boolean)
        .join('\n\n')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('目录包含文件但缺少 index.md')) warnings.push(message)
      sources = [
        sources,
        `[Wiki 读取失败]\n${message}`,
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  }
  for (let round = 0; round < maxReadRounds; round += 1) {
    const readRequest = await requestJson({
      messages: [
        ...input.messages,
        { role: 'system', content: WIKI_READ_PLAN_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `当前任务：${input.task}\n已获得的 Wiki 资料：\n${sources}`,
        },
      ],
      sendChatCompletion: input.sendChatCompletion,
      signal: input.signal,
    })
    readMetrics = sumMetrics(readMetrics, readRequest.metrics)
    try {
      readPlan = parseWikiReadPlan(readRequest.text)
    } catch (error) {
      readPlan = {
        paths: [],
        missing: [`ReadPlan 无法解析：${error instanceof Error ? error.message : String(error)}`],
        sufficient: true,
      }
      readStopReason = 'failed'
    }
    let nextPaths = [...new Set(readPlan.paths.map(item => item.path))].filter(
      path => !readPaths.includes(path),
    )
    const authorized = indexedPaths(latestObservation)
    if (authorized) {
      const explicit = explicitTaskPaths(input.task)
      const unauthorized = nextPaths.filter(path => !authorized.has(path) && !explicit.has(path))
      if (unauthorized.length) {
        const warning = `未读取未被索引授权的路径：${unauthorized.join('、')}`
        readPlan.missing.push(warning)
        warnings.push(warning)
        sources = `${sources}\n\n[Wiki 索引缺失或路径未授权]\n${unauthorized.join('、')}`
        nextPaths = nextPaths.filter(path => !unauthorized.includes(path))
        readPlan.sufficient = true
        readPlan.status = 'complete'
        readStopReason = 'failed'
      }
    }
    readPaths.push(...nextPaths)
    if (nextPaths.length) {
      try {
        await executeReadPaths(nextPaths)
      } catch (error) {
        readStopReason = 'failed'
        sources = `${sources}\n\n[Wiki 读取失败]\n${error instanceof Error ? error.message : String(error)}`
        break
      }
    }
    if (!nextPaths.length || readPlan.sufficient) {
      if (!readPlan.sufficient) readStopReason = 'stalled'
      break
    }
  }
  if (readStopReason === 'complete' && !readPlan.sufficient) readStopReason = 'limit_reached'
  const readIncomplete = readStopReason !== 'complete'

  const synthesisRequest = await requestJson({
    messages: [
      ...input.messages,
      { role: 'system', content: WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `当前任务：${input.task}\nReadPlan：${JSON.stringify(readPlan)}\n实际 Wiki 资料：\n${sources}${readIncomplete ? `\n\n[Wiki 读取未完成：${readStopReason}，不得生成或执行写入计划]` : ''}`,
      },
    ],
    sendChatCompletion: input.sendChatCompletion,
    signal: input.signal,
  })
  let plan: WikiSynthesisAndChangePlan
  try {
    plan = parseWikiSynthesisAndChangePlan(synthesisRequest.text)
  } catch {
    return {
      text: [synthesisRequest.text, ...warnings].filter(Boolean).join('\n\n'),
      plan: { answer: synthesisRequest.text, changePlan: null },
      metrics: { ...sumMetrics(readMetrics, synthesisRequest.metrics), toolRounds: wikiToolRounds },
      readPaths,
    }
  }
  if (readIncomplete) {
    plan.answer = `${plan.answer}\n\n> Wiki 资料尚未读取完整（${readStopReason}），以上回答仅基于已读取内容。`
    plan.changePlan = null
  }
  if (warnings.length) plan.answer = `${plan.answer}\n\n> Wiki 提示：${[...new Set(warnings)].join('；')}`
  const metrics = {
    ...sumMetrics(readMetrics, synthesisRequest.metrics),
    toolRounds: wikiToolRounds,
  }
  if (!plan.changePlan) return { text: plan.answer, plan, metrics, readPaths }
  const changePlan = {
    ...plan.changePlan,
    reason: plan.changePlan.reason || input.task,
    basis: plan.changePlan.basis.length ? plan.changePlan.basis : readPaths,
  }
  plan.changePlan = changePlan
  const executionPlan = {
    reason: changePlan.reason,
    basis: changePlan.basis,
    operations: changePlan.operations,
  }

  const applyCall: DirectToolCall = {
    id: 'wiki_change_plan',
    type: 'function',
    function: {
      name: 'wiki',
      arguments: JSON.stringify({ action: 'apply', ...executionPlan }),
    },
  }
  state.pendingPlan = { action: 'apply', ...executionPlan }
  validateTaskEnvelope(
    {
      version: 1,
      runId: input.runId || 'wiki-run',
      source: 'program',
      status: 'ready_to_execute',
      capabilities: ['wiki'],
      reads: [],
      actions: [{ id: 'wiki_change_plan', agent: 'wiki', kind: 'apply', arguments: executionPlan }],
    },
    WIKI_AGENT,
    ['wiki'],
    'program',
  )
  let applied: Awaited<ReturnType<DirectToolExecutor>>
  try {
    wikiToolRounds += 1
    metrics.toolRounds += 1
    applied = await input.executeWiki(applyCall, input.signal)
  } catch (error) {
    return {
      text: plan.answer,
      plan,
      metrics,
      readPaths,
      applyResult: `status: failed\nreason: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (applied.status !== 'succeeded') {
    return {
      text: plan.answer,
      plan,
      metrics,
      readPaths,
      applyResult: `status: ${applied.status || 'failed'}\nreason: ${applied.content || 'Wiki 写入未完成'}`,
    }
  }
  state.applyResult = applied.content
  const envelope = validateTaskEnvelope(
    {
      version: 1,
      runId: input.runId || 'wiki-run',
      source: 'program',
      status: 'complete',
      capabilities: ['wiki'],
      reads: [],
      actions: [{ id: 'wiki_change_plan', agent: 'wiki', kind: 'apply', arguments: executionPlan }],
      observations: [
        {
          id: 'wiki_change_observation',
          actionId: 'wiki_change_plan',
          agent: 'wiki',
          ok: true,
          result: applied.content,
        },
      ],
      answer: plan.answer,
      receipt: { ok: true, completedActionIds: ['wiki_change_plan'], failedActionIds: [] },
    },
    WIKI_AGENT,
    ['wiki'],
    'program',
  )
  return { text: plan.answer, plan, metrics, readPaths, applyResult: applied.content, envelope }
}
