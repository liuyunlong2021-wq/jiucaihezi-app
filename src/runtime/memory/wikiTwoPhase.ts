import {
  parseWikiAgentStep,
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

async function requestJson(input: {
  messages: DirectApiMessage[]
  sendChatCompletion: (request: DirectChatCompletionRequest) => Promise<Response>
  signal?: AbortSignal
}): Promise<{ text: string; metrics: DirectRunMetrics }> {
  const run = async (messages: DirectApiMessage[]) => await runDirectChatCompletion({
    messages,
    sendChatCompletion: input.sendChatCompletion,
    onText: () => {},
    signal: input.signal,
    allowToolCalls: false,
    continueOnLength: false,
  })
  const result = await run(input.messages)
  if (!result.text.trim()) {
    const retry = await run([
      ...input.messages,
      {
        role: 'user',
        content: '上一响应没有可见结果。停止继续分析，立即只输出本轮要求的最小 JSON。',
      },
    ])
    return {
      text: resolveDirectCompletionText(retry.text, retry.finishReason, '模型没有返回结构化计划'),
      metrics: sumMetrics(result.metrics, retry.metrics),
    }
  }
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
  const referencedAnswer = /(?:上面|以上|上一条回答|前文)/u.test(input.task)
    ? [...input.messages].reverse().find(message => message.role === 'assistant')?.content
    : undefined
  const referencedAnswerText = typeof referencedAnswer === 'string' ? referencedAnswer.trim() : ''
  const taskContext = referencedAnswerText
    ? `当前任务：${input.task}\n待整理的上一条 assistant 回答：\n${referencedAnswerText}`
    : `当前任务：${input.task}`
  const state = createWikiAgentState({
    runId: input.runId || 'wiki-run',
    wikiRoot: 'wiki',
    requiresMutation: /(?:写入|填入|记录|沉淀|保存|归档|创建|更新|填充|移动|整理|删除|修正)/u.test(input.task),
  })
  let sources = input.entryResult
  let readPlan: WikiReadPlan = { paths: [], missing: [], sufficient: false }
  let readMetrics: DirectRunMetrics = EMPTY_METRICS
  let plan: WikiSynthesisAndChangePlan | null = null
  const readPaths: string[] = []
  const maxReadRounds = 12
  let readStopReason: 'complete' | 'limit_reached' | 'failed' | 'stalled' = 'complete'
  const warnings: string[] = []
  let wikiToolRounds = 0
  const executeReadPaths = async (paths: string[]) => {
    if (!paths.length) return
    const signature = JSON.stringify([...paths].sort())
    if (!recordWikiRetrieval(state, signature, paths)) {
      sources = `${sources}\n\n[Wiki 页面已经读取]\n${paths.join('、')}`
      return
    }
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
          content: `${taskContext}\n已获得的 Wiki 资料：\n${sources}`,
        },
      ],
      sendChatCompletion: input.sendChatCompletion,
      signal: input.signal,
    })
    readMetrics = sumMetrics(readMetrics, readRequest.metrics)
    try {
      const step = parseWikiAgentStep(readRequest.text)
      if (step.kind === 'final') {
        plan = step.plan
        readPlan = { paths: [], missing: [], sufficient: true, status: 'complete' }
        break
      }
      readPlan = step.plan
    } catch (error) {
      readPlan = {
        paths: [],
        missing: [`ReadPlan 无法解析：${error instanceof Error ? error.message : String(error)}`],
        sufficient: true,
      }
      readStopReason = 'failed'
    }
    const requestedPaths = [...new Set(readPlan.paths.map(item => item.path))]
    const repeatedPaths = requestedPaths.filter(path => readPaths.includes(path))
    let nextPaths = requestedPaths.filter(path => !readPaths.includes(path))
    if (repeatedPaths.length)
      sources = `${sources}\n\n[Wiki 页面已经读取]\n${repeatedPaths.join('、')}`
    if (!nextPaths.length && !readPlan.sufficient && (repeatedPaths.length || readPlan.paths.length))
      continue
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

  let synthesisMetrics = EMPTY_METRICS
  if (!plan) {
    const synthesisRequest = await requestJson({
      messages: [
        ...input.messages,
        { role: 'system', content: WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `${taskContext}\nReadPlan：${JSON.stringify(readPlan)}\n实际 Wiki 资料：\n${sources}${readIncomplete ? `\n\n[Wiki 读取未完成：${readStopReason}。请基于现有真实资料完成任务，资料不足时如实说明。]` : ''}`,
        },
      ],
      sendChatCompletion: input.sendChatCompletion,
      signal: input.signal,
    })
    synthesisMetrics = synthesisRequest.metrics
    try {
      plan = parseWikiSynthesisAndChangePlan(synthesisRequest.text)
    } catch (error) {
      const failure = `Wiki 写入未执行：模型返回的修改计划无法解析（${error instanceof Error ? error.message : String(error)}）。`
      return {
        text: [failure, ...warnings].filter(Boolean).join('\n\n'),
        plan: { answer: failure, changePlan: null },
        metrics: { ...sumMetrics(readMetrics, synthesisMetrics), toolRounds: wikiToolRounds },
        readPaths,
        applyResult: `status: failed\nreason: ${failure}`,
      }
    }
  }
  if (readIncomplete) {
    plan.answer = `${plan.answer}\n\n> Wiki 资料尚未读取完整（${readStopReason}），以上回答仅基于已读取内容。`
  }
  if (warnings.length) plan.answer = `${plan.answer}\n\n> Wiki 提示：${[...new Set(warnings)].join('；')}`
  const metrics = {
    ...sumMetrics(readMetrics, synthesisMetrics),
    toolRounds: wikiToolRounds,
  }
  if (!plan.changePlan) return { text: plan.answer, plan, metrics, readPaths }
  const changePlan = {
    ...plan.changePlan,
    reason: plan.changePlan.reason || input.task,
    basis: plan.changePlan.basis.length ? plan.changePlan.basis : readPaths,
  }
  plan.changePlan = changePlan
  let executionPlan = {
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
    applied = {
      content: error instanceof Error ? error.message : String(error),
      status: 'failed',
    }
  }
  // Models sometimes describe an edit as create/write. Give them one bounded
  // correction round; the program still refuses unsafe overwrites.
  if (applied.status !== 'succeeded' && /页面已存在|已存在/u.test(applied.content || '') && plan.changePlan) {
    const correction = await requestJson({
      messages: [
        ...input.messages,
        { role: 'system', content: WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `${taskContext}\n实际 Wiki 资料：\n${sources}\n上一次写入计划被程序拒绝：目标页面已存在，不能使用 write/create 覆盖。请将已有页面的修改改为 edit，逐字提供 oldText 和 newText；只输出最小 JSON。`,
        },
      ],
      sendChatCompletion: input.sendChatCompletion,
      signal: input.signal,
    })
    synthesisMetrics = sumMetrics(synthesisMetrics, correction.metrics)
    try {
      const corrected = parseWikiSynthesisAndChangePlan(correction.text)
      if (corrected.changePlan) {
        plan = corrected
        const correctedPlan = {
          ...corrected.changePlan,
          reason: corrected.changePlan.reason || input.task,
          basis: corrected.changePlan.basis.length ? corrected.changePlan.basis : readPaths,
        }
        plan.changePlan = correctedPlan
        executionPlan = {
          reason: correctedPlan.reason,
          basis: correctedPlan.basis,
          operations: correctedPlan.operations,
        }
        state.pendingPlan = { action: 'apply', ...executionPlan }
        applyCall.function.arguments = JSON.stringify({
          action: 'apply',
          reason: correctedPlan.reason,
          basis: correctedPlan.basis,
          operations: correctedPlan.operations,
        })
        wikiToolRounds += 1
        metrics.toolRounds += 1
        applied = await input.executeWiki(applyCall, input.signal)
      }
    } catch {
      // Keep the original failure receipt below when correction is malformed.
    }
  }
  const replaceOperations = executionPlan.operations.filter(operation => operation.kind === 'replace')
  if (
    applied.status !== 'succeeded' &&
    /多处命中.*replaceAll/u.test(applied.content || '') &&
    executionPlan.operations.length === 1 &&
    replaceOperations.length === 1 &&
    replaceOperations[0]!.replaceAll !== true
  ) {
    executionPlan = {
      ...executionPlan,
      operations: [{ ...replaceOperations[0]!, replaceAll: true }],
    }
    plan.changePlan = { ...plan.changePlan!, operations: executionPlan.operations }
    state.pendingPlan = { action: 'apply', ...executionPlan }
    applyCall.function.arguments = JSON.stringify({ action: 'apply', ...executionPlan })
    wikiToolRounds += 1
    metrics.toolRounds += 1
    applied = await input.executeWiki(applyCall, input.signal)
  }
  if (applied.status !== 'succeeded') {
    const cancelled = applied.status === 'cancelled'
    const failure = cancelled
      ? 'Wiki 写入已取消。'
      : `Wiki 写入未执行：${applied.content || 'Wiki 写入未完成'}`
    return {
      text: failure,
      plan: { ...plan, answer: failure },
      metrics: { ...sumMetrics(readMetrics, synthesisMetrics), toolRounds: wikiToolRounds },
      readPaths,
      applyResult: `status: ${cancelled ? 'cancelled' : 'failed'}\nreason: ${failure}`,
    }
  }
  const finalMetrics = { ...sumMetrics(readMetrics, synthesisMetrics), toolRounds: wikiToolRounds }
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
  return { text: plan.answer, plan, metrics: finalMetrics, readPaths, applyResult: applied.content, envelope }
}
