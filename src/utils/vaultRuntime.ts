import {
  buildVaultContextPack,
  buildVaultRetrievalPlan,
  type VaultContextPackOptions,
  type VaultRetrievalFile,
} from './vaultRetrieval'
import {
  scoreVaultKnowledge,
  type VaultEnhancementConfig,
  type VaultFolderSemantic,
  type VaultWritebackDraft,
} from './vaultCompilerCore'
import { isPendingWikiCandidate } from './vaultCandidate'

export interface RuntimeFileLike {
  id: string
  name: string
  content: string
  kind?: string
  updatedAt?: number
  metadata?: Record<string, unknown>
}

export interface RuntimePathHelpers<T extends RuntimeFileLike> {
  filePath: (file: T) => string
  semanticFor: (path: string, enhancement?: VaultEnhancementConfig) => unknown
}

export interface RecallSectionInput {
  claudeText?: string
  pinned?: Array<{ name: string; content: string }>
  contextPack?: string
  maxTotalChars?: number
  claudeMaxChars?: number
  pinnedMaxChars?: number
}

export interface WikiWritebackRecord {
  name: string
  targetPath: string
  content: string
  kind: 'page' | 'summary'
  mode: 'create' | 'append'
  metadata: Record<string, unknown>
}

function normalizePath(path: string): string {
  return String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
}

function tagsFromSemantic(semantic: unknown): string[] {
  if (!semantic || typeof semantic !== 'object') return []
  return Array.isArray((semantic as VaultFolderSemantic).tags)
    ? (semantic as VaultFolderSemantic).tags!.map(String)
    : []
}

function semanticToSearchText(semantic: unknown): string {
  if (!semantic) return ''
  if (typeof semantic === 'string') return semantic
  if (typeof semantic !== 'object') return ''
  const value = semantic as VaultFolderSemantic
  return [
    value.description,
    value.retrievalHint,
    value.writebackHint,
    ...(value.tags || []),
  ].filter(Boolean).join(' ')
}

export function buildRetrievalFiles<T extends RuntimeFileLike>(
  files: T[],
  helpers: RuntimePathHelpers<T>,
  enhancement?: VaultEnhancementConfig,
): VaultRetrievalFile[] {
  return files.filter(file => !isPendingWikiCandidate(file)).map(file => {
    const path = helpers.filePath(file)
    const semantic = helpers.semanticFor(path, enhancement)
    const tags = [
      ...(Array.isArray(file.metadata?.tags) ? file.metadata.tags as string[] : []),
      ...path.split('/').filter(Boolean),
      ...tagsFromSemantic(semantic),
    ]
    return {
      id: file.id,
      name: file.name,
      content: [
        file.content,
        tags.length ? `\n\n标签：${tags.join(' ')}` : '',
        semantic ? `\n\n目录语义：${semanticToSearchText(semantic)}` : '',
      ].join(''),
      kind: file.kind,
      updatedAt: file.updatedAt,
      metadata: {
        ...(file.metadata || {}),
        vaultFolder: file.metadata?.vaultFolder,
        folderPath: path,
        folderSemantic: semantic,
        tags,
      },
    }
  })
}

