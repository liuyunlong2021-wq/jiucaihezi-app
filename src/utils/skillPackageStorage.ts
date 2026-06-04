import { resolveDesktopDataDirs } from '@/utils/idb'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { normalizeSkillPackagePath, type SkillPackageDraftManifest, type SkillPackageReference } from '@/utils/skillTextBuilder'

export interface SkillPackageAssetIndexEntry {
  path: string
  title?: string
  mimeType: string
  bytes: number
}

export interface PersistedSkillPackage {
  packagePath: string
  packageManifestPath: string
  assetIndex: SkillPackageAssetIndexEntry[]
}

export interface PersistSkillPackageDraftInput {
  skillId: string
  skillMd: string
  references?: SkillPackageReference[]
  manifest?: SkillPackageDraftManifest | Record<string, unknown>
  rootDir?: string
}

interface SkillPackageFs {
  mkdir(path: string): Promise<void>
  writeTextFile(path: string, content: string): Promise<void>
  rename?(from: string, to: string): Promise<void>
  remove?(path: string, options?: { recursive?: boolean }): Promise<void>
}

export async function persistSkillPackageDraft(
  input: PersistSkillPackageDraftInput,
  fs?: SkillPackageFs,
): Promise<PersistedSkillPackage | null> {
  const references = input.references || []
  if (!input.skillMd.trim() && references.length === 0) return null

  const rootDir = input.rootDir || await resolveDefaultSkillPackagesRoot()
  if (!rootDir) return null

  const writer = fs || await loadTauriSkillPackageFs()
  if (!writer) return null
  if (!writer.rename) return null

  const skillId = sanitizeSkillId(input.skillId)
  const packagePath = joinPath(rootDir, skillId)
  const tempPackagePath = joinPath(rootDir, `${skillId}.tmp`)
  const manifestPath = joinPath(packagePath, 'skill-package.json')
  const tempManifestPath = joinPath(tempPackagePath, 'skill-package.json')
  const assetIndex: SkillPackageAssetIndexEntry[] = [
    {
      path: 'SKILL.md',
      mimeType: 'text/markdown',
      bytes: textByteLength(input.skillMd),
    },
  ]

  try {
    if (writer.remove) await writer.remove(tempPackagePath, { recursive: true }).catch(() => {})
    await writer.mkdir(tempPackagePath)
    await writer.writeTextFile(joinPath(tempPackagePath, 'SKILL.md'), input.skillMd)

    const referenceDirs = new Set<string>()
    for (const reference of references) {
      const relativePath = normalizeSkillPackagePath(reference.path)
      const dir = parentDir(relativePath)
      if (dir) referenceDirs.add(dir)
    }
    for (const dir of referenceDirs) {
      await writer.mkdir(joinPath(tempPackagePath, dir))
    }
    for (const reference of references) {
      const relativePath = normalizeSkillPackagePath(reference.path)
      await writer.writeTextFile(joinPath(tempPackagePath, relativePath), reference.content)
      assetIndex.push({
        path: relativePath,
        title: reference.title,
        mimeType: reference.mimeType,
        bytes: textByteLength(reference.content),
      })
    }

    const manifest = {
      ...(input.manifest || {}),
      entry: 'SKILL.md',
      files: assetIndex,
      savedAt: new Date().toISOString(),
    }
    await writer.writeTextFile(tempManifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    if (writer.remove) await writer.remove(packagePath, { recursive: true }).catch(() => {})
    await writer.rename(tempPackagePath, packagePath)
  } catch (error) {
    if (writer.remove) await writer.remove(tempPackagePath, { recursive: true }).catch(() => {})
    throw error
  }

  return {
    packagePath,
    packageManifestPath: manifestPath,
    assetIndex,
  }
}

async function resolveDefaultSkillPackagesRoot(): Promise<string> {
  if (!isTauriRuntime()) return ''
  const tauriPath = await import('@tauri-apps/api/path')
  const appData = await tauriPath.appDataDir()
  const home = await tauriPath.homeDir()
  const dirs = resolveDesktopDataDirs(appData, home)
  return joinPath(dirs.dataDir.replace(/\/data$/, ''), 'skills')
}

async function loadTauriSkillPackageFs(): Promise<SkillPackageFs | null> {
  if (!isTauriRuntime()) return null
  const tauriFs = await import('@tauri-apps/plugin-fs')
  return {
    mkdir: (path: string) => tauriFs.mkdir(path, { recursive: true }),
    writeTextFile: (path: string, content: string) => tauriFs.writeTextFile(path, content),
    rename: (from: string, to: string) => tauriFs.rename(from, to),
    remove: (path: string, options?: { recursive?: boolean }) => tauriFs.remove(path, { recursive: options?.recursive }),
  }
}

function sanitizeSkillId(value: string): string {
  const clean = String(value || '')
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return clean || `skill_${Date.now().toString(36)}`
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
