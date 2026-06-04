export type SkillMaterialCapability =
  | 'skill.source.pdf'
  | 'skill.source.documentation_url'
  | 'skill.source.github_repo'
  | 'skill.source.local_codebase'

export type SkillMaterialSourceInput =
  | {
      type: 'pdf'
      fileName?: string
      attachmentId?: string
      path?: string
    }
  | {
      type: 'documentation_url'
      url: string
    }
  | {
      type: 'github_repo'
      repo: string
      ref?: string
      githubToken?: string
    }
  | {
      type: 'local_codebase'
      path: string
    }

export type SkillMaterialRuntimeErrorCode =
  | 'SKILL_MATERIAL_RUNTIME_UNAVAILABLE'
  | 'UNSUPPORTED_SOURCE_TYPE'
  | 'SOURCE_TOO_LARGE'
  | 'SOURCE_ACCESS_DENIED'
  | 'GITHUB_TOKEN_REQUIRED'
  | 'GITHUB_RATE_LIMITED'
  | 'PDF_ENCRYPTED'
  | 'CLI_COMMAND_FAILED'
  | 'SKILL_OUTPUT_MISSING'
  | 'SKILL_OUTPUT_UNSAFE_PATH'
  | 'SKILL_PACKAGE_NORMALIZE_FAILED'

export interface SkillMaterialRuntimeInfo {
  available: boolean
  cwd?: string
  command?: string
  argsPrefix?: string[]
  capabilities: SkillMaterialCapability[]
  errorCode?: SkillMaterialRuntimeErrorCode
}

export interface DetectSkillMaterialRuntimeOptions {
  devProjectPath?: string
  exists?: (path: string) => Promise<boolean> | boolean
}

export interface SkillMaterialRuntimeCommandInput {
  runtime: SkillMaterialRuntimeInfo
  name: string
  source: SkillMaterialSourceInput
  preset?: 'quick' | 'standard'
  limits?: {
    maxPages?: number
    maxFiles?: number
    maxBytes?: number
  }
}

export interface SkillMaterialRuntimeCommand {
  command: string
  args: string[]
  cwd?: string
  env: Record<string, string>
}

export interface SkillMaterialSourceValidationError {
  code: SkillMaterialRuntimeErrorCode
  message: string
  sourceIndex: number
}

export interface SkillMaterialSourceValidationResult {
  errors: SkillMaterialSourceValidationError[]
}

const DEFAULT_DEV_PROJECT_PATH = '/Users/by3/Documents/Skill_Seekers'
const DEFAULT_CAPABILITIES: SkillMaterialCapability[] = [
  'skill.source.pdf',
  'skill.source.documentation_url',
  'skill.source.github_repo',
  'skill.source.local_codebase',
]

export async function detectSkillMaterialRuntime(
  options: DetectSkillMaterialRuntimeOptions = {},
): Promise<SkillMaterialRuntimeInfo> {
  const devProjectPath = options.devProjectPath || DEFAULT_DEV_PROJECT_PATH
  const exists = options.exists || defaultExists
  if (await exists(devProjectPath)) {
    return {
      available: true,
      cwd: devProjectPath,
      command: 'uv',
      argsPrefix: ['run', 'skill-seekers'],
      capabilities: DEFAULT_CAPABILITIES,
    }
  }
  return {
    available: false,
    capabilities: [],
    errorCode: 'SKILL_MATERIAL_RUNTIME_UNAVAILABLE',
  }
}

export function buildSkillMaterialRuntimeCommand(input: SkillMaterialRuntimeCommandInput): SkillMaterialRuntimeCommand {
  if (!input.runtime.available || !input.runtime.command) {
    throw new Error('Skill material runtime is unavailable')
  }
  const sourceArg = sourceToCliArg(input.source)
  const args = [
    ...(input.runtime.argsPrefix || []),
    'create',
    sourceArg,
    '--name',
    input.name,
  ]
  if (input.preset) {
    args.push('--preset', input.preset)
  }
  if (input.limits?.maxPages && input.source.type === 'documentation_url') {
    args.push('--max-pages', String(input.limits.maxPages))
  }
  args.push('--enhance-level', '0', '--quiet', '--non-interactive')

  const env: Record<string, string> = {}
  if (input.source.type === 'github_repo' && input.source.githubToken) {
    env.GITHUB_TOKEN = input.source.githubToken
  }
  return {
    command: input.runtime.command,
    args,
    cwd: input.runtime.cwd,
    env,
  }
}

