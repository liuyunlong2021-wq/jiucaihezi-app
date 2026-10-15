import contract from '../../../public/skills/wiki-artifacts.json'
import { createRuntimeProjectFileService, type ProjectFileService } from '@/services/projectFileService'
import type { ProjectTextRead } from '@/utils/projectResource'

type Template = { path: string; index: string; label: string; entity?: boolean; episode?: boolean; model?: string[]; mode?: string }
type Args = Record<string, unknown>
export const WIKI_ARTIFACT_RECEIPT_MARKER = '\n\n程序保存回执：\n'
export interface WikiArtifactReceipt {
  status: 'saved' | 'saved_with_warnings'
  path: string
  operation: 'created' | 'updated' | 'unchanged'
  warnings: string[]
  affected_paths: string[]
}

export const WIKI_ARTIFACT_TOOL = {
  type: 'function',
  function: {
    name: 'wiki_save_artifact',
    description: '保存用户要求的正式创作产物到当前项目唯一 Wiki，更新直属索引。讨论、候选、不要保存时禁用。小说先存草稿，明确确认一致版本后才能追加原文。更新已有文件必须先 read。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['artifact_kind', 'content'],
      properties: {
        artifact_kind: { type: 'string', enum: Object.keys(contract.types) },
        wiki_root: { type: 'string', enum: contract.rootCandidates, description: '仅当用户已明确选择多个现有根中的一个时填写；不得替用户选择或另建平行Wiki。' },
        content: { type: 'string', description: '完整 Markdown 正文；小说章节不含工具生成的章标题。' },
        summary: { type: 'string' },
        episode_number: { type: 'integer' }, entity_name: { type: 'string' },
        video_model: { type: 'string', enum: ['H3', 'Seedance'] }, segment: { type: 'string' },
        write_mode: { type: 'string', enum: ['create', 'update', 'append'] }, section_name: { type: 'string' },
        work_name: { type: 'string' }, chapter_number: { type: 'integer' }, chapter_title: { type: 'string' },
        user_confirmed: { type: 'boolean', description: '仅用户明确确认已保存草稿时传 true；继续不等于确认。' },
      },
    },
  },
}

export async function chooseProjectWikiRoot(owner: string, files: ProjectFileService, preferredRoot?: string): Promise<string | null> {
  const entries = await files.list(owner)
  const roots: string[] = []
  for (const root of contract.rootCandidates) {
    const signature = contract.excludedRootSignatures.find(item => item.root === root)
    if (signature && entries.some(item => item.path === `${root}/${signature.path}`)) {
      const text = await files.readTextAt(owner, `${root}/${signature.path}`)
      if (text.content.startsWith(signature.startsWith)) continue
    }
    const names = new Set(entries.filter(item => item.path.startsWith(`${root}/`)).map(item => item.path.slice(root.length + 1).split('/')[0]))
    if (names.has(contract.rootIndex) || contract.rootMarkers.filter(name => name !== contract.rootIndex && names.has(name)).length >= contract.minimumRootMarkers) roots.push(root)
  }
  if (preferredRoot) {
    if (!roots.includes(preferredRoot)) throw new Error('用户选择的目录不是可识别的项目Wiki根，未创建平行Wiki')
    return preferredRoot
  }
  if (roots.length > 1) throw new Error(`检测到多个 Wiki 根目录：${roots.join('、')}，请先明确选择。`)
  return roots[0] || null
}

