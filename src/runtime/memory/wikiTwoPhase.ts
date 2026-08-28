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
  const readRequest = await requestJson({
    messages: [
      ...input.messages,
      { role: 'system', content: WIKI_READ_PLAN_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `当前任务：${input.task}\nWiki 根入口实际内容：\n${input.entryResult}`,
      },
    ],
    sendChatCompletion: input.sendChatCompletion,
    signal: input.signal,
  })
  let readPlan: WikiReadPlan
  try {
    readPlan = parseWikiReadPlan(readRequest.text)
  } catch (error) {
    readPlan = {
      paths: [],
      missing: [`ReadPlan 无法解析：${error instanceof Error ? error.message : String(error)}`],
      sufficient: true,
    }
  }
  let readMetrics = readRequest.metrics
  let readPaths = [...new Set(readPlan.paths.map(item => item.path))]
  let sources = input.entryResult
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
      const result = await input.executeWiki(readCall, input.signal)
      sources = [
        sources,
        result.status && result.status !== 'succeeded'
          ? `[Wiki 读取${result.status === 'cancelled' ? '已取消' : '失败'}]\n${result.content || '无详细信息'}`
          : result.content,
      ]
        .filter(Boolean)
        .join('\n\n')
    } catch (error) {
      sources = [
        sources,
        `[Wiki 读取失败]\n${error instanceof Error ? error.message : String(error)}`,
      ]
        .filter(Boolean)
        .join('\n\n')
    }
  }
  await executeReadPaths(readPaths)

  const synthesisRequest = await requestJson({
    messages: [
      ...input.messages,
      { role: 'system', content: WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `当前任务：${input.task}\nReadPlan：${JSON.stringify(readPlan)}\n实际 Wiki 资料：\n${sources}`,
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
      text: synthesisRequest.text,
      plan: { answer: synthesisRequest.text, changePlan: null },
      metrics: sumMetrics(readMetrics, synthesisRequest.metrics),
      readPaths,
    }
  }
  const metrics = sumMetrics(readMetrics, synthesisRequest.metrics)
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
