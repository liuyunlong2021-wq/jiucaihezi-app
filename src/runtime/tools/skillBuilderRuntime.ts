import { isExplicitSkillSaveIntent } from './skillCreatorRuntime'

export type SkillBuilderRuntimeState =
  | 'idle'
  | 'draft_ready'
  | 'tested'
  | 'saved'
  | 'error'

export interface SkillBuilderRuntimeContext {
  agentId?: string | null
  sessionId?: string | null
  userInput?: string | null
}

export interface SkillBuilderRuntimeSnapshot {
  key: string
  draftId: string
  sessionId: string
  state: SkillBuilderRuntimeState
  draftReady: boolean
  tested: boolean
  testCount: number
  saveRequested: boolean
  updatedAt: number
  lastToolName?: string
  lastErrorCode?: string
  testedUserInput?: string | null
}

export interface SkillBuilderRuntimeToolInput {
  toolName: string
  args: Record<string, unknown>
  context?: SkillBuilderRuntimeContext
  result?: Record<string, unknown>
  now?: number
}

export interface SkillBuilderRuntimeDecision {
  allowed: boolean
  state: SkillBuilderRuntimeState
  draftId: string
  errorCode?: string
  message?: string
  nextStep?: string
}

export interface SkillBuilderRuntime {
  beforeToolCall(input: SkillBuilderRuntimeToolInput): SkillBuilderRuntimeDecision
  afterToolResult(input: SkillBuilderRuntimeToolInput): SkillBuilderRuntimeSnapshot
  getSnapshot(args: Record<string, unknown>, context?: SkillBuilderRuntimeContext): SkillBuilderRuntimeSnapshot | null
  reset(args: Record<string, unknown>, context?: SkillBuilderRuntimeContext): void
}

const DEFAULT_SESSION_ID = 'unsaved-session'
const DEFAULT_DRAFT_ID = 'default'
const SKILL_BUILDER_AGENT_ID = 'preset_skill-builder'
const MIN_TEST_CASES = 3

export function createSkillBuilderRuntime(): SkillBuilderRuntime {
  const records = new Map<string, SkillBuilderRuntimeSnapshot>()

  function getOrCreate(args: Record<string, unknown>, context?: SkillBuilderRuntimeContext, now = Date.now()): SkillBuilderRuntimeSnapshot {
    const identity = resolveSkillBuilderRuntimeIdentity(args, context)
    const existing = records.get(identity.key)
    if (existing) return existing
    const created: SkillBuilderRuntimeSnapshot = {
      key: identity.key,
      draftId: identity.draftId,
      sessionId: identity.sessionId,
      state: 'idle',
      draftReady: false,
      tested: false,
      testCount: 0,
      saveRequested: false,
      updatedAt: now,
    }
    records.set(identity.key, created)
    return created
  }

  function beforeToolCall(input: SkillBuilderRuntimeToolInput): SkillBuilderRuntimeDecision {
    const now = input.now ?? Date.now()
    const record = getOrCreate(input.args, input.context, now)
    applyUserIntent(record, input.context?.userInput, now)
    const blocked = validateBeforeTool(record, input.toolName, input.args)
    if (blocked) {
      record.state = blocked.state
      record.lastToolName = input.toolName
      record.lastErrorCode = blocked.errorCode
      record.updatedAt = now
      return {
        allowed: false,
        state: record.state,
        draftId: record.draftId,
        errorCode: blocked.errorCode,
        message: blocked.message,
        nextStep: blocked.nextStep,
      }
    }
    record.lastToolName = input.toolName
    record.lastErrorCode = undefined
    record.updatedAt = now
    return {
      allowed: true,
      state: record.state,
      draftId: record.draftId,
    }
  }

  function afterToolResult(input: SkillBuilderRuntimeToolInput): SkillBuilderRuntimeSnapshot {
    const now = input.now ?? Date.now()
    const resultDraftId = String(input.result?.draft_id || input.args.draft_id || '').trim()
    const record = getOrCreate({ ...input.args, draft_id: resultDraftId || input.args.draft_id }, input.context, now)
    const status = String(input.result?.status || '')
    const isOk = status === 'ok' || status === 'success'

    if (!isOk && status) {
      record.state = 'error'
      record.lastErrorCode = String(input.result?.error || input.result?.errorCode || 'SKILL_BUILDER_TOOL_ERROR')
    } else if (input.toolName === 'build_skill_from_text' || input.toolName === 'compile_skill_materials') {
      record.draftReady = true
      record.tested = false
      record.testCount = 0
      record.saveRequested = false
      record.state = 'draft_ready'
    } else if (input.toolName === 'run_skill_tests') {
      record.testCount = Number(input.result?.eval_count || countTestCases(input.args))
      record.tested = record.testCount >= MIN_TEST_CASES
      record.saveRequested = false
      record.testedUserInput = input.context?.userInput || null
      record.state = record.tested ? 'tested' : 'draft_ready'
      if (!record.tested) record.lastErrorCode = 'SKILL_BUILDER_MIN_TESTS_REQUIRED'
    } else if (input.toolName === 'save_skill') {
      record.state = 'saved'
    }

    record.lastToolName = input.toolName
    record.updatedAt = now
    records.set(record.key, record)
    return { ...record }
  }

  return {
    beforeToolCall,
    afterToolResult,
    getSnapshot(args, context) {
      const identity = resolveSkillBuilderRuntimeIdentity(args, context)
      const record = records.get(identity.key)
      return record ? { ...record } : null
    },
    reset(args, context) {
      const identity = resolveSkillBuilderRuntimeIdentity(args, context)
      records.delete(identity.key)
    },
  }
}

