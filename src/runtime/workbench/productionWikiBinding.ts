export type ProductionWikiEntityKind = 'character' | 'scene' | 'prop'

export interface ProductionWikiResource {
  id?: string
  path: string
  name: string
  isDirectory: boolean
  kind: 'document' | 'media' | 'canvas' | 'binary'
}

export interface ProductionWikiEntity {
  kind: ProductionWikiEntityKind
  name: string
  paths: string[]
}

export interface ProductionWikiSceneResolution {
  entities: ProductionWikiEntity[]
  unresolvedLinks: string[]
}

const entityDirectories: Array<{ directory: string; kind: ProductionWikiEntityKind }> = [
  { directory: '角色', kind: 'character' },
  { directory: '场景', kind: 'scene' },
  { directory: '道具', kind: 'prop' },
]

export function resolveProductionWikiScene(input: {
  rootPath: string
  anchor: ProductionWikiResource
  content: string
  resources: ProductionWikiResource[]
}): ProductionWikiSceneResolution {
  const rootPath = trimSlashes(input.rootPath)
  const entities: ProductionWikiEntity[] = []
  const unresolvedLinks: string[] = []
  const seen = new Set<string>()

  for (const target of wikiLinkTargets(input.content)) {
    const parsed = entityTarget(rootPath, target)
    if (!parsed) continue
    const key = `${parsed.kind}:${parsed.name}`
    if (seen.has(key)) continue
    seen.add(key)
    const paths = entityPaths(rootPath, parsed.directory, parsed.name, input.resources)
    if (!paths.length) {
      unresolvedLinks.push(target)
      continue
    }
    entities.push({ kind: parsed.kind, name: parsed.name, paths })
  }

  return { entities, unresolvedLinks }
}

function wikiLinkTargets(content: string): string[] {
  return [...String(content || '').matchAll(/(?<!!)\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)]
    .map(match => String(match[1] || '').trim())
    .filter(Boolean)
}

function entityTarget(rootPath: string, target: string): { directory: string; kind: ProductionWikiEntityKind; name: string } | null {
  const normalized = trimSlashes(target.replace(/\.md$/i, ''))
  const relative = normalized.startsWith(`${rootPath}/`) ? normalized.slice(rootPath.length + 1) : normalized
  const [directory, name, ...rest] = relative.split('/')
  const match = entityDirectories.find(item => item.directory === directory)
  return match && name && !rest.length ? { ...match, name } : null
}

function entityPaths(rootPath: string, directory: string, name: string, resources: ProductionWikiResource[]): string[] {
  const flatPath = `${rootPath}/${directory}/${name}.md`
  const directoryPrefix = `${rootPath}/${directory}/${name}/`
  return resources
    .filter(resource => !resource.isDirectory && resource.kind === 'document')
    .map(resource => resource.path)
    .filter(path => path === flatPath || path.startsWith(directoryPrefix))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

function trimSlashes(value: string): string {
  return String(value || '').replace(/^\/+|\/+$/g, '')
}
