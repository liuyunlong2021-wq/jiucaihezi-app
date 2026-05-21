import { resolveApiConfig, buildHeaders } from '@/utils/api'
import { useFileStore, type FileEntry } from '@/composables/useFileStore'
import { useVaultStore } from '@/stores/vaultStore'
import {
  buildVaultIndexEntries,
  buildKnowledgeMarkdown,
  lintVaultKnowledge,
  parseCompilerJson,
  type ParsedCompilerOutput,
  type VaultKnowledgeCandidate,
} from '@/utils/vaultCompilerCore'
import { buildLocalWikiActions, type WikiAction } from '@/utils/vaultOrganizeActions'

export interface VaultCompileResult {
  vaultId: string
  rawCount: number
  pageCount: number
  entityCount: number
  relationCount: number
  hotCacheUpdated: boolean
}

const HOT_CACHE_KIND = 'summary'
const HOT_CACHE_META_KIND = 'vault-hot-cache'
const VAULT_INDEX_META_KIND = 'vault-index'
const VAULT_LINT_META_KIND = 'vault-lint-report'

function sourceMessageIds(raws: FileEntry[]) {
  return Array.from(new Set(raws.flatMap(raw => raw.sourceMessageIds || [])))
}

function sourceSessionId(raws: FileEntry[]) {
  return raws.find(raw => raw.sourceSessionId)?.sourceSessionId
}

function compilerFallback(raws: FileEntry[]): ParsedCompilerOutput {
  const text = raws.map(raw => raw.content).join('\n\n').slice(0, 1200)
  return {
    pages: [{
      title: '项目记忆',
      pageType: 'note',
      status: 'developing',
      confidence: 'medium',
      tags: ['自动整理'],
      body: text,
      topic: '项目记忆',
    }],
    entities: [],
    relations: [],
  }
}

async function callCompiler(raws: FileEntry[], vaultName: string): Promise<ParsedCompilerOutput> {
  const text = raws.map(raw => `## ${raw.name}\n${raw.content}`).join('\n\n---\n\n').slice(0, 10000)
  try {
    const config = await resolveApiConfig()
    const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(config),
      body: JSON.stringify({
        model: config.model || 'claude-sonnet-4-6',
        messages: [
          {
            role: 'system',
            content: `你是 Vault 知识编译器。把原始对话持续维护为可读 Markdown 知识页、实体和关系。

输出严格 JSON 对象：
{
  "pages": [{"title":"标题","pageType":"character|world|plot|style|note","status":"developing|stable","confidence":"high|medium|low","tags":["标签"],"body":"正文","topic":"栏目"}],
  "entities": [{"name":"实体名","entityType":"character|place|object|concept","summary":"摘要","tags":["标签"]}],
  "relations": [{"from":"实体A","to":"实体B","relation":"关系","summary":"说明"}]
}

只输出 JSON，不要解释。当前知识库：${vaultName}`,
          },
          { role: 'user', content: text },
        ],
        temperature: 0.25,
        max_tokens: 2800,
        stream: false,
      }),
    })
    if (!res.ok) return compilerFallback(raws)
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || ''
    return parseCompilerJson(content)
  } catch {
    return compilerFallback(raws)
  }
}

function mergeByTitle(existing: FileEntry[], title: string, vaultId: string, kind: FileEntry['kind']) {
  return existing.find(file =>
    file.category === 'knowledge' &&
    file.vaultId === vaultId &&
    file.kind === kind &&
    file.name === title
  )
}

function toCandidate(file: FileEntry): VaultKnowledgeCandidate {
  return {
    id: file.id,
    title: file.name,
    content: file.content,
    kind: file.kind,
    updatedAt: file.updatedAt,
    tags: Array.isArray(file.metadata?.tags) ? file.metadata.tags as string[] : [],
    metadata: file.metadata,
  }
}

