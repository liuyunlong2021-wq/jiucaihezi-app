import { createHash } from 'node:crypto'
import { join, posix } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['saved', 'saved_with_warnings'], required: true },
    path: { type: 'string', required: true },
    operation: { type: 'string', enum: ['created', 'updated', 'unchanged'], required: true },
    warnings: { type: 'array', items: { type: 'string' }, required: true },
  },
  additionalProperties: false,
}

const ROOT_INDEXES = [
  { path: '原始材料/index.md', title: '原始材料', purpose: '保存用户明确导入或授权使用的来源材料。' },
  { path: '改编方案/index.md', title: '改编方案', purpose: '保存已确认的视觉方向与项目总纲。' },
  { path: '剧本/index.md', title: '剧本', purpose: '按集管理分集剧本、工程剧本和视频提示词。' },
  { path: '资产/角色/index.md', title: '角色', purpose: '一个角色一份档案，集中保存人物小传关联信息、形象设定与提示词。' },
  { path: '资产/场景/index.md', title: '场景', purpose: '一个场景一份档案，保存可复用空间设定与提示词。' },
  { path: '资产/道具/index.md', title: '道具', purpose: '一个道具一份档案，保存可复用设计与提示词。' },
  { path: '项目资料/人物小传/index.md', title: '人物小传', purpose: '每个人物单独保存一份小传。' },
]

const ROOT_INDEX = [
  '# 漫剧制作 Wiki',
  '',
  '用途：集中管理本项目的前期资料、分集剧本、资产和视频提示词。内容仅在漫剧制作实际产出时建立。',
  '',
  '## 子目录',
  '',
  '- [[原始材料/index|原始材料]]',
  '- [[项目资料/index|项目资料]]',
  '- [[改编方案/index|改编方案]]',
  '- [[剧本/index|剧本]]',
  '- [[资产/index|资产]]',
  '- [[制作进度|制作进度]]',
].join('\n') + '\n'

const PROGRESS_INDEX = [
  '# 制作进度',
  '',
  '本页只索引已经保存的交付物，不复制资料正文。',
  '',
  '## 已保存产物',
].join('\n') + '\n'

const PROJECT_MATERIALS_INDEX = [
  '# 项目资料',
  '',
  '用途：保存故事资料与人物小传。',
  '',
  '## 子目录',
  '',
  '- [[人物小传/index|人物小传]]',
  '',
  '## 内容',
].join('\n') + '\n'

const ASSET_INDEX = [
  '# 资产',
  '',
  '用途：保存可复用的角色、场景和道具资料及提示词。',
  '',
  '## 子目录',
  '',
  '- [[角色/index|角色]]',
  '- [[场景/index|场景]]',
  '- [[道具/index|道具]]',
].join('\n') + '\n'

function folderIndex({ title, purpose }) {
  return `# ${title}\n\n用途：${purpose}\n\n## 内容\n`
}

function rootIndex(contract) {
  const rootDirs = [...new Set(contract.scaffold.directories.map(item => item.path.split('/')[0]))]
  const purposes = new Map(contract.scaffold.directories.map(item => [item.path, item.purpose]))
  return [
    `# ${contract.scaffold.rootTitle}`,
    '',
    '用途：统一管理本项目的创作规划、来源材料、短剧剧本、漫剧制作资料与可复用资产。',
    '',
    '## 子目录',
    '',
    ...rootDirs.map(name => `- [[${name}/index|${name}]] - ${purposes.get(name) || `${name} 相关资料导航。`}`),
    `- [[${contract.scaffold.progressPath.replace(/\.md$/i, '')}|项目进度]] - 跟踪已保存产物与待办。`,
  ].join('\n') + '\n'
}

function sharedFolderIndex(item, contract) {
  const title = item.path.split('/').at(-1)
  const children = contract.scaffold.directories.filter(child =>
    !child.path.includes('{') && child.path.startsWith(`${item.path}/`)
      && !child.path.slice(item.path.length + 1).includes('/'),
  )
  return [
    `# ${title}`,
    '',
    `用途：${item.purpose}`,
    '',
    ...(children.length ? ['## 子目录', '', ...children.map(child => {
      const name = child.path.slice(item.path.length + 1)
      return `- [[${name}/index|${name.split('/').at(-1)}]] - ${child.purpose}`
    }), ''] : []),
    '## 内容',
  ].join('\n') + '\n'
}

function sharedProgressIndex() {
  return '# 项目进度\n\n本页只导航已经保存的交付物与待办，不复制正文，也不替代业务确认。\n\n## 已保存产物\n'
}

function normalizedMarkdown(content) {
  if (typeof content !== 'string') throw new Error('产物 content 必须是 Markdown 文本')
  const normalized = content.replace(/\r\n/g, '\n').trimEnd()
  if (!normalized.trim()) throw new Error('产物内容不能为空')
  if (Buffer.byteLength(normalized, 'utf8') > 1_000_000) throw new Error('单份 Wiki 产物不能超过 1 MB')
  return `${normalized}\n`
}

function indexSummary(value, content, label) {
  const frontmatterStripped = content.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '')
  const excerpt = frontmatterStripped.split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line && !/^#{1,6}\s/.test(line))
    ?.replace(/^[-*+]\s+/, '')
  const summary = String(value || excerpt || `${label}正文。`)
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target, label) => label || target)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[\r\n|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const clipped = [...summary].slice(0, 160).join('')
  return clipped || `${label}正文。`
}

function normalizeWikiLinks(content, wikiRoot, path) {
  return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (original, target, label) => {
    if (!target.startsWith(`${wikiRoot}/`)) return original
    const match = /^(.*?\.md)(?:\s+(.+))?$/.exec(target)
    if (!match) return original
    const relative = posix.relative(posix.dirname(`${wikiRoot}/${path}`), match[1])
    return `[[${relative}|${label || match[2] || posix.basename(match[1], '.md')}]]`
  })
}

function safeName(value, field) {
  const safe = String(value || '')
    .normalize('NFC')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .replace(/[\[\]#%]/g, '-')
    .replace(/\s+/gu, '-')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/g, '')
    .slice(0, 80)
  if (!safe || safe === '.' || safe === '..') throw new Error(`${field}不能为空或不能作为文件名`)
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe)) return `_${safe}`
  return safe
}

function episodeFolder(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 9999)
    throw new Error('episode_number 必须是 1 至 9999 的正整数')
  return `第${String(value).padStart(3, '0')}集`
}

function chapterFolder(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 99999)
    throw new Error('chapter_number 必须是 1 至 99999 的正整数')
  return String(value).padStart(3, '0')
}

