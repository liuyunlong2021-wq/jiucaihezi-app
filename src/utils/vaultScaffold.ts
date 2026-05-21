import type { VaultEnhancementConfig, VaultFolderSemantic } from './vaultCompilerCore'
import { createDefaultVaultEnhancement } from './vaultCompilerCore'

export interface VaultSeedPageSpec {
  path: string
  title?: string
  summary?: string
  content?: string
  sources?: string[]
  tags?: string[]
  confidence?: 'high' | 'medium' | 'low' | string
}

export interface VaultScaffoldInput {
  name: string
  oneLineDesc?: string
  description?: string
  keywords?: string[]
  rawFolders?: string[]
  wikiFolders?: string[]
  templateRulebook?: string
  seedPages?: VaultSeedPageSpec[]
  enhancement?: VaultEnhancementConfig
}

export interface VaultScaffold {
  claudeMd: string
  rawFolders: string[]
  wikiFolders: string[]
  rootFiles: Array<{ name: string; content: string; metadata?: Record<string, unknown> }>
  wikiFiles: Array<{ path: string; content: string; metadata?: Record<string, unknown> }>
  templateFiles: Array<{ path: string; content: string }>
  reportFolders: string[]
  enhancement: VaultEnhancementConfig
}

const DEFAULT_RAW_FOLDERS = ['对话记录', '上传资料', '原始文件', '转换后的MD']
const DEFAULT_WIKI_FOLDERS = ['meta']
const DEFAULT_REPORT_FOLDERS = ['整理记录', '健康检查', '冲突报告', '覆盖率报告']

const WIKI_SYSTEM_FILES = new Set(['index.md', 'overview.md', 'hot.md', 'log.md'])

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = normalizeVaultPath(String(value || ''))
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

export function normalizeVaultPath(path: string): string {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')
    .trim()
    .split('/')
    .filter(part => part && part !== '.' && part !== '..')
    .join('/')
}