export function validateSkillMaterialSources(sources: SkillMaterialSourceInput[]): SkillMaterialSourceValidationResult {
  const errors: SkillMaterialSourceValidationError[] = []
  sources.forEach((source, sourceIndex) => {
    if (!isSupportedSourceType(source)) {
      errors.push({
        sourceIndex,
        code: 'UNSUPPORTED_SOURCE_TYPE',
        message: '当前素材转Skill暂不支持这个资料来源。',
      })
      return
    }
    const sourceError = validateOneSource(source, sourceIndex)
    if (sourceError) errors.push(sourceError)
  })
  return { errors }
}

function validateOneSource(source: SkillMaterialSourceInput, sourceIndex: number): SkillMaterialSourceValidationError | null {
  if (source.type === 'pdf') {
    if (source.path && !isSafeAbsolutePath(source.path)) {
      return denied(sourceIndex, 'PDF 文件路径不安全。')
    }
    return null
  }
  if (source.type === 'documentation_url') {
    if (!isSafeHttpUrl(source.url)) return denied(sourceIndex, '文档 URL 只支持 http/https。')
    return null
  }
  if (source.type === 'github_repo') {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repo)) {
      return denied(sourceIndex, 'GitHub 仓库必须使用 owner/repo 格式。')
    }
    return null
  }
  if (!isSafeAbsolutePath(source.path)) {
    return denied(sourceIndex, '本地代码目录路径不安全。')
  }
  return null
}

function sourceToCliArg(source: SkillMaterialSourceInput): string {
  switch (source.type) {
    case 'pdf':
      return source.path || source.fileName || ''
    case 'documentation_url':
      return source.url
    case 'github_repo':
      return source.repo
    case 'local_codebase':
      return source.path
  }
}

function isSupportedSourceType(source: unknown): source is SkillMaterialSourceInput {
  if (!source || typeof source !== 'object') return false
  const type = (source as { type?: unknown }).type
  return type === 'pdf' || type === 'documentation_url' || type === 'github_repo' || type === 'local_codebase'
}

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (url.username || url.password) return false
    return !isUnsafeHost(url.hostname)
  } catch {
    return false
  }
}

function isUnsafeHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === 'metadata.google.internal') return true
  if (host.includes(':')) return isUnsafeIpv6(host)
  const ipv4 = parseIpv4(host)
  if (!ipv4) return false
  const [a, b] = ipv4
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  const nums = parts.map(part => {
    if (!/^\d+$/.test(part)) return NaN
    const value = Number(part)
    return value >= 0 && value <= 255 ? value : NaN
  })
  return nums.every(Number.isFinite) ? nums as [number, number, number, number] : null
}

function isUnsafeIpv6(host: string): boolean {
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  if (host.startsWith('fe80:')) return true
  const first = Number.parseInt(host.split(':')[0] || '', 16)
  if (!Number.isFinite(first)) return false
  return (first & 0xfe00) === 0xfc00
}

function isSafeAbsolutePath(value: string): boolean {
  const path = String(value || '')
  if (!path || path.includes('\0')) return false
  if (!path.startsWith('/')) return false
  return !path.split('/').some(part => part === '..')
}

function denied(sourceIndex: number, message: string): SkillMaterialSourceValidationError {
  return {
    sourceIndex,
    code: 'SOURCE_ACCESS_DENIED',
    message,
  }
}

async function defaultExists(path: string): Promise<boolean> {
  try {
    const fs = await import('node:fs/promises')
    await fs.access(path)
    return true
  } catch {}
  try {
    const fs = await import('@tauri-apps/plugin-fs') as { exists?: (path: string) => Promise<boolean> }
    if (typeof fs.exists === 'function') return await fs.exists(path)
  } catch {}
  return false
}