function artifactSpec(args, contract) {
  let template = contract.types[args.artifact_kind]
  if (!template) throw new Error(`不支持的 Wiki 产物类型：${args.artifact_kind}`)
  if (args.research_version !== undefined) {
    if (!template.research || !['original', 'adapted'].includes(args.research_version))
      throw new Error('research_version 只允许项目资料使用 original 或 adapted')
    const prefix = `项目资料/${args.research_version === 'original' ? '原作' : '改编版'}/`
    template = { ...template, path: template.path.replace('项目资料/', prefix), index: template.index.replace('项目资料/', prefix) }
  }
  const values = {}
  if (template.episode) values.episode_number = String(args.episode_number)
  if (template.mode === 'source_selection') values.work = safeName(args.work_name, 'work_name')
  if (template.episode) values.episode = episodeFolder(args.episode_number)
  if (template.entity) values.entity = safeName(args.entity_name, 'entity_name')
  if (template.model) {
    if (!template.model.includes(args.video_model)) throw new Error(`video_model 必须是 ${template.model.join(' 或 ')}`)
    values.model = args.video_model
  }
  if (template.path.includes('{segment}') || template.label.includes('{segment}')) values.segment = safeName(args.segment ?? '全篇', 'segment')
  if (template.path.includes('{clip}')) {
    const clip = /^(?:片段)?([0-9]{1,3})$/.exec(String(args.segment || ''))
    if (!clip || Number(clip[1]) < 1) throw new Error('segment 必须是1至999的片段序号，例如001')
    values.clip = String(Number(clip[1])).padStart(3, '0')
  }
  if (template.path.includes('{book}') || template.path.includes('{chapter}')) {
    values.book = safeName(args.work_name, 'work_name')
    values.chapter = chapterFolder(args.chapter_number)
    const title = String(args.chapter_title || '').trim()
    if (!title || /[\r\n]/.test(title)) throw new Error('chapter_title 必须是非空单行标题')
    if (title.length > 120) throw new Error('chapter_title 不能超过 120 个字符')
  }
  const interpolate = value => value.replace(/\{([a-z_]+)\}/g, (_match, key) => {
    if (!(key in values)) throw new Error(`缺少产物字段：${key}`)
    return values[key]
  })
  const mode = template.mode || 'page'
  const writeMode = mode === 'chapter_source' ? 'append' : args.write_mode || 'create'
  if (!['create', 'update', 'append'].includes(writeMode)) throw new Error('write_mode 必须是 create、update 或 append')
  if (writeMode === 'append' && !template.entity && mode !== 'chapter_source')
    throw new Error('write_mode=append 只用于同一人物、角色、场景或道具档案新增独立章节')
  if (mode === 'chapter_draft' && writeMode === 'append') throw new Error('章节草稿不能追加到其他章节')
  if (mode === 'chapter_source' && args.write_mode) throw new Error('已确认章节只追加到原文，不能以文件写入模式覆盖')
  return {
    path: interpolate(template.path),
    index: interpolate(template.index),
    label: interpolate(template.label),
    episode: values.episode,
    modelFolder: values.model,
    workName: String(args.work_name || '').trim(),
    chapterNumber: values.chapter,
    chapterTitle: String(args.chapter_title || '').trim(),
    chapterOrdinal: Number(args.chapter_number),
    mode,
    writeMode,
    sectionName: writeMode === 'append' && template.entity ? safeName(args.section_name, 'section_name') : '',
    kind: args.artifact_kind,
    template,
  }
}

function relativeIndexLink(indexPath, targetPath, label, summary) {
  const target = posix.relative(posix.dirname(indexPath), targetPath).replace(/\.md$/i, '')
  return `- [[${target}|${label}]] - ${summary}`
}

async function projectTarget(ctx, cwd, relativePath, signal, workspace) {
  const parts = relativePath.split('/').filter(Boolean)
  if (!parts.length || parts.some(part => part === '.' || part === '..')) throw new Error('目标路径不在当前项目 Wiki 范围内')
  let cursor = cwd
  for (const part of parts) {
    cursor = join(cursor, part)
    const pathInfo = await ctx.fs.lstat(cursor, { cwd }, signal)
    if (pathInfo?.type === 'symlink') throw new Error(`拒绝写入符号链接路径：${relativePath}`)
  }
  const target = await ctx.fs.resolve(join(cwd, ...parts), { cwd, signal })
  if (!ctx.fs.contains(workspace, target)) throw new Error(`目标路径超出当前项目：${relativePath}`)
  return target
}

async function writePath(ctx, args, exec, cwd, workspace, policy, relativePath, content, mode = 'create', expectedPriorContent) {
  const target = await projectTarget(ctx, cwd, relativePath, exec.signal, workspace)
  const beforeInfo = await ctx.fs.stat(target, exec.signal)
  if (mode === 'create' && beforeInfo?.type === 'file' && args.artifact_kind === 'source_material'
    && await ctx.fs.readText(target, exec.signal) === content) return 'unchanged'
  if (mode === 'create' && beforeInfo) throw new Error(`文件已存在，未覆盖：${relativePath}。若用户明确要求修改，请先读取原文件并使用 write_mode=update。`)
  if (mode === 'update' && !beforeInfo) throw new Error(`要更新的文件不存在：${relativePath}。请先按新产物创建。`)
  if (beforeInfo && beforeInfo.type !== 'file') throw new Error(`目标不是普通文件：${relativePath}`)

  let nextContent = content
  let intent
  let expected
  if (!beforeInfo) {
    if (mode === 'append') {
      const section = safeName(args.section_name, 'section_name')
      const entity = safeName(args.entity_name, 'entity_name')
      nextContent = `# ${entity}\n\n## ${section}\n\n${content.trimEnd()}\n`
    }
    ctx.emit('fs/observed', target, { kind: 'absent' }, exec)
    intent = await ctx.waterfall('fs/write-intent', target, exec, () => ({ kind: 'createIfAbsent' }))
    expected = intent || { kind: 'createIfAbsent' }
  } else {
    const currentText = await ctx.fs.readText(target, exec.signal)
    const currentInfo = await ctx.fs.stat(target, exec.signal)
    if (!currentInfo || currentInfo.version !== beforeInfo.version || currentText === undefined)
      throw new Error(`文件在读取期间发生变化，请重试：${relativePath}`)
    if (expectedPriorContent !== undefined && currentText !== expectedPriorContent)
      throw new Error(`文件内容已被其他操作修改，请重新读取后再更新：${relativePath}`)
    if (mode === 'upsert' && currentText === content) return 'unchanged'
    if (mode === 'append') {
      const section = safeName(args.section_name, 'section_name')
      if (currentText.split(/\r?\n/).some(line => line.trim() === `## ${section}`))
        throw new Error(`文件已包含“${section}”章节：${relativePath}。若要修订该章节，请读取原文并使用 write_mode=update。`)
      nextContent = `${currentText.trimEnd()}\n\n## ${section}\n\n${content.trimEnd()}\n`
    }
    ctx.emit('fs/observed', target, { kind: 'present', version: currentInfo.version }, exec)
    intent = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)
    expected = intent?.kind === 'replaceIfVersion'
      ? intent
      : { kind: 'replaceIfVersion', version: currentInfo.version }
  }

  const result = await ctx.fs.writeText(target, nextContent, expected, exec.signal, policy)
  ctx.emit('fs/observed', target, { kind: 'present', version: result.version }, exec)
  const readback = await ctx.fs.readText(target, exec.signal)
  if (readback !== nextContent) throw new Error(`文件读回校验不一致：${relativePath}`)
  return result.operation === 'create' ? 'created' : 'updated'
}

