import type { DirectToolCall } from '@/runtime/direct/directTypes'
import {
  aggregateBenchmark,
  analyzeSkillComparison,
  compareSkillOutputs,
  generateEvalViewerHtml,
  improveSkillDescription,
  packageSkillDraft,
  runSkillTests,
  validateSkillDraft,
  type BenchmarkData,
  type SingleTestResult,
  type SkillTestToolCall,
  type SkillTestToolResult,
} from '@/utils/skillTestRunner'
import { appendSkillCreatorHistory, loadSkillCreatorFeedback, persistSkillCreatorFeedback, persistSkillCreatorReviewWorkspace, persistSkillCreatorWorkspaceArtifact } from '@/utils/skillCreatorWorkspace'
import { getSkillBuilderDraft, registerSkillBuilderDraft, SkillBuilderDraftError } from '@/utils/skillBuilderTools'
import { skillCreatorRuntime, shouldUseSkillCreatorRuntime } from '@/runtime/tools/skillCreatorRuntime'

const TOOL_NAMES = new Set([
  'skill_creator_load_installed_skill',
  'skill_creator_validate',
  'run_skill_tests',
  'skill_creator_aggregate_benchmark',
  'skill_creator_open_eval_review',
  'skill_creator_submit_eval_feedback',
  'skill_creator_load_eval_feedback',
  'skill_creator_compare_outputs',
  'skill_creator_analyze_comparison',
  'skill_creator_improve_description',
  'skill_creator_package',
  'save_skill',
])

type StoredRun = { results: SingleTestResult[]; previousResults?: SingleTestResult[]; benchmark: BenchmarkData; skillName: string; skillMd: string; draftId: string; iteration: number }
const runs = new Map<string, StoredRun>()
const installedSnapshots = new Map<string, SkillCreatorInstalledSkill>()
const comparisons = new Map<string, Record<string, unknown>>()

export interface SkillCreatorInstalledSkill {
  skillId: string
  skillMd: string
  files: string[]
  source: string
  editable: boolean
}

interface SkillCreatorToolContext {
  agentId?: string
  sessionId?: string
  userInput?: string
  signal?: AbortSignal
  loadInstalledSkill?: (skillId: string) => Promise<SkillCreatorInstalledSkill | null>
  testToolAdapter?: {
    tools: unknown[]
    execute: (call: SkillTestToolCall, signal?: AbortSignal) => Promise<SkillTestToolResult>
  }
}

export function isSkillCreatorToolName(name: string): boolean {
  return TOOL_NAMES.has(String(name || '').trim())
}

export async function executeSkillCreatorToolCall(
  call: DirectToolCall,
  context: SkillCreatorToolContext,
): Promise<string> {
  const args = parseArgs(call.function.arguments)
  const runtimeContext = {
    agentId: context.agentId,
    sessionId: context.sessionId,
    userInput: context.userInput,
  }
  const gate = shouldUseSkillCreatorRuntime(runtimeContext)
    ? skillCreatorRuntime.beforeToolCall({ toolName: call.function.name, args, context: runtimeContext })
    : { allowed: true }
  if (!gate.allowed) return JSON.stringify({ status: 'error', errorCode: 'errorCode' in gate ? gate.errorCode : undefined, message: 'message' in gate ? gate.message : undefined, nextStep: 'nextStep' in gate ? gate.nextStep : undefined })

  try {
    const result = await execute(call.function.name, args, context)
    if (shouldUseSkillCreatorRuntime(runtimeContext))
      skillCreatorRuntime.afterToolResult({ toolName: call.function.name, args, context: runtimeContext, result: JSON.parse(result) })
    return result
  } catch (error) {
    const result = JSON.stringify({
      status: 'error',
      errorCode: error instanceof SkillDraftError || error instanceof SkillBuilderDraftError ? error.code : undefined,
      message: error instanceof Error ? error.message : String(error),
    })
    if (shouldUseSkillCreatorRuntime(runtimeContext))
      skillCreatorRuntime.afterToolResult({ toolName: call.function.name, args, context: runtimeContext, result: JSON.parse(result) })
    return result
  }
}

