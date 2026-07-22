import type { ProjectFileService } from '@/services/projectFileService'

export type EcommerceHistoryAction = 'reverse-prompt' | 'product-image-plan' | 'product-image'
export type EcommerceHistoryStatus = 'waiting' | 'running' | 'success' | 'failed'

export interface EcommerceHistoryRecord {
  version: 1
  runId: string
  action: EcommerceHistoryAction
  title: string
  modelId: string
  createdAt: number
  status: EcommerceHistoryStatus
  output: string
  thumbnail?: string
  error?: string
}

export function ecommerceHistoryRecordPath(runId: string): string {
  const id = String(runId || '').trim()
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('工作台运行 ID 无效')
  return `jc-media/ecommerce/${id}/record.json`
}

export function createEcommerceHistoryRecord(input: {
  runId: string
  action: EcommerceHistoryAction
  modelId: string
  status: EcommerceHistoryStatus
  output?: string
  thumbnail?: string
  error?: string
  title?: string
  createdAt?: number
}): EcommerceHistoryRecord {
  return {
    version: 1,
    runId: String(input.runId),
    action: input.action,
    title: input.title || (input.action === 'reverse-prompt' ? '参考图反推' : '商品图'),
    modelId: String(input.modelId),
    createdAt: input.createdAt ?? Date.now(),
    status: input.status,
    output: String(input.output || ''),
    ...(input.thumbnail ? { thumbnail: input.thumbnail } : {}),
    ...(input.error ? { error: input.error } : {}),
  }
}

function parseRecord(content: string): EcommerceHistoryRecord | null {
  try {
    const value = JSON.parse(content) as Partial<EcommerceHistoryRecord>
    if (
      value.version !== 1 ||
      typeof value.runId !== 'string' ||
      !['reverse-prompt', 'product-image-plan', 'product-image'].includes(String(value.action)) ||
      typeof value.title !== 'string' ||
      typeof value.modelId !== 'string' ||
      typeof value.createdAt !== 'number' ||
      !['waiting', 'running', 'success', 'failed'].includes(String(value.status)) ||
      typeof value.output !== 'string'
    ) return null
    return value as EcommerceHistoryRecord
  } catch {
    return null
  }
}

export async function saveEcommerceHistory(
  files: Pick<ProjectFileService, 'list' | 'readText' | 'writeText' | 'createText'>,
  owner: string,
  record: EcommerceHistoryRecord,
): Promise<void> {
  if (!owner) return
  const path = ecommerceHistoryRecordPath(record.runId)
  const existing = (await files.list(owner)).find(resource => resource.path === path)
  const content = `${JSON.stringify(record, null, 2)}\n`
  if (!existing) {
    await files.createText(owner, path, content)
    return
  }
  const current = await files.readText(existing)
  const result = await files.writeText(existing, content, current.revision)
  if (result.status !== 'saved') throw new Error('工作台记录保存失败')
}

export async function listEcommerceHistory(
  files: Pick<ProjectFileService, 'list' | 'readText'>,
  owner: string,
): Promise<EcommerceHistoryRecord[]> {
  if (!owner) return []
  const resources = await files.list(owner)
  const records = await Promise.all(resources
    .filter(resource => /^jc-media\/ecommerce\/[^/]+\/record\.json$/.test(resource.path))
    .map(async resource => parseRecord((await files.readText(resource)).content)))
  return records.filter((record): record is EcommerceHistoryRecord => Boolean(record))
    .sort((a, b) => b.createdAt - a.createdAt)
}
