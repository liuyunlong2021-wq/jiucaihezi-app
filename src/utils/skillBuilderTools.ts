import type { ChatCompletionTool } from '@/composables/officeTools'
import { skillBuilderRuntime, shouldUseSkillBuilderRuntime } from '@/runtime/tools/skillBuilderRuntime'
import { getLocalContentToolDefinitions } from '@/utils/localContentTools'
import { buildSkillPackageFromText, type SkillPackageDraftManifest, type SkillPackageReference } from '@/utils/skillTextBuilder'
import {
  hashSkillDraft,
  loadLatestSkillDraftRevision,
  persistSkillDraftRevision,
  type PersistedSkillDraftRecord,
} from '@/utils/skillDraftStorage'
import {
  RUN_SKILL_TESTS_TOOL,
  SAVE_SKILL_TOOL,
} from '@/utils/skillTestRunner'

export interface SkillBuilderToolCallLike {
  function: {
    name: string
    arguments?: string
  }
}

export interface SkillBuilderToolContext {
  agentId?: string | null
  sessionId?: string | null
  userInput?: string | null
}

export interface SkillBuilderDraftRecord {
  draftId: string
  sessionId: string
  revision: number
  contentHash: string
  skillMd: string
  references: SkillPackageReference[]
  manifest: SkillPackageDraftManifest
  quality: ReturnType<typeof buildSkillPackageFromText>['quality']
  createdAt: number
  updatedAt: number
}

export class SkillBuilderDraftError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'SkillBuilderDraftError'
  }
}

export interface RegisterSkillBuilderDraftInput {
  draftId?: string
  expectedRevision?: number
  skillMd: string
  references: SkillPackageReference[]
  manifest: SkillPackageDraftManifest
  quality?: ReturnType<typeof buildSkillPackageFromText>['quality']
  sessionId?: string | null
}

const DEFAULT_SESSION_ID = 'unsaved-session'
const skillBuilderDrafts = new Map<string, SkillBuilderDraftRecord>()

export const BUILD_SKILL_FROM_TEXT_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'build_skill_from_text',
    description: '从用户粘贴的文本或 Markdown 内容构建标准 Skill 草稿，并生成 references/source.md。仅适用于素材转Skill。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill 名称' },
        description: { type: 'string', description: 'Skill 适用场景和职责说明' },
        source_title: { type: 'string', description: '来源资料标题或文件名' },
        source_text: { type: 'string', description: '用户提供的完整文本或 Markdown 内容' },
      },
      required: ['name', 'description', 'source_text'],
    },
  },
}

export const COMPILE_SKILL_MATERIALS_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'compile_skill_materials',
    description: '将 PDF、文档 URL、GitHub 仓库或本地代码目录编译成 Skill 草稿包，并返回 draft_id。仅适用于素材转Skill。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '要生成的 Skill 名称' },
        description: { type: 'string', description: 'Skill 职责说明' },
        sources: {
          type: 'array',
          description: '资料来源列表。P2 支持 pdf、documentation_url、github_repo、local_codebase。',
          items: { type: 'object' },
        },
        preset: { type: 'string', enum: ['quick', 'standard'] },
        limits: { type: 'object' },
      },
      required: ['name', 'sources'],
    },
  },
}

const SKILL_BUILDER_MATERIAL_TOOL_NAMES = new Set([
  'local_extract_attachment',
  'document_to_markdown',
])

const SKILL_BUILDER_MATERIAL_TOOLS: ChatCompletionTool[] = [
  'local_extract_attachment',
  'document_to_markdown',
].flatMap(toolName => getLocalContentToolDefinitions().filter(tool => (
  tool.function.name === toolName && SKILL_BUILDER_MATERIAL_TOOL_NAMES.has(tool.function.name)
)))

export const ALL_SKILL_BUILDER_TOOLS: ChatCompletionTool[] = [
  BUILD_SKILL_FROM_TEXT_TOOL,
  ...SKILL_BUILDER_MATERIAL_TOOLS,
  RUN_SKILL_TESTS_TOOL,
  SAVE_SKILL_TOOL,
  COMPILE_SKILL_MATERIALS_TOOL,
]

export const BASE_SKILL_BUILDER_TOOLS: ChatCompletionTool[] = [
  BUILD_SKILL_FROM_TEXT_TOOL,
  ...SKILL_BUILDER_MATERIAL_TOOLS,
  RUN_SKILL_TESTS_TOOL,
  SAVE_SKILL_TOOL,
]

export function getSkillBuilderToolDefinitions(options: { skillMaterialRuntimeAvailable?: boolean } = {}): ChatCompletionTool[] {
  return options.skillMaterialRuntimeAvailable
    ? [...BASE_SKILL_BUILDER_TOOLS, COMPILE_SKILL_MATERIALS_TOOL]
    : [...BASE_SKILL_BUILDER_TOOLS]
}