async function execute(name: string, args: Record<string, any>, context: SkillCreatorToolContext): Promise<string> {
  if (name === 'skill_creator_load_installed_skill') {
    const skillId = String(args.skill_id || '').trim()
    if (!skillId) return JSON.stringify({ status: 'error', errorCode: 'SKILL_ID_REQUIRED', message: '请提供要修改的 Skill ID。' })
    if (!context.loadInstalledSkill) return JSON.stringify({ status: 'error', errorCode: 'SKILL_LOOKUP_UNAVAILABLE', message: '当前平台无法读取已安装 Skill。' })
    const skill = await context.loadInstalledSkill(skillId)
    if (!skill) return JSON.stringify({ status: 'error', errorCode: 'SKILL_NOT_INSTALLED', message: `「我的 Skill」中找不到 ${skillId}。` })
    if (!skill.editable) return JSON.stringify({ status: 'error', errorCode: 'SKILL_READ_ONLY', message: `${skill.skillId} 是只读 Skill，请先定制到「我的 Skill」。` })
    if (!skill.skillMd.trim()) return JSON.stringify({ status: 'error', errorCode: 'SKILL_CONTENT_EMPTY', message: `${skill.skillId} 的 SKILL.md 为空。` })
    installedSnapshots.set(`${context.sessionId || 'unsaved-session'}::${skill.skillId}`, skill)
    return JSON.stringify({
      status: 'ok',
      target_skill_id: skill.skillId,
      skill_md: skill.skillMd,
      files: [...new Set(['SKILL.md', ...skill.files.map(String).filter(Boolean)])],
      source: skill.source,
    })
  }
  const testId = String(args.test_id || args.run_id || 'default')
  const runKey = `${context.sessionId || 'unsaved-session'}::${testId}`
  if (name === 'skill_creator_validate') {
    const draft = await resolveDraft(args, context)
    return JSON.stringify({
      ...validateSkillDraft(draft.skillMd, draft.references),
      draft_id: draft.draftId,
      revision: draft.revision,
      content_hash: draft.contentHash,
    })
  }
  if (name === 'run_skill_tests') {
    const draft = await resolveDraft(args, context)
    const skillMd = draft.skillMd
    const testCases = Array.isArray(args.test_cases) ? args.test_cases : []
    const targetSkillId = String(args.target_skill_id || '').trim()
    const installed = targetSkillId ? installedSnapshots.get(`${context.sessionId || 'unsaved-session'}::${targetSkillId}`) : undefined
    const baselineSkillMd = args.baseline_mode === 'installed_version' ? installed?.skillMd : undefined
    if (args.baseline_mode === 'installed_version' && !baselineSkillMd) throw new Error('找不到当前会话加载的已安装 Skill 基线')
    const previous = runs.get(runKey)
    const result = await runSkillTests(skillMd, testCases, { runsPerConfiguration: Number(args.runs_per_configuration) || 1, baselineSkillMd, toolAdapter: context.testToolAdapter })
    const skillName = String(args.skill_name || 'Skill')
    const benchmark = aggregateBenchmark(result.results, skillName, {
      provider: result.execution.provider,
      model: result.execution.model,
      revision: draft.revision,
      baselineConfiguration: result.execution.baseline,
    })
    const iteration = (runs.get(runKey)?.iteration || 0) + 1
    runs.set(runKey, { results: result.results, previousResults: previous?.results, benchmark, skillName, skillMd, draftId: draft.draftId, iteration })
    await appendSkillCreatorHistory({ sessionId: draft.sessionId, draftId: draft.draftId, entry: { event: 'tested', revision: draft.revision, iteration, timestamp: new Date().toISOString(), provider: result.execution.provider, model: result.execution.model } })
    return JSON.stringify({
      status: 'ok',
      draft_id: draft.draftId,
      revision: draft.revision,
      content_hash: draft.contentHash,
      ...result,
      benchmark,
      notes: benchmark.notes,
      iteration,
    })
  }
  const stored = runs.get(runKey)
  if (name === 'skill_creator_aggregate_benchmark') {
    if (!stored) throw new Error(`找不到测试结果: ${testId}`)
    const draft = await resolveDraft(args, context)
    return JSON.stringify({ status: 'ok', draft_id: draft.draftId, revision: draft.revision, content_hash: draft.contentHash, benchmark: aggregateBenchmark(stored.results, String(args.skill_name || stored.skillName)) })
  }
  if (name === 'skill_creator_open_eval_review') {
    if (!stored) throw new Error(`找不到测试结果: ${testId}`)
    const draft = await resolveDraft(args, context)
    const previous = stored.iteration > 1 ? await loadSkillCreatorFeedback({ sessionId: context.sessionId || 'unsaved-session', draftId: draft.draftId, iteration: stored.iteration - 1 }) : null
    const html = generateEvalViewerHtml(stored.skillName, stored.results, stored.benchmark, Object.fromEntries((previous?.reviews || []).map(review => [review.run_id, review.feedback])), stored.previousResults)
    const workspace = await persistSkillCreatorReviewWorkspace({
      skillName: stored.skillName,
      workspaceId: `${context.sessionId || 'unsaved-session'}/${draft.draftId}/iteration-${stored.iteration}`,
      reviewHtml: html,
      results: stored.results,
      benchmark: stored.benchmark,
    })
    return JSON.stringify({ status: 'ok', draft_id: draft.draftId, revision: draft.revision, content_hash: draft.contentHash, iteration: stored.iteration, review_html: workspace ? undefined : html, review_path: workspace?.reviewHtmlPath, benchmark: stored.benchmark })
  }
  if (name === 'skill_creator_submit_eval_feedback') {
    const draft = await resolveDraft(args, context)
    const iteration = positiveInteger(args.iteration)
    const reviews = Array.isArray(args.reviews) ? args.reviews.map((review: any) => ({ run_id: String(review.run_id || ''), feedback: String(review.feedback ?? ''), timestamp: new Date().toISOString() })).filter(review => review.run_id) : []
    const saved = await persistSkillCreatorFeedback({ sessionId: draft.sessionId, draftId: draft.draftId, iteration, reviews })
    await appendSkillCreatorHistory({ sessionId: draft.sessionId, draftId: draft.draftId, entry: { event: 'feedback', revision: draft.revision, iteration, timestamp: new Date().toISOString() } })
    return JSON.stringify({ status: 'ok', draft_id: draft.draftId, revision: draft.revision, content_hash: draft.contentHash, iteration, saved_count: saved.reviews.length, empty_feedback_count: saved.reviews.filter(review => !review.feedback.trim()).length })
  }
  if (name === 'skill_creator_load_eval_feedback') {
    const draft = await resolveDraft(args, context)
    const iteration = positiveInteger(args.iteration)
    const feedback = await loadSkillCreatorFeedback({ sessionId: draft.sessionId, draftId: draft.draftId, iteration })
    return JSON.stringify({ status: 'ok', draft_id: draft.draftId, revision: draft.revision, content_hash: draft.contentHash, iteration, feedback })
  }
  if (name === 'skill_creator_compare_outputs') {
    if (!stored) throw new Error(`找不到测试结果: ${testId}`)
    const draft = await resolveDraft(args, context)
    const evalId = positiveInteger(args.eval_id)
    const result = stored.results.find(item => item.eval_id === evalId)
    if (!result) throw new Error(`找不到测试用例: ${evalId}`)
    const configurations = [...new Set(result.runs.map(run => run.configuration))]
    const selected = configurations.slice(0, 2).map(configuration => result.runs.filter(run => run.configuration === configuration).at(-1)!).filter(Boolean)
    const comparison = await compareSkillOutputs(selected, String(args.rubric || ''), `${testId}:${evalId}`, context.signal)
    comparisons.set(`${runKey}::${evalId}`, comparison)
    const comparisonPath = await persistSkillCreatorWorkspaceArtifact({ sessionId: draft.sessionId, draftId: draft.draftId, iteration: stored.iteration, fileName: 'comparison.json', value: comparison })
    return JSON.stringify({ status: 'ok', draft_id: draft.draftId, revision: draft.revision, content_hash: draft.contentHash, eval_id: evalId, comparison: comparison.comparison, comparison_path: comparisonPath })
  }
  if (name === 'skill_creator_analyze_comparison') {
    if (!stored) throw new Error(`找不到测试结果: ${testId}`)
    const draft = await resolveDraft(args, context)
    const evalId = positiveInteger(args.eval_id)
    const comparison = comparisons.get(`${runKey}::${evalId}`)
    if (!comparison) throw new Error('请先完成同一用例的 Blind A/B 比较')
    const result = stored.results.find(item => item.eval_id === evalId)
    const evidence = JSON.stringify({ skill_md: stored.skillMd, runs: result?.runs.map(run => ({ configuration: run.configuration, transcript: run.transcript, output: run.output, assertions: run.assertions })) })
    const analysis = await analyzeSkillComparison(comparison, evidence, context.signal)
    const analysisPath = await persistSkillCreatorWorkspaceArtifact({ sessionId: draft.sessionId, draftId: draft.draftId, iteration: stored.iteration, fileName: 'analysis.json', value: analysis })
    return JSON.stringify({ status: 'ok', draft_id: draft.draftId, revision: draft.revision, content_hash: draft.contentHash, eval_id: evalId, comparison, analysis, analysis_path: analysisPath })
  }
  if (name === 'skill_creator_improve_description') {
    const draft = await resolveDraft(args, context)
    const improved = await improveSkillDescription({
      skillMd: draft.skillMd,
      userIntent: String(args.user_intent || ''),
      feedback: String(args.feedback || ''),
      benchmarkNotes: Array.isArray(args.benchmark_notes) ? args.benchmark_notes.map(String) : [],
    }, context.signal)
    const updated = await registerSkillBuilderDraft({
      draftId: draft.draftId,
      expectedRevision: draft.revision,
      skillMd: improved.skillMd,
      references: draft.references,
      manifest: draft.manifest,
      quality: draft.quality,
      sessionId: context.sessionId,
    })
    return JSON.stringify({
      status: 'ok',
      draft_id: updated.draftId,
      revision: updated.revision,
      content_hash: updated.contentHash,
      skill_md: updated.skillMd,
      output: improved.output,
    })
  }
  if (name === 'skill_creator_package') {
    const draft = await resolveDraft(args, context)
    return JSON.stringify({
      ...packageSkillDraft(draft.skillMd, draft.references),
      draft_id: draft.draftId,
      revision: draft.revision,
      content_hash: draft.contentHash,
    })
  }
  if (name === 'save_skill') {
    const draft = await resolveDraft(args, context)
    const validation = validateSkillDraft(draft.skillMd, draft.references)
    if (validation.status !== 'ok') return JSON.stringify(validation)
    return JSON.stringify({
      status: 'prepared',
      draft_id: draft.draftId,
      revision: draft.revision,
      content_hash: draft.contentHash,
      target_skill_id: String(args.target_skill_id || validation.name),
      install_token: {
        schemaVersion: 2,
        draftId: draft.draftId,
        sessionId: draft.sessionId,
        revision: draft.revision,
        contentHash: draft.contentHash,
        targetSkillId: String(args.target_skill_id || validation.name),
      },
      skill_md: draft.skillMd,
      references: draft.references,
      manifest: args.manifest,
      message: '草稿已准备完成。请把 install_token 原样放进 jc-skill-install-v2 代码块；用户点击安装卡后才会写入中央 Skill 根目录。',
    })
  }
  throw new Error(`未知 Skill Creator 工具: ${name}`)
}

