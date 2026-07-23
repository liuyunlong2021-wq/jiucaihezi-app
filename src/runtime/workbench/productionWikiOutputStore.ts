import type { ProjectFileService } from '@/services/projectFileService'

import { productionWikiOutputPath, type ProductionOutputKind } from './productionWikiOutput'

type Files = Pick<ProjectFileService, 'list' | 'readText' | 'writeText' | 'createText'>

export interface ProductionWikiBindingRecord {
  rootPath: string
  anchorPath: string
  excludedEntityKeys: string[]
  sources: Array<{ path: string; revision: string }>
}

const emptyWikiFolders = [
  'wiki',
  'wiki/世界观',
  'wiki/角色',
  'wiki/场景',
  'wiki/道具',
  'wiki/分镜',
  'wiki/分镜/视频',
]

export async function createProductionWikiSkeleton(
  files: Pick<ProjectFileService, 'list' | 'createFolder'>,
  owner: string,
): Promise<void> {
  const existing = await files.list(owner)
  for (const path of emptyWikiFolders) {
    if (!existing.some(resource => resource.path === path && resource.isDirectory)) {
      await files.createFolder(owner, path)
    }
  }
}

export async function saveProductionWikiBinding(
  files: Files,
  owner: string,
  binding: ProductionWikiBindingRecord,
): Promise<void> {
  const resources = await files.list(owner)
  await save(files, owner, resources, 'wiki/制作/绑定.json', `${JSON.stringify(binding, null, 2)}\n`)
}

export async function readProductionWikiBinding(
  files: Pick<ProjectFileService, 'list' | 'readText'>,
  owner: string,
): Promise<ProductionWikiBindingRecord | null> {
  const resource = (await files.list(owner)).find(item => item.path === 'wiki/制作/绑定.json')
  if (!resource) return null
  try {
    const value = JSON.parse((await files.readText(resource)).content) as Partial<ProductionWikiBindingRecord>
    if (
      typeof value.rootPath !== 'string'
      || typeof value.anchorPath !== 'string'
      || !Array.isArray(value.excludedEntityKeys)
      || !value.excludedEntityKeys.every(key => typeof key === 'string')
      || !Array.isArray(value.sources)
      || !value.sources.every(source => Boolean(source && typeof source.path === 'string' && typeof source.revision === 'string'))
    ) return null
    return {
      rootPath: value.rootPath,
      anchorPath: value.anchorPath,
      excludedEntityKeys: value.excludedEntityKeys,
      sources: value.sources as Array<{ path: string; revision: string }>,
    }
  } catch {
    return null
  }
}

export async function saveProductionWikiOutput(
  files: Files,
  owner: string,
  input: {
    kind: ProductionOutputKind
    name?: string
    content: string
    cards?: Array<{ name: string; prompt: string; sourcePath?: string }>
  },
): Promise<void> {
  const resources = await files.list(owner)
  const outputs: Array<{ name?: string; content: string; sourcePath?: string }> = input.cards?.length
    ? input.cards.map(card => ({ name: card.name, content: card.prompt, sourcePath: card.sourcePath }))
    : [{ name: input.name, content: input.content }]
  for (const output of outputs) {
    const outputPath = productionWikiEntityOutputPath(input.kind, output.sourcePath) || productionWikiOutputPath(input.kind, output.name)
    await save(files, owner, resources, outputPath, output.content)
  }
}

function productionWikiEntityOutputPath(kind: ProductionOutputKind, sourcePath: string | undefined): string | null {
  const directories: Partial<Record<ProductionOutputKind, { directory: string; label: string }>> = {
    character: { directory: '角色', label: '角色' },
    scene: { directory: '场景', label: '场景' },
    prop: { directory: '道具', label: '道具' },
  }
  const definition = directories[kind]
  const normalized = String(sourcePath || '').replace(/^\/+/, '')
  const prefix = definition ? `wiki/${definition.directory}/` : ''
  if (!definition || !normalized.startsWith(prefix)) return null
  const relative = normalized.slice(prefix.length)
  const [entityName, ...rest] = relative.split('/')
  if (!entityName) return null
  if (!rest.length) {
    const base = `${prefix}${entityName.replace(/\.md$/i, '')}`
    return `${base}/制作-${definition.label}提示词.md`
  }
  const base = `${prefix}${entityName}`
  return `${base}/制作-${definition.label}提示词.md`
}

async function save(files: Files, owner: string, resources: Awaited<ReturnType<Files['list']>>, path: string, content: string) {
  const existing = resources.find(resource => resource.path === path)
  if (!existing) return await files.createText(owner, path, content) as unknown as void
  const current = await files.readText(existing)
  const result = await files.writeText(existing, content, current.revision)
  if (result.status !== 'saved') throw new Error('制作结果保存失败')
}
