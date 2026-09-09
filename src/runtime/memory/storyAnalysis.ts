import type { ProjectFileService } from '@/services/projectFileService'
import type { ProjectResource, ProjectTextRead } from '@/utils/projectResource'
import { hashText } from './markdownSplit'
import { safeWikiSegment, upsertWikiIndex, withStoryWorkflowLock } from './storyImport'

type AssetKind = 'characters' | 'scenes' | 'props'

export interface StoryAnalysisFact {
  name: string
  description: string
  evidence: string[]
}

export interface StoryAnalysisRelation {
  subject: string
  predicate: string
  object: string
  description: string
  evidence: string[]
}

export interface StoryAnalysisSubmission {
  node_id: string
  source_hash: string
  summary: string
  scenes: StoryAnalysisFact[]
  characters: StoryAnalysisFact[]
  props: StoryAnalysisFact[]
  relations: StoryAnalysisRelation[]
  evidence: string[]
  needs_review: string[]
  expected_analysis_revision?: string
}

export interface PreparedStoryAnalysisNode {
  nodeId: string
  sourceHash: string
  sourceLabel: string
  sourcePath: string
  sourceContent: string
  analysisStatus: 'unprocessed' | 'needs_review'
  analysisContent?: string
  expectedAnalysisRevision?: string
}

export interface PreparedStoryAnalysis {
  workDirectory: string
  nodes: PreparedStoryAnalysisNode[]
  assetIndexes: Array<{ path: string; content: string }>
}

export interface StoryAnalysisCommitResult {
  committed: string[]
  skipped: string[]
  needs_review: string[]
  conflicts: string[]
  affected_paths: string[]
}

const ASSET_DIRECTORIES: Record<AssetKind | 'relations', string> = {
  characters: '人物',
  scenes: '场景',
  props: '道具',
  relations: '关系',
}

const ASSET_TYPES: Record<AssetKind | 'relations', string> = {
  characters: 'story-character',
  scenes: 'story-scene',
  props: 'story-prop',
  relations: 'story-relation',
}

function normalizeWorkDirectory(value: string): {
  workDirectory: string
  wikiRoot: 'wiki' | 'docs/wiki'
  work: string
} {
  const workDirectory = String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '')
  const match = workDirectory.match(/^(wiki|docs\/wiki)\/原始材料\/([^/]+)$/u)
  if (!match || match[2] === '.' || match[2] === '..' || workDirectory.includes('\0')) {
    throw new Error('故事目录必须是当前 Wiki 的单个作品目录')
  }
  return { workDirectory, wikiRoot: match[1] as 'wiki' | 'docs/wiki', work: match[2]! }
}

function parsePage(content: string): {
  fields: Record<string, string>
  body: string
  aliases: string[]
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { fields: {}, body: content, aliases: [] }
  const fields: Record<string, string> = {}
  const lines = match[1]!.split(/\r?\n/)
  for (const line of lines) {
    const field = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (field) fields[field[1]!] = decodeScalar(field[2]!)
  }
  const aliases: string[] = []
  const inlineAliases = fields.aliases
  if (inlineAliases) {
    try {
      const parsed = JSON.parse(inlineAliases)
      if (Array.isArray(parsed)) aliases.push(...parsed.map(String))
      else aliases.push(inlineAliases)
    } catch {
      aliases.push(
        ...inlineAliases
          .replace(/^\[|\]$/g, '')
          .split(',')
          .map(item => item.trim())
          .filter(Boolean),
      )
    }
  }
  const aliasesLine = lines.findIndex(line => /^aliases:\s*$/.test(line))
  if (aliasesLine >= 0) {
    for (const line of lines.slice(aliasesLine + 1)) {
      const item = line.match(/^\s+-\s+(.+)$/)
      if (!item) break
      aliases.push(decodeScalar(item[1]!))
    }
  }
  let body = content.slice(match[0].length)
  if (body.startsWith('\n')) body = body.slice(1)
  return { fields, body, aliases }
}

