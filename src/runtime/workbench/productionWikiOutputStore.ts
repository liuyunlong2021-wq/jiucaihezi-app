import type { ProjectFileService } from '@/services/projectFileService'

import {
  productionWikiDesignPath,
  productionWikiOutputPath,
  type ProductionOutputKind,
} from './productionWikiOutput'

type Files = Pick<ProjectFileService, 'list' | 'readText' | 'writeText' | 'createText'>

export interface ProductionRunRecord {
  runId: string
  step: string
  status: string
  modelId: string
  profile: string
  content: string
  createdAt: number
}

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
  'wiki/制作',
  'wiki/制作/运行',
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
    runId: string
    kind: ProductionOutputKind
    name?: string
    content: string
    cards?: Array<{ name: string; prompt: string; sourcePath?: string }>
    record?: { step: string; modelId: string; profile: string; userText: string; sourcePaths: string[] }
  },
): Promise<void> {
  const recordPath = `wiki/制作/运行/${input.runId}.json`
  const resources = await files.list(owner)
  const outputs: Array<{ name?: string; content: string; sourcePath?: string }> = input.cards?.length
    ? input.cards.map(card => ({ name: card.name, content: card.prompt, sourcePath: card.sourcePath }))
    : [{ name: input.name, content: input.content }]
  const wikiPaths: string[] = []

  for (const output of outputs) {
    const linkedPaths = productionWikiEntityOutputPaths(input.kind, output.sourcePath)
    const outputPath = linkedPaths?.outputPath || productionWikiOutputPath(input.kind, output.name)
    const designPath = linkedPaths?.designPath || productionWikiDesignPath(input.kind, output.name)
    const outputContent = outputPath.endsWith('.json')
      ? `${JSON.stringify({ kind: input.kind, name: output.name, content: output.content }, null, 2)}\n`
      : output.content
    await save(files, owner, resources, outputPath, outputContent)
    wikiPaths.push(outputPath)
    if (designPath) {
      await save(files, owner, resources, designPath, `${JSON.stringify({
        kind: input.kind,
        name: output.name,
        content: output.content,
      }, null, 2)}\n`)
      wikiPaths.push(designPath)
    }
  }
  await save(files, owner, resources, recordPath, `${JSON.stringify({
    runId: input.runId,
    kind: input.kind,
    step: input.record?.step,
    modelId: input.record?.modelId,
    profile: input.record ? { id: input.record.profile } : undefined,
    input: input.record ? { userText: input.record.userText, sourcePaths: input.record.sourcePaths } : undefined,
    status: 'succeeded',
    outputPath: wikiPaths[0],
    createdAt: Date.now(),
    result: { content: input.content, wikiPaths, mediaTaskIds: [] },
  }, null, 2)}\n`)
}

function productionWikiEntityOutputPaths(kind: ProductionOutputKind, sourcePath: string | undefined): { outputPath: string; designPath: string } | null {
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
    return {
      outputPath: `${base}.制作-${definition.label}提示词.md`,
      designPath: `${base}.制作-${definition.label}图.design.json`,
    }
  }
  const base = `${prefix}${entityName}`
  return {
    outputPath: `${base}/制作-${definition.label}提示词.md`,
    designPath: `${base}/制作-${definition.label}图.design.json`,
  }
}

export async function saveProductionMediaTask(
  files: Pick<ProjectFileService, 'list' | 'readText' | 'writeText'>,
  owner: string,
  runId: string,
  taskId: string,
): Promise<void> {
  const path = `wiki/制作/运行/${runId}.json`
  const resource = (await files.list(owner)).find(item => item.path === path)
  if (!resource) throw new Error('制作运行记录不存在')
  const current = await files.readText(resource)
  const record = JSON.parse(current.content) as { result?: { mediaTaskIds?: string[] } }
  const mediaTaskIds = [...new Set([...(record.result?.mediaTaskIds || []), taskId])]
  const result = await files.writeText(resource, `${JSON.stringify({
    ...record,
    status: 'media-submitted',
    result: { ...record.result, mediaTaskIds },
  }, null, 2)}\n`, current.revision)
  if (result.status !== 'saved') throw new Error('媒体任务记录保存失败')
}

export async function listProductionRuns(
  files: Pick<ProjectFileService, 'list' | 'readText'>,
  owner: string,
): Promise<ProductionRunRecord[]> {
  const resources = await files.list(owner)
  const records = await Promise.all(resources
    .filter(resource => /^wiki\/制作\/运行\/[^/]+\.json$/.test(resource.path))
    .map(async resource => parseProductionRun((await files.readText(resource)).content)))
  return records.filter((record): record is ProductionRunRecord => Boolean(record))
    .sort((a, b) => b.createdAt - a.createdAt)
}

function parseProductionRun(content: string): ProductionRunRecord | null {
  try {
    const value = JSON.parse(content) as Partial<ProductionRunRecord> & {
      profile?: { id?: string }
      result?: { content?: string }
    }
    if (
      typeof value.runId !== 'string' ||
      typeof value.step !== 'string' ||
      typeof value.status !== 'string' ||
      typeof value.modelId !== 'string' ||
      typeof value.profile?.id !== 'string' ||
      typeof value.result?.content !== 'string' ||
      typeof value.createdAt !== 'number'
    ) return null
    return {
      runId: value.runId,
      step: value.step,
      status: value.status,
      modelId: value.modelId,
      profile: value.profile.id,
      content: value.result.content,
      createdAt: value.createdAt,
    }
  } catch {
    return null
  }
}

async function save(files: Files, owner: string, resources: Awaited<ReturnType<Files['list']>>, path: string, content: string) {
  const existing = resources.find(resource => resource.path === path)
  if (!existing) return await files.createText(owner, path, content) as unknown as void
  const current = await files.readText(existing)
  const result = await files.writeText(existing, content, current.revision)
  if (result.status !== 'saved') throw new Error('制作结果保存失败')
}