export function rankRetrievalFilesWithRules(
  query: string,
  files: VaultRetrievalFile[],
  enhancement?: VaultEnhancementConfig,
): VaultRetrievalFile[] {
  return files
    .map(file => ({
      file,
      score: scoreVaultKnowledge(query, {
        id: file.id,
        title: file.name,
        content: file.content,
        kind: file.kind as any,
        updatedAt: file.updatedAt,
        tags: Array.isArray(file.metadata?.tags) ? file.metadata.tags as string[] : [],
        metadata: file.metadata,
      }, enhancement),
    }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(row => row.file)
}

function budgeted(text: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  return String(text || '').slice(0, maxChars)
}

function fitSections(sections: Array<{ title: string; body: string; minChars: number; maxChars: number }>, maxTotalChars: number): string {
  const headerCost = sections.reduce((sum, section) => sum + `\n\n---\n[${section.title}]\n`.length, 0)
  let remaining = Math.max(0, maxTotalChars - headerCost)
  const bodies = sections.map(section => {
    const share = Math.min(section.maxChars, Math.max(section.minChars, Math.floor(remaining / Math.max(1, sections.length))))
    const body = budgeted(section.body, share)
    remaining -= body.length
    return body
  })

  for (let i = 0; i < bodies.length && remaining > 0; i++) {
    const section = sections[i]
    const available = section.maxChars - bodies[i].length
    if (available <= 0) continue
    const extra = budgeted(section.body.slice(bodies[i].length), Math.min(available, remaining))
    bodies[i] += extra
    remaining -= extra.length
  }

  return sections
    .map((section, index) => `\n\n---\n[${section.title}]\n${bodies[index]}`)
    .join('')
    .slice(0, maxTotalChars)
}

export function buildRecallSections(input: RecallSectionInput): string {
  const maxTotalChars = input.maxTotalChars || 6000
  const sections: Array<{ title: string; body: string; minChars: number; maxChars: number }> = []
  if (input.claudeText) {
    sections.push({
      title: '知识库配置',
      body: input.claudeText,
      minChars: Math.min(160, input.claudeMaxChars || 1500),
      maxChars: input.claudeMaxChars || 1500,
    })
  }
  if (input.contextPack) {
    sections.push({
      title: '知识库上下文包',
      body: input.contextPack,
      minChars: Math.min(220, maxTotalChars),
      maxChars: maxTotalChars,
    })
  }
  if (input.pinned?.length) {
    const body = input.pinned
      .map(p => `- ${p.name}: ${p.content}`)
      .join('\n')
    sections.push({
      title: '钉选记忆',
      body,
      minChars: Math.min(160, input.pinnedMaxChars || 2000),
      maxChars: input.pinnedMaxChars || 2000,
    })
  }
  return fitSections(sections, maxTotalChars)
}

function timestampForFileName(now: number): string {
  return new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

export function toWikiWritebackRecords(input: {
  drafts: VaultWritebackDraft[]
  userText: string
  assistantText: string
  sessionId?: string
  sourceMessageIds?: string[]
  now?: number
}): WikiWritebackRecord[] {
  const now = input.now || Date.now()
  const records: WikiWritebackRecord[] = []

  for (const draft of input.drafts) {
    records.push({
      name: draft.fileName,
      targetPath: normalizePath(draft.targetPath),
      content: [
        `<!-- 写回候选：${new Date(now).toLocaleString('zh-CN')} -->`,
        '',
        `## 用户问题`,
        input.userText,
        '',
        `## 候选内容`,
        draft.content,
      ].join('\n'),
      kind: 'page',
      mode: draft.mode,
      metadata: {
        vaultFolder: 'wiki',
        kind: 'writeback-candidate',
        status: 'pending',
        targetPath: normalizePath(draft.targetPath),
        reason: draft.reason,
        sourceSessionId: input.sessionId,
        sourceMessageIds: input.sourceMessageIds || [],
        autoWritebackAt: now,
      },
    })
  }

  if (records.length > 0) {
    const summary = records.map(record => `- ${record.targetPath}/${record.name}：${record.metadata.reason}`).join('\n')
    records.push({
      name: 'log.md',
      targetPath: 'wiki',
      content: `\n- ${new Date(now).toLocaleString('zh-CN')} 生成 ${records.length} 条写回候选，等待整理确认。`,
      kind: 'summary',
      mode: 'append',
      metadata: {
        vaultFolder: 'wiki',
        kind: 'vault-log-entry',
        status: 'pending',
      },
    })
    records.push({
      name: `写回候选报告_${timestampForFileName(now)}.md`,
      targetPath: '_reports/整理记录',
      content: [
        '# 写回候选报告',
        '',
        `生成时间：${new Date(now).toLocaleString('zh-CN')}`,
        '',
        '## 候选条目',
        summary,
      ].join('\n'),
      kind: 'summary',
      mode: 'create',
      metadata: {
        vaultFolder: 'reports',
        kind: 'writeback-candidate-report',
        status: 'pending',
      },
    })
  }

  return records
}

export function buildRuntimeContextPack(
  query: string,
  files: VaultRetrievalFile[],
  enhancement: VaultEnhancementConfig | undefined,
  opts: VaultContextPackOptions,
): string {
  const ranked = rankRetrievalFilesWithRules(query, files, enhancement)
  const plan = buildVaultRetrievalPlan(query, ranked)
  return buildVaultContextPack(plan, opts)
}