function decodeScalar(value: string): string {
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'string' ? parsed : value
  } catch {
    return value.replace(/^['"]|['"]$/g, '')
  }
}

function normalizedName(value: string): string {
  return value.normalize('NFC').trim().toLocaleLowerCase()
}

function directMarkdownPages(resources: ProjectResource[], directory: string): ProjectResource[] {
  const prefix = `${directory}/`
  return resources.filter(
    resource =>
      !resource.isDirectory &&
      resource.path.startsWith(prefix) &&
      !resource.path.slice(prefix.length).includes('/') &&
      /\.md$/i.test(resource.path) &&
      !resource.path.endsWith('/index.md'),
  )
}

export async function prepareStoryAnalysis(
  input: { workDirectory: string; limit?: number; includeNeedsReview?: boolean },
  files: ProjectFileService,
  owner: string,
): Promise<PreparedStoryAnalysis> {
  const { workDirectory, wikiRoot } = normalizeWorkDirectory(input.workDirectory)
  const limit = Math.max(1, Math.min(Math.floor(input.limit || 1), 10))
  const resources = await files.list(owner)
  const sourceDirectory = `${workDirectory}/原文节点`
  const analysisDirectory = `${workDirectory}/节点分析`
  const sourcePages = directMarkdownPages(resources, sourceDirectory)
    .filter(
      resource => /\/[0-9]{4}\.md$/u.test(resource.path) && !resource.path.endsWith('/0000.md'),
    )
    .sort((a, b) => a.path.localeCompare(b.path))
  if (!sourcePages.length) throw new Error(`没有可分析的原文节点：${sourceDirectory}`)
  const resourceByPath = new Map(resources.map(resource => [resource.path, resource]))
  const nodes: PreparedStoryAnalysisNode[] = []
  for (const resource of sourcePages) {
    const source = await files.readText(resource)
    const parsed = parsePage(source.content)
    const nodeId = parsed.fields.id
    const sourceHash = parsed.fields.source_hash
    if (!nodeId || !sourceHash || (await hashText(parsed.body)) !== sourceHash) {
      throw new Error(`原文节点身份或哈希无效：${resource.path}`)
    }
    const filename = resource.path.split('/').at(-1)!
    const analysisPath = `${analysisDirectory}/${filename}`
    const analysisResource = resourceByPath.get(analysisPath)
    const analysis = analysisResource ? await files.readText(analysisResource) : null
    const status = analysis ? parsePage(analysis.content).fields.analysis_status : ''
    if (status === 'complete' || (status === 'needs_review' && !input.includeNeedsReview)) continue
    nodes.push({
      nodeId,
      sourceHash,
      sourceLabel: parsed.fields.source_label || filename.replace(/\.md$/i, ''),
      sourcePath: resource.path,
      sourceContent: parsed.body,
      analysisStatus: status === 'needs_review' ? 'needs_review' : 'unprocessed',
      ...(analysis
        ? { analysisContent: analysis.content, expectedAnalysisRevision: analysis.revision.value }
        : {}),
    })
    if (nodes.length >= limit) break
  }
  const assetIndexes: Array<{ path: string; content: string }> = []
  for (const directory of ['资产', '资产/人物', '资产/场景', '资产/道具', '资产/关系']) {
    const path = `${wikiRoot}/${directory}/index.md`
    const resource = resourceByPath.get(path)
    if (resource) assetIndexes.push({ path, content: (await files.readText(resource)).content })
  }
  return { workDirectory, nodes, assetIndexes }
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
    throw new Error(`${label} 必须是字符串数组`)
  return value.map(item => item.trim()).filter(Boolean)
}

function facts(value: unknown, label: string): StoryAnalysisFact[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`)
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error(`${label}[${index}] 无效`)
    const fact = item as Record<string, unknown>
    if (
      typeof fact.name !== 'string' ||
      !fact.name.trim() ||
      typeof fact.description !== 'string' ||
      !fact.description.trim()
    ) {
      throw new Error(`${label}[${index}] 缺少名称或描述`)
    }
    return {
      name: fact.name.trim(),
      description: fact.description.trim(),
      evidence: stringList(fact.evidence, `${label}[${index}].evidence`),
    }
  })
}

export function parseStoryAnalysisSubmissions(value: unknown): StoryAnalysisSubmission[] {
  if (!Array.isArray(value) || !value.length || value.length > 10)
    throw new Error('语义分析结果数量必须为 1-10')
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error(`analyses[${index}] 无效`)
    const row = item as Record<string, unknown>
    for (const field of ['node_id', 'source_hash', 'summary']) {
      if (typeof row[field] !== 'string' || !String(row[field]).trim())
        throw new Error(`analyses[${index}].${field} 无效`)
    }
    if (
      row.expected_analysis_revision !== undefined &&
      typeof row.expected_analysis_revision !== 'string'
    ) {
      throw new Error(`analyses[${index}].expected_analysis_revision 无效`)
    }
    const relations = Array.isArray(row.relations)
      ? row.relations.map((item, relationIndex) => {
          if (!item || typeof item !== 'object' || Array.isArray(item))
            throw new Error(`relations[${relationIndex}] 无效`)
          const relation = item as Record<string, unknown>
          for (const field of ['subject', 'predicate', 'object', 'description']) {
            if (typeof relation[field] !== 'string' || !String(relation[field]).trim())
              throw new Error(`relations[${relationIndex}].${field} 无效`)
          }
          return {
            subject: String(relation.subject).trim(),
            predicate: String(relation.predicate).trim(),
            object: String(relation.object).trim(),
            description: String(relation.description).trim(),
            evidence: stringList(relation.evidence, `relations[${relationIndex}].evidence`),
          }
        })
      : (() => {
          throw new Error('relations 必须是数组')
        })()
    return {
      node_id: String(row.node_id).trim(),
      source_hash: String(row.source_hash).trim(),
      summary: String(row.summary).trim(),
      scenes: facts(row.scenes, 'scenes'),
      characters: facts(row.characters, 'characters'),
      props: facts(row.props, 'props'),
      relations,
      evidence: stringList(row.evidence, 'evidence'),
      needs_review: stringList(row.needs_review, 'needs_review'),
      ...(row.expected_analysis_revision === undefined
        ? {}
        : { expected_analysis_revision: row.expected_analysis_revision }),
    }
  })
}

function assetPage(
  type: string,
  name: string,
  facts: Array<{ description: string; evidence: string[]; sourceLink: string }>,
): string {
  return [
    '---',
    `type: ${type}`,
    `title: ${JSON.stringify(name)}`,
    '---',
    '',
    `# ${name}`,
    '',
    '## 来源事实',
    '',
    ...facts.flatMap(fact => [
      `- ${fact.description}（来源：${fact.sourceLink}）`,
      ...fact.evidence.map(quote => `  - 证据：${JSON.stringify(quote)}`),
    ]),
    '',
  ].join('\n')
}

