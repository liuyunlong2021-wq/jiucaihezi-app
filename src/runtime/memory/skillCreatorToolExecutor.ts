import type { DirectToolCall } from '@/runtime/direct/directTypes'
import {
  aggregateBenchmark,
  generateEvalViewerHtml,
  improveSkillDescription,
  packageSkillDraft,
  runSkillTests,
  validateSkillDraft,
  type BenchmarkData,
  type SingleTestResult,
} from '@/utils/skillTestRunner'
import { persistSkillCreatorReviewWorkspace } from '@/utils/skillCreatorWorkspace'
import { persistSkillPackageDraft } from '@/utils/skillPackageStorage'
import { skillCreatorRuntime, shouldUseSkillCreatorRuntime } from '@/runtime/tools/skillCreatorRuntime'

const TOOL_NAMES = new Set([
  'skill_creator_load_installed_skill',
  'skill_creator_validate',
  'run_skill_tests',
  'skill_creator_aggregate_benchmark',
  'skill_creator_open_eval_review',
  'skill_creator_improve_description',
  'skill_creator_package',
  'save_skill',
])

type StoredRun = { results: SingleTestResult[]; benchmark: BenchmarkData; skillName: string; skillMd: string }
const runs = new Map<string, StoredRun>()

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
    const result = JSON.stringify({ status: 'error', message: error instanceof Error ? error.message : String(error) })
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
    return JSON.stringify({
      status: 'ok',
      target_skill_id: skill.skillId,
      skill_md: skill.skillMd,
      files: [...new Set(['SKILL.md', ...skill.files.map(String).filter(Boolean)])],
      source: skill.source,
    })
  }
  const testId = String(args.test_id || args.run_id || 'default')
  if (name === 'skill_creator_validate') {
    return JSON.stringify(validateSkillDraft(String(args.skill_md || ''), normalizeReferences(args.references)))
  }
  if (name === 'run_skill_tests') {
    const skillMd = String(args.draft_skill_md || args.skill_md || '')
    const testCases = Array.isArray(args.test_cases) ? args.test_cases : []
    const result = await runSkillTests(skillMd, testCases)
    const skillName = String(args.skill_name || 'Skill')
    const benchmark = aggregateBenchmark(result.results, skillName)
    runs.set(testId, { results: result.results, benchmark, skillName, skillMd })
    return JSON.stringify({ status: 'ok', ...result, benchmark, notes: benchmark.notes })
  }
  const stored = runs.get(testId)
  if (name === 'skill_creator_aggregate_benchmark') {
    if (!stored) throw new Error(`找不到测试结果: ${testId}`)
    return JSON.stringify({ status: 'ok', benchmark: aggregateBenchmark(stored.results, String(args.skill_name || stored.skillName)) })
  }
  if (name === 'skill_creator_open_eval_review') {
    if (!stored) throw new Error(`找不到测试结果: ${testId}`)
    const html = generateEvalViewerHtml(stored.skillName, stored.results, stored.benchmark)
    const workspace = await persistSkillCreatorReviewWorkspace({
      skillName: stored.skillName,
      workspaceId: testId,
      reviewHtml: html,
      results: stored.results,
      benchmark: stored.benchmark,
    })
    return JSON.stringify({ status: 'ok', review_html: workspace ? undefined : html, review_path: workspace?.reviewHtmlPath, benchmark: stored.benchmark })
  }
  if (name === 'skill_creator_improve_description') {
    const improved = await improveSkillDescription({
      skillMd: String(args.skill_md || ''),
      userIntent: String(args.user_intent || ''),
      feedback: String(args.feedback || ''),
      benchmarkNotes: Array.isArray(args.benchmark_notes) ? args.benchmark_notes.map(String) : [],
    }, context.signal)
    return JSON.stringify({ status: 'ok', skill_md: improved.skillMd, output: improved.output })
  }
  if (name === 'skill_creator_package') {
    return JSON.stringify(packageSkillDraft(String(args.skill_md || ''), normalizeReferences(args.references)))
  }
  if (name === 'save_skill') {
    const skillMd = String(args.skill_md || '')
    const validation = validateSkillDraft(skillMd, normalizeReferences(args.references))
    if (validation.status !== 'ok') return JSON.stringify(validation)
    const persisted = await persistSkillPackageDraft({
      skillId: String(args.target_skill_id || validation.name),
      skillMd,
      references: normalizeReferences(args.references).map(reference => ({
        ...reference,
        title: reference.title || reference.path,
        mimeType: 'text/markdown' as const,
      })),
      manifest: args.manifest,
    })
    if (!persisted) throw new Error('当前平台无法保存本地 Skill 包')
    return JSON.stringify({ status: 'ok', message: 'Skill 已保存，在「我的Skill」中可用。', ...persisted })
  }
  throw new Error(`未知 Skill Creator 工具: ${name}`)
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