// 文件名规则沿用桌面合同，路径只由固定模板产生，不接收任意路径。
function safeName(value: unknown, field: string): string {
  // eslint-disable-next-line no-control-regex -- Windows文件名禁止控制字符。
  const name = String(value || '').normalize('NFC').trim().replace(/[<>:"/\\|?*\u0000-\u001f\u007f[\]#%]/g, '-').replace(/\s+/gu, '-').replace(/^\.+/, '').replace(/[. ]+$/g, '').slice(0, 80)
  if (!name) throw new Error(`${field}不能为空`)
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name
}

function ordinal(value: unknown, max: number, field: string): string {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > max) throw new Error(`${field}必须是1至${max}的正整数`)
  return String(value).padStart(3, '0')
}

function relativeLink(from: string, to: string): string {
  const base = from.split('/').slice(0, -1)
  const target = to.replace(/\.md$/i, '').split('/')
  while (base.length && target.length && base[0] === target[0]) { base.shift(); target.shift() }
  return [...base.map(() => '..'), ...target].join('/')
}

async function snapshot(owner: string, path: string, files: ProjectFileService): Promise<ProjectTextRead | null> {
  const resource = (await files.list(owner)).find(item => item.path === path)
  if (!resource) return null
  if (resource.isDirectory) throw new Error(`目标不是文件：${path}`)
  const text = await files.readTextAt(owner, path)
  if (text.truncated) throw new Error(`文件读取不完整，未写入：${path}`)
  return text
}

async function write(owner: string, path: string, content: string, before: ProjectTextRead | null, files: ProjectFileService): Promise<'created' | 'updated' | 'unchanged'> {
  if (before?.content === content) return 'unchanged'
  if (!before) {
    const parts = path.split('/').slice(0, -1)
    for (let i = 1; i <= parts.length; i++) await files.createFolder(owner, parts.slice(0, i).join('/'))
    await files.createText(owner, path, content)
  } else {
    const resource = (await files.list(owner)).find(item => item.path === path)
    if (!resource) throw new Error(`文件已被删除：${path}`)
    const result = await files.writeText(resource, content, before.revision)
    if (result.status !== 'saved') throw new Error(`文件发生变化或版本冲突，未覆盖：${path}`)
  }
  if ((await files.readTextAt(owner, path)).content !== content) throw new Error(`写后读回不一致：${path}`)
  return before ? 'updated' : 'created'
}

async function updateIndex(owner: string, path: string, target: string, label: string, summary: string, files: ProjectFileService) {
  const key = relativeLink(path, target)
  const line = `- [[${key}|${label}]] - ${summary}`
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await snapshot(owner, path, files)
    const lines = (before?.content || `# ${path.split('/').at(-2) || 'Wiki'}\n`).trimEnd().split('\n')
    const existing = lines.findIndex(item => item.includes(`[[${key}|`) || item.includes(`[[${key}]]`))
    if (existing < 0) lines.push('', line)
    else lines[existing] = line
    try { await write(owner, path, `${lines.join('\n')}\n`, before, files); return } catch (error) { if (attempt === 2) throw error }
  }
}

