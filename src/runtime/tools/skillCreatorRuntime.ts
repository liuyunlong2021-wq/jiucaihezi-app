export type SkillCreatorRuntimeState =
  | 'idle'
  | 'drafting'
  | 'validated'
  | 'testing'
  | 'review_ready'
  | 'waiting_user_feedback'
  | 'improving'
  | 'package_ready'
  | 'saved'
  | 'error'

export interface SkillCreatorRuntimeContext {
  agentId?: string | null
  sessionId?: string | null
  userInput?: string | null
}

export interface SkillCreatorRuntimeSnapshot {
  key: string
  runId: string
  sessionId: string
  state: SkillCreatorRuntimeState
  validated: boolean
  tested: boolean
  reviewOpened: boolean
  enteredWaitingUserFeedback: boolean
  saveRequested: boolean
  updatedAt: number
  lastToolName?: string
  lastErrorCode?: string
}

export interface SkillCreatorRuntimeToolInput {
  toolName: string
  args: Record<string, unknown>
  context?: SkillCreatorRuntimeContext
  result?: Record<string, unknown>
  now?: number
}

export interface SkillCreatorRuntimeDecision {
  allowed: boolean
  state: SkillCreatorRuntimeState
  runId: string
  errorCode?: string
  message?: string
  nextStep?: string
}

export interface SkillCreatorRuntime {
  beforeToolCall(input: SkillCreatorRuntimeToolInput): SkillCreatorRuntimeDecision
  afterToolResult(input: SkillCreatorRuntimeToolInput): SkillCreatorRuntimeSnapshot
  getSnapshot(args: Record<string, unknown>, context?: SkillCreatorRuntimeContext): SkillCreatorRuntimeSnapshot | null
  reset(args: Record<string, unknown>, context?: SkillCreatorRuntimeContext): void
}

const DEFAULT_SESSION_ID = 'unsaved-session'
const DEFAULT_RUN_ID = 'default'
const SKILL_CREATOR_AGENT_IDS = new Set(['skill-creator', 'preset_skill-creator'])

export function createSkillCreatorRuntime(): SkillCreatorRuntime {
  const records = new Map<string, SkillCreatorRuntimeSnapshot>()

  function getOrCreate(args: Record<string, unknown>, context?: SkillCreatorRuntimeContext, now = Date.now()): SkillCreatorRuntimeSnapshot {
    const identity = resolveSkillCreatorRuntimeIdentity(args, context)
    const existing = records.get(identity.key)
    if (existing) return existing
    const created: SkillCreatorRuntimeSnapshot = {
      key: identity.key,
      runId: identity.runId,
      sessionId: identity.sessionId,
      state: 'idle',
      validated: false,
      tested: false,
      reviewOpened: false,
      enteredWaitingUserFeedback: false,
      saveRequested: false,
      updatedAt: now,
    }
    records.set(identity.key, created)
    return created
  }

  function beforeToolCall(input: SkillCreatorRuntimeToolInput): SkillCreatorRuntimeDecision {
    const now = input.now ?? Date.now()
    const record = getOrCreate(input.args, input.context, now)
    applyUserIntent(record, input.context?.userInput, now)

    const blocked = validateBeforeTool(record, input.toolName)
    if (blocked) {
      record.state = blocked.state
      record.lastToolName = input.toolName
      record.lastErrorCode = blocked.errorCode
      record.updatedAt = now
      return {
        allowed: false,
        state: record.state,
        runId: record.runId,
        errorCode: blocked.errorCode,
        message: blocked.message,
        nextStep: blocked.nextStep,
      }
    }

    if (input.toolName === 'run_skill_tests') record.state = 'testing'
    if (input.toolName === 'skill_creator_improve_description') record.state = 'improving'
    record.lastToolName = input.toolName
    record.lastErrorCode = undefined
    record.updatedAt = now
    return {
      allowed: true,
      state: record.state,
      runId: record.runId,
    }
  }

  function afterToolResult(input: SkillCreatorRuntimeToolInput): SkillCreatorRuntimeSnapshot {
    const now = input.now ?? Date.now()
    const record = getOrCreate(input.args, input.context, now)
    const status = String(input.result?.status || '')
    const isOk = status === 'ok' || status === 'success'

    if (!isOk && status) {
      record.state = 'error'
      record.lastErrorCode = String(input.result?.error || input.result?.errorCode || 'SKILL_CREATOR_TOOL_ERROR')
    } else if (input.toolName === 'skill_creator_validate') {
      record.validated = true
      record.tested = false
      record.reviewOpened = false
      record.enteredWaitingUserFeedback = false
      record.saveRequested = false
      record.state = 'validated'
    } else if (input.toolName === 'run_skill_tests') {
      record.tested = true
      record.reviewOpened = false
      record.enteredWaitingUserFeedback = false
      record.state = 'review_ready'
    } else if (input.toolName === 'skill_creator_aggregate_benchmark') {
      if (record.tested) record.state = 'review_ready'
    } else if (input.toolName === 'skill_creator_open_eval_review') {
      record.reviewOpened = true
      record.enteredWaitingUserFeedback = true
      record.state = 'waiting_user_feedback'
    } else if (input.toolName === 'skill_creator_improve_description') {
      record.validated = false
      record.tested = false
      record.reviewOpened = false
      record.enteredWaitingUserFeedback = false
      record.saveRequested = false
      record.state = 'improving'
    } else if (input.toolName === 'skill_creator_package') {
      record.state = 'package_ready'
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
      const identity = resolveSkillCreatorRuntimeIdentity(args, context)
      const record = records.get(identity.key)
      return record ? { ...record } : null
    },
    reset(args, context) {
      const identity = resolveSkillCreatorRuntimeIdentity(args, context)
      records.delete(identity.key)
    },
  }
}