export const skillBuilderRuntime = createSkillBuilderRuntime()

export function shouldUseSkillBuilderRuntime(context?: SkillBuilderRuntimeContext): boolean {
  return context?.agentId === SKILL_BUILDER_AGENT_ID
}

export function resolveSkillBuilderRuntimeIdentity(
  args: Record<string, unknown>,
  context?: SkillBuilderRuntimeContext,
): { key: string; draftId: string; sessionId: string } {
  const sessionId = sanitizeIdentityPart(context?.sessionId || DEFAULT_SESSION_ID)
  const explicitDraftId = String(args.draft_id || args.test_id || args.run_id || '').trim()
  const draftId = sanitizeIdentityPart(explicitDraftId || DEFAULT_DRAFT_ID)
  return {
    key: `${sessionId}::${draftId}`,
    draftId,
    sessionId,
  }
}

function applyUserIntent(record: SkillBuilderRuntimeSnapshot, userInput: string | null | undefined, now: number): void {
  if (
    record.tested
    && isExplicitSkillSaveIntent(userInput)
    && normalizeIntentText(userInput) !== normalizeIntentText(record.testedUserInput)
  ) {
    record.saveRequested = true
    record.updatedAt = now
  }
}

function normalizeIntentText(value: string | null | undefined): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, '')
}

function validateBeforeTool(
  record: SkillBuilderRuntimeSnapshot,
  toolName: string,
  args: Record<string, unknown>,
): { state: SkillBuilderRuntimeState; errorCode: string; message: string; nextStep: string } | null {
  if (toolName === 'run_skill_tests' && countTestCases(args) < MIN_TEST_CASES) {
    return blocked(record.state, 'SKILL_BUILDER_MIN_TESTS_REQUIRED', '素材转Skill保存前至少需要 3 个测试用例。', '请补足至少 3 个测试用例后再运行 run_skill_tests。')
  }
  if (toolName === 'save_skill') {
    if (!record.draftReady) {
      return blocked(record.state, 'SKILL_BUILDER_DRAFT_REQUIRED', '还不能保存：请先从素材生成 Skill 草稿。', '先调用 build_skill_from_text。')
    }
    if (!record.tested) {
      return blocked(record.state, record.testCount > 0 ? 'SKILL_BUILDER_MIN_TESTS_REQUIRED' : 'SKILL_BUILDER_TESTS_REQUIRED', '还不能保存：请先运行至少 3 个测试用例。', '先调用 run_skill_tests，并提供至少 3 个测试用例。')
    }
    if (!record.saveRequested) {
      return blocked(record.state, 'SKILL_BUILDER_SAVE_CONFIRMATION_REQUIRED', '还不能保存：需要用户明确说“保存”或“确认保存”。', '请先展示草稿和测试结果，并等待用户明确确认保存。')
    }
  }
  return null
}

function countTestCases(args: Record<string, unknown>): number {
  return Array.isArray(args.test_cases) ? args.test_cases.length : 0
}

function blocked(
  state: SkillBuilderRuntimeState,
  errorCode: string,
  message: string,
  nextStep: string,
): { state: SkillBuilderRuntimeState; errorCode: string; message: string; nextStep: string } {
  return { state, errorCode, message, nextStep }
}

function sanitizeIdentityPart(value: string): string {
  const clean = String(value || '')
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._:-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return clean || DEFAULT_DRAFT_ID
}