export async function saveWikiArtifact(
  owner: string,
  args: Args,
  files: ProjectFileService = createRuntimeProjectFileService(),
  observed: ReadonlyMap<string, string> = new Map(),
): Promise<WikiArtifactReceipt> {
  if (!owner) throw new Error('请先选择项目')
  const properties = WIKI_ARTIFACT_TOOL.function.parameters.properties
  if (Object.keys(args).some(key => !(key in properties))) throw new Error('不支持的产物参数；不能传入任意路径')
  for (const [key, value] of Object.entries(args)) {
    const type = (properties as Record<string, { type: string }>)[key]!.type
    if (type === 'integer' ? !Number.isInteger(value) : typeof value !== type) throw new Error(`产物参数类型无效：${key}`)
  }
  const template = (contract.types as Record<string, Template>)[String(args.artifact_kind)]
  if (!template) throw new Error('不支持的产物类型')
  if (typeof args.content !== 'string' || !args.content.trim()) throw new Error('正文不能为空')
  const content = `${args.content.replace(/\r\n/g, '\n').trimEnd()}\n`
  if (new TextEncoder().encode(content).length > 1_000_000) throw new Error('产物不能超过1MB')
  const values: Record<string, string> = {}
  if (template.entity) values.entity = safeName(args.entity_name, 'entity_name')
  if (template.episode) values.episode = `第${ordinal(args.episode_number, 9999, 'episode_number')}集`
  if (template.model) {
    if (!template.model.includes(String(args.video_model))) throw new Error('video_model必须是H3或Seedance')
    values.model = String(args.video_model)
    values.segment = safeName(args.segment, 'segment')
  }
  const chapter = template.mode?.startsWith('chapter_')
  if (chapter) {
    values.book = safeName(args.work_name, 'work_name')
    values.chapter = ordinal(args.chapter_number, 99999, 'chapter_number')
    if (typeof args.chapter_title !== 'string' || !args.chapter_title.trim() || /[\r\n]/.test(args.chapter_title) || args.chapter_title.length > 120) throw new Error('chapter_title必须是非空单行标题，最多120字')
  }
  const interpolate = (value: string) => value.replace(/\{([a-z_]+)\}/g, (_match, key: string) => {
    if (!(key in values)) throw new Error(`缺少产物字段：${key}`)
    return values[key]!
  })
  let mode = String(args.write_mode || 'create')
  if (!['create', 'update', 'append'].includes(mode)) throw new Error('write_mode无效')
  if (mode === 'append' && !template.entity) throw new Error('append仅用于实体独立章节')
  if (template.mode === 'chapter_source' && args.write_mode) throw new Error('已确认章节不能覆盖原文')
  const pageContent = chapter ? `# 第${values.chapter}章 ${String(args.chapter_title).trim()}\n\n${content}` : content
  let root = await chooseProjectWikiRoot(owner, files, typeof args.wiki_root === 'string' ? args.wiki_root : undefined)
  if (!root) {
    const entries = await files.list(owner)
    const occupied = entries.some(item => item.path === 'wiki' && !item.isDirectory || item.path.startsWith('wiki/'))
    const retryPath = `wiki/${interpolate(template.path)}`
    const retry = occupied && entries.some(item => item.path === retryPath) ? await snapshot(owner, retryPath, files) : null
    if (occupied && retry?.content !== pageContent) throw new Error('wiki已有内容但缺少可识别索引，请先整理，未另建Wiki')
    root = 'wiki'
  }
  const path = `${root}/${interpolate(template.path)}`
  const label = interpolate(template.label)
  const before = await snapshot(owner, path, files)
  let next = pageContent
  let draft: { path: string; before: ProjectTextRead; record: string } | undefined
  if (template.mode === 'chapter_source') {
    if (args.user_confirmed !== true) throw new Error('只有用户明确确认后才能追加原文')
    const draftPath = `${root}/创作/章节草稿/${values.book}/第${values.chapter}章.md`
    const pending = await snapshot(owner, draftPath, files)
    if (!pending) throw new Error('找不到待确认草稿')
    const bytes = new TextEncoder().encode(next)
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    const record = `# 第${values.chapter}章 ${String(args.chapter_title).trim()}\n\n> 状态：已由用户确认并追加到原文。\n> 草稿 SHA-256：${digest}\n> 原文：[[${relativeLink(draftPath, path)}|已确认正文]]\n`
    if (pending.content !== next && pending.content !== record) throw new Error('确认正文与已保存草稿不一致，请重新确认')
    const source = before?.content || `# ${values.book}\n`
    const matches = [...source.matchAll(new RegExp(`^#{1,6}\\s*第0*${Number(values.chapter)}章(?:\\s|$).*`, 'gm'))]
    if (matches.length > 1) throw new Error('原文存在重复章号，请先处理冲突')
    if (matches.length) {
      const start = matches[0]!.index!
      const heading = /^#{1}\s+/gm
      heading.lastIndex = start + matches[0]![0].length
      const end = heading.exec(source)?.index ?? source.length
      if (source.slice(start, end).trim() !== next.trim()) throw new Error('原文已有不同章节，未覆盖')
      next = source
    } else next = `${source.trimEnd()}\n\n${next}`
    draft = { path: draftPath, before: pending, record }
    mode = 'confirmed'
  } else if (mode === 'append') {
    const section = safeName(args.section_name, 'section_name')
    if (before && observed.get(path) !== before.content) throw new Error('请先读取当前文件版本再追加')
    if (before?.content.split('\n').some(line => line.trim() === `## ${section}`)) throw new Error('章节已存在，请明确修订')
    next = `${before?.content.trimEnd() || `# ${values.entity}`}\n\n## ${section}\n\n${content}`
  }
  if (mode === 'create' && before && before.content !== next) throw new Error('文件已存在，先读取后明确更新')
  if (mode === 'update' && (!before || observed.get(path) !== before.content)) throw new Error('请先读取当前文件版本再更新')
  const operation = await write(owner, path, next, before, files)
  const warnings: string[] = []
  const affected = new Set([path])
  if (draft) {
    try { await write(owner, draft.path, draft.record, draft.before, files); affected.add(draft.path) } catch (error) { warnings.push(`原文已保存，确认记录未完成：${String(error)}`) }
  }
  // 正文可靠保存后才维护导航；失败保留正文，同内容重试只修复缺项。
  const summary = String(args.summary || content.split('\n').find(line => line.trim() && !line.startsWith('#')) || label).replace(/[\r\n|]+/g, ' ').slice(0, 160)
  let target = path
  let parent = path.split('/').slice(0, -1).join('/')
  while (parent === root || parent.startsWith(`${root}/`)) {
    const index = `${parent}/index.md`
    try { await updateIndex(owner, index, target, target === path ? label : target.split('/').at(-2)!, target === path ? summary : '子目录内容导航。', files); affected.add(index) } catch (error) { warnings.push(`${index}: ${String(error)}`) }
    if (parent === root) break
    target = index
    parent = parent.split('/').slice(0, -1).join('/')
  }
  return { status: warnings.length ? 'saved_with_warnings' : 'saved', path, operation, warnings, affected_paths: [...affected] }
}