function positiveInteger(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('iteration 必须是正整数')
  return parsed
}

function parseArgs(value: string): Record<string, any> {
  const parsed = JSON.parse(value || '{}')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('工具参数必须是 JSON 对象')
  return parsed
}

function normalizeReferences(value: unknown): Array<{ path: string; content: string; title?: string; mimeType?: string }> {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object').map(item => {
      const ref = item as Record<string, unknown>
      return { path: String(ref.path || ''), content: String(ref.content || ''), title: ref.title ? String(ref.title) : undefined, mimeType: ref.mimeType ? String(ref.mimeType) : undefined }
    })
    : []
}

async function resolveDraft(args: Record<string, any>, context: SkillCreatorToolContext) {
  const draftId = String(args.draft_id || '').trim()
  const stored = draftId ? await getSkillBuilderDraft(draftId, context.sessionId) : null
  if (draftId && !stored) throw new SkillDraftError('SKILL_DRAFT_NOT_FOUND', `找不到当前会话的 Skill 草稿: ${draftId}`)
  if (stored) {
    assertDraftIdentity(stored, args)
    const nextSkillMd = String(args.draft_skill_md || args.skill_md || '')
    const hasReferences = Array.isArray(args.references)
    if (!nextSkillMd.trim() && !hasReferences) return stored
    return registerSkillBuilderDraft({
      draftId: stored.draftId,
      expectedRevision: stored.revision,
      skillMd: nextSkillMd.trim() ? nextSkillMd : stored.skillMd,
      references: hasReferences ? toDraftReferences(normalizeReferences(args.references)) : stored.references,
      manifest: args.manifest || stored.manifest,
      quality: stored.quality,
      sessionId: context.sessionId,
    })
  }
  const skillMd = String(args.draft_skill_md || args.skill_md || '')
  if (!skillMd.trim()) throw new SkillDraftError('SKILL_DRAFT_REQUIRED', '请提供 draft_id 或 skill_md')
  const references = normalizeReferences(args.references)
  return registerSkillBuilderDraft({
    skillMd,
    references: toDraftReferences(references),
    manifest: args.manifest || {
      kind: 'skill-package-draft',
      schemaVersion: '2026-06-03.v1',
      sourceType: 'manual',
      createdAt: new Date().toISOString(),
      entry: 'SKILL.md',
      references: references.map(reference => ({ path: reference.path, title: reference.title || reference.path })),
      quality: { hardGatePassed: true, errors: [], warnings: [] },
    },
    sessionId: context.sessionId,
  })
}

function toDraftReferences(references: ReturnType<typeof normalizeReferences>) {
  return references.map(reference => ({
    path: reference.path,
    content: reference.content,
    title: reference.title || reference.path,
    mimeType: 'text/markdown' as const,
  }))
}

function assertDraftIdentity(
  draft: { revision: number; contentHash: string },
  args: Record<string, any>,
): void {
  const revision = Number(args.revision)
  const contentHash = String(args.content_hash || '').trim()
  if ((Number.isSafeInteger(revision) && revision !== draft.revision) || (contentHash && contentHash !== draft.contentHash)) {
    throw new SkillDraftError(
      'STALE_SKILL_DRAFT',
      `Skill 草稿版本已变化：当前 revision ${draft.revision}，请重新校验并生成确认卡。`,
    )
  }
}

class SkillDraftError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'SkillDraftError'
  }
}