function stripWikiPrefix(path: string): string {
  return normalizeVaultPath(path).replace(/^wiki\//, '')
}

function stripRawPrefix(path: string): string {
  return normalizeVaultPath(path).replace(/^raw\//, '')
}

function cleanPagePath(path: string, fallback: string): string {
  let normalized = stripWikiPrefix(path || fallback)
  if (!normalized) normalized = fallback
  if (!/\.(md|markdown)$/i.test(normalized)) normalized += '.md'
  return normalized
}

function escapeFrontmatterValue(value: unknown): string {
  return String(value || '')
    .replace(/\r?\n/g, ' ')
    .replace(/"/g, '\\"')
    .trim()
}

function yamlList(items: string[] = []): string {
  const cleaned = items.map(item => escapeFrontmatterValue(item)).filter(Boolean)
  return `[${cleaned.map(item => `"${item}"`).join(', ')}]`
}

function headingFromPath(path: string): string {
  const fileName = stripWikiPrefix(path).split('/').pop() || '未命名'
  return fileName.replace(/\.(md|markdown)$/i, '')
}

function buildClaudeMd(input: VaultScaffoldInput, wikiFolders: string[], rawFolders: string[]): string {
  const keywords = (input.keywords || []).filter(Boolean).join('、') || '未设置'
  const desc = input.oneLineDesc || input.description || '这个知识库用于沉淀用户资料、对话记录和可复用知识。'
  const wikiList = wikiFolders.length
    ? wikiFolders.map(folder => `- wiki/${folder}`).join('\n')
    : '- wiki/'
  const rawList = rawFolders.map(folder => `- raw/${folder}`).join('\n')
  const templateRules = input.templateRulebook?.trim()

  return [
    `# ${input.name || '知识库'} 使用说明`,
    '',
    '## 定位',
    desc,
    '',
    `关键词：${keywords}`,
    '',
    '## 固定目录',
    '',
    '### raw/',
    '原始资料层。保留上传文件、转换后的 Markdown 和对话记录，不做破坏性改写。',
    rawList,
    '',
    '### wiki/',
    '结构化知识层。只放适合检索、引用、复用和继续编辑的 Markdown 页面。',
    wikiList,
    '',
    '### _reports/',
    '审计层。每次整理、健康检查、冲突处理和覆盖率检查都必须留下报告。',
    '',
    '## 检索规则',
    '- 先查 wiki/index.md、wiki/hot.md 和相关 wiki 页面。',
    '- wiki 没有命中时，再查 raw/转换后的MD 和 raw/对话记录。',
    '- raw 仍然没有命中时，可以基于模型能力回答，但要标记为候选知识。',
    '- 输出中涉及知识库事实时，优先附带来源路径。',
    '',
    '## 写回规则',
    '- 高价值对话和生成结果应沉淀为 wiki 页面或追加到已有页面。',
    '- 不要把一次性闲聊写入 wiki。',
    '- 发现重复讨论的主题时，优先建议新增 wiki 栏目。',
    '- 发现冲突信息时，不要覆盖旧内容，写入 _reports/冲突报告。',
    '',
    templateRules ? ['## 模板补充规则', templateRules].join('\n\n') : '',
  ].filter(Boolean).join('\n')
}

function buildWikiIndex(input: VaultScaffoldInput, wikiFolders: string[], seedPages: VaultSeedPageSpec[]): string {
  const folderLines = wikiFolders
    .filter(folder => folder !== 'meta')
    .map(folder => `- [[${folder}]]`)
  const pageLines = seedPages.map(page => `- [[${cleanPagePath(page.path, page.title || '知识页')}]]${page.summary ? `：${page.summary}` : ''}`)

  return [
    '# 知识库索引',
    '',
    input.oneLineDesc || input.description || '这里是当前知识库的主目录。',
    '',
    '## 主要栏目',
    folderLines.length ? folderLines.join('\n') : '- 暂无领域栏目，后续会在整理中自动补齐。',
    '',
    '## 首版页面',
    pageLines.length ? pageLines.join('\n') : '- 暂无首版页面。上传资料整理后会生成。',
    '',
    '## 使用建议',
    '- 对话时优先引用本索引中的栏目和页面。',
    '- 新产生的重要知识应写回对应栏目。',
  ].join('\n')
}

function buildOverview(input: VaultScaffoldInput, seedPages: VaultSeedPageSpec[]): string {
  const summaries = seedPages
    .filter(page => page.summary)
    .slice(0, 12)
    .map(page => `- ${page.title || headingFromPath(page.path)}：${page.summary}`)

  return [
    '# 总览',
    '',
    input.oneLineDesc || input.description || '这个页面用于保存当前知识库的整体概述。',
    '',
    '## 首版摘要',
    summaries.length ? summaries.join('\n') : '- 还没有足够资料生成摘要。',
  ].join('\n')
}

function buildHot(input: VaultScaffoldInput, seedPages: VaultSeedPageSpec[]): string {
  const hotPages = seedPages.slice(0, 8).map(page => `- [[${cleanPagePath(page.path, page.title || '知识页')}]]`)
  return [
    '# 最近上下文',
    '',
    '这个页面保存近期高频使用、正在整理或对当前任务最重要的知识。',
    '',
    '## 当前推荐',
    hotPages.length ? hotPages.join('\n') : '- 暂无近期推荐。',
    '',
    `更新时间：${new Date().toLocaleString('zh-CN')}`,
    input.name ? `知识库：${input.name}` : '',
  ].filter(Boolean).join('\n')
}

function buildLog(): string {
  return [
    '# 操作日志',
    '',
    `- ${new Date().toLocaleString('zh-CN')} 创建知识库 2.0 脚手架。`,
  ].join('\n')
}

function buildDashboard(input: VaultScaffoldInput, wikiFolders: string[], rawFolders: string[]): string {
  return [
    '# 知识库仪表盘',
    '',
    `知识库：${input.name || '未命名知识库'}`,
    '',
    '## 状态',
    '- 健康状态：待检查',
    '- 未整理资料：待统计',
    '- 冲突内容：待检查',
    '- 建议新增栏目：待检查',
    '',
    '## 目录统计',
    `- raw 子目录：${rawFolders.length}`,
    `- wiki 子目录：${wikiFolders.length}`,
  ].join('\n')
}

function buildHealth(): string {
  return [
    '# 健康检查',
    '',
    '最近一次健康检查尚未执行。',
    '',
    '## 检查项',
    '- 未整理资料',
    '- 缺失引用',
    '- 冲突内容',
    '- 建议新增栏目',
  ].join('\n')
}

function buildSeedPageMarkdown(page: VaultSeedPageSpec): string {
  const path = cleanPagePath(page.path, page.title || '知识页')
  const title = page.title || headingFromPath(path)
  const body = String(page.content || page.summary || '').trim()

  return [
    '---',
    'pageType: wiki',
    `status: first-draft`,
    `confidence: ${escapeFrontmatterValue(page.confidence || 'medium') || 'medium'}`,
    `tags: ${yamlList(page.tags || [])}`,
    `sources: ${yamlList(page.sources || [])}`,
    `updatedAt: ${Date.now()}`,
    '---',
    '',
    `# ${title}`,
    '',
    page.summary ? ['## 摘要', page.summary].join('\n\n') : '',
    body && body !== page.summary ? ['## 内容', body].join('\n\n') : '',
    ['## 适用场景', '- 适合在相关问题、资料检索和后续生成任务中引用。'].join('\n'),
    ['## 相关页面', '- 待整理'].join('\n'),
    page.sources?.length ? ['## 来源', ...page.sources.map(source => `- ${source}`)].join('\n') : '',
  ].filter(Boolean).join('\n\n')
}

function buildTemplateFiles(): VaultScaffold['templateFiles'] {
  return [
    {
      path: 'entity.md',
      content: [
        '---',
        'pageType: entity',
        'status: developing',
        'confidence: medium',
        'tags: []',
        'sources: []',
        '---',
        '',
        '# {{实体名称}}',
        '',
        '## 摘要',
        '',
        '## 关键事实',
        '',
        '## 相关页面',
        '',
        '## 来源',
      ].join('\n'),
    },
    {
      path: 'concept.md',
      content: [
        '---',
        'pageType: concept',
        'status: developing',
        'confidence: medium',
        'tags: []',
        'sources: []',
        '---',
        '',
        '# {{概念名称}}',
        '',
        '## 定义',
        '',
        '## 适用场景',
        '',
        '## 常见误区',
        '',
        '## 来源',
      ].join('\n'),
    },
    {
      path: 'source.md',
      content: [
        '---',
        'pageType: source',
        'status: active',
        'confidence: high',
        'tags: []',
        'sources: []',
        '---',
        '',
        '# {{资料名称}}',
        '',
        '## 资料信息',
        '',
        '## 结构摘要',
        '',
        '## 可提取知识',
      ].join('\n'),
    },
    {
      path: 'question.md',
      content: [
        '---',
        'pageType: question',
        'status: open',
        'confidence: low',
        'tags: []',
        'sources: []',
        '---',
        '',
        '# {{问题}}',
        '',
        '## 当前答案',
        '',
        '## 证据',
        '',
        '## 待确认',
      ].join('\n'),
    },
  ]
}

function collectWikiFolders(inputFolders: string[], seedPages: VaultSeedPageSpec[]): string[] {
  const seedFolders = seedPages
    .map(page => {
      const path = cleanPagePath(page.path, page.title || '知识页')
      const parts = path.split('/')
      parts.pop()
      return parts.join('/')
    })
    .filter(Boolean)

  return uniqueStrings([
    ...DEFAULT_WIKI_FOLDERS,
    ...inputFolders.map(stripWikiPrefix),
    ...seedFolders,
  ])
}

function mergeEnhancementWithScaffold(
  input: VaultScaffoldInput,
  wikiFolders: string[],
  rawFolders: string[],
): VaultEnhancementConfig {
  const base = input.enhancement || createDefaultVaultEnhancement({
    rawFolders,
    wikiFolders,
    keywords: input.keywords || [],
    oneLineDesc: input.oneLineDesc || input.description || '',
  })
  const generated = createDefaultVaultEnhancement({
    rawFolders,
    wikiFolders,
    keywords: input.keywords || [],
    oneLineDesc: input.oneLineDesc || input.description || '',
  })

  return {
    ...generated,
    ...base,
    retrievalRules: base.retrievalRules?.length ? base.retrievalRules : generated.retrievalRules,
    writebackRules: base.writebackRules?.length ? base.writebackRules : generated.writebackRules,
    contextPackRules: {
      ...generated.contextPackRules,
      ...(base.contextPackRules || {}),
    },
    folderSemantics: {
      ...(generated.folderSemantics || {}),
      ...(base.folderSemantics || {}),
      'wiki/meta': {
        description: '知识库运行状态、健康检查和仪表盘',
        tags: ['meta', 'health', 'dashboard'],
        priority: 3,
      } satisfies VaultFolderSemantic,
    },
  }
}

export function buildVaultScaffold(input: VaultScaffoldInput): VaultScaffold {
  const seedPages = input.seedPages || []
  const rawFolders = uniqueStrings([
    ...DEFAULT_RAW_FOLDERS,
    ...(input.rawFolders || []).map(stripRawPrefix),
  ])
  const wikiFolders = collectWikiFolders(input.wikiFolders || [], seedPages)
  const enhancement = mergeEnhancementWithScaffold(input, wikiFolders, rawFolders)
  const claudeMd = buildClaudeMd(input, wikiFolders, rawFolders)

  const wikiFiles: VaultScaffold['wikiFiles'] = [
    { path: 'index.md', content: buildWikiIndex(input, wikiFolders, seedPages), metadata: { kind: 'vault-index' } },
    { path: 'overview.md', content: buildOverview(input, seedPages), metadata: { kind: 'vault-overview' } },
    { path: 'hot.md', content: buildHot(input, seedPages), metadata: { kind: 'vault-hot-cache' } },
    { path: 'log.md', content: buildLog(), metadata: { kind: 'vault-log' } },
    { path: 'meta/dashboard.md', content: buildDashboard(input, wikiFolders, rawFolders), metadata: { kind: 'vault-dashboard' } },
    { path: 'meta/health.md', content: buildHealth(), metadata: { kind: 'vault-health' } },
    ...seedPages.map(page => {
      const path = cleanPagePath(page.path, page.title || '知识页')
      return {
        path,
        content: buildSeedPageMarkdown({ ...page, path }),
        metadata: {
          kind: 'wiki-page',
          seed: true,
          sources: page.sources || [],
          confidence: page.confidence || 'medium',
        },
      }
    }),
  ].filter((file, index, files) => {
    const path = normalizeVaultPath(file.path)
    if (!path) return false
    return files.findIndex(other => normalizeVaultPath(other.path) === path) === index
  })

  return {
    claudeMd,
    rawFolders,
    wikiFolders,
    rootFiles: [
      { name: 'CLAUDE.md', content: claudeMd, metadata: { vaultFolder: 'root', isConfig: true } },
    ],
    wikiFiles,
    templateFiles: buildTemplateFiles(),
    reportFolders: [...DEFAULT_REPORT_FOLDERS],
    enhancement,
  }
}

export function parentFoldersForWikiFile(path: string): string[] {
  const normalized = stripWikiPrefix(path)
  const parts = normalized.split('/').filter(Boolean)
  const fileName = parts.at(-1) || ''
  if (WIKI_SYSTEM_FILES.has(fileName) || parts.length <= 1) return []
  parts.pop()
  const result: string[] = []
  for (let i = 1; i <= parts.length; i++) {
    result.push(parts.slice(0, i).join('/'))
  }
  return result
}
