import { normalizeSkillPackagePath, type SkillPackageDraftManifest, type SkillPackageReference } from '@/utils/skillTextBuilder'
import type { SkillMaterialRuntimeErrorCode } from '@/utils/skillMaterialRuntime'

export interface SkillMaterialRawFile {
  path: string
  content: string
  mimeType?: string
}

export interface SkillMaterialNormalizerFs {
  mkdir(path: string): Promise<void>
  writeTextFile(path: string, content: string): Promise<void>
}

export interface NormalizeSkillMaterialOutputInput {
  jobId: string
  workspacePath: string
  rawFiles: SkillMaterialRawFile[]
  fs: SkillMaterialNormalizerFs
}

export interface NormalizedSkillMaterialPackage {
  status: 'ok'
  skillMd: string
  skillMdPath: string
  manifestPath: string
  reportPath: string
  references: SkillPackageReference[]
  manifest: SkillPackageDraftManifest
  referenceCount: number
  assetCount: number
}

export interface NormalizeSkillMaterialOutputError {
  status: 'error'
  error: SkillMaterialRuntimeErrorCode
  message: string
}

export type NormalizeSkillMaterialOutputResult =
  | NormalizedSkillMaterialPackage
  | NormalizeSkillMaterialOutputError

export async function normalizeSkillMaterialOutput(
  input: NormalizeSkillMaterialOutputInput,
): Promise<NormalizeSkillMaterialOutputResult> {
  const rawFiles: Array<SkillMaterialRawFile & { safePath: string }> = []
  for (const file of input.rawFiles) {
    const safePath = safeNormalizePath(file.path)
    if (!safePath) {
      return {
        status: 'error',
        error: 'SKILL_OUTPUT_UNSAFE_PATH',
        message: `Skill Seekers 输出包含不安全路径: ${file.path}`,
      }
    }
    rawFiles.push({ ...file, safePath })
  }

  const skillFile = rawFiles.find(file => file.safePath === 'SKILL.md')
  if (!skillFile) {
    return {
      status: 'error',
      error: 'SKILL_OUTPUT_MISSING',
      message: '资料编译结果缺少 SKILL.md。',
    }
  }

  const skillDir = joinPath(input.workspacePath, 'skill')
  const reportsDir = joinPath(input.workspacePath, 'reports')
  await input.fs.mkdir(skillDir)
  await input.fs.mkdir(reportsDir)

  const dirSet = new Set<string>()
  for (const file of rawFiles) {
    const dir = parentDir(file.safePath)
    if (dir) dirSet.add(dir)
  }
  for (const dir of Array.from(dirSet)) {
    await input.fs.mkdir(joinPath(skillDir, dir))
  }

  for (const file of rawFiles) {
    await input.fs.writeTextFile(joinPath(skillDir, file.safePath), file.content)
  }

  const references = rawFiles
    .filter(file => file.safePath.startsWith('references/'))
    .map(file => ({
      path: file.safePath,
      title: file.safePath.split('/').pop() || file.safePath,
      content: file.content,
      mimeType: 'text/markdown' as const,
    }))
  const assetCount = rawFiles.filter(file => file.safePath.startsWith('assets/')).length
  const files = rawFiles.map(file => ({
    path: file.safePath,
    mimeType: file.mimeType || inferMimeType(file.safePath),
    bytes: textByteLength(file.content),
  }))
  const quality = {
    hardGatePassed: true,
    errors: [],
    warnings: [],
  }
  const manifest: SkillPackageDraftManifest = {
    kind: 'skill-package-draft',
    schemaVersion: '2026-06-03.v1',
    sourceType: 'text',
    createdAt: new Date().toISOString(),
    entry: 'SKILL.md',
    references: references.map(reference => ({ path: reference.path, title: reference.title })),
    quality,
  }
  const packageManifest = {
    ...manifest,
    entry: 'SKILL.md',
    files,
  }
  const sourceAnalysis = {
    jobId: input.jobId,
    fileCount: rawFiles.length,
    referenceCount: references.length,
    assetCount,
    files,
  }
  const manifestPath = joinPath(skillDir, 'skill-package.json')
  const reportPath = joinPath(reportsDir, 'source-analysis.json')
  await input.fs.writeTextFile(manifestPath, `${JSON.stringify(packageManifest, null, 2)}\n`)
  await input.fs.writeTextFile(reportPath, `${JSON.stringify(sourceAnalysis, null, 2)}\n`)

  return {
    status: 'ok',
    skillMd: skillFile.content,
    skillMdPath: joinPath(skillDir, 'SKILL.md'),
    manifestPath,
    reportPath,
    references,
    manifest,
    referenceCount: references.length,
    assetCount,
  }
}

function safeNormalizePath(path: string): string {
  try {
    const normalized = normalizeSkillPackagePath(path)
    if (!normalized) return ''
    return normalized
  } catch {
    return ''
  }
}

function extractSkillName(skillMd: string): string {
  const match = skillMd.match(/^---[\s\S]*?\nname:\s*(.+)$/m)
  return (match?.[1] || '未命名Skill').trim().replace(/^["']|["']$/g, '')
}

function inferMimeType(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.md')) return 'text/markdown'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.txt')) return 'text/plain'
  return 'application/octet-stream'
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

function parentDir(path: string): string {
  const index = path.lastIndexOf('/')
  return index > 0 ? path.slice(0, index) : ''
}

function textByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}