async function ensureFile(ctx, args, exec, cwd, workspace, policy, path, content) {
  const target = await projectTarget(ctx, cwd, path, exec.signal, workspace)
  const info = await ctx.fs.stat(target, exec.signal)
  if (info?.type === 'file') return
  if (info) throw new Error(`索引文件路径被非文件占用：${path}`)
  try {
    await writePath(ctx, args, exec, cwd, workspace, policy, path, content, 'create')
  } catch (error) {
    const after = await ctx.fs.stat(target, exec.signal).catch(() => undefined)
    if (after?.type === 'file') return
    throw error
  }
}

async function appendIndexLink(ctx, exec, cwd, workspace, policy, indexPath, targetPath, label, summary = `${label}内容导航。`) {
  const link = relativeIndexLink(indexPath, targetPath, label, summary)
  const targetKey = link.slice(link.indexOf('[[') + 2, link.indexOf('|'))
  const target = await projectTarget(ctx, cwd, indexPath, exec.signal, workspace)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const info = await ctx.fs.stat(target, exec.signal)
    if (!info || info.type !== 'file') throw new Error(`索引文件不可用：${indexPath}`)
    const current = await ctx.fs.readText(target, exec.signal)
    const lines = current.split(/\r?\n/)
    const existingLine = lines.findIndex(line => line.includes(`[[${targetKey}|`) || line.includes(`[[${targetKey}]]`))
    if (existingLine >= 0 && lines[existingLine].trim() === link) return
    const next = existingLine >= 0
      ? `${lines.map((line, index) => index === existingLine ? link : line).join('\n').trimEnd()}\n`
      : `${current.trimEnd()}\n\n${link}\n`
    const afterRead = await ctx.fs.stat(target, exec.signal)
    if (!afterRead || afterRead.type !== 'file' || afterRead.version !== info.version) continue
    ctx.emit('fs/observed', target, { kind: 'present', version: afterRead.version }, exec)
    const intent = await ctx.waterfall('fs/write-intent', target, exec, () => undefined)
    const expected = intent?.kind === 'replaceIfVersion'
      ? intent
      : { kind: 'replaceIfVersion', version: afterRead.version }
    try {
      const result = await ctx.fs.writeText(target, next, expected, exec.signal, policy)
      ctx.emit('fs/observed', target, { kind: 'present', version: result.version }, exec)
      if (await ctx.fs.readText(target, exec.signal) !== next) throw new Error(`索引读回校验不一致：${indexPath}`)
      return
    } catch (error) {
      if (error?.code && !['FS_STALE_VERSION', 'FS_NOT_OBSERVED'].includes(error.code)) throw error
      const latest = await ctx.fs.stat(target, exec.signal).catch(() => undefined)
      if (attempt === 2 || !latest || latest.type !== 'file') throw error
    }
  }
}

async function chooseWikiRoot(ctx, cwd, exec, workspace, contract) {
  const candidates = contract.rootCandidates
  const roots = []
  for (const path of candidates) {
    const target = await projectTarget(ctx, cwd, path, exec.signal, workspace)
    const info = await ctx.fs.stat(target, exec.signal)
    if (!info) { roots.push({ path, kind: 'missing', actual: false }); continue }
    if (info.type !== 'directory') { roots.push({ path, kind: 'occupied', actual: false }); continue }
    const entries = await ctx.fs.listDir(target, exec.signal)
    const markers = new Set(entries.map(entry => entry.name))
    const markerCount = contract.rootMarkers.filter(name => name !== contract.rootIndex && markers.has(name)).length
    let excluded = false
    const signature = contract.excludedRootSignatures?.find(item => item.root === path)
    if (signature && markers.has(signature.path)) {
      const signaturePath = `${path}/${signature.path}`
      const signatureTarget = await projectTarget(ctx, cwd, signaturePath, exec.signal, workspace)
      const signatureText = await ctx.fs.readText(signatureTarget, exec.signal).catch(() => undefined)
      excluded = signatureText?.startsWith(signature.startsWith) === true
    }
    roots.push({
      path,
      kind: 'directory',
      entries: entries.length,
      actual: !excluded && (markers.has(contract.rootIndex) || markerCount >= contract.minimumRootMarkers),
    })
  }
  const actual = roots.filter(root => root.actual)
  if (actual.length > 1) throw new Error(`检测到多个 Wiki 根目录：${actual.map(root => `${root.path}/`).join('、')}。请先明确选择，不能混合读取。`)
  if (actual.length === 1) return actual[0].path
  const wiki = roots.find(root => root.path === contract.rootCandidates[0])
  if (wiki?.kind === 'occupied') throw new Error('wiki 路径被普通文件占用，无法建立项目 Wiki。')
  if (wiki?.kind === 'directory' && wiki.entries > 0)
    throw new Error('wiki/ 已有内容但缺少可识别的 Wiki 索引；先整理现有根，未另建第二套 Wiki。')
  return 'wiki'
}

function episodeIndex(episode) {
  return [
    `# ${episode}`,
    '',
    '本集已生成的分集剧本、工程剧本和视频提示词会列在这里。',
    '',
    '## 交付物',
  ].join('\n') + '\n'
}

function promptIndex(episode) {
  return `# ${episode}视频提示词\n\n按模型和片段分别保存；同一集可混用不同模型。\n\n## 模型\n`
}

function modelIndex(episode, model) {
  return `# ${episode} ${model} 视频提示词\n\n## 片段\n`
}

async function ensureScaffold(ctx, args, exec, cwd, workspace, policy, wikiRoot, contract) {
  const staticDirectories = contract.scaffold.directories.filter(item => !item.path.includes('{'))
  const topDirectories = [...new Set(staticDirectories.map(item => item.path.split('/')[0]))]
  const indexItems = new Map()
  for (const name of topDirectories) {
    const top = staticDirectories.find(item => item.path === name)
      || { path: name, purpose: `${name} 内容的导航目录。` }
    indexItems.set(name, top)
  }
  for (const item of staticDirectories) indexItems.set(item.path, item)
  const staticIndexes = [
    { path: `${wikiRoot}/index.md`, content: rootIndex(contract) },
    { path: `${wikiRoot}/${contract.scaffold.progressPath}`, content: sharedProgressIndex() },
    ...[...indexItems.values()].map(item => ({
      path: `${wikiRoot}/${item.path}/index.md`,
      content: sharedFolderIndex(item, contract),
    })),
  ]
  for (const item of staticIndexes)
    await ensureFile(ctx, args, exec, cwd, workspace, policy, item.path, item.content)

  const parentIndexes = new Map([[`${wikiRoot}/index.md`, '']])
  for (const item of indexItems.values()) {
    const parent = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : ''
    parentIndexes.set(`${wikiRoot}/${parent ? `${parent}/` : ''}index.md`, parent)
  }
  for (const [indexPath, parent] of parentIndexes) {
    const children = [...indexItems.values()].filter(item => {
      const itemParent = item.path.includes('/') ? item.path.slice(0, item.path.lastIndexOf('/')) : ''
      return itemParent === parent
    })
    for (const child of children) {
      const target = `${wikiRoot}/${child.path}/index.md`
      const label = child.path.split('/').at(-1)
      await appendIndexLink(ctx, exec, cwd, workspace, policy, indexPath, target, label, child.purpose)
    }
  }
  await appendIndexLink(ctx, exec, cwd, workspace, policy,
    `${wikiRoot}/index.md`, `${wikiRoot}/${contract.scaffold.progressPath}`, '项目进度', '跟踪已保存产物与待办。')
}

