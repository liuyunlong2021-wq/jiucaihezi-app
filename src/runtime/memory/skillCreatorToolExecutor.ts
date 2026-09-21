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
import { registerSkillBuilderDraft, SkillBuilderDraftError } from '@/utils/skillBuilderTools'
import { type SkillPackageDraftManifest, type SkillPackageReference } from '@/utils/skillTextBuilder'
import { assertSkillDraftPath, readSkillDraft, type SkillDraftFiles } from '@/utils/skillDraftPath'

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
  /**
   * 草稿所在项目文件树的读写口。
   *
   * 草稿归模型管（模型用现有文件工具读写），这里只提供只读回读，供校验、测试、评审
   * 和出卡使用。不提供写入 —— 宿主不替模型改草稿。
   */
  files?: SkillDraftFiles
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
  // 参数解析失败必须在进闸门前就地成结果：抛出去只会变成一句引擎原生报错，
  // 模型和用户都看不出该怎么自救。
  let args: Record<string, any>
  try {
    args = parseArgs(call.function.name, call.function.arguments)
  } catch (error) {
    return JSON.stringify({
      status: 'error',
      errorCode: 'MALFORMED_TOOL_ARGUMENTS',
      message: error instanceof Error ? error.message : String(error),
    })
  }
  // 流程顺序不再由宿主状态机把守：草稿状态就是文件本身，校验、测试、评审、出卡各自
  // 从草稿目录读当前内容。"不能安装没校验过的草稿"仍由 save_skill 内部的
  // validateSkillDraft 兜住。
  try {
    return await execute(call.function.name, args, context)
  } catch (error) {
    return JSON.stringify({
      status: 'error',
      errorCode: error instanceof SkillDraftError || error instanceof SkillBuilderDraftError ? error.code : undefined,
      message: error instanceof Error ? error.message : String(error),
    })
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
      draft_path: draft.draftPath,
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
      draft_path: draft.draftPath,
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
    return JSON.stringify({ status: 'ok', draft_path: draft.draftPath, benchmark: aggregateBenchmark(stored.results, String(args.skill_name || stored.skillName)) })
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
    return JSON.stringify({ status: 'ok', draft_path: draft.draftPath, iteration: stored.iteration, review_html: workspace ? undefined : html, review_path: workspace?.reviewHtmlPath, benchmark: stored.benchmark })
  }
  if (name === 'skill_creator_submit_eval_feedback') {
    const draft = await resolveDraft(args, context)
    const iteration = positiveInteger(args.iteration)
    const reviews = Array.isArray(args.reviews) ? args.reviews.map((review: any) => ({ run_id: String(review.run_id || ''), feedback: String(review.feedback ?? ''), timestamp: new Date().toISOString() })).filter(review => review.run_id) : []
    const saved = await persistSkillCreatorFeedback({ sessionId: draft.sessionId, draftId: draft.draftId, iteration, reviews })
    await appendSkillCreatorHistory({ sessionId: draft.sessionId, draftId: draft.draftId, entry: { event: 'feedback', revision: draft.revision, iteration, timestamp: new Date().toISOString() } })
    return JSON.stringify({ status: 'ok', draft_path: draft.draftPath, iteration, saved_count: saved.reviews.length, empty_feedback_count: saved.reviews.filter(review => !review.feedback.trim()).length })
  }
  if (name === 'skill_creator_load_eval_feedback') {
    const draft = await resolveDraft(args, context)
    const iteration = positiveInteger(args.iteration)
    const feedback = await loadSkillCreatorFeedback({ sessionId: draft.sessionId, draftId: draft.draftId, iteration })
    return JSON.stringify({ status: 'ok', draft_path: draft.draftPath, iteration, feedback })
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
    return JSON.stringify({ status: 'ok', draft_path: draft.draftPath, eval_id: evalId, comparison: comparison.comparison, comparison_path: comparisonPath })
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
    return JSON.stringify({ status: 'ok', draft_path: draft.draftPath, eval_id: evalId, comparison, analysis, analysis_path: analysisPath })
  }
  if (name === 'skill_creator_improve_description') {
    const draft = await resolveDraft(args, context)
    const improved = await improveSkillDescription({
      skillMd: draft.skillMd,
      userIntent: String(args.user_intent || ''),
      feedback: String(args.feedback || ''),
      benchmarkNotes: Array.isArray(args.benchmark_notes) ? args.benchmark_notes.map(String) : [],
    }, context.signal)
    // 草稿归模型管：宿主不替它改文件树，只把改好的正文交回去由模型自己写回。
    return JSON.stringify({
      status: 'ok',
      draft_path: draft.draftPath,
      skill_md: improved.skillMd,
      output: improved.output,
      message: `请把 skill_md 用 write_text_batch 写回 ${draft.draftPath}/SKILL.md，然后重新调用 skill_creator_validate。`,
    })
  }
  if (name === 'skill_creator_package') {
    const draft = await resolveDraft(args, context)
    return JSON.stringify({
      ...packageSkillDraft(draft.skillMd, draft.references),
      draft_path: draft.draftPath,
    })
  }
  if (name === 'save_skill') {
    const draft = await resolveDraft(args, context)
    const validation = validateSkillDraft(draft.skillMd, draft.references)
    if (validation.status !== 'ok') return JSON.stringify(validation)
    const targetSkillId = String(args.target_skill_id || validation.name)
    // 出卡即冻结：文件树草稿在这里被复制成一份受控快照（旧受控草稿库的草稿本身就是快照）。
    // Rust 侧只认快照与它的哈希，模型指定的路径不会被当成安装来源。
    // 出卡即冻结：把文件树草稿读回来、校验通过后冻结成一份受控快照。Rust 侧只认快照
    // 与它的哈希，模型给的路径永远不会被当成安装来源。
    const frozen = await registerSkillBuilderDraft({
      skillMd: draft.skillMd,
      references: draft.references,
      manifest: buildDraftManifest(draft.references),
      sessionId: context.sessionId,
    })
    if (!Number.isSafeInteger(frozen.revision) || !frozen.contentHash) {
      throw new SkillDraftError('SKILL_DRAFT_REQUIRED', '草稿冻结失败，请稍后重试。')
    }
    return JSON.stringify({
      status: 'prepared',
      draft_path: draft.draftPath,
      draft_id: frozen.draftId,
      revision: frozen.revision,
      content_hash: frozen.contentHash,
      target_skill_id: targetSkillId,
      install_token: {
        schemaVersion: 2,
        draftId: frozen.draftId,
        sessionId: context.sessionId,
        revision: frozen.revision,
        contentHash: frozen.contentHash,
        targetSkillId,
      },
      skill_md: draft.skillMd,
      references: draft.references,
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

function parseArgs(toolName: string, value?: string): Record<string, any> {
  const raw = value || '{}'
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`工具参数 JSON 不完整（${toolName}，收到 ${raw.length} 字符）：多半是回复被输出长度截断。请缩短参数后重试——只传 draft_path 这类标识，不要把 SKILL.md 正文或 references 全文复制进参数；必要时拆成多次调用。`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`工具参数必须是 JSON 对象（${toolName}）。`)
  return parsed as Record<string, any>
}

function normalizeReferences(value: unknown): Array<{ path: string; content: string; title?: string; mimeType?: string }> {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object').map(item => {
      const ref = item as Record<string, unknown>
      return { path: String(ref.path || ''), content: String(ref.content || ''), title: ref.title ? String(ref.title) : undefined, mimeType: ref.mimeType ? String(ref.mimeType) : undefined }
    })
    : []
}

