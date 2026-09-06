import { isTauriRuntime } from '@/utils/tauriEnv'

export interface PersistedSkillDraftReference {
  path: string
  title: string
  content: string
  mimeType: string
}

export interface PersistedSkillDraftRecord {
  draftId: string
  sessionId: string
  revision: number
  contentHash: string
  skillMd: string
  references: PersistedSkillDraftReference[]
  manifest: Record<string, unknown>
  quality: { hardGatePassed: boolean; errors: string[]; warnings: string[] }
  createdAt: number
  updatedAt: number
}

const WEB_STORAGE_PREFIX = 'jc_skill_draft_v2'

export async function hashSkillDraft(
  skillMd: string,
  references: PersistedSkillDraftReference[],
): Promise<string> {
  const canonical = JSON.stringify({
    skillMd: normalizeText(skillMd),
    files: references
      .map(reference => ({
        path: reference.path.replace(/\\/g, '/'),
        title: reference.title,
        content: normalizeText(reference.content),
        mimeType: reference.mimeType,
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  })
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function persistSkillDraftRevision(record: PersistedSkillDraftRecord): Promise<void> {
  if (!isTauriRuntime()) {
    const storage = getWebStorage()
    if (!storage) return
    const serialized = JSON.stringify(record)
    storage.setItem(webRevisionKey(record.sessionId, record.draftId, record.revision), serialized)
    storage.setItem(webLatestKey(record.sessionId, record.draftId), serialized)
    return
  }

  const { tempDir, join } = await import('@tauri-apps/api/path')
  const fs = await import('@tauri-apps/plugin-fs')
  const draftDir = await join(
    await tempDir(),
    'jiucaihezi-skill-drafts',
    sanitizePart(record.sessionId),
    sanitizePart(record.draftId),
  )
  const revisionPath = await join(draftDir, `revision-${record.revision}.json`)
  const tempPath = `${revisionPath}.tmp`
  await fs.mkdir(draftDir, { recursive: true })
  await fs.remove(tempPath).catch(() => {})
  await fs.writeTextFile(tempPath, `${JSON.stringify(record, null, 2)}\n`)
  if (await fs.exists(revisionPath)) await fs.remove(revisionPath)
  await fs.rename(tempPath, revisionPath)
}

export async function loadLatestSkillDraftRevision(
  sessionId: string,
  draftId: string,
): Promise<PersistedSkillDraftRecord | null> {
  if (!isTauriRuntime()) {
    const storage = getWebStorage()
    if (!storage) return null
    return parseRecord(storage.getItem(webLatestKey(sessionId, draftId)))
  }

  const { tempDir, join } = await import('@tauri-apps/api/path')
  const fs = await import('@tauri-apps/plugin-fs')
  const draftDir = await join(
    await tempDir(),
    'jiucaihezi-skill-drafts',
    sanitizePart(sessionId),
    sanitizePart(draftId),
  )
  if (!await fs.exists(draftDir)) return null
  const revisions = (await fs.readDir(draftDir))
    .flatMap(entry => entry.name?.match(/^revision-(\d+)\.json$/)?.[1] || [])
    .map(Number)
    .filter(Number.isSafeInteger)
    .sort((a, b) => b - a)
  if (!revisions.length) return null
  return parseRecord(await fs.readTextFile(await join(draftDir, `revision-${revisions[0]}.json`)))
}

function parseRecord(value: string | null): PersistedSkillDraftRecord | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as PersistedSkillDraftRecord
    if (!parsed.draftId || !parsed.sessionId || !Number.isSafeInteger(parsed.revision) || !parsed.contentHash) return null
    return parsed
  } catch {
    return null
  }
}

function webLatestKey(sessionId: string, draftId: string): string {
  return `${WEB_STORAGE_PREFIX}:${sanitizePart(sessionId)}:${sanitizePart(draftId)}:latest`
}

function webRevisionKey(sessionId: string, draftId: string, revision: number): string {
  return `${WEB_STORAGE_PREFIX}:${sanitizePart(sessionId)}:${sanitizePart(draftId)}:${revision}`
}

function sanitizePart(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'default'
}

function normalizeText(value: string): string {
  return String(value || '').replace(/\r\n/g, '\n')
}

function getWebStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    localStorage.getItem(`${WEB_STORAGE_PREFIX}:probe`)
    return localStorage
  } catch {
    return null
  }
}
