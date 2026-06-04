import { resolveDesktopDataDirs } from '@/utils/idb'
import { isTauriRuntime } from '@/utils/tauriEnv'

export interface SkillCreatorWorkspaceArtifact {
  path: string
  mimeType: string
  bytes: number
}

export interface PersistedSkillCreatorReviewWorkspace {
  workspacePath: string
  reviewHtmlPath: string
  resultsJsonPath: string
  benchmarkJsonPath: string
  artifacts: SkillCreatorWorkspaceArtifact[]
}

export interface PersistSkillCreatorReviewWorkspaceInput {
  skillName: string
  workspaceId?: string
  reviewHtml: string
  results: unknown
  benchmark: unknown
  rootDir?: string
}

interface SkillCreatorWorkspaceFs {
  mkdir(path: string): Promise<void>
  writeTextFile(path: string, content: string): Promise<void>
}

export async function persistSkillCreatorReviewWorkspace(
  input: PersistSkillCreatorReviewWorkspaceInput,
  fs?: SkillCreatorWorkspaceFs,
): Promise<PersistedSkillCreatorReviewWorkspace | null> {
  const rootDir = input.rootDir || await resolveDefaultSkillCreatorWorkspaceRoot()
  if (!rootDir) return null

  const writer = fs || await loadTauriWorkspaceFs()
  if (!writer) return null

  const workspaceId = sanitizeWorkspaceId(input.workspaceId || `${input.skillName}-${Date.now().toString(36)}`)
  const workspacePath = joinPath(rootDir, workspaceId)
  const reviewHtmlPath = joinPath(workspacePath, 'eval-review.html')
  const resultsJsonPath = joinPath(workspacePath, 'eval-results.json')
  const benchmarkJsonPath = joinPath(workspacePath, 'benchmark.json')
  const resultsJson = `${JSON.stringify(input.results, null, 2)}\n`
  const benchmarkJson = `${JSON.stringify(input.benchmark, null, 2)}\n`

  await writer.mkdir(workspacePath)
  await writer.writeTextFile(reviewHtmlPath, input.reviewHtml)
  await writer.writeTextFile(resultsJsonPath, resultsJson)
  await writer.writeTextFile(benchmarkJsonPath, benchmarkJson)

  return {
    workspacePath,
    reviewHtmlPath,
    resultsJsonPath,
    benchmarkJsonPath,
    artifacts: [
      { path: 'eval-review.html', mimeType: 'text/html', bytes: textByteLength(input.reviewHtml) },
      { path: 'eval-results.json', mimeType: 'application/json', bytes: textByteLength(resultsJson) },
      { path: 'benchmark.json', mimeType: 'application/json', bytes: textByteLength(benchmarkJson) },
    ],
  }
}

async function resolveDefaultSkillCreatorWorkspaceRoot(): Promise<string> {
  if (!isTauriRuntime()) return ''
  const tauriPath = await import('@tauri-apps/api/path')
  const appData = await tauriPath.appDataDir()
  const home = await tauriPath.homeDir()
  const dirs = resolveDesktopDataDirs(appData, home)
  return joinPath(dirs.dataDir.replace(/\/data$/, ''), 'skill-workspaces')
}

async function loadTauriWorkspaceFs(): Promise<SkillCreatorWorkspaceFs | null> {
  if (!isTauriRuntime()) return null
  const tauriFs = await import('@tauri-apps/plugin-fs')
  return {
    mkdir: (path: string) => tauriFs.mkdir(path, { recursive: true }),
    writeTextFile: (path: string, content: string) => tauriFs.writeTextFile(path, content),
  }
}

function sanitizeWorkspaceId(value: string): string {
  const clean = String(value || '')
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return clean || `skill_creator_${Date.now().toString(36)}`
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

function textByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}
