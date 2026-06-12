export interface ProgressiveRawFile {
  id: string
  name: string
  content: string
  metadata?: Record<string, unknown>
}

export interface ProgressiveOrganizeCandidate {
  id: string
  rawId: string
  rawName: string
  chunkHash: string
  title: string
  targetPath: string
  content: string
  reason: string
  status: 'candidate'
  sources: string[]
}

export interface ProgressiveOrganizePlan {
  rawCount: number
  candidates: ProgressiveOrganizeCandidate[]
  newFolderSuggestions: string[]
  skippedRawIds: string[]
}

interface RawSection {
  raw: ProgressiveRawFile
  title: string
  content: string
}

function cleanName(value: string): string {
  return String(value || '未命名')
    .replace(/^#+\s*/, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 60) || '未命名'
}

function chunkHash(section: Pick<RawSection, 'title' | 'content'>): string {
  const text = `${section.title}\n${section.content}`.replace(/\s+/g, ' ').trim()
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function organizedChunkHashes(raw: ProgressiveRawFile): Set<string> {
  const value = raw.metadata?.organizedChunkHashes
  return new Set(Array.isArray(value) ? value.map(item => String(item)) : [])
}

function extractSections(raw: ProgressiveRawFile): RawSection[] {
  const lines = String(raw.content || '').split(/\r?\n/)
  const sections: RawSection[] = []
  let title = ''
  let buffer: string[] = []

  function push() {
    const body = buffer.join('\n').trim()
    if (title && body) sections.push({ raw, title: cleanName(title), content: body })
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+?)\s*$/)
    if (heading) {
      if (title) push()
      title = heading[2]
      buffer = []
      continue
    }
    if (title) buffer.push(line)
  }
  if (title) push()

  if (sections.length === 0 && raw.content.trim()) {
    sections.push({ raw, title: cleanName(raw.name.replace(/\.[^.]+$/, '')), content: raw.content.trim() })
  }
  return sections
}

function inferFolder(section: RawSection, wikiFolders: string[]): string {
  const text = `${section.title}\n${section.content}`
  const candidates: Array<[RegExp, string]> = [
    [/角色|男主|女主|人物|主角|配角/, '角色'],
    [/文风|风格|语气|表达|写法/, '风格'],
    [/道具|物品|武器|钥匙|装备/, '道具'],
    [/世界观|势力|地理|历史|规则|设定/, '世界观'],
    [/流程|步骤|操作|执行|复盘/, '流程'],
    [/模板|公式|清单|表格/, '模板'],
    [/问题|为什么|怎么办|FAQ/, 'FAQ'],
  ]
  const matched = candidates.find(([regex]) => regex.test(text))?.[1] || '沉淀内容'
  const existing = wikiFolders.find(folder => folder === matched || folder.startsWith(`${matched}/`) || folder.includes(matched))
  return existing ? existing.split('/')[0] : matched
}

function buildCandidate(section: RawSection, folder: string, index: number): ProgressiveOrganizeCandidate {
  const title = cleanName(section.title)
  const targetPath = `wiki/${folder}/${title}.md`
  const source = `raw/${section.raw.name}#${title}`
  return {
    id: `candidate_${section.raw.id}_${index}`,
    rawId: section.raw.id,
    rawName: section.raw.name,
    chunkHash: chunkHash(section),
    title,
    targetPath,
    content: [
      `# ${title}`,
      '',
      '## 新增内容',
      section.content.trim(),
      '',
      '## 来源',
      `- ${source}`,
    ].join('\n'),
    reason: `从 ${section.raw.name} 提取到可复用知识，建议写入 ${folder}。`,
    status: 'candidate',
    sources: [source],
  }
}

export function buildProgressiveOrganizePlan(input: {
  rawFiles: ProgressiveRawFile[]
  wikiFolders: string[]
  maxCandidates?: number
}): ProgressiveOrganizePlan {
  const maxCandidates = Math.max(1, Math.min(30, input.maxCandidates || 20))
  const candidates: ProgressiveOrganizeCandidate[] = []
  const suggestions = new Set<string>()
  const existingTopFolders = new Set((input.wikiFolders || []).map(folder => folder.split('/')[0]).filter(Boolean))
  const skippedRawIds: string[] = []

  for (const raw of input.rawFiles || []) {
    const sections = extractSections(raw)
    if (sections.length === 0) {
      skippedRawIds.push(raw.id)
      continue
    }
    const organized = organizedChunkHashes(raw)
    let addedForRaw = 0
    for (const section of sections) {
      if (candidates.length >= maxCandidates) break
      if (organized.has(chunkHash(section))) continue
      if (section.content.replace(/\s+/g, '').length < 6) continue
      const folder = inferFolder(section, input.wikiFolders || [])
      if (!existingTopFolders.has(folder)) suggestions.add(folder)
      candidates.push(buildCandidate(section, folder, candidates.length + 1))
      addedForRaw++
    }
    if (addedForRaw === 0) skippedRawIds.push(raw.id)
  }

  return {
    rawCount: (input.rawFiles || []).length,
    candidates,
    newFolderSuggestions: Array.from(suggestions),
    skippedRawIds,
  }
}

export function buildProgressiveOrganizeReport(vaultName: string, plan: ProgressiveOrganizePlan): string {
  return [
    `# ${vaultName || '知识库'} 渐进整理候选报告`,
    '',
    `- 时间：${new Date().toLocaleString('zh-CN')}`,
    `- 读取 raw：${plan.rawCount}`,
    `- 候选更新：${plan.candidates.length}`,
    `- 建议新增栏目：${plan.newFolderSuggestions.length}`,
    `- 跳过 raw：${plan.skippedRawIds.length}`,
    '',
    '## 候选更新',
    ...(plan.candidates.length
      ? plan.candidates.map(candidate => `- [pending] ${candidate.targetPath}：${candidate.reason}`)
      : ['- 无']),
    '',
    '## 建议新增栏目',
    ...(plan.newFolderSuggestions.length
      ? plan.newFolderSuggestions.map(folder => `- ${folder}`)
      : ['- 无']),
  ].join('\n')
}