export function useVaultCompiler() {
  const fileStore = useFileStore()
  const vaultStore = useVaultStore()

  async function compileVault(vaultId: string): Promise<VaultCompileResult> {
    await vaultStore.loadAll()
    const vault = vaultStore.vaults.find(v => v.id === vaultId)
    const vaultName = vault?.name || '项目知识库'
    const files = await fileStore.loadByVault(vaultId)
    const raws = files.filter(file =>
      file.category === 'knowledge' &&
      file.mimeType !== 'folder' &&
      file.indexed === false &&
      (file.kind === 'raw' || file.kind === 'summary' || !file.kind)
    )

    if (raws.length === 0) {
      return { vaultId, rawCount: 0, pageCount: 0, entityCount: 0, relationCount: 0, hotCacheUpdated: false }
    }

    const output = await callCompiler(raws, vaultName)
    const allKnowledge = await fileStore.loadByCategory('knowledge', vaultId)
    const messageIds = sourceMessageIds(raws)
    const sessionId = sourceSessionId(raws)
    const now = Date.now()
    let pageCount = 0
    let entityCount = 0
    let relationCount = 0

    for (const page of output.pages) {
      const title = page.title || '知识页'
      const body = page.body || page.content || ''
      if (!body.trim()) continue
      const content = buildKnowledgeMarkdown({
        title,
        pageType: page.pageType || 'note',
        status: page.status || 'developing',
        confidence: page.confidence || 'medium',
        tags: page.tags || [],
        sources: messageIds,
        updatedAt: now,
        body,
      })
      const existing = mergeByTitle(allKnowledge, title, vaultId, 'page')
      const metadata = {
        ...(existing?.metadata || {}),
        pageType: page.pageType || 'note',
        status: page.status || 'developing',
        confidence: page.confidence || 'medium',
        tags: page.tags || [],
        sources: messageIds,
        updatedAt: now,
      }
      if (existing) {
        await fileStore.updateFile(existing.id, {
          content,
          topic: page.topic || page.pageType || '知识页',
          sourceSessionId: existing.sourceSessionId || sessionId,
          sourceMessageIds: Array.from(new Set([...(existing.sourceMessageIds || []), ...messageIds])),
          metadata,
          indexed: true,
        })
      } else {
        await fileStore.addKnowledge({
          name: title,
          content,
          topic: page.topic || page.pageType || '知识页',
          vaultId,
          kind: 'page',
          sourceSessionId: sessionId,
          sourceMessageIds: messageIds,
          indexed: true,
          metadata,
        })
      }
      pageCount++
    }

    for (const entity of output.entities) {
      if (!entity.name) continue
      const existing = mergeByTitle(allKnowledge, entity.name, vaultId, 'entity')
      const patch = {
        content: entity.summary || entity.name,
        topic: entity.entityType || 'entity',
        sourceSessionId: existing?.sourceSessionId || sessionId,
        sourceMessageIds: Array.from(new Set([...(existing?.sourceMessageIds || []), ...messageIds])),
        indexed: true,
        metadata: { ...(existing?.metadata || {}), entityType: entity.entityType || 'concept', tags: entity.tags || [], sources: messageIds },
      }
      if (existing) {
        await fileStore.updateFile(existing.id, patch)
      } else {
        await fileStore.addKnowledge({
          name: entity.name,
          vaultId,
          kind: 'entity',
          ...patch,
        })
      }
      entityCount++
    }

    for (const relation of output.relations) {
      if (!relation.from || !relation.to || !relation.relation) continue
      const name = `${relation.from} - ${relation.relation} - ${relation.to}`
      const existing = mergeByTitle(allKnowledge, name, vaultId, 'relation')
      const patch = {
        content: relation.summary || `${relation.from} ${relation.relation} ${relation.to}`,
        topic: 'relation',
        sourceSessionId: existing?.sourceSessionId || sessionId,
        sourceMessageIds: Array.from(new Set([...(existing?.sourceMessageIds || []), ...messageIds])),
        indexed: true,
        metadata: { ...(existing?.metadata || {}), from: relation.from, to: relation.to, relation: relation.relation, sources: messageIds },
      }
      if (existing) {
        await fileStore.updateFile(existing.id, patch)
      } else {
        await fileStore.addKnowledge({
          name,
          vaultId,
          kind: 'relation',
          ...patch,
        })
      }
      relationCount++
    }

    const hotText = raws.map(raw => raw.content).join('\n').replace(/\s+/g, ' ').slice(-500)
    const hotExisting = files.find(file => file.metadata?.kind === HOT_CACHE_META_KIND)
    const hotContent = `# ${vaultName} 热记忆\n\n${hotText}`
    if (hotExisting) {
      await fileStore.updateFile(hotExisting.id, {
        content: hotContent,
        updatedAt: now,
        metadata: { ...(hotExisting.metadata || {}), kind: HOT_CACHE_META_KIND, updatedAt: now },
      })
    } else {
      await fileStore.addKnowledge({
        name: `${vaultName}_热记忆`,
        content: hotContent,
        topic: 'hot-cache',
        vaultId,
        kind: HOT_CACHE_KIND,
        indexed: true,
        metadata: { kind: HOT_CACHE_META_KIND, updatedAt: now },
      })
    }

    for (const raw of raws) {
      await fileStore.updateFile(raw.id, { indexed: true })
    }

    await fileStore.addKnowledge({
      name: `编译日志_${new Date(now).toLocaleString('zh-CN')}`,
      content: `编译 ${raws.length} 条原始记录，生成 ${pageCount} 页、${entityCount} 个实体、${relationCount} 条关系。`,
      topic: 'compile-log',
      vaultId,
      kind: 'summary',
      indexed: true,
      metadata: {
        kind: 'vault-compile-log',
        rawIds: raws.map(raw => raw.id),
        pageCount,
        entityCount,
        relationCount,
        compiledAt: now,
      },
    })

    const refreshedFiles = (await fileStore.loadByVault(vaultId)).filter(file =>
      file.category === 'knowledge' &&
      file.mimeType !== 'folder' &&
      file.metadata?.kind !== VAULT_INDEX_META_KIND &&
      file.metadata?.kind !== VAULT_LINT_META_KIND
    )
    const candidates = refreshedFiles.map(toCandidate)
    const indexEntries = buildVaultIndexEntries(candidates)
    const lintIssues = lintVaultKnowledge(candidates)
    const indexContent = [
      `# ${vaultName} 知识索引`,
      '',
      ...indexEntries.map(item => `- [${item.kind}] ${item.title}: ${item.summary}`),
    ].join('\n')
    const lintContent = [
      `# ${vaultName} 知识体检`,
      '',
      lintIssues.length > 0
        ? lintIssues.map(issue => `- ${issue.category}: ${issue.description}`).join('\n')
        : '暂无明显问题',
    ].join('\n')

    const indexExisting = files.find(file => file.metadata?.kind === VAULT_INDEX_META_KIND)
    if (indexExisting) {
      await fileStore.updateFile(indexExisting.id, {
        content: indexContent,
        metadata: { ...(indexExisting.metadata || {}), kind: VAULT_INDEX_META_KIND, updatedAt: now, itemCount: indexEntries.length },
      })
    } else {
      await fileStore.addKnowledge({
        name: `${vaultName}_知识索引`,
        content: indexContent,
        topic: 'index',
        vaultId,
        kind: 'page',
        indexed: true,
        metadata: { kind: VAULT_INDEX_META_KIND, updatedAt: now, itemCount: indexEntries.length },
      })
    }

    const lintExisting = files.find(file => file.metadata?.kind === VAULT_LINT_META_KIND)
    if (lintExisting) {
      await fileStore.updateFile(lintExisting.id, {
        content: lintContent,
        metadata: { ...(lintExisting.metadata || {}), kind: VAULT_LINT_META_KIND, updatedAt: now, issueCount: lintIssues.length },
      })
    } else {
      await fileStore.addKnowledge({
        name: `${vaultName}_知识体检`,
        content: lintContent,
        topic: 'lint',
        vaultId,
        kind: 'page',
        indexed: true,
        metadata: { kind: VAULT_LINT_META_KIND, updatedAt: now, issueCount: lintIssues.length },
      })
    }

    await vaultStore.updateVault(vaultId, {
      stats: {
        pageCount: refreshedFiles.filter(file => file.kind === 'page').length,
        rawCount: refreshedFiles.filter(file => file.kind === 'raw' && file.indexed === false).length,
        lastCompressedAt: now,
      },
    })

    return { vaultId, rawCount: raws.length, pageCount, entityCount, relationCount, hotCacheUpdated: true }
  }

  /**
   * 目录感知的 raw→wiki 整理器
   *
   * 读取 CLAUDE.md 配置 + wiki/ 目录结构，让 LLM 将 raw 内容
   * 整理到具体的 wiki 目录下。
   */
  async function compileRawToWiki(
    vaultId: string,
    opts?: { targetRawIds?: string[] },
  ): Promise<{ created: number; updated: number; rawCount: number; reportName?: string }> {
    const fs = fileStore
    const vault = vaultStore.vaults.find(v => v.id === vaultId)
    const vaultName = vault?.name || '知识库'

    // 1. 读取 CLAUDE.md
    const allFiles = await fs.loadByVault(vaultId)
    const claudeMdFile = allFiles.find(f => f.name === 'CLAUDE.md' && f.mimeType !== 'folder')
    const claudeMd = claudeMdFile?.content || ''

    // 2. 获取 wiki/ 目录结构
    const wikiRoot = allFiles.find(f => f.name === 'wiki' && f.mimeType === 'folder' && f.metadata?.vaultFolder === 'wiki')
    let wikiStructure = '（空目录）'
    if (wikiRoot) {
      const wikiFiles = allFiles.filter(f => f.mimeType === 'folder' || f.folderId)
      // 简单列出所有 wiki 下的文件夹和文件
      function getWikiTree(parentId: string, depth: number): string[] {
        const children = wikiFiles.filter(f => f.folderId === parentId)
        const lines: string[] = []
        for (const child of children) {
          const indent = '  '.repeat(depth)
          const icon = child.mimeType === 'folder' ? '📁' : '📄'
          lines.push(`${indent}${icon} ${child.name}`)
          if (child.mimeType === 'folder') {
            lines.push(...getWikiTree(child.id, depth + 1))
          }
        }
        return lines
      }
      const treeLines = getWikiTree(wikiRoot.id, 0)
      if (treeLines.length > 0) wikiStructure = treeLines.join('\n')
    }

    // 3. 收集待整理的 raw 文件
    let raws: FileEntry[]
    if (opts?.targetRawIds?.length) {
      raws = allFiles.filter(f => opts.targetRawIds!.includes(f.id))
    } else {
      raws = allFiles.filter(f =>
        f.category === 'knowledge' &&
        f.mimeType !== 'folder' &&
        f.indexed === false &&
        (f.kind === 'raw' || !f.kind)
      )
    }

    if (raws.length === 0) return { created: 0, updated: 0, rawCount: 0 }

    async function ensureChildFolder(
      parentId: string,
      name: string,
      metadata: Record<string, unknown> = {},
    ): Promise<FileEntry> {
      const existing = await fs.findChildFolder(parentId, name, vaultId)
      if (existing) return existing
      return await fs.createFolder(name, parentId, vaultId, {
        isFolder: true,
        ...metadata,
      })
    }

    async function ensureReportsFolder(): Promise<FileEntry> {
      const latest = await fs.loadByVault(vaultId)
      let reportsRoot = latest.find(file =>
        file.mimeType === 'folder' &&
        !file.folderId &&
        file.name === '_reports' &&
        file.vaultId === vaultId
      )
      if (!reportsRoot) {
        reportsRoot = await fs.addFile({
          category: 'knowledge',
          name: '_reports',
          content: '',
          mimeType: 'folder',
          size: 0,
          vaultId,
          metadata: { vaultFolder: 'reports', isFolder: true },
        })
      }
      return await ensureChildFolder(reportsRoot.id, '整理记录', {
        vaultFolder: 'reports',
        folderPath: '_reports/整理记录',
      })
    }

    async function writeOrganizeReport(input: {
      created: number
      updated: number
      fallback?: string
      actions?: WikiAction[]
    }): Promise<string> {
      const now = Date.now()
      const folder = await ensureReportsFolder()
      const reportName = `整理报告_${new Date(now).toLocaleString('zh-CN').replace(/[/:]/g, '-')}.md`
      const content = [
        `# ${vaultName} 整理报告`,
        '',
        `- 时间：${new Date(now).toLocaleString('zh-CN')}`,
        `- 读取 raw：${raws.length} 条`,
        `- 新增 wiki：${input.created} 项`,
        `- 更新 wiki：${input.updated} 项`,
        input.fallback ? `- 降级处理：${input.fallback}` : '',
        '',
        '## 原始材料',
        ...raws.map(raw => `- ${raw.name}`),
        '',
        '## 执行动作',
        input.actions?.length
          ? input.actions.map(action => `- ${action.type || 'unknown'}：${action.path || ''}`).join('\n')
          : '- 无结构化动作',
      ].filter(Boolean).join('\n')

      await fs.addFile({
        category: 'knowledge',
        name: reportName,
        content,
        mimeType: 'text/markdown',
        size: new TextEncoder().encode(content).length,
        vaultId,
        folderId: folder.id,
        kind: 'summary',
        indexed: true,
        metadata: {
          kind: 'vault-organize-report',
          rawIds: raws.map(raw => raw.id),
          created: input.created,
          updated: input.updated,
          fallback: input.fallback || '',
          organizedAt: now,
        },
      })
      return reportName
    }

    async function ensureWikiFolderPath(path: string): Promise<FileEntry | null> {
      if (!wikiRoot) return null
      const parts = path.replace(/^wiki\//, '').split('/').filter(Boolean)
      let parentId = wikiRoot.id
      let currentPath = 'wiki'
      for (const part of parts) {
        currentPath = `${currentPath}/${part}`
        const existing = await fs.findChildFolder(parentId, part, vaultId)
        if (existing) {
          parentId = existing.id
        } else {
          const created = await fs.createFolder(part, parentId, vaultId, {
            vaultFolder: 'wiki',
            folderPath: currentPath,
          })
          parentId = created.id
        }
      }
      return (await fs.loadByVault(vaultId)).find(file => file.id === parentId) || null
    }

    function normalizeWikiActions(actions: WikiAction[]): WikiAction[] {
      return (actions || [])
        .filter(action => action && typeof action.path === 'string' && action.path.startsWith('wiki/'))
        .map(action => ({
          ...action,
          path: action.path.replace(/\\/g, '/').replace(/\/+/g, '/'),
        }))
        .filter(action => {
          if (action.type === 'create_folder') return true
          if (action.type === 'create') return isUsableWikiMarkdown(String(action.content || ''))
          if (action.type === 'update') return isUsableWikiMarkdown(String(action.append || ''))
          return false
        })
    }

    function isUsableWikiMarkdown(content: string): boolean {
      const text = String(content || '').trim()
      const cleaned = text
        .replace(/^---[\s\S]*?---/, '')
        .replace(/[#>*_`\-[\]().,，。:：;；\s]/g, '')
        .trim()
      if (cleaned.length < 12) return false
      const placeholders = [
        /在此编辑知识内容/,
        /完整的markdown内容/i,
        /todo/i,
        /待补充/,
        /待整理/,
        /相关页面\s*[:：]?\s*[-*]?\s*待/,
        /来源\s*[:：]?\s*[-*]?\s*待/,
        /占位/,
        /示例内容/,
      ]
      return !placeholders.some(regex => regex.test(text))
    }

    async function buildFallbackActions(reason: string): Promise<{ actions: WikiAction[]; fallback: string }> {
      return {
        actions: localReferencePlan.actions,
        fallback: reason,
      }
    }

    async function callWikiActionCompiler(): Promise<{ actions: WikiAction[]; fallback?: string }> {
      const rawContent = raws.map(r => `### ${r.name}\n${r.content}`).join('\n\n---\n\n').slice(0, 12000)
      try {
        const config = await resolveApiConfig()
        const res = await fetch(`${config.apiBase}/v1/chat/completions`, {
          method: 'POST',
          headers: buildHeaders(config),
          body: JSON.stringify({
            model: config.model || 'claude-sonnet-4-6',
            messages: [
              {
                role: 'system',
                content: `你是知识整理师。根据知识库配置和现有目录结构，将原始资料整理到 wiki 目录中。

## 知识库配置（CLAUDE.md）
${claudeMd}

## 现有 wiki/ 目录结构
${wikiStructure}

## 输出要求
输出严格 JSON，描述要执行的整理操作：
{
  "actions": [
    {"type": "create", "path": "wiki/角色/王五.md", "content": "完整的markdown内容", "sources": ["raw/转换后的MD/资料.md#章节"]},
    {"type": "update", "path": "wiki/角色/张三.md", "append": "## 新增事件\\n内容...", "sources": ["raw/转换后的MD/资料.md#章节"]},
    {"type": "create_folder", "path": "wiki/案件/2024/"}
  ]
}

规则：
- path 必须以 wiki/ 开头
- 优先放入已有的目录分类中
- 需要新目录时用 create_folder
- create 的 content 必须是可直接检索引用的完整 Markdown 页面，不能是占位符
- 提取可复用的知识，忽略一次性闲聊
- 不要生成 candidate、pending、待确认状态
- 只输出 JSON`,
              },
              { role: 'user', content: `请整理以下原始资料到 wiki：\n\n${rawContent}` },
            ],
            temperature: 0.25,
            max_tokens: 4000,
            stream: false,
          }),
        })

        if (!res.ok) return buildFallbackActions(`模型接口 ${res.status}，已用本地规则生成正式 Wiki`)

        const data = await res.json()
        let content = data.choices?.[0]?.message?.content || ''
        content = content.replace(/^```json\s*/m, '').replace(/```\s*$/m, '').trim()
        const parsed = JSON.parse(content)
        const actions = normalizeWikiActions(parsed.actions || [])
        if (actions.length === 0) return buildFallbackActions('模型未返回可执行动作，已用本地规则生成正式 Wiki')
        return { actions }
      } catch (err: any) {
        return buildFallbackActions(`模型整理失败：${err?.message || '未知错误'}，已用本地规则生成正式 Wiki`)
      }
    }

    async function executeWikiActions(actions: WikiAction[]): Promise<{ created: number; updated: number }> {
      let created = 0
      let updated = 0

      for (const action of actions) {
        if (!action.path || !action.path.startsWith('wiki/')) continue
        const pathParts = action.path.replace(/^wiki\//, '').split('/').filter(Boolean)

        if (action.type === 'create_folder') {
          const folder = await ensureWikiFolderPath(action.path)
          if (folder) created++
          continue
        }

        const fileName = pathParts.pop()
        if (!fileName) continue
        const folder = await ensureWikiFolderPath(`wiki/${pathParts.join('/')}`)
        if (!folder) continue
        const children = await fs.getChildren(folder.id, vaultId)
        const existing = children.find(file => file.name === fileName && file.mimeType !== 'folder')

        if (action.type === 'update') {
          if (existing) {
            await fs.appendToFile(existing.id, `\n\n${String(action.append || '').trim()}`)
            updated++
          }
          continue
        }

        if (action.type !== 'create') continue
        const content = String(action.content || '').trim()
        if (!content) continue
        const metadata = {
          ...(existing?.metadata || {}),
          vaultFolder: 'wiki',
          kind: 'wiki-page',
          folderPath: `wiki/${pathParts.join('/')}`,
          sources: action.sources || [],
          rawId: action.rawId || '',
          organizeStatus: 'active',
          updatedAt: Date.now(),
        }

        if (existing) {
          await fs.updateFile(existing.id, {
            content,
            size: new TextEncoder().encode(content).length,
            kind: 'page',
            indexed: true,
            metadata,
          })
          updated++
        } else {
          await fs.addFile({
            category: 'knowledge',
            name: fileName,
            content,
            mimeType: 'text/markdown',
            size: new TextEncoder().encode(content).length,
            vaultId,
            folderId: folder.id,
            kind: 'page',
            indexed: true,
            metadata,
          })
          created++
        }
      }

      return { created, updated }
    }

    function organizedHashesByRaw(actions: WikiAction[]): Map<string, string[]> {
      const map = new Map<string, string[]>()
      for (const action of actions) {
        if (!action.rawId || !action.chunkHash) continue
        const list = map.get(action.rawId) || []
        list.push(action.chunkHash)
        map.set(action.rawId, list)
      }
      return map
    }

    const existingWikiFolders = allFiles
      .filter(file => file.mimeType === 'folder' && file.metadata?.vaultFolder === 'wiki')
      .map(file => String(file.metadata?.folderPath || file.name).replace(/^wiki\//, ''))
      .filter(Boolean)
    const localReferencePlan = buildLocalWikiActions({
      rawFiles: raws.map(raw => ({
        id: raw.id,
        name: raw.name,
        content: raw.content,
        metadata: raw.metadata,
      })),
      wikiFolders: existingWikiFolders,
    })
    const { actions, fallback } = await callWikiActionCompiler()
    if (actions.length === 0) {
      const reportName = await writeOrganizeReport({
        created: 0,
        updated: 0,
        actions,
        fallback: fallback || '没有发现可整理成 Wiki 的有效内容',
      })
      return { created: 0, updated: 0, rawCount: raws.length, reportName }
    }
    const { created, updated } = await executeWikiActions(actions)

    // 6. 标记 raw 为已处理
    const hashesByRaw = organizedHashesByRaw(actions)
    const referenceHashesByRaw = organizedHashesByRaw(localReferencePlan.actions)
    for (const raw of raws) {
      const existingHashes = Array.isArray(raw.metadata?.organizedChunkHashes)
        ? raw.metadata!.organizedChunkHashes.map(item => String(item))
        : []
      const nextHashes = Array.from(new Set([
        ...existingHashes,
        ...((hashesByRaw.get(raw.id)?.length ? hashesByRaw.get(raw.id) : referenceHashesByRaw.get(raw.id)) || []),
      ]))
      await fs.updateFile(raw.id, {
        indexed: true,
        metadata: {
          ...(raw.metadata || {}),
          organizedChunkHashes: nextHashes,
          organizedActionCount: (hashesByRaw.get(raw.id) || []).length,
          organizedAt: Date.now(),
        },
      })
    }

    // 7. 更新 vault stats
    const refreshedFiles = await fs.loadByVault(vaultId)
    await vaultStore.updateVault(vaultId, {
      stats: {
        pageCount: refreshedFiles.filter(f => f.kind === 'page' && f.mimeType !== 'folder').length,
        rawCount: refreshedFiles.filter(f => f.kind === 'raw' && f.indexed === false && f.mimeType !== 'folder').length,
        lastCompressedAt: Date.now(),
      },
    })

    const reportName = await writeOrganizeReport({ created, updated, actions, fallback })
    return { created, updated, rawCount: raws.length, reportName }
  }

  return { compileVault, compileRawToWiki }
}
