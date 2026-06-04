import { toolJobRunner, type ToolJobRunner } from '@/runtime/tools/jobRunner'
import {
  buildSkillMaterialRuntimeCommand,
  detectSkillMaterialRuntime,
  validateSkillMaterialSources,
  type SkillMaterialRuntimeInfo,
  type SkillMaterialSourceInput,
} from '@/utils/skillMaterialRuntime'
import {
  normalizeSkillMaterialOutput,
  type SkillMaterialNormalizerFs,
  type SkillMaterialRawFile,
} from '@/utils/skillMaterialNormalizer'
import { registerSkillBuilderDraft } from '@/utils/skillBuilderTools'
import { isTauriRuntime } from '@/utils/tauriEnv'

export interface CompileSkillMaterialsToolCallLike {
  id?: string
  function: {
    name: string
    arguments?: string
  }
}

export interface SkillMaterialCompilerContext {
  sessionId?: string | null
  detectRuntime?: () => Promise<SkillMaterialRuntimeInfo>
  jobRunner?: ToolJobRunner
  runCompiler?: (input: RunSkillMaterialCompilerInput) => Promise<RunSkillMaterialCompilerOutput>
  normalizerFs?: SkillMaterialNormalizerFs
  workspaceRoot?: string
}

let testDeps: SkillMaterialCompilerContext | null = null

export function __setSkillMaterialCompilerTestDeps(deps: SkillMaterialCompilerContext | null): void {
  const env = (import.meta as any).env
  const nodeEnv = (globalThis as any).process?.env
  const allowed = Boolean(env?.DEV || env?.VITEST || nodeEnv?.NODE_ENV === 'test' || nodeEnv?.VITEST)
  if (!allowed) throw new Error('__setSkillMaterialCompilerTestDeps is only available in dev/test builds')
  testDeps = deps
}

export interface RunSkillMaterialCompilerInput {
  command: ReturnType<typeof buildSkillMaterialRuntimeCommand>
  source: SkillMaterialSourceInput
  name: string
  workspacePath: string
}

export interface RunSkillMaterialCompilerOutput {
  exitCode?: number | null
  stdout?: string
  stderr?: string
  rawFiles: SkillMaterialRawFile[]
}

export type SkillMaterialCompilerInvoke = (command: string, payload: Record<string, unknown>) => Promise<unknown>

interface CompileSkillMaterialsArgs {
  name?: string
  description?: string
  sources?: SkillMaterialSourceInput[]
  preset?: 'quick' | 'standard'
  limits?: {
    maxPages?: number
    maxFiles?: number
    maxBytes?: number
  }
}

export async function executeCompileSkillMaterialsToolCall(
  call: CompileSkillMaterialsToolCallLike,
  context: SkillMaterialCompilerContext = {},
): Promise<string | null> {
  if (call.function.name !== 'compile_skill_materials') return null
  const effectiveContext = {
    ...(testDeps || {}),
    ...context,
  }

  const args = parseArgs(call.function.arguments)
  if (!args) {
    return JSON.stringify({
      status: 'error',
      error: 'INVALID_TOOL_ARGUMENTS',
      message: 'compile_skill_materials 参数不是合法 JSON。',
    })
  }

  const sources = Array.isArray(args.sources) ? args.sources : []
  if (sources.length === 0) {
    return JSON.stringify({
      status: 'error',
      error: 'INVALID_TOOL_ARGUMENTS',
      message: 'compile_skill_materials 至少需要 1 个资料来源。',
    })
  }
  const validation = validateSkillMaterialSources(sources)
  if (validation.errors.length > 0) {
    const first = validation.errors[0]
    return JSON.stringify({
      status: 'error',
      error: first.code,
      message: first.message,
      next_step: '请换成受支持的资料来源，或先把资料转成 Markdown 后走基础素材转Skill。',
    })
  }

  const runtime = await (effectiveContext.detectRuntime || detectSkillMaterialRuntime)()
  if (!runtime.available) {
    return JSON.stringify({
      status: 'error',
      error: runtime.errorCode || 'SKILL_MATERIAL_RUNTIME_UNAVAILABLE',
      message: '当前只支持文本、Markdown 和可读附件。PDF、文档 URL、GitHub、本地代码目录需要 Skill 高级构建能力包。',
      next_step: '请先使用文本/Markdown 资料，或安装 Skill 高级构建能力包后再试。',
    })
  }

  const runner = effectiveContext.jobRunner || toolJobRunner
  const workspaceRoot = effectiveContext.workspaceRoot || '/tmp/jiucai-skill-builds'
  const started = runner.start({
    toolName: 'compile_skill_materials',
    callId: call.id,
    sessionId: effectiveContext.sessionId || undefined,
    task: async ({ jobId, emit }) => {
      emit({ stage: 'runtime_check', message: '正在检查 Skill 高级构建运行时。' })
      const source = sources[0]
      const command = buildSkillMaterialRuntimeCommand({
        runtime,
        name: String(args.name || '未命名Skill'),
        source,
        preset: args.preset,
        limits: args.limits,
      })
      emit({ stage: 'compiler_start', message: '正在整理资料并生成 Skill 草稿。' })
      const workspacePath = joinPath(workspaceRoot, jobId)
      const output = await (effectiveContext.runCompiler || defaultRunCompiler)({
        command,
        source,
        name: String(args.name || '未命名Skill'),
        workspacePath,
      })
      emit({ stage: 'normalize_start', message: '正在规范化 Skill 包。' })
      const normalized = await normalizeSkillMaterialOutput({
        jobId,
        workspacePath,
        rawFiles: output.rawFiles,
        fs: effectiveContext.normalizerFs || defaultNormalizerFs,
      })
      if (normalized.status === 'error') {
        return {
          status: 'error',
          toolName: 'compile_skill_materials',
          errorCode: normalized.error,
          errorMessage: normalized.message,
        }
      }
      const draft = registerSkillBuilderDraft({
        skillMd: normalized.skillMd,
        references: normalized.references,
        manifest: normalized.manifest,
        sessionId: effectiveContext.sessionId,
      })
      emit({ stage: 'draft_ready', message: 'Skill 草稿已生成。' })
      return {
        status: 'ok',
        toolName: 'compile_skill_materials',
        message: '已整理资料并生成 Skill 草稿。请展示草稿摘要，设计至少 3 个测试用例。',
        data: {
          draft_id: draft.draftId,
          package: {
            skillMdPath: normalized.skillMdPath,
            manifestPath: normalized.manifestPath,
            referenceCount: normalized.referenceCount,
            assetCount: normalized.assetCount,
            reportPath: normalized.reportPath,
          },
        },
      }
    },
  })

  return JSON.stringify({
    status: 'running',
    jobId: started.jobId,
    message: '正在后台整理资料并生成 Skill 草稿。',
  })
}