function indexEntries(spec, wikiRoot, contract) {
  const index = `${wikiRoot}/${spec.index}`
  const target = `${wikiRoot}/${spec.path}`
  const entries = [{ index, target, label: spec.label, summary: spec.summary }]
  if (spec.precise) {
    let directory = posix.dirname(spec.index)
    while (directory !== '.') {
      const parent = posix.dirname(directory)
      entries.push({ index: `${wikiRoot}/${parent === '.' ? '' : `${parent}/`}index.md`,
        target: `${wikiRoot}/${directory}/index.md`, label: posix.basename(directory), summary: `${posix.basename(directory)}资料与产物。` })
      directory = parent
    }
    entries.push({ index: `${wikiRoot}/${contract.scaffold.progressPath}`, target, label: spec.label, summary: spec.summary })
    return entries.filter(entry => entry.index !== entry.target)
  }
  if (spec.episode) {
    const episodePath = `剧本/${spec.episode}`
    entries.push({ index: `${wikiRoot}/剧本/index.md`, target: `${wikiRoot}/${episodePath}/index.md`, label: spec.episode, summary: '查看本集分集剧本、工程剧本和视频提示词。' })
    entries.push({ index: `${wikiRoot}/${episodePath}/index.md`, target: `${wikiRoot}/${episodePath}/视频提示词/index.md`, label: '视频提示词', summary: '按视频模型和片段查看生成提示词。' })
    if (spec.kind === 'screenplay' || spec.kind === 'engineering_script')
      entries.push({ index: `${wikiRoot}/${episodePath}/index.md`, target, label: spec.label, summary: spec.summary })
  }
  if (spec.modelFolder) {
    const promptRoot = `剧本/${spec.episode}/视频提示词`
    entries.push({ index: `${wikiRoot}/${promptRoot}/index.md`, target: `${wikiRoot}/${promptRoot}/${spec.modelFolder}/index.md`, label: spec.modelFolder, summary: `${spec.modelFolder}视频提示词与片段索引。` })
    entries.push({ index: `${wikiRoot}/${promptRoot}/${spec.modelFolder}/index.md`, target, label: spec.label, summary: spec.summary })
  }
  if (spec.mode === 'chapter_draft') {
    const parent = '创作/章节草稿'
    const bookIndex = `${wikiRoot}/${spec.index}`
    entries.push({ index: `${wikiRoot}/创作/index.md`, target: `${wikiRoot}/${parent}/index.md`, label: '章节草稿', summary: '管理等待用户确认的章节草稿。' })
    entries.push({ index: `${wikiRoot}/${parent}/index.md`, target: bookIndex, label: spec.workName, summary: `查看《${spec.workName}》的章节草稿。` })
  }
  if (spec.mode === 'chapter_source') {
    const bookIndex = `${wikiRoot}/${spec.index}`
    const draftIndex = `${wikiRoot}/创作/章节草稿/${spec.workName}/index.md`
    const draftPath = `${wikiRoot}/创作/章节草稿/${spec.workName}/第${spec.chapterNumber}章.md`
    entries.push({
      index: draftIndex,
      target: draftPath,
      label: `${spec.workName} 第${spec.chapterNumber}章确认记录`,
      summary: '查看用户确认状态与正式原文链接。',
    })
    entries.push({ index: `${wikiRoot}/原始材料/index.md`, target: bookIndex, label: spec.workName, summary: `查看《${spec.workName}》已确认的原文。` })
    entries.push({
      index: `${wikiRoot}/创作/章节草稿/${spec.workName}/index.md`,
      target,
      label: `已确认：第${spec.chapterNumber}章正文`,
      summary: spec.summary,
    })
  }
  entries.push({ index: `${wikiRoot}/${contract.scaffold.progressPath}`, target, label: spec.label, summary: spec.summary })
  if (spec.template.research || spec.mode === 'source_selection') {
    let child = `${wikiRoot}/${spec.index}`
    let directory = posix.dirname(spec.index)
    while (directory.includes('/')) {
      const parent = posix.dirname(directory)
      entries.push({ index: `${wikiRoot}/${parent}/index.md`, target: child, label: posix.basename(directory), summary: `${posix.basename(directory)}资料索引。` })
      child = `${wikiRoot}/${parent}/index.md`
      directory = parent
    }
  }
  return entries.filter(entry => entry.index !== entry.target)
}

async function ensureDynamicIndexes(ctx, args, exec, cwd, workspace, policy, wikiRoot, spec, contract) {
  if (spec.precise) {
    let directory = posix.dirname(spec.index)
    while (directory !== '.') {
      await ensureFile(ctx, args, exec, cwd, workspace, policy, `${wikiRoot}/${directory}/index.md`, `# ${posix.basename(directory)}\n\n## 页面\n`)
      directory = posix.dirname(directory)
    }
    return
  }
  if (spec.template.research || spec.mode === 'source_selection') {
    let directory = posix.dirname(spec.index)
    while (directory !== '.') {
      await ensureFile(ctx, args, exec, cwd, workspace, policy,
        `${wikiRoot}/${directory}/index.md`, `# ${posix.basename(directory)}\n\n## 页面\n`)
      directory = posix.dirname(directory)
    }
  }
  if (spec.episode) {
    const episodeRoot = `${wikiRoot}/剧本/${spec.episode}`
    await ensureFile(ctx, args, exec, cwd, workspace, policy, `${episodeRoot}/index.md`, episodeIndex(spec.episode))
    await ensureFile(ctx, args, exec, cwd, workspace, policy, `${episodeRoot}/视频提示词/index.md`, promptIndex(spec.episode))
    if (spec.modelFolder)
      await ensureFile(ctx, args, exec, cwd, workspace, policy,
        `${episodeRoot}/视频提示词/${spec.modelFolder}/index.md`, modelIndex(spec.episode, spec.modelFolder))
  }
  if (spec.mode === 'chapter_draft' || spec.mode === 'chapter_source') {
    const directory = spec.path.slice(0, spec.path.lastIndexOf('/'))
    await ensureFile(ctx, args, exec, cwd, workspace, policy,
      `${wikiRoot}/${directory}/index.md`, `# ${spec.workName}\n\n## 章节\n`)
  }
}

function chapterDocument(spec, content) {
  return `# 第${spec.chapterNumber}章 ${spec.chapterTitle}\n\n${content.trimEnd()}\n`
}