/**
 * 草稿就在项目文件树里，模型给目录，宿主只读回来。
 *
 * 路径即身份：不再有不透明标识，也不再有宿主内的草稿状态。
 */
async function resolveDraft(args: Record<string, any>, context: SkillCreatorToolContext): Promise<ResolvedSkillDraft> {
  const draftPath = String(args.draft_path || '').trim()
  if (!draftPath) {
    throw new SkillDraftError(
      'SKILL_DRAFT_PATH_REQUIRED',
      '请提供 draft_path（草稿目录，形如 .raw/jc-media/文档/skill-<name>）。草稿由你用文件工具写在项目文件树里。',
    )
  }
  return await readFileTreeDraft(draftPath, context)
}

function toDraftReferences(references: ReturnType<typeof normalizeReferences>): SkillPackageReference[] {
  return references.map(reference => ({
    path: reference.path,
    content: reference.content,
    title: reference.title || reference.path,
    mimeType: 'text/markdown' as const,
  }))
}

/** 出卡冻结时用的包清单（与手工草稿同构：入口 SKILL.md，引用即包内文件）。 */
function buildDraftManifest(references: SkillPackageReference[]): SkillPackageDraftManifest {
  return {
    kind: 'skill-package-draft',
    schemaVersion: '2026-06-03.v1',
    sourceType: 'manual',
    createdAt: new Date().toISOString(),
    entry: 'SKILL.md',
    references: references.map(reference => ({ path: reference.path, title: reference.title || reference.path })),
    quality: { hardGatePassed: true, errors: [], warnings: [] },
  }
}

interface ResolvedSkillDraft {
  /** 草稿目录（项目相对路径）。路径即身份。 */
  draftPath: string
  /** 宿主内部句柄，用于评测工作区与历史记录的路径；就是草稿目录名。 */
  draftId: string
  sessionId: string
  /** 文件树草稿没有修订概念，恒为 1（仅供评测元数据）。 */
  revision: number
  skillMd: string
  references: SkillPackageReference[]
}

/** 读回文件树里的草稿：草稿由模型用现有文件工具写，宿主只读。 */
async function readFileTreeDraft(draftPath: string, context: SkillCreatorToolContext): Promise<ResolvedSkillDraft> {
  const files = context.files
  if (!files) throw new SkillDraftError('SKILL_DRAFT_FILES_UNAVAILABLE', '当前运行环境读不到项目文件树里的草稿。')
  const directory = assertSkillDraftPath(draftPath)
  const draft = await readSkillDraft(directory, files)
  return {
    draftPath: directory,
    draftId: directory.slice(directory.lastIndexOf('/') + 1),
    sessionId: context.sessionId || 'unsaved-session',
    revision: 1,
    skillMd: draft.skillMd,
    references: toDraftReferences(draft.references),
  }
}

function assertDraftIdentityRemovedForReference() { /* 旧的 draft_id/revision/content_hash 核对已随状态机一起删除 */ }

class SkillDraftError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'SkillDraftError'
  }
}
