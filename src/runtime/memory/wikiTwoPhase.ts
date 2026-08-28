import {
  parseWikiReadPlan,
  parseWikiSynthesisAndChangePlan,
  WIKI_READ_PLAN_SYSTEM_PROMPT,
  WIKI_SYNTHESIS_CHANGE_PLAN_SYSTEM_PROMPT,
  type WikiSynthesisAndChangePlan,
} from './wikiPlans'
import type {
  DirectApiMessage,
  DirectRunMetrics,
  DirectToolCall,
  DirectToolExecutor,
} from '@/runtime/direct/directTypes'
import { resolveDirectCompletionText, runDirectChatCompletion, type DirectChatCompletionRequest } from '@/runtime/direct/directEngine'
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
      { role: 'user', content: `当前任务：${input.task}\nWiki 根入口实际内容：\n${input.entryResult}` },
    ],
    sendChatCompletion: input.sendChatCompletion,
    signal: input.signal,
  })
  let readPlan = parseWikiReadPlan(readRequest.text)
  let readMetrics = readRequest.metrics
  let readPaths = [...new Set(readPlan.paths.map(item => item.path))]
  let sources = input.entryResult
  const executeReadPaths = async (paths: string[]) => {
    if (!paths.length) return
    const signature = JSON.stringify([...paths].sort())
    if (!recordWikiRetrieval(state, signature, paths)) throw new Error('相同 Wiki 读取计划已执行，拒绝重复读取')
    validateTaskEnvelope({
      version: 1,
      runId: input.runId || 'wiki-run',
      source: 'program',
      status: 'needs_observation',
      capabilities: ['wiki'],
      reads: [{ id: 'wiki_read_plan', agent: 'wiki', kind: 'context', arguments: { paths } }],
      actions: [],
    }, WIKI_AGENT, ['wiki'], 'program')
    const readCall: DirectToolCall = {
      id: 'wiki_read_plan',
      type: 'function',
      function: {
        name: 'wiki_context',
        arguments: JSON.stringify({ action: 'read', paths }),
      },
    }
    const result = await input.executeWiki(readCall, input.signal)
    if (result.status !== 'succeeded') throw new Error(result.content || 'Wiki 读取未完成')
    sources = [sources, result.content].filter(Boolean).join('\n\n')
  }
  await executeReadPaths(readPaths)

  if (!readPlan.sufficient) {
    const supplement = await requestJson({
      messages: [
        ...input.messages,
        { role: 'system', content: WIKI_READ_PLAN_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `当前任务：${input.task}\n首次 ReadPlan：${JSON.stringify(readPlan)}\n已读取入口和资料：\n${sources}\n请只补充首次计划遗漏且确实必要的页面；若仍不足，保留 missing 并将 sufficient 设为 false。`,
        },
      ],
      sendChatCompletion: input.sendChatCompletion,
      signal: input.signal,
    })
    readMetrics = sumMetrics(readMetrics, supplement.metrics)
    const supplementPlan = parseWikiReadPlan(supplement.text)
    const additionalPaths = supplementPlan.paths
      .map(item => item.path)
      .filter(path => !readPaths.includes(path))
    await executeReadPaths(additionalPaths)
    readPaths = [...new Set([...readPaths, ...additionalPaths])]
    const unresolvedMissing = readPlan.missing.filter(missing => {
      const needle = missing.toLowerCase().replace(/\\/g, '/')
      return !additionalPaths.some(path => {
        const normalized = path.toLowerCase().replace(/\\/g, '/')
        const missingName = needle.split('/').at(-1) || needle
        return normalized === needle || normalized.endsWith(`/${needle}`) || normalized.includes(missingName)
      })
    })
    readPlan = {
      paths: [...readPlan.paths, ...supplementPlan.paths.filter(item => additionalPaths.includes(item.path))],
      missing: [...new Set([...unresolvedMissing, ...supplementPlan.missing])],
      sufficient: supplementPlan.sufficient && additionalPaths.length > 0 && unresolvedMissing.length === 0,
    }
    if (!readPlan.sufficient) throw new Error(`Wiki 资料不足：${readPlan.missing.join('、') || '缺少必要页面'}`)
  }

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
  const plan = parseWikiSynthesisAndChangePlan(synthesisRequest.text)
  const metrics = sumMetrics(readMetrics, synthesisRequest.metrics)
  if (!plan.changePlan) return { text: plan.answer, plan, metrics, readPaths }
  validateDeclaredIndexChanges(plan.changePlan)

  const applyCall: DirectToolCall = {
    id: 'wiki_change_plan',
    type: 'function',
    function: {
      name: 'wiki',
      arguments: JSON.stringify({ action: 'apply', ...plan.changePlan }),
    },
  }
  state.pendingPlan = { action: 'apply', ...plan.changePlan }
  validateTaskEnvelope({
    version: 1,
    runId: input.runId || 'wiki-run',
    source: 'program',
    status: 'ready_to_execute',
    capabilities: ['wiki'],
    reads: [],
    actions: [{ id: 'wiki_change_plan', agent: 'wiki', kind: 'apply', arguments: plan.changePlan }],
  }, WIKI_AGENT, ['wiki'], 'program')
  const applied = await input.executeWiki(applyCall, input.signal)
  if (applied.status !== 'succeeded') throw new Error(applied.content || 'Wiki 写入未完成')
  state.applyResult = applied.content
  const envelope = validateTaskEnvelope({
    version: 1,
    runId: input.runId || 'wiki-run',
    source: 'program',
    status: 'complete',
    capabilities: ['wiki'],
    reads: [],
    actions: [{ id: 'wiki_change_plan', agent: 'wiki', kind: 'apply', arguments: plan.changePlan }],
    observations: [{ id: 'wiki_change_observation', actionId: 'wiki_change_plan', agent: 'wiki', ok: true, result: applied.content }],
    answer: plan.answer,
    receipt: { ok: true, completedActionIds: ['wiki_change_plan'], failedActionIds: [] },
  }, WIKI_AGENT, ['wiki'], 'program')
  return { text: plan.answer, plan, metrics, readPaths, applyResult: applied.content, envelope }
}