export async function executeSkillBuilderToolCall(
  call: SkillBuilderToolCallLike,
  context?: SkillBuilderToolContext,
): Promise<string | null> {
  const name = call.function.name
  if (name === 'compile_skill_materials') {
    const { executeCompileSkillMaterialsToolCall } = await import('@/utils/skillMaterialCompiler')
    return executeCompileSkillMaterialsToolCall(call, context)
  }
  if (name !== 'build_skill_from_text') return null

  let args: Record<string, unknown>
  try {
    args = JSON.parse(call.function.arguments || '{}')
  } catch {
    return JSON.stringify({
      status: 'error',
      message: 'build_skill_from_text 参数不是合法 JSON',
    })
  }

  try {
    const draft = buildSkillPackageFromText({
      name: String(args.name || ''),
      description: String(args.description || ''),
      sourceTitle: String(args.source_title || ''),
      sourceText: String(args.source_text || ''),
    })
    const draftRecord = await registerSkillBuilderDraft({ ...draft, sessionId: context?.sessionId })
    if (shouldUseSkillBuilderRuntime(context)) {
      skillBuilderRuntime.afterToolResult({
        toolName: 'build_skill_from_text',
        args: { ...args, draft_id: draftRecord.draftId },
        context,
        result: {
          status: 'ok',
          draft_id: draftRecord.draftId,
          revision: draftRecord.revision,
          content_hash: draftRecord.contentHash,
        },
      })
    }

    return JSON.stringify({
      status: 'ok',
      draft_id: draftRecord.draftId,
      revision: draftRecord.revision,
      content_hash: draftRecord.contentHash,
      skill_md: draft.skillMd,
      references: draft.references,
      manifest: draft.manifest,
      quality: draft.quality,
      message: '已从用户提供文本生成 Skill 草稿。请展示 SKILL.md、设计测试用例，并等待用户确认后再运行 run_skill_tests。',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return JSON.stringify({
      status: 'error',
      message,
    })
  }
}

export async function getSkillBuilderDraft(draftId: string, sessionId?: string | null): Promise<SkillBuilderDraftRecord | null> {
  const key = buildDraftKey(sessionId, draftId)
  const record = skillBuilderDrafts.get(key)
  if (record) return cloneDraftRecord(record)
  const persisted = await loadLatestSkillDraftRevision(normalizeSessionId(sessionId), draftId)
  if (!persisted) return null
  const restored = fromPersistedRecord(persisted)
  skillBuilderDrafts.set(key, restored)
  return cloneDraftRecord(restored)
}

export async function registerSkillBuilderDraft(input: RegisterSkillBuilderDraftInput): Promise<SkillBuilderDraftRecord> {
  const sessionId = normalizeSessionId(input.sessionId)
  const draftId = String(input.draftId || '').trim() || `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const existing = input.draftId ? await getSkillBuilderDraft(draftId, sessionId) : null
  if (existing && input.expectedRevision !== undefined && input.expectedRevision !== existing.revision) {
    throw new SkillBuilderDraftError('STALE_SKILL_DRAFT', `Skill 草稿版本已变化：当前 revision ${existing.revision}。`)
  }
  const references = input.references.map(reference => ({ ...reference }))
  const contentHash = await hashSkillDraft(input.skillMd, references)
  if (existing?.contentHash === contentHash) return existing
  const now = Date.now()
  const record: SkillBuilderDraftRecord = {
    draftId,
    sessionId,
    revision: (existing?.revision || 0) + 1,
    contentHash,
    skillMd: input.skillMd,
    references,
    manifest: { ...input.manifest },
    quality: input.quality || {
      hardGatePassed: true,
      errors: [],
      warnings: [],
    },
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  }
  await persistSkillDraftRevision(toPersistedRecord(record))
  skillBuilderDrafts.set(buildDraftKey(sessionId, draftId), record)
  return cloneDraftRecord(record)
}

export function __resetSkillBuilderDraftMemoryForTests(): void {
  skillBuilderDrafts.clear()
}

function buildDraftKey(sessionId: string | null | undefined, draftId: string): string {
  return `${normalizeSessionId(sessionId)}::${String(draftId || '').trim()}`
}

function normalizeSessionId(sessionId?: string | null): string {
  return String(sessionId || DEFAULT_SESSION_ID).trim() || DEFAULT_SESSION_ID
}

function cloneDraftRecord(record: SkillBuilderDraftRecord): SkillBuilderDraftRecord {
  return {
    ...record,
    references: record.references.map(reference => ({ ...reference })),
    manifest: { ...record.manifest },
    quality: { ...record.quality },
  }
}

function toPersistedRecord(record: SkillBuilderDraftRecord): PersistedSkillDraftRecord {
  return {
    ...record,
    references: record.references.map(reference => ({ ...reference })),
    manifest: { ...record.manifest },
    quality: { ...record.quality },
  }
}

function fromPersistedRecord(record: PersistedSkillDraftRecord): SkillBuilderDraftRecord {
  return {
    ...record,
    references: record.references.map(reference => ({ ...reference, mimeType: 'text/markdown' as const })),
    manifest: record.manifest as unknown as SkillPackageDraftManifest,
    quality: { ...record.quality },
  }
}
