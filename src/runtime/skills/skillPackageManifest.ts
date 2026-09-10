export type SkillPackageFileKind = 'instruction' | 'reference' | 'script' | 'asset' | 'metadata' | 'other'

export interface SkillPackageFile {
  path: string
  kind: SkillPackageFileKind
}

export interface SkillPackageManifest {
  schemaVersion: 1
  entry: 'SKILL.md'
  files: SkillPackageFile[]
}

const QUOTED_PACKAGE_PATH = /[`'"]((?:references|scripts|assets|agents|eval-viewer)\/[^`'"\r\n]+)[`'"]/gmu
const MARKDOWN_PACKAGE_PATH = /\]\(((?:references|scripts|assets|agents|eval-viewer)\/[^)\r\n]+)\)/gmu
const PLAIN_PACKAGE_PATH = /(?:^|[\s(\[])((?:references|scripts|assets|agents|eval-viewer)\/[^\s`'"),\]:；，。]+)/gmu

export function normalizeSkillPackagePath(value: string): string {
  const path = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\//, '')
  if (!path || path.startsWith('/') || /^[A-Za-z]:\//.test(path) || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..')) return ''
  return path
}

export function skillPackageFileKind(path: string): SkillPackageFileKind {
  if (path === 'SKILL.md') return 'instruction'
  if (path.startsWith('references/')) return 'reference'
  if (path.startsWith('scripts/')) return 'script'
  if (path.startsWith('assets/')) return 'asset'
  if (path.startsWith('agents/')) return 'metadata'
  return 'other'
}

export function buildSkillPackageManifest(paths: string[]): SkillPackageManifest {
  const normalized = [...new Set(['SKILL.md', ...paths].map(normalizeSkillPackagePath).filter(Boolean))]
    .sort((left, right) => left === 'SKILL.md' ? -1 : right === 'SKILL.md' ? 1 : left.localeCompare(right))
  return { schemaVersion: 1, entry: 'SKILL.md', files: normalized.map(path => ({ path, kind: skillPackageFileKind(path) })) }
}

export function extractReferencedSkillPackagePaths(skillMd: string): string[] {
  const paths = new Set<string>()
  const content = String(skillMd || '')
  for (const pattern of [QUOTED_PACKAGE_PATH, MARKDOWN_PACKAGE_PATH, PLAIN_PACKAGE_PATH]) {
    for (const match of content.matchAll(pattern)) {
      const normalized = normalizeSkillPackagePath(match[1] || '')
      if (normalized) paths.add(normalized)
    }
  }
  return [...paths].sort()
}

export function validateSkillPackageReferences(skillMd: string, files: string[]): string[] {
  const available = new Set(files.map(normalizeSkillPackagePath).filter(Boolean))
  return extractReferencedSkillPackagePaths(skillMd).filter(path => !available.has(path))
}