function parseArgs(raw: string | undefined): CompileSkillMaterialsArgs | null {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export async function runSkillMaterialCompilerWithTauri(
  input: RunSkillMaterialCompilerInput,
  invokeOverride?: SkillMaterialCompilerInvoke,
): Promise<RunSkillMaterialCompilerOutput> {
  const sourcePayload = sourceToRustPayload(input.source)
  const invoke = invokeOverride || await resolveTauriInvoke()
  const result = await invoke('skill_material_compile', {
    input: {
      runtimeRoot: input.command.cwd || '',
      workspacePath: input.workspacePath,
      name: input.name,
      source: sourcePayload,
      preset: input.command.args.includes('--preset')
        ? input.command.args[input.command.args.indexOf('--preset') + 1]
        : 'quick',
      maxPages: extractNumericArg(input.command.args, '--max-pages'),
      timeoutSeconds: 900,
    },
  }) as { exitCode?: number | null; stdout?: string; stderr?: string; rawFiles?: SkillMaterialRawFile[] }
  const exitCode = typeof result.exitCode === 'number' ? result.exitCode : result.exitCode ?? null
  const stdout = redactCompilerText(result.stdout || '', input.command.env)
  const stderr = redactCompilerText(result.stderr || '', input.command.env)
  if (exitCode !== null && exitCode !== 0) {
    const detail = stderr || stdout || `exitCode=${exitCode}`
    throw new Error(`Skill material compiler failed: ${detail}`)
  }
  return {
    exitCode,
    stdout,
    stderr,
    rawFiles: Array.isArray(result.rawFiles) ? result.rawFiles : [],
  }
}

async function defaultRunCompiler(input: RunSkillMaterialCompilerInput): Promise<RunSkillMaterialCompilerOutput> {
  return runSkillMaterialCompilerWithTauri(input)
}

const defaultNormalizerFs: SkillMaterialNormalizerFs = {
  mkdir: async () => {},
  writeTextFile: async () => {},
}

function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part, index) => index === 0
      ? part.replace(/\/+$/g, '')
      : part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

function sourceToRustPayload(source: SkillMaterialSourceInput): { sourceType: string; value: string; githubToken?: string } {
  switch (source.type) {
    case 'pdf':
      return { sourceType: 'pdf', value: source.path || source.fileName || '' }
    case 'documentation_url':
      return { sourceType: 'documentation_url', value: source.url }
    case 'github_repo':
      return { sourceType: 'github_repo', value: source.repo, githubToken: source.githubToken }
    case 'local_codebase':
      return { sourceType: 'local_codebase', value: source.path }
  }
}

function extractNumericArg(args: string[], flag: string): number | undefined {
  const index = args.indexOf(flag)
  if (index < 0) return undefined
  const value = Number(args[index + 1])
  return Number.isFinite(value) ? value : undefined
}

function redactCompilerText(value: string, env: Record<string, string>): string {
  let text = String(value || '')
  Object.values(env).forEach((secret) => {
    if (secret) text = text.split(secret).join('[REDACTED]')
  })
  return text
}

async function resolveTauriInvoke(): Promise<SkillMaterialCompilerInvoke> {
  if (!isTauriRuntime()) {
    throw new Error('Skill material compiler requires Tauri runtime')
  }
  const { invoke } = await import('@tauri-apps/api/core')
  return (command, payload) => invoke(command, payload)
}