function analysisPage(input: {
  analysis: StoryAnalysisSubmission
  sourceLink: string
  links: Record<
    AssetKind | 'relations',
    Array<{ link: string; description: string; evidence: string[] }>
  >
  runtimeReview: string[]
  final: boolean
}): string {
  const review = [...input.analysis.needs_review, ...input.runtimeReview]
  const status = review.length ? 'needs_review' : 'complete'
  const yamlLinks = (kind: AssetKind) =>
    `[${input.links[kind].map(item => JSON.stringify(item.link)).join(', ')}]`
  return [
    '---',
    'type: story-node-analysis',
    `id: ${JSON.stringify(`${input.analysis.node_id}.analysis`)}`,
    `source: ${JSON.stringify(input.sourceLink)}`,
    `source_hash: ${JSON.stringify(input.analysis.source_hash)}`,
    `characters: ${yamlLinks('characters')}`,
    `locations: ${yamlLinks('scenes')}`,
    `props: ${yamlLinks('props')}`,
    ...(input.final ? [`analysis_status: ${status}`] : []),
    '---',
    '',
    `# ${input.analysis.node_id} 分析`,
    '',
    '## 摘要',
    '',
    input.analysis.summary,
    '',
    ...(['scenes', 'characters', 'props', 'relations'] as const).flatMap(kind =>
      input.links[kind].length
        ? [
            `## ${ASSET_DIRECTORIES[kind]}`,
            '',
            ...input.links[kind].flatMap(item => [
              `- ${item.link}：${item.description}`,
              ...item.evidence.map(quote => `  - 证据：${JSON.stringify(quote)}`),
            ]),
            '',
          ]
        : [],
    ),
    '## 摘要证据',
    '',
    ...input.analysis.evidence.map(quote => `- ${JSON.stringify(quote)}`),
    '',
    ...(review.length ? ['## 待确认', '', ...review.map(item => `- ${item}`), ''] : []),
  ].join('\n')
}

