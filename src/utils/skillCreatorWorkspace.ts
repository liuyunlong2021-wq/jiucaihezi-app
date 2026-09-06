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
  readTextFile?(path: string): Promise<string>
}

export interface SkillCreatorFeedbackReview { run_id: string; feedback: string; timestamp: string }
export interface SkillCreatorFeedback { reviews: SkillCreatorFeedbackReview[]; status: 'complete' }
export interface SkillCreatorHistoryEntry { event: 'tested' | 'feedback' | 'installed'; revision: number; iteration?: number; timestamp: string; provider?: string; model?: string }

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

export async function persistSkillCreatorFeedback(
  input: { sessionId: string; draftId: string; iteration: number; reviews: SkillCreatorFeedbackReview[]; rootDir?: string },
  fs?: SkillCreatorWorkspaceFs,
): Promise<SkillCreatorFeedback> {
  const feedback: SkillCreatorFeedback = { reviews: input.reviews, status: 'complete' }
  const key = feedbackStorageKey(input.sessionId, input.draftId, input.iteration)
  const rootDir = input.rootDir || await resolveDefaultSkillCreatorWorkspaceRoot()
  const writer = fs || await loadTauriWorkspaceFs()
  if (rootDir && writer) {
    const dir = joinPath(rootDir, sanitizeWorkspaceId(input.sessionId), sanitizeWorkspaceId(input.draftId), `iteration-${input.iteration}`)
    await writer.mkdir(dir)
    await writer.writeTextFile(joinPath(dir, 'feedback.json'), `${JSON.stringify(feedback, null, 2)}\n`)
  } else {
    try { localStorage.setItem(key, JSON.stringify(feedback)) } catch { /* unavailable browser storage */ }
  }
  return feedback
}

export async function loadSkillCreatorFeedback(
  input: { sessionId: string; draftId: string; iteration: number; rootDir?: string },
  fs?: SkillCreatorWorkspaceFs,
): Promise<SkillCreatorFeedback | null> {
  const rootDir = input.rootDir || await resolveDefaultSkillCreatorWorkspaceRoot()
  const reader = fs || await loadTauriWorkspaceFs()
  try {
    const raw = rootDir && reader?.readTextFile
      ? await reader.readTextFile(joinPath(rootDir, sanitizeWorkspaceId(input.sessionId), sanitizeWorkspaceId(input.draftId), `iteration-${input.iteration}`, 'feedback.json'))
      : localStorage.getItem(feedbackStorageKey(input.sessionId, input.draftId, input.iteration))
    return raw ? JSON.parse(raw) as SkillCreatorFeedback : null
  } catch { return null }
}

export async function persistSkillCreatorWorkspaceArtifact(
  input: { sessionId: string; draftId: string; iteration: number; fileName: 'comparison.json' | 'analysis.json'; value: unknown; rootDir?: string },
  fs?: SkillCreatorWorkspaceFs,
): Promise<string | null> {
  const rootDir = input.rootDir || await resolveDefaultSkillCreatorWorkspaceRoot()
  const writer = fs || await loadTauriWorkspaceFs()
  if (!rootDir || !writer) return null
  const dir = joinPath(rootDir, sanitizeWorkspaceId(input.sessionId), sanitizeWorkspaceId(input.draftId), `iteration-${input.iteration}`)
  const path = joinPath(dir, input.fileName)
  await writer.mkdir(dir)
  await writer.writeTextFile(path, `${JSON.stringify(input.value, null, 2)}\n`)
  return path
}

export async function appendSkillCreatorHistory(
  input: { sessionId: string; draftId: string; entry: SkillCreatorHistoryEntry; rootDir?: string },
  fs?: SkillCreatorWorkspaceFs,
): Promise<void> {
  const key = `jc_skill_history_v1:${sanitizeWorkspaceId(input.sessionId)}:${sanitizeWorkspaceId(input.draftId)}`
  const rootDir = input.rootDir || await resolveDefaultSkillCreatorWorkspaceRoot()
  const writer = fs || await loadTauriWorkspaceFs()
  if (rootDir && writer) {
    const dir = joinPath(rootDir, sanitizeWorkspaceId(input.sessionId), sanitizeWorkspaceId(input.draftId))
    const path = joinPath(dir, 'history.json')
    let history: SkillCreatorHistoryEntry[] = []
    try { history = JSON.parse(await writer.readTextFile?.(path) || '[]') } catch { /* first entry */ }
    await writer.mkdir(dir)
    await writer.writeTextFile(path, `${JSON.stringify([...history, input.entry], null, 2)}\n`)
    return
  }
  try {
    const history = JSON.parse(localStorage.getItem(key) || '[]') as SkillCreatorHistoryEntry[]
    localStorage.setItem(key, JSON.stringify([...history, input.entry]))
  } catch { /* unavailable browser storage */ }
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
    readTextFile: (path: string) => tauriFs.readTextFile(path),
  }
}

function feedbackStorageKey(sessionId: string, draftId: string, iteration: number): string {
  return `jc_skill_feedback_v1:${sanitizeWorkspaceId(sessionId)}:${sanitizeWorkspaceId(draftId)}:${iteration}`
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
