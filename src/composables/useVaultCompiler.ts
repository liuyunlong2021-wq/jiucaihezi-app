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
  ): Promise<{ created: number; updated: number }> {
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

    if (raws.length === 0) return { created: 0, updated: 0 }

    // 4. 调用 LLM
    const rawContent = raws.map(r => `### ${r.name}\n${r.content}`).join('\n\n---\n\n').slice(0, 12000)
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
    {"type": "create", "path": "wiki/角色/王五.md", "content": "完整的markdown内容"},
    {"type": "update", "path": "wiki/角色/张三.md", "append": "## 新增事件\\n内容..."},
    {"type": "create_folder", "path": "wiki/案件/2024/"}
  ]
}

规则：
- path 必须以 wiki/ 开头
- 优先放入已有的目录分类中
- 需要新目录时用 create_folder
- 提取可复用的知识，忽略一次性对话
- 内容用 Markdown 格式
- 只输出 JSON`,
          },
          { role: 'user', content: `请整理以下原始资料到 wiki：\n\n${rawContent}` },
        ],
        temperature: 0.25,
        max_tokens: 3000,
        stream: false,
      }),
    })

    let created = 0
    let updated = 0

    if (!res.ok) {
      // API 失败，回退到旧编译器
      await compileVault(vaultId)
      return { created: 0, updated: 0 }
    }

    const data = await res.json()
    let content = data.choices?.[0]?.message?.content || ''
    content = content.replace(/^```json\s*/m, '').replace(/```\s*$/m, '').trim()

    let actions: any[] = []
    try {
      const parsed = JSON.parse(content)
      actions = parsed.actions || []
    } catch {
      // JSON 解析失败，回退
      await compileVault(vaultId)
      return { created: 0, updated: 0 }
    }

    // 5. 执行 actions
    for (const action of actions) {
      if (!action.path || !action.path.startsWith('wiki/')) continue
      const pathParts = action.path.replace(/^wiki\//, '').split('/').filter(Boolean)

      if (action.type === 'create_folder') {
        // 逐级创建文件夹
        if (!wikiRoot) continue
        let parentId = wikiRoot.id
        for (const part of pathParts) {
          const existing = await fs.findChildFolder(parentId, part, vaultId)
          if (existing) {
            parentId = existing.id
          } else {
            const newFolder = await fs.createFolder(part, parentId, vaultId)
            parentId = newFolder.id
            created++
          }
        }
      } else if (action.type === 'create' && action.content) {
        // 创建文件
        if (!wikiRoot) continue
        const fileName = pathParts.pop()!
        let parentId = wikiRoot.id

        // 确保父目录存在
        for (const part of pathParts) {
          const existing = await fs.findChildFolder(parentId, part, vaultId)
          if (existing) {
            parentId = existing.id
          } else {
            const newFolder = await fs.createFolder(part, parentId, vaultId)
            parentId = newFolder.id
          }
        }

        await fs.addFile({
          category: 'knowledge',
          name: fileName,
          content: action.content,
          mimeType: 'text/markdown',
          size: new TextEncoder().encode(action.content).length,
          vaultId,
          folderId: parentId,
          kind: 'page',
          indexed: true,
          metadata: { vaultFolder: 'wiki', kind: 'wiki-page' },
        })
        created++
      } else if (action.type === 'update' && action.append) {
        // 追加到已有文件
        const fileName = pathParts.pop()!
        if (!wikiRoot) continue
        let parentId = wikiRoot.id
        for (const part of pathParts) {
          const existing = await fs.findChildFolder(parentId, part, vaultId)
          if (existing) parentId = existing.id
          else break
        }
        const children = await fs.getChildren(parentId, vaultId)
        const targetFile = children.find(f => f.name === fileName && f.mimeType !== 'folder')
        if (targetFile) {
          await fs.appendToFile(targetFile.id, '\n\n' + action.append)
          updated++
        }
      }
    }

    // 6. 标记 raw 为已处理
    for (const raw of raws) {
      await fs.updateFile(raw.id, { indexed: true })
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

    return { created, updated }
  }

  return { compileVault, compileRawToWiki }
}
