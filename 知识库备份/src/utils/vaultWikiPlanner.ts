import type { WikiAction } from './vaultOrganizeActions'
import type { VaultSourceChunk } from './vaultChunking'

export interface VaultWikiPlanResult {
  chunkCount: number
  actions: WikiAction[]
  newFolders: string[]
  skippedRawIds: string[]
}

function cleanName(value: string, fallback = '未命名'): string {
  return String(value || fallback)
    .replace(/^#+\s*/, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 60) || fallback
}

function summarize(text: string, max = 160): string {
  return String(text || '')
    .replace(/^#+\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max) || '待补充'
}

function organizedChunkHashes(chunk: VaultSourceChunk): Set<string> {
  const value = chunk.metadata?.organizedChunkHashes
  return new Set(Array.isArray(value) ? value.map(item => String(item)) : [])
}

const FOLDER_ALIASES: Record<string, string[]> = {
  人物: ['人物', '角色', '主角', '配角', '档案'],
  角色: ['人物', '角色', '主角', '配角', '档案'],
  关系: ['关系', '感情', '情感', '羁绊', '纠葛'],
  事件线: ['事件线', '时间线', '年表', '感情线', '情感线', '进展'],
  章节索引: ['章节', '章回', '索引'],
  案由: ['案由', '罪名', '纠纷', '构成要件'],
  案件: ['案件', '案例', '案卷', '案号'],
  文书模板: ['文书', '模板', '诉状', '起诉状', '答辩状', '代理词', '辩护词'],
  办案策略: ['策略', '办案', '打法', '处理方案'],
}

function folderMatches(folder: string, term: string): boolean {
  const value = String(folder || '')
  const aliases = FOLDER_ALIASES[term] || [term]
  return aliases.some(alias => value === alias || value.includes(alias) || alias.includes(value))
}

function firstExistingFolder(preferred: string[], wikiFolders: string[], fallback: string): string {
  for (const folder of wikiFolders || []) {
    if (preferred.some(term => folderMatches(folder, term))) return folder.split('/')[0]
  }
  return preferred[0] || fallback
}

function inferPageTypeAndFolder(chunk: VaultSourceChunk, wikiFolders: string[]): { pageType: string; folder: string } {
  const text = `${chunk.title}\n${chunk.headingPath.join(' ')}\n${chunk.text}`
  const documentType = String(chunk.metadata.documentType || '')

  if (Number(chunk.metadata.chapterNumber || 0) > 0 || /第\s*[0-9０-９一二三四五六七八九十百千]+\s*[章节回]/.test(text)) {
    return { pageType: 'chapter', folder: firstExistingFolder(['章节索引'], wikiFolders, '章节索引') }
  }
  if (chunk.metadata.caseNumber) {
    return { pageType: 'case', folder: firstExistingFolder(['案件'], wikiFolders, '案件') }
  }
  if (/起诉状|答辩状|代理词|辩护词|证据清单/.test(documentType || text)) {
    return { pageType: 'template', folder: firstExistingFolder(['文书模板', '模板'], wikiFolders, '文书模板') }
  }
  if (/故意伤害|案由|构成要件/.test(text)) {
    return { pageType: 'caseCause', folder: firstExistingFolder(['案由'], wikiFolders, '案由') }
  }
  if (/男主|女主|人物|角色|主角|配角/.test(text)) {
    return { pageType: 'character', folder: firstExistingFolder(['人物', '角色'], wikiFolders, '人物') }
  }
  if (/爱情|感情|关系|冲突|纠葛/.test(text)) {
    return { pageType: 'relationship', folder: firstExistingFolder(['关系', '事件线'], wikiFolders, '关系') }
  }
  if (/事件线|时间线|进展|经历/.test(text)) {
    return { pageType: 'eventline', folder: firstExistingFolder(['事件线'], wikiFolders, '事件线') }
  }
  if (/文风|风格|语气|表达|写法/.test(text)) {
    return { pageType: 'style', folder: firstExistingFolder(['风格'], wikiFolders, '风格') }
  }
  if (/道具|物品|武器|钥匙|装备/.test(text)) {
    return { pageType: 'prop', folder: firstExistingFolder(['道具'], wikiFolders, '道具') }
  }
  if (/世界观|势力|地理|历史|规则|设定/.test(text)) {
    return { pageType: 'worldbuilding', folder: firstExistingFolder(['世界观'], wikiFolders, '世界观') }
  }
  if (/流程|步骤|操作|执行|复盘|阶段|第一步|第二步/.test(text)) {
    return { pageType: 'process', folder: firstExistingFolder(['流程', '办案策略'], wikiFolders, '流程') }
  }
  if (/模板|公式|清单|表格|范例|示例/.test(text)) {
    return { pageType: 'template', folder: firstExistingFolder(['模板', '文书模板'], wikiFolders, '模板') }
  }
  if (/案例|项目|复盘|样例/.test(text)) {
    return { pageType: 'case', folder: firstExistingFolder(['案例', '案件'], wikiFolders, '案例') }
  }
  return { pageType: 'wiki', folder: firstExistingFolder(['沉淀内容'], wikiFolders, '沉淀内容') }
}

function sourceFor(chunk: VaultSourceChunk): string {
  return `${chunk.sourcePath}${chunk.anchor}`
}

function buildWikiAction(chunk: VaultSourceChunk, wikiFolders: string[]): WikiAction {
  const { pageType, folder } = inferPageTypeAndFolder(chunk, wikiFolders)
  const title = cleanName(chunk.title)
  const source = sourceFor(chunk)
  const content = [
    '---',
    `pageType: ${pageType}`,
    'status: active',
    'confidence: medium',
    `tags: ["${folder.replace(/"/g, '\\"')}"]`,
    'sources:',
    `  - ${source}`,
    'sourceChunks:',
    `  - ${chunk.id}`,
    `updatedAt: ${Date.now()}`,
    '---',
    '',
    `# ${title}`,
    '',
    '## 摘要',
    summarize(chunk.text),
    '',
    '## 关键事实',
    chunk.text.trim(),
    '',
    '## 来源',
    `- ${source}`,
  ].join('\n')

  return {
    type: 'create',
    path: `wiki/${folder}/${title}.md`,
    content,
    sources: [source],
    sourceChunkIds: [chunk.id],
    rawId: chunk.rawId,
    chunkHash: chunk.chunkHash,
  }
}

export function buildVaultWikiPlan(input: {
  chunks: VaultSourceChunk[]
  wikiFolders: string[]
  maxActions?: number
}): VaultWikiPlanResult {
  const maxActions = Math.max(1, Math.min(80, input.maxActions || 40))
  const actions: WikiAction[] = []
  const newFolders = new Set<string>()
  const rawIds = new Set<string>()
  const rawIdsWithActions = new Set<string>()
  const existingTopFolders = new Set((input.wikiFolders || []).map(folder => folder.split('/')[0]).filter(Boolean))

  for (const chunk of input.chunks || []) {
    rawIds.add(chunk.rawId)
    if (actions.length >= maxActions) break
    if (organizedChunkHashes(chunk).has(chunk.chunkHash)) continue
    const action = buildWikiAction(chunk, input.wikiFolders || [])
    const topFolder = action.path.replace(/^wiki\//, '').split('/')[0]
    if (topFolder && !existingTopFolders.has(topFolder)) newFolders.add(topFolder)
    actions.push(action)
    rawIdsWithActions.add(chunk.rawId)
  }

  return {
    chunkCount: (input.chunks || []).length,
    actions,
    newFolders: Array.from(newFolders),
    skippedRawIds: Array.from(rawIds).filter(rawId => !rawIdsWithActions.has(rawId)),
  }
}