export async function commitStoryAnalysis(
  input: { workDirectory: string; analyses: StoryAnalysisSubmission[] },
  files: ProjectFileService,
  owner: string,
): Promise<StoryAnalysisCommitResult> {
  return await withStoryWorkflowLock(owner, async () => {
    const { workDirectory, wikiRoot, work } = normalizeWorkDirectory(input.workDirectory)
    const analyses = parseStoryAnalysisSubmissions(input.analyses)
    if (new Set(analyses.map(item => item.node_id)).size !== analyses.length)
      throw new Error('node_id 不能重复')
    const resources = await files.list(owner)
    const resourceByPath = new Map(resources.map(resource => [resource.path, resource]))
    const reads = new Map<string, ProjectTextRead>()
    const read = async (resource: ProjectResource) => {
      let value = reads.get(resource.path)
      if (!value) {
        value = await files.readText(resource)
        reads.set(resource.path, value)
      }
      return value
    }
    const sourceById = new Map<
      string,
      { resource: ProjectResource; page: ReturnType<typeof parsePage> }
    >()
    for (const resource of directMarkdownPages(resources, `${workDirectory}/原文节点`)) {
      const value = await read(resource)
      const page = parsePage(value.content)
      if (page.fields.id) sourceById.set(page.fields.id, { resource, page })
    }

    const catalog = new Map<string, Set<string>>()
    for (const kind of Object.keys(ASSET_DIRECTORIES) as Array<AssetKind | 'relations'>) {
      const directory = `${wikiRoot}/资产/${ASSET_DIRECTORIES[kind]}`
      for (const resource of directMarkdownPages(resources, directory)) {
        const page = parsePage((await read(resource)).content)
        const stem = resource.path.split('/').at(-1)!.replace(/\.md$/i, '')
        for (const label of [stem, page.fields.title, ...page.aliases].filter(Boolean)) {
          const key = `${kind}:${normalizedName(label!)}`
          const paths = catalog.get(key) || new Set<string>()
          paths.add(resource.path)
          catalog.set(key, paths)
        }
      }
    }

    type NewAsset = {
      kind: AssetKind | 'relations'
      name: string
      path: string
      facts: Array<{ description: string; evidence: string[]; sourceLink: string }>
    }
    const newAssets = new Map<string, NewAsset>()
    const pathOwners = new Map<string, string>()
    const analysisPlans: Array<{
      value: StoryAnalysisSubmission
      path: string
      before?: ProjectTextRead
      draft: string
      final: string
      status: 'complete' | 'needs_review'
    }> = []
    const conflicts: string[] = []

    for (const value of analyses) {
      const source = sourceById.get(value.node_id)
      if (!source) throw new Error(`原文节点不存在：${value.node_id}`)
      if (
        source.page.fields.source_hash !== value.source_hash ||
        (await hashText(source.page.body)) !== value.source_hash
      ) {
        throw new Error(`原文节点已变化：${value.node_id}`)
      }
      const allowedEvidence = new Set(value.evidence)
      if (
        !value.evidence.length ||
        value.evidence.some(quote => !quote || !source.page.body.includes(quote))
      ) {
        throw new Error(`摘要证据不在原文节点中：${value.node_id}`)
      }
      const sourceFile = source.resource.path.split('/').at(-1)!.replace(/\.md$/i, '')
      const sourceLink = `[[${source.resource.path.replace(/\.md$/i, '')}|${sourceFile}]]`
      const runtimeReview: string[] = []
      const links: Record<
        AssetKind | 'relations',
        Array<{ link: string; description: string; evidence: string[] }>
      > = {
        characters: [],
        scenes: [],
        props: [],
        relations: [],
      }
      const resolveAsset = (
        kind: AssetKind | 'relations',
        name: string,
        description: string,
        evidence: string[],
      ) => {
        if (
          !evidence.length ||
          evidence.some(quote => !allowedEvidence.has(quote) || !source.page.body.includes(quote))
        ) {
          throw new Error(`${value.node_id} 的${ASSET_DIRECTORIES[kind]}证据无效：${name}`)
        }
        const key = `${kind}:${normalizedName(name)}`
        const matches = [...(catalog.get(key) || [])]
        if (matches.length > 1) {
          const message = `${ASSET_DIRECTORIES[kind]}“${name}”匹配多个规范页面：${matches.join('、')}`
          conflicts.push(message)
          runtimeReview.push(message)
          return
        }
        let path = matches[0]
        if (!path) {
          path = `${wikiRoot}/资产/${ASSET_DIRECTORIES[kind]}/${safeWikiSegment(name)}.md`
          const ownerKey = pathOwners.get(path)
          if (ownerKey && ownerKey !== key) throw new Error(`规范资产路径冲突：${path}`)
          pathOwners.set(path, key)
          if (resourceByPath.has(path)) throw new Error(`规范资产目标已存在但名称不匹配：${path}`)
          const planned = newAssets.get(key) || { kind, name, path, facts: [] }
          planned.facts.push({ description, evidence, sourceLink })
          newAssets.set(key, planned)
        }
        links[kind].push({
          link: `[[${path.replace(/\.md$/i, '')}|${name}]]`,
          description,
          evidence,
        })
      }
      for (const kind of ['characters', 'scenes', 'props'] as const) {
        for (const fact of value[kind])
          resolveAsset(kind, fact.name, fact.description, fact.evidence)
      }
      for (const relation of value.relations) {
        const name = `${relation.subject}—${relation.predicate}—${relation.object}`
        resolveAsset('relations', name, relation.description, relation.evidence)
      }
      const analysisPath = `${workDirectory}/节点分析/${sourceFile}.md`
      const analysisResource = resourceByPath.get(analysisPath)
      const before = analysisResource ? await read(analysisResource) : undefined
      const beforeStatus = before ? parsePage(before.content).fields.analysis_status : ''
      const pageInput = { analysis: value, sourceLink, links, runtimeReview }
      const final = analysisPage({ ...pageInput, final: true })
      if (before?.content === final) {
        analysisPlans.push({
          value,
          path: analysisPath,
          before,
          draft: final,
          final,
          status: runtimeReview.length || value.needs_review.length ? 'needs_review' : 'complete',
        })
        continue
      }
      if (beforeStatus === 'complete')
        throw new Error(`已完成的分析页不能被自动覆盖：${analysisPath}`)
      if (before && before.revision.value !== value.expected_analysis_revision)
        throw new Error(`分析页已变化，请重新准备：${analysisPath}`)
      analysisPlans.push({
        value,
        path: analysisPath,
        before,
        draft: analysisPage({ ...pageInput, final: false }),
        final,
        status: runtimeReview.length || value.needs_review.length ? 'needs_review' : 'complete',
      })
    }

    const result: StoryAnalysisCommitResult = {
      committed: [],
      skipped: [],
      needs_review: [],
      conflicts,
      affected_paths: [],
    }
    const addPath = (path: string) => {
      if (!result.affected_paths.includes(path)) result.affected_paths.push(path)
    }
    for (const asset of newAssets.values()) {
      const content = assetPage(ASSET_TYPES[asset.kind], asset.name, asset.facts)
      await files.createText(owner, asset.path, content)
      addPath(asset.path)
    }

    const indexSpecs = new Map<
      string,
      {
        title: string
        purpose: string
        directories: Array<{ target: string; label: string; summary: string }>
        pages: Array<{ target: string; label: string; summary: string }>
      }
    >()
    const addIndex = (
      path: string,
      title: string,
      purpose: string,
      directories: Array<{ target: string; label: string; summary: string }> = [],
      pages: Array<{ target: string; label: string; summary: string }> = [],
    ) => {
      const spec = indexSpecs.get(path) || { title, purpose, directories: [], pages: [] }
      spec.directories.push(...directories)
      spec.pages.push(...pages)
      indexSpecs.set(path, spec)
    }
    if (newAssets.size) {
      addIndex(
        `${wikiRoot}/index.md`,
        wikiRoot === 'wiki' ? 'Wiki' : '文档 Wiki',
        '项目知识导航。',
        [
          {
            target: '资产/index',
            label: '资产',
            summary: '故事中可复用的人物、场景、道具和关系。',
          },
        ],
      )
      addIndex(
        `${wikiRoot}/资产/index.md`,
        '资产',
        '保存跨章节复用的规范故事实体。',
        [...new Set([...newAssets.values()].map(asset => asset.kind))].map(kind => ({
          target: `${ASSET_DIRECTORIES[kind]}/index`,
          label: ASSET_DIRECTORIES[kind],
          summary: '从故事证据中沉淀的规范实体。',
        })),
      )
    }
    for (const asset of newAssets.values())
      addIndex(
        `${wikiRoot}/资产/${ASSET_DIRECTORIES[asset.kind]}/index.md`,
        ASSET_DIRECTORIES[asset.kind],
        `保存故事${ASSET_DIRECTORIES[asset.kind]}的规范页面。`,
        [],
        [
          {
            target: asset.path.split('/').at(-1)!.replace(/\.md$/i, ''),
            label: asset.name,
            summary: asset.facts[0]!.description,
          },
        ],
      )
    addIndex(`${workDirectory}/index.md`, work, '保存本作品的可追溯原文、无损节点和分析入口。', [
      { target: '节点分析/index', label: '节点分析', summary: '逐节点保存有证据的语义分析结果。' },
    ])
    addIndex(
      `${workDirectory}/节点分析/index.md`,
      '节点分析',
      '导航逐个原文节点的语义分析结果。',
      [],
      analysisPlans.map(plan => ({
        target: plan.path.split('/').at(-1)!.replace(/\.md$/i, ''),
        label: plan.value.node_id,
        summary: plan.value.summary,
      })),
    )

    const analysisIndexPaths = new Set([
      `${workDirectory}/index.md`,
      `${workDirectory}/节点分析/index.md`,
    ])
    const saveIndexes = async (analysisIndexes: boolean) => {
      for (const [path, spec] of indexSpecs) {
        if (analysisIndexPaths.has(path) !== analysisIndexes) continue
        const resource = resourceByPath.get(path)
        const before = resource ? await read(resource) : undefined
        const content = upsertWikiIndex(
          before?.content || '',
          spec.title,
          spec.purpose,
          spec.directories,
          spec.pages,
        )
        if (before?.content === content) continue
        if (!resource) await files.createText(owner, path, content)
        else {
          const saved = await files.writeText(resource, content, before!.revision)
          if (saved.status !== 'saved') throw new Error(`索引正在其他窗口更新，请重新执行：${path}`)
        }
        addPath(path)
      }
    }
    await saveIndexes(false)

    const drafts = new Map<string, ProjectTextRead>()
    for (const plan of analysisPlans) {
      if (plan.before?.content === plan.final) {
        result.skipped.push(plan.value.node_id)
        continue
      }
      if (!plan.before) await files.createText(owner, plan.path, plan.draft)
      else {
        const saved = await files.writeText(
          resourceByPath.get(plan.path)!,
          plan.draft,
          plan.before.revision,
        )
        if (saved.status !== 'saved') throw new Error(`分析页正在其他窗口更新：${plan.path}`)
      }
      drafts.set(plan.path, await files.readTextAt(owner, plan.path))
      addPath(plan.path)
    }
    await saveIndexes(true)
    for (const plan of analysisPlans) {
      const draft = drafts.get(plan.path)
      if (!draft) continue
      const resource = (await files.list(owner)).find(item => item.path === plan.path)
      if (!resource) throw new Error(`分析页写入后丢失：${plan.path}`)
      const saved = await files.writeText(resource, plan.final, draft.revision)
      if (saved.status !== 'saved') throw new Error(`分析页完成标记冲突：${plan.path}`)
      result.committed.push(plan.value.node_id)
      if (plan.status === 'needs_review') result.needs_review.push(plan.value.node_id)
    }
    return result
  })
}