function validateDeclaredIndexChanges(changePlan: WikiSynthesisAndChangePlan['changePlan']): void {
  if (!changePlan) return
  const declared = changePlan.indexChanges
  for (const operation of changePlan.operations) {
    const expectedDirectory = operation.kind === 'move'
      ? operation.destination.split('/').slice(0, -1).join('/') || '.'
      : operation.path.split('/').slice(0, -1).join('/') || '.'
    const directoryMatches = (item: { directory: string; path: string }) => item.directory === expectedDirectory
    if (operation.kind === 'create' && !declared.some(item => item.action === 'add' && item.path === operation.path))
      throw new Error(`Wiki 计划缺少新增页面的 indexChanges: ${operation.path}`)
    if ((operation.kind === 'create' || operation.kind === 'move') && !declared.some(directoryMatches))
      throw new Error(`Wiki 计划的 indexChanges.directory 与目标目录不一致: ${operation.path}`)
    if (operation.kind === 'trash' && !declared.some(item => item.action === 'remove' && item.path === operation.path))
      throw new Error(`Wiki 计划缺少移除页面的 indexChanges: ${operation.path}`)
    if (operation.kind === 'move' && operation.path.endsWith('.md')) {
      if (!declared.some(item => item.action === 'remove' && item.path === operation.path))
        throw new Error(`Wiki 计划缺少移动源页面的 indexChanges: ${operation.path}`)
      if (!declared.some(item => item.action === 'add' && item.path === operation.destination))
        throw new Error(`Wiki 计划缺少移动目标页面的 indexChanges: ${operation.destination}`)
    }
  }
}