function confirmedChapterBlock(spec, content) {
  return `# 第${spec.chapterNumber}章 ${spec.chapterTitle}\n\n${content.trimEnd()}`
}

function chapterDigest(spec, content) {
  return createHash('sha256').update(chapterDocument(spec, content)).digest('hex')
}

function chapterConfirmationRecord(spec, draftPath, sourcePath, digest) {
  const sourceLink = posix.relative(posix.dirname(draftPath), sourcePath).replace(/\.md$/i, '')
  return [
    `# 第${spec.chapterNumber}章 ${spec.chapterTitle}`,
    '',
    '> 状态：已由用户确认并追加到原文。',
    `> 草稿 SHA-256：${digest}`,
    `> 原文：[[${sourceLink}|已确认正文]]`,
    '',
  ].join('\n')
}

function findChapterSection(source, chapterNumber) {
  const ordinal = Number(chapterNumber)
  const header = new RegExp(`^(#{1,6})\\s*第0*${ordinal}章(?:\\s|$).*$`, 'gm')
  const matches = [...source.matchAll(header)]
  if (matches.length > 1) throw new Error(`原文中重复出现第${chapterNumber}章标题，请先人工处理冲突。`)
  if (!matches.length) return undefined
  const match = matches[0]
  const level = match[1].length
  const nextHeading = new RegExp(`^#{1,${level}}\\s+`, 'gm')
  nextHeading.lastIndex = match.index + match[0].length
  const next = nextHeading.exec(source)
  const end = next ? next.index : source.length
  return source.slice(match.index, end).trim()
}