export const skillCreatorRuntime = createSkillCreatorRuntime()

export function shouldUseSkillCreatorRuntime(context?: SkillCreatorRuntimeContext): boolean {
  return SKILL_CREATOR_AGENT_IDS.has(context?.agentId || '')
}

export function resolveSkillCreatorRuntimeIdentity(
  args: Record<string, unknown>,
  context?: SkillCreatorRuntimeContext,
): { key: string; runId: string; sessionId: string } {
  const sessionId = sanitizeIdentityPart(context?.sessionId || DEFAULT_SESSION_ID)
  const explicitRunId = String(args.test_id || args.run_id || args.session_id || '').trim()
  const runId = sanitizeIdentityPart(explicitRunId || DEFAULT_RUN_ID)
  return {
    key: `${sessionId}::${runId}`,
    runId,
    sessionId,
  }
}

export function isExplicitSkillSaveIntent(value?: string | null): boolean {
  return /(确认)?保存|保存(这个|下来|为|成)|就这样|可以保存|没问题.*保存/.test(String(value || ''))
}

export function isSkillImproveIntent(value?: string | null): boolean {
  return /不满意|继续(改|优化|调整|完善)|优化描述|命中不准|关键词不准|再改|重写|改一下/.test(String(value || ''))
}

function applyUserIntent(record: SkillCreatorRuntimeSnapshot, userInput: string | null | undefined, now: number): void {
  if (isExplicitSkillSaveIntent(userInput)) {
    record.saveRequested = true
    record.updatedAt = now
  }
  if (record.enteredWaitingUserFeedback && isSkillImproveIntent(userInput)) {
    record.state = 'improving'
    record.updatedAt = now
  }
}

function validateBeforeTool(
  record: SkillCreatorRuntimeSnapshot,
  toolName: string,
): { state: SkillCreatorRuntimeState; errorCode: string; message: string; nextStep: string } | null {
  if (toolName === 'run_skill_tests' && !record.validated) {
    return blocked('idle', 'SKILL_CREATOR_VALIDATE_REQUIRED', '还不能运行测试：请先调用 skill_creator_validate 校验 SKILL.md。', '先调用 skill_creator_validate。')
  }
  if ((toolName === 'skill_creator_open_eval_review' || toolName === 'skill_creator_aggregate_benchmark') && !record.tested) {
    return blocked(record.validated ? 'validated' : 'idle', 'SKILL_CREATOR_TESTS_REQUIRED', '还不能打开评审页：请先完成 run_skill_tests。', '先调用 run_skill_tests。')
  }
  if (toolName === 'skill_creator_improve_description' && !record.enteredWaitingUserFeedback) {
    return blocked(record.state, 'SKILL_CREATOR_REVIEW_REQUIRED', '还不能优化：请先打开评审页，让用户基于评审结果反馈。', '先调用 skill_creator_open_eval_review。')
  }
  if (toolName === 'skill_creator_package' && !record.enteredWaitingUserFeedback) {
    return blocked(record.state, 'SKILL_CREATOR_REVIEW_REQUIRED', '还不能打包：请先完成评审并等待用户反馈。', '先调用 skill_creator_open_eval_review。')
  }
  if (toolName === 'save_skill') {
    if (!record.enteredWaitingUserFeedback) {
      return blocked(record.state, 'SKILL_CREATOR_WAITING_FEEDBACK_REQUIRED', '还不能保存：请先完成 validate、run_skill_tests 和评审页，并等待用户确认。', '先调用 skill_creator_validate，再调用 run_skill_tests，最后打开 skill_creator_open_eval_review。')
    }
    if (!record.saveRequested) {
      return blocked(record.state, 'SKILL_CREATOR_SAVE_CONFIRMATION_REQUIRED', '还不能保存：需要用户明确说“保存”或“确认保存”。', '请先向用户展示评审结论，并等待用户明确确认保存。')
    }
  }
  return null
}

function blocked(
  state: SkillCreatorRuntimeState,
  errorCode: string,
  message: string,
  nextStep: string,
): { state: SkillCreatorRuntimeState; errorCode: string; message: string; nextStep: string } {
  return { state, errorCode, message, nextStep }
}

function sanitizeIdentityPart(value: string): string {
  const clean = String(value || '')
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._:-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return clean || DEFAULT_RUN_ID
}