async function saveConfirmedChapter(ctx, args, exec, cwd, workspace, policy, wikiRoot, spec, content) {
  if (args.user_confirmed !== true)
    throw new Error('只有用户明确确认章节草稿后，才能把正文追加到原始材料。')
  const draftPath = `${wikiRoot}/创作/章节草稿/${spec.workName}/第${spec.chapterNumber}章.md`
  const draftTarget = await projectTarget(ctx, cwd, draftPath, exec.signal, workspace)
  const draftInfo = await ctx.fs.stat(draftTarget, exec.signal)
  if (!draftInfo || draftInfo.type !== 'file') throw new Error(`找不到待确认章节草稿：${draftPath}`)
  const draftText = await ctx.fs.readText(draftTarget, exec.signal)
  const draftContent = chapterDocument(spec, content)
  const sourcePath = `${wikiRoot}/${spec.path}`
  const confirmationRecord = chapterConfirmationRecord(spec, draftPath, sourcePath, chapterDigest(spec, content))
  const isPendingDraft = draftText === draftContent
  const isConfirmationRecord = draftText === confirmationRecord
  if (!isPendingDraft && !isConfirmationRecord)
    throw new Error('确认正文与已保存章节草稿不一致；请先更新草稿，再由用户确认后归档。')

  const block = confirmedChapterBlock(spec, content)
  const sourceTarget = await projectTarget(ctx, cwd, sourcePath, exec.signal, workspace)
  const sourceInfo = await ctx.fs.stat(sourceTarget, exec.signal)
  let operation
  if (!sourceInfo) {
    const manuscript = `# ${spec.workName}\n\n${block}\n`
    operation = await writePath(ctx, args, exec, cwd, workspace, policy, sourcePath, manuscript, 'create')
  } else {
    if (sourceInfo.type !== 'file') throw new Error(`原文目标不是普通文件：${sourcePath}`)
    const sourceText = await ctx.fs.readText(sourceTarget, exec.signal)
    if (sourceText === undefined) throw new Error(`无法读取原文目标：${sourcePath}`)
    const existingSection = findChapterSection(sourceText, spec.chapterNumber)
    if (existingSection !== undefined) {
      if (existingSection !== block) throw new Error(`原文已存在不同内容的第${spec.chapterNumber}章；没有覆盖或重复追加。`)
      operation = 'unchanged'
    } else {
      const next = `${sourceText.trimEnd()}\n\n${block}\n`
      operation = await writePath(ctx, args, exec, cwd, workspace, policy,
        sourcePath, next, 'update', sourceText)
    }
  }

  const warnings = []
  if (isPendingDraft) {
    try {
      await writePath(ctx, args, exec, cwd, workspace, policy,
        draftPath, confirmationRecord, 'update', draftText)
    } catch (error) {
      warnings.push(`${draftPath}: 原文已保存，但章节确认记录未完成转换：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { path: sourcePath, operation, warnings }
}

async function saveArtifact(ctx, args, exec, contract, route) {
  const cwd = exec.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || !cwd) throw new Error('Wiki 产物必须保存到当前项目，请先打开项目目录。')
  const workspace = await ctx.fs.resolve(cwd, { cwd, signal: exec.signal })
  const policyService = ctx.get('sandboxPolicy')
  if (ctx.fs.sandboxMode !== undefined && !policyService)
    throw new Error('Wiki 产物保存失败：当前文件系统缺少沙箱策略服务。')
  const policy = policyService?.resolve({ session: exec.agent.session })
  const wikiRoot = await chooseWikiRoot(ctx, cwd, exec, workspace, contract)
  let legacySpec
  if (route === 'manju' && contract.manju_layout) {
    try { legacySpec = artifactSpec(args, contract) } catch { /* new layout may not require a legacy segment */ }
    contract = { ...contract, types: Object.fromEntries(Object.entries(contract.types).map(([kind, spec]) =>
      [kind, { ...spec, ...contract.manju_layout.types[kind] }])),
      scaffold: { ...contract.scaffold, directories: contract.manju_layout.directories } }
  }
  let spec
  try { spec = artifactSpec(args, contract) }
  catch (error) {
    if (!legacySpec || !await ctx.fs.stat(await projectTarget(ctx, cwd, `${wikiRoot}/${legacySpec.path}`, exec.signal, workspace), exec.signal)) throw error
    spec = legacySpec
  }
  spec.precise = route === 'manju' && contract.manju_layout !== undefined
  if (legacySpec && legacySpec.path !== spec.path) {
    const oldFile = await ctx.fs.stat(await projectTarget(ctx, cwd, `${wikiRoot}/${legacySpec.path}`, exec.signal, workspace), exec.signal)
    if (oldFile) {
      const newFile = await ctx.fs.stat(await projectTarget(ctx, cwd, `${wikiRoot}/${spec.path}`, exec.signal, workspace), exec.signal)
      if (newFile) throw new Error('新旧产物同时存在，请明确当前版本，未覆盖任一文件')
      spec = { ...legacySpec, precise: false }
    }
  }
  let content = spec.mode === 'source_selection' ? args.content : normalizedMarkdown(args.content)
  if (route === 'manju' && !['source_selection', 'pipeline'].includes(spec.mode)) content = normalizeWikiLinks(content, wikiRoot, spec.path)
  if (spec.mode === 'pipeline') content = await pipelineCheckpoint(ctx, args, exec, cwd, workspace, wikiRoot, spec, content)
  spec.summary = indexSummary(args.summary, content, spec.label)

  let saved
  if (spec.mode === 'chapter_source') {
    saved = await saveConfirmedChapter(ctx, args, exec, cwd, workspace, policy, wikiRoot, spec, content)
  } else {
    const pageContent = spec.mode === 'chapter_draft' ? chapterDocument(spec, content) : content
    const writeMode = route !== 'none' && args.write_mode === undefined && spec.mode !== 'source_selection'
      ? 'upsert' : spec.writeMode
    const operation = await writePath(ctx, args, exec, cwd, workspace, policy,
      `${wikiRoot}/${spec.path}`, pageContent, writeMode)
    saved = { path: `${wikiRoot}/${spec.path}`, operation }
  }

  // 业务文件已可靠读回；后续归档步骤异常只降级为警告，不伪报正文失败。
  const indexWarnings = []
  try {
    await ensureScaffold(ctx, args, exec, cwd, workspace, policy, wikiRoot, contract)
  } catch (error) {
    indexWarnings.push(`${wikiRoot}/: ${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    await ensureDynamicIndexes(ctx, args, exec, cwd, workspace, policy, wikiRoot, spec, contract)
  } catch (error) {
    indexWarnings.push(`${wikiRoot}/${spec.index}: ${error instanceof Error ? error.message : String(error)}`)
  }
  for (const entry of indexEntries(spec, wikiRoot, contract)) {
    try {
      await appendIndexLink(ctx, exec, cwd, workspace, policy,
        entry.index, entry.target, entry.label, entry.summary)
    } catch (error) {
      indexWarnings.push(`${entry.index}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const warnings = [...(saved.warnings || []), ...indexWarnings]
  if (warnings.length) console.warn('[wiki-memory] saved with warnings:', warnings)
  return {
    status: warnings.length ? 'saved_with_warnings' : 'saved',
    path: saved.path,
    operation: saved.operation,
    warnings,
  }
}


const sourceMessages = new WeakMap()
const pipelineStates = new WeakMap()
export const pipelineStateFor = agent => pipelineStates.get(agent)
// Successful model-facing reads only; writing a document does not count as reading it.
const wikiReads = new WeakMap()
export function resetWikiReads(agent) { wikiReads.set(agent, new Map()) }
export function recordWikiRead(agent, target, observation, exec) {
  if (exec?.agent?.session !== agent.session || !['read', 'read_image'].includes(exec.name) || observation.kind !== 'present') return
  wikiReads.get(agent)?.set(target.targetKey, { target, version: observation.version, image: exec.name === 'read_image' })
}

export function validateSeedanceReferences(content) {
  const definitions = [...content.matchAll(/^@图(\d+)[：:]([^\n]*)$/gm)]
  if (!definitions.length) throw new Error('Seedance缺少参考图占位：每个资产须以@图1：……单独成行，镜内引用相同编号')
  if (definitions.some(match => /@图\d+[：:]/.test(match[2]))) throw new Error('每个参考图定义必须单独一行')
  if (definitions.some(match => !match[2].trim())) throw new Error('参考图行必须写明资产名称与特征')
  for (const match of definitions)
    if (match[2].includes('声音九维') && !['年龄', '音高', '明暗', '厚薄', '共鸣', '气息', '颗粒感', '口音', '表达'].every(field => match[2].includes(field)))
      throw new Error('角色参考图行的声音九维信息不完整')
  const numbers = definitions.map(match => Number(match[1]))
  if (numbers.some((number, index) => number !== index + 1)) throw new Error('参考图编号必须从1连续且不重复')
  for (const match of content.matchAll(/@图(\d+)/g))
    if (!numbers.includes(Number(match[1]))) throw new Error(`引用了未定义的参考图${match[1]}`)
  if (/(?<!@)图\d+/.test(content)) throw new Error('参考图与镜内引用统一使用@图编号')
  const global = content.indexOf('【全局设定】'), shots = content.indexOf('【时间戳剧本分镜】'), ending = content.indexOf('【全局补充】')
  if (global < 0 || shots <= global || ending <= shots || definitions.some(match => match.index >= global))
    throw new Error('Seedance须按五模块交付：简短基调、逐行@图与空间关系、【全局设定】、【时间戳剧本分镜】、【全局补充】')
  if (/待上传|未上传|未提供参考图|尚未核验|工程镜\s*\d|对应本段镜|全片\s*\d|本段\s*\d+(?:\.\d+)?秒预算|非实测|制作待审/.test(content)
    || /承接上一段|沿用上一段|继续前文|同上|下一段[切接]/.test(content)) throw new Error('提交正文不得包含制作备注或跨段上下文指代')
  for (const line of content.split('\n'))
    if (/声音九维|年龄感[：:]|音高[：:]|共鸣[：:]|颗粒感[：:]/.test(line) && !/^@图\d+[：:]/.test(line))
      throw new Error('声音九维身份信息只能写在角色参考图行，不能放在分镜或全局设定里')
  if (!/@图\d+/.test(content.slice(shots, ending))) throw new Error('分镜必须使用@图引用当前镜头资产')
}

async function requirePipelineReads(ctx, args, exec, agent) {
  const reads = wikiReads.get(agent), state = pipelineStateFor(agent)
  if (!reads || !state || state.stage === 'complete') return
  const kind = args.artifact_kind
  const rules = {
    film_style: ['summary'], character_asset: ['style', 'bio'], character_voice: ['style', 'bio'],
    character_format: ['style', 'image'], scene_asset: ['style', 'scene'], prop_asset: ['style', 'prop'],
    engineering_script: ['style', 'source', 'cast'], sound_direction: ['engineering', 'cast'],
    storyboard_prompt: ['engineering'], video_prompt: ['engineeringOrStoryboard'],
  }
  if (kind === 'video_prompt' && args.video_model === 'Seedance' && Object.keys(state.files?.assets || {}).length) validateSeedanceReferences(args.content)
  if (!rules[kind]) return
  if (args.episode_number !== undefined && args.episode_number !== state.episode_number
    || args.video_model !== undefined && args.video_model !== state.video_model) throw new Error('当前流水线集数或模型不匹配，请先保存对应plan进度')
  const root = state.path.split('/制作流水线/')[0]
  const materials = Object.keys(state.files?.materials || {})
  const entity = args.entity_name ? safeName(args.entity_name, '实体') : ''
  const candidates = category => {
    const paths = materials.filter(path => path.includes(`/${category}/`))
    const exact = paths.filter(path => posix.basename(path, '.md') === entity)
    return exact.length || category === '人物小传' || category === '道具说明' ? exact : paths
  }
  const groups = {
    summary: materials.filter(path => /\/故事梗概\.md$/.test(path)),
    style: Object.keys(state.files?.style || {}).filter(path => path === `${root}/项目风格/影片比例与风格.md`), source: [state.source_path],
    bio: candidates('人物小传'), scene: candidates('场景说明'), prop: candidates('道具说明'),
    image: [`${root}/资产/角色/${entity}/角色生图提示词.md`],
    engineering: Object.keys(state.files?.engineering || {}).filter(path => /工程剧本\.md$/.test(path)),
    engineeringOrStoryboard: Object.keys(state.files?.engineering || {}).filter(path => /工程剧本\.md$/.test(path)),
  }
  const cwd = exec.agent.session.header.cwd
  const observed = async path => {
    const target = await ctx.fs.resolve(path, { cwd, signal: exec.signal })
    const prior = reads.get(target.targetKey)
    return prior && JSON.stringify((await ctx.fs.stat(target, exec.signal))?.version) === JSON.stringify(prior.version)
  }
  if (kind === 'video_prompt' && args.video_model === 'Seedance') {
    const byEntity = new Map()
    for (const path of Object.keys(state.files?.assets || {}).filter(path => /生图(?:格式)?提示词\.md$/.test(path))) {
      const name = posix.basename(posix.dirname(path))
      if (!args.content.includes(name)) continue
      if (!byEntity.has(name)) byEntity.set(name, [])
      byEntity.get(name).push(path)
    }
    for (const paths of byEntity.values())
      if (!(await Promise.all(paths.map(observed))).some(Boolean)) throw new Error(`参考图对应资产尚未读取或已过期：先read ${paths.join(' 或 ')}，再填写占位与镜内引用`)
  }
  for (const rule of rules[kind]) {
    if (rule === 'cast') {
      for (const path of materials.filter(path => path.includes('/人物小传/') && String(args.content || '').includes(posix.basename(path, '.md'))))
        if (!await observed(path)) throw new Error(`精准读取缺失或已过期：请用read读取 ${path}，再根据正文生成产物；刚写入和聊天记忆不能代替读取。`)
      continue
    }
    if (rule === 'image' && (await Promise.all([...reads.values()].filter(read => read.image).map(read => observed(ctx.fs.processPath(read.target))))).some(Boolean)) continue
    const paths = groups[rule]
    // A storyboard alternative is valid only when it was actually read this turn.
    if (rule === 'engineeringOrStoryboard') {
      for (const { target } of reads.values()) {
        const path = ctx.fs.processPath(target)
        if (path.includes(`/分镜提示词/${args.video_model}/第${args.episode_number}集`) && await observed(path)) paths.push(path)
      }
    }
    if (!paths.length || !(await Promise.all(paths.map(observed))).some(Boolean))
      throw new Error(`精准读取缺失或已过期（${rule}）：先用read读取对应Wiki正文再生成。候选：${paths.join('、') || '请先补齐对应项目资料'}。刚写入和聊天记忆不能代替读取。`)
  }
}

const pipelineStages = ['plan', 'materials', 'style', 'assets', 'engineering', 'prompts', 'complete']

async function pipelineCheckpoint(ctx, args, exec, cwd, workspace, wikiRoot, spec, content) {
  const input = JSON.parse(content)
  const stage = pipelineStages.indexOf(input.stage)
  if (stage < 0 || !Array.isArray(input.outputs)) throw new Error('流水线进度需要有效stage和outputs数组')
  const target = await projectTarget(ctx, cwd, `${wikiRoot}/${spec.path}`, exec.signal, workspace)
  const previous = await ctx.fs.stat(target, exec.signal) ? JSON.parse(await ctx.fs.readText(target, exec.signal)) : undefined
  if (stage > 0 && (!previous || ![stage - 1, stage].includes(pipelineStages.indexOf(previous.stage))))
    throw new Error('流水线不能跳过尚未完成的前置阶段')
  if (input.stage === 'complete' && input.status === 'blocked') throw new Error('完成阶段不能同时标记暂停')
  if (input.status !== undefined && !['running', 'blocked', ...(input.stage === 'complete' ? ['completed'] : [])].includes(input.status)) throw new Error('流水线status无效')
  if (input.status === 'blocked' && !String(input.reason || '').trim()) throw new Error('暂停流水线必须说明原因')
  const state = stage === 0 ? {} : previous
  const hashFile = async (path, output = true) => {
    if (typeof path !== 'string' || (output && !path.startsWith(`${wikiRoot}/`))) throw new Error('流水线产物必须位于当前Wiki')
    const file = await projectTarget(ctx, cwd, path, exec.signal, workspace)
    if ((await ctx.fs.stat(file, exec.signal))?.type !== 'file') throw new Error(`流水线文件不存在：${path}`)
    return createHash('sha256').update(await ctx.fs.readText(file, exec.signal)).digest('hex')
  }
  const source = stage === 0 ? input.source_path : state.source_path
  const sourceHash = await hashFile(source, false)
  if (stage && sourceHash !== state.source_hash) throw new Error('来源剧本已改变，请重新规划流水线')
  const files = Object.fromEntries(Object.entries(state.files || {}).filter(([name]) => pipelineStages.indexOf(name) < stage))
  for (const entries of Object.values(files)) for (const [path, hash] of Object.entries(entries))
    if (await hashFile(path) !== hash) throw new Error(`前置产物已修改，请从该阶段重新规划：${path}`)
  const outputs = {}
  for (const path of input.outputs) outputs[path] = await hashFile(path)
  if (stage > 0 && stage < 6 && Object.keys(outputs).length === 0) throw new Error('当前阶段没有真实产物，不能标记完成')
  if (input.stage === 'materials' && !input.outputs.some(path => /项目资料\/(?:[^/]+\/)?故事梗概\.md$/.test(path))) throw new Error('项目资料阶段需要故事梗概')
  if (input.stage === 'style') {
    const path = `${wikiRoot}/项目风格/影片比例与风格.md`
    if (!outputs[path]) throw new Error('风格阶段必须保存影片比例与风格')
    const text = await ctx.fs.readText(await projectTarget(ctx, cwd, path, exec.signal, workspace), exec.signal)
    if (/状态：待填写/.test(text) || !/\d+(?:\.\d+)?\s*:\s*\d+/.test(text)) throw new Error('影片比例与风格尚未填写')
  }
  if (input.stage === 'assets' && input.outputs.some(path => !path.startsWith(`${wikiRoot}/资产/`))) throw new Error('资产阶段只能登记资产文档')
  const duration = input.duration_seconds ?? state.duration_seconds
  if (stage >= 4 && (!Number.isFinite(duration) || duration <= 0)) throw new Error('工程阶段必须提供有效总时长预算duration_seconds')
  if (input.stage === 'engineering') {
    const path = input.outputs.find(path => /工程剧本\.md$/.test(path))
    if (!path) throw new Error('工程阶段缺少工程剧本')
    const text = await ctx.fs.readText(await projectTarget(ctx, cwd, path, exec.signal, workspace), exec.signal)
    if (!/资产清单/.test(text) || !/比例/.test(text)) throw new Error('工程剧本缺少影片比例或整集资产清单')
  }
  const segments = input.segments ?? state.segments
  if (stage >= 5) {
    if (!Array.isArray(segments) || !segments.length) throw new Error('视频提示词阶段必须提供segments')
    let end = 0
    for (const [index, segment] of segments.entries()) {
      const path = `${wikiRoot}/剧本/视频提示词/${args.video_model}/第${args.episode_number}集${String(index + 1).padStart(3, '0')}视频提示词.md`
      if (segment.path !== path || !Number.isFinite(segment.start_seconds) || !Number.isFinite(segment.end_seconds)
        || Math.abs(segment.start_seconds - end) > 0.01 || segment.end_seconds <= end
        || segment.end_seconds - segment.start_seconds > (args.video_model === 'H3' ? 15 : 30)) throw new Error('片段命名、连续时间或30/15秒上限不符合流水线合同')
      await hashFile(path)
      if (stage === 5 && !outputs[path]) throw new Error('片段必须包含在本阶段outputs中')
      end = segment.end_seconds
    }
    if (Math.abs(end - duration) > 0.01) throw new Error('片段没有覆盖整集工程时长')
  }
  files[input.stage] = outputs
  return JSON.stringify({ stage: input.stage, status: input.stage === 'complete' ? 'completed' : input.status || 'running', reason: input.stage === 'complete' ? '' : input.reason || '',
    video_model: args.video_model, episode_number: args.episode_number, source_path: source, source_hash: sourceHash,
    files, duration_seconds: duration, segments }, null, 2) + '\n'
}

export function setWikiSourceContent(agent, blocks) {
  sourceMessages.set(agent, blocks.filter(block => block.type === 'text').map(block => block.text))
}

export function selectWikiSource(agent, args) {
  const blocks = sourceMessages.get(agent)
  if (!blocks || !Number.isSafeInteger(args.source_block) || args.source_block < 0 || args.source_block >= blocks.length)
    throw new Error('source_block 必须指向当前用户消息的文本块（从0开始）')
  const text = blocks[args.source_block]
  const start = args.source_start
  const end = args.source_end
  if (typeof start !== 'string' || typeof end !== 'string' || start.length < 12 || end.length < 12)
    throw new Error('source_start 与 source_end 各需至少12个原文字符')
  const a = text.indexOf(start)
  const b = text.indexOf(end)
  if (a < 0 || b < a || text.indexOf(start, a + 1) !== -1 || text.indexOf(end, b + 1) !== -1)
    throw new Error('来源首尾片段缺失、顺序错误或不唯一，未保存')
  const selected = text.slice(a, b + end.length)
  if (Buffer.byteLength(selected, 'utf8') > 1_000_000) throw new Error('单份来源不能超过 1 MB，请使用已有文件导入')
  return selected
}

export function createWikiArtifactTool(ctx, contract, sourceAgent, route = 'none') {
  if (!ctx.fs || !ctx.tools) throw new Error('Wiki 归档工具缺少 Harness 文件或工具服务')
  if (ctx.fs.sandboxMode !== undefined && !ctx.get('sandboxPolicy'))
    throw new Error('Wiki 归档工具缺少 Harness 沙箱策略')
  const kinds = Object.keys(contract.types).filter(kind => route === 'none' || contract.types[kind].production_routes?.includes(route))
  const hidden = route === 'none' ? [] : route === 'novel'
    ? ['episode_number', 'video_model', 'segment', 'research_version']
    : ['chapter_number', 'chapter_title', 'user_confirmed']
  const tool = {
    name: 'wiki_save_artifact',
    description: '把已完成、按当前创作路线规则应归档或用户要求保存的短剧、漫剧或小说产物，按固定类型写入当前项目统一 Wiki 并更新直属索引。不得接收任意路径。小说章节先保存草稿，只有用户明确确认后才能追加到原文。',
    parameters: {
      artifact_kind: {
        type: 'string', required: true,
        enum: kinds,
        description: '产物类型，决定唯一保存目录。',
      },
      content: { type: 'string', description: '完成的正文；pipeline_checkpoint传JSON：stage、outputs路径数组、plan的source_path、engineering的duration_seconds、prompts的segments[{path,start_seconds,end_seconds}]。' },
      source_block: { type: 'integer', description: 'source_material 必填，当前用户消息文本块序号，从0开始。' },
      source_start: { type: 'string', description: '来源开始处至少12字符的唯一原文，包含在保存内容中。' },
      source_end: { type: 'string', description: '来源结束处至少12字符的唯一原文，包含在保存内容中。' },
      summary: { type: 'string', description: '一条简短、可检索的内容摘要；缺省时由工具提取正文首个有效句。' },
      research_version: { type: 'string', enum: ['original', 'adapted'], description: '项目资料版本；省略时保留旧目录，original 为原作，adapted 为改编版。' },
      episode_number: { type: 'integer', description: '剧本、分镜、视频提示词或声音导演稿对应的集数。' },
      entity_name: { type: 'string', description: '人物、角色、场景或道具名称。' },
      video_model: { type: 'string', enum: ['H3', 'Seedance'], description: '视频或分镜提示词使用的模型分支。' },
      segment: { type: 'string', description: '视频、分镜提示词或声音导演稿的片段或镜头范围，如 片段001-003；整集声音稿用 全篇。' },
      write_mode: { type: 'string', enum: ['create', 'update', 'append'], description: route === 'none'
        ? '默认 create；update 替换完整文件，append 保留现有文件并新增章节。'
        : '省略时自动创建或更新同一路径；显式 create 只新建，update 替换完整文件，append 新增实体章节。原始来源不覆盖。' },
      section_name: { type: 'string', description: 'write_mode=append 时用于新章节的标题。' },
      work_name: { type: 'string', description: '小说书名；章节草稿和确认正文必填。' },
      chapter_number: { type: 'integer', description: '小说章节序号，必须为正整数。' },
      chapter_title: { type: 'string', description: '小说章节标题，章节草稿和确认正文必填。' },
      user_confirmed: { type: 'boolean', description: '只有用户明确确认已保存的章节草稿后，写入 novel_chapter_source 时才传 true。' },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!kinds.includes(args.artifact_kind) || hidden.some(key => Object.hasOwn(args, key))) throw new Error('归档类型或字段不属于当前创作路线')
      if (args.artifact_kind === 'source_material') {
        if (args.write_mode && args.write_mode !== 'create') throw new Error('原始来源只允许创建，不覆盖已有原文')
        args = { ...args, content: selectWikiSource(sourceAgent, args) }
      }
      if (route === 'manju') await requirePipelineReads(ctx, args, exec, sourceAgent)
      const value = await saveArtifact(ctx, args, exec, contract, route)
      if (args.artifact_kind === 'pipeline_checkpoint') {
        const workspace = await ctx.fs.resolve(exec.agent.session.header.cwd, { cwd: exec.agent.session.header.cwd, signal: exec.signal })
        const target = await projectTarget(ctx, exec.agent.session.header.cwd, value.path, exec.signal, workspace)
        pipelineStates.set(sourceAgent, { ...JSON.parse(await ctx.fs.readText(target, exec.signal)), path: value.path })
      }
      return { status: value.status, path: value.path, operation: value.operation, warnings: value.warnings }
    },
  }
  for (const key of hidden) delete tool.parameters[key]
  return defineTool(tool)
}
