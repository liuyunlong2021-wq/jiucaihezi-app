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
    assembled: { type: 'string' },
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

async function saveArtifact(ctx, args, exec, contract, route, sourceAgent, prepared) {
  const extraWarnings = []
  let adapted = false
  const cwd = exec.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || !cwd) throw new Error('Wiki 产物必须保存到当前项目，请先打开项目目录。')
  const workspace = await ctx.fs.resolve(cwd, { cwd, signal: exec.signal })
  const policyService = ctx.get('sandboxPolicy')
  if (ctx.fs.sandboxMode !== undefined && !policyService)
    throw new Error('Wiki 产物保存失败：当前文件系统缺少沙箱策略服务。')
  const policy = policyService?.resolve({ session: exec.agent.session })
  const wikiRoot = await chooseWikiRoot(ctx, cwd, exec, workspace, contract)
  let legacySpec
  const layout = route === 'manju' ? contract.manju_layout : route === 'short-drama' ? contract.short_drama_layout : undefined
  if (layout) {
    try { legacySpec = artifactSpec(args, contract) } catch { /* new layout may not require a legacy segment */ }
    contract = { ...contract, types: Object.fromEntries(Object.entries(contract.types).map(([kind, spec]) =>
      [kind, { ...spec, ...layout.types[kind] }])),
      scaffold: { ...contract.scaffold, directories: layout.directories } }
  }
  let spec
  try { spec = artifactSpec(args, contract) }
  catch (error) {
    if (!legacySpec || !await ctx.fs.stat(await projectTarget(ctx, cwd, `${wikiRoot}/${legacySpec.path}`, exec.signal, workspace), exec.signal)) throw error
    spec = legacySpec
  }
  spec.precise = Boolean(layout)
  if (legacySpec && legacySpec.path !== spec.path) {
    const oldFile = await ctx.fs.stat(await projectTarget(ctx, cwd, `${wikiRoot}/${legacySpec.path}`, exec.signal, workspace), exec.signal)
    if (oldFile) {
      const newFile = await ctx.fs.stat(await projectTarget(ctx, cwd, `${wikiRoot}/${spec.path}`, exec.signal, workspace), exec.signal)
      if (newFile) throw new Error('新旧产物同时存在，请明确当前版本，未覆盖任一文件')
      spec = { ...legacySpec, precise: false }
    }
  }
  const legacyPath = layout?.types[args.artifact_kind]?.legacy_path
  if (legacyPath && await ctx.fs.stat(await projectTarget(ctx, cwd, `${wikiRoot}/${legacyPath}`, exec.signal, workspace), exec.signal)) {
    if (await ctx.fs.stat(await projectTarget(ctx, cwd, `${wikiRoot}/${spec.path}`, exec.signal, workspace), exec.signal)) throw new Error('新旧产物同时存在，请明确当前版本，未覆盖任一文件')
    spec = { ...spec, path: legacyPath, precise: false }
  }
  // prepared：程序自己生成的产物（如按标注组装的切分与分集剧本），不经模型正文的转换与校验。
  let content = prepared ?? (spec.mode === 'source_selection' ? args.content : normalizedMarkdown(args.content))
  if (prepared === undefined && args.artifact_kind === 'adaptation_card') throw new Error('切分卡由程序生成，保存标注时自动写入，不能手写')
  if (prepared === undefined) {
  if (route !== 'none' && ['manju', 'short-drama'].includes(route) && !['source_selection', 'pipeline', 'adaptation_cut', 'adaptation_pipeline', 'adaptation_annotation'].includes(spec.mode)) content = normalizeWikiLinks(content, wikiRoot, spec.path)
  if (spec.mode === 'adaptation_annotation') content = await adaptationAnnotation(ctx, args, exec, wikiRoot, content, sourceAgent)
  if (spec.mode === 'pipeline') content = await pipelineCheckpoint(ctx, args, exec, cwd, workspace, wikiRoot, spec, content)
  if (spec.mode === 'adaptation_cut') content = await adaptationCut(ctx, args, exec, sourceAgent, content)
  // 短剧删减式改编：事件文档按“E序号_一句话概述”命名；分集剧本只能由程序从已校验的切分生成，正文只有原文。
  if (route === 'short-drama' && args.artifact_kind === 'adaptation_event' && !/^E\d+_./.test(String(args.entity_name || '')))
    throw new Error('事件文档名须为“E数字_一句话概述”，如 E03_噗叽偷食被收服，以保持顺序')
  if (route === 'short-drama' && args.artifact_kind === 'episode_source_script') {
    let input
    try { input = JSON.parse(args.content) } catch { input = undefined }
    if (input?.adapted !== undefined) {
      const result = await adaptedScript(ctx, args, exec, wikiRoot, sourceAgent, input.adapted)
      content = result.content
      extraWarnings.push(...result.warnings)
      adapted = true
    } else content = await episodeScriptFromCut(ctx, args, exec, wikiRoot, sourceAgent)
  }
  if (spec.mode === 'adaptation_pipeline') content = await adaptationCheckpoint(ctx, args, exec, wikiRoot, content, sourceAgent)
  }
  spec.summary = indexSummary(args.summary || (spec.mode === 'adaptation_cut' ? '本集使用的真实原文片段，作为本集改编边界。' : undefined), content, spec.label)

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
  const warnings = [...(saved.warnings || []), ...indexWarnings, ...extraWarnings]
  if (warnings.length) console.warn('[wiki-memory] saved with warnings:', warnings)
  return {
    status: warnings.length ? 'saved_with_warnings' : 'saved',
    path: saved.path,
    operation: saved.operation,
    warnings,
    wikiRoot,
    ...(args.artifact_kind === 'episode_source_script' && adapted ? { adapted } : {}),
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
  if (definitions.length && !/@图\d+/.test(content.slice(shots, ending))) throw new Error('分镜必须使用@图引用当前镜头资产')
}

async function requirePipelineReads(ctx, args, exec, agent) {
  const reads = wikiReads.get(agent), state = pipelineStateFor(agent)
  if (!reads || !state || state.stage === 'complete') return
  const kind = args.artifact_kind
  const rules = {
    film_style: ['summary'], character_asset: ['style', 'bio'], character_voice: ['style', 'bio'],
    character_format: ['style', 'image'], scene_asset: ['style', 'scene'], prop_asset: ['style', 'prop'], crowd_asset: ['style'], costume_asset: ['style'], character_look: ['style'],
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
  const candidates = category => researchCandidates(materials, entity, category)
  const groups = {
    summary: materials.filter(path => /\/故事梗概\.md$/.test(path)),
    style: Object.keys(state.files?.style || {}).filter(path => path === `${root}/项目风格/影片比例与风格.md`), source: [state.source_path],
    bio: candidates('人物小传'), scene: candidates('场景说明'), prop: candidates('道具说明'),
    // 三格格式提示词可由已读的角色设计提示词，或（全自动成片一步出格式时）已读的人物小传支撑。
    image: [`${root}/资产/角色/${entity}/角色生图提示词.md`, ...candidates('人物小传')],
    engineering: Object.keys(state.files?.engineering || {}).filter(path => /工程剧本\.md$/.test(path)),
    engineeringOrStoryboard: Object.keys(state.files?.engineering || {}).filter(path => /工程剧本\.md$/.test(path)),
  }
  const cwd = exec.agent.session.header.cwd
  const observed = async path => {
    const target = await ctx.fs.resolve(path, { cwd, signal: exec.signal })
    const prior = reads.get(target.targetKey ?? target)
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

/**
 * 某实体的项目资料候选：默认布局写 `项目资料/场景`、`项目资料/道具`，
 * 短剧布局写 `项目资料/场景说明`、`项目资料/道具说明`（见 wiki-artifacts.json 的 short_drama_layout）。
 * 两类都是同类资料，归档器只关心「该实体正文被读过」，所以两种目录名都算候选；
 * 限定在 项目资料/ 下，避免把 资产/场景 之类的产物当成资料。
 */
export function researchCandidates(materials, entity, category) {
  const aliases = { '场景说明': ['场景说明', '场景'], '道具说明': ['道具说明', '道具'] }[category] ?? [category]
  const paths = materials.filter(path => path.includes('/项目资料/') && aliases.some(name => path.includes(`/${name}/`)))
  const exact = paths.filter(path => posix.basename(path, '.md') === entity)
  return exact.length || category === '人物小传' || category === '道具说明' ? exact : paths
}

const pipelineStages = ['plan', 'materials', 'style', 'assets', 'engineering', 'prompts', 'complete']
async function pipelineCheckpoint(ctx, args, exec, cwd, workspace, wikiRoot, spec, content) {
  const input = JSON.parse(content)
  const stage = pipelineStages.indexOf(input.stage)
  if (stage < 0 || !Array.isArray(input.outputs)) throw new Error('流水线进度需要有效stage和outputs数组')
  const target = await projectTarget(ctx, cwd, `${wikiRoot}/${spec.path}`, exec.signal, workspace)
  const previous = await ctx.fs.stat(target, exec.signal) ? JSON.parse(await ctx.fs.readText(target, exec.signal)) : undefined
  // 审片修改（2026-10-26）：已完成的集可从 engineering 或 prompts 重开，沿用已登记的项目资料、风格与资产。
  const reopen = previous?.stage === 'complete' && (input.stage === 'engineering' || input.stage === 'prompts')
  if (stage > 0 && !reopen && (!previous || ![stage - 1, stage].includes(pipelineStages.indexOf(previous.stage))))
    throw new Error('流水线不能跳过尚未完成的前置阶段')
  if (input.stage === 'complete' && input.status === 'blocked') throw new Error('完成阶段不能同时标记暂停')
  if (input.status !== undefined && !['running', 'blocked', ...(input.stage === 'complete' ? ['completed'] : [])].includes(input.status)) throw new Error('流水线status无效')
  if (input.status === 'blocked' && !String(input.reason || '').trim()) throw new Error('暂停流水线必须说明原因')
  const state = stage === 0 ? {} : previous
  // 模型限制：全自动按所选视频模型写入（每段最长秒数、最多参考图张数）；未写入时两条路线都默认 30 秒（2026-10-26 MiniMax H3 也支持 30 秒）。
  const limits = stage === 0 ? input.limits : state.limits
  if (limits !== undefined && (!limits || !Number.isFinite(limits.max_seconds) || limits.max_seconds <= 0 || limits.max_seconds > 30
    || (limits.max_refs !== undefined && (!Number.isInteger(limits.max_refs) || limits.max_refs < 0)))) throw new Error('limits 需为 {max_seconds: 1–30, max_refs: 非负整数（0 为纯文生）}')
  const maxSeconds = limits?.max_seconds ?? 30
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
  // 资产按需（2026-10-26）：纯文生或本集无需保持一致的实体时，资产阶段可以没有产物。
  if (stage > 0 && stage < 6 && input.stage !== 'assets' && Object.keys(outputs).length === 0) throw new Error('当前阶段没有真实产物，不能标记完成')
  if (input.stage === 'assets' && limits?.max_refs === 0 && input.outputs.length) throw new Error('本集为纯文生（max_refs 为 0）：不建资产提示词，assets 阶段 outputs 留空')
  if (input.stage === 'materials' && !input.outputs.some(path => /项目资料\/(?:[^/]+\/)?故事梗概\.md$/.test(path))) throw new Error('项目资料阶段需要故事梗概')
  if (input.stage === 'style') {
    const path = `${wikiRoot}/项目风格/影片比例与风格.md`
    if (!outputs[path]) throw new Error('风格阶段必须保存影片比例与风格')
    const text = await ctx.fs.readText(await projectTarget(ctx, cwd, path, exec.signal, workspace), exec.signal)
    if (/状态：待填写/.test(text) || !/\d+(?:\.\d+)?\s*:\s*\d+/.test(text)) throw new Error('影片比例与风格尚未填写')
  }
  if (input.stage === 'assets' && input.outputs.some(path => !path.startsWith(`${wikiRoot}/资产/`))) throw new Error('资产阶段只能登记资产文档')
  // 资产登记：全自动成片据此生图、按 @图 顺序取参考图。角色优先三视图格式提示词。
  let assets = state.assets || {}
  if (input.stage === 'assets') {
    assets = {}
    const kinds = { 角色: 'character', 场景: 'scene', 道具: 'prop', 人群: 'crowd' }
    for (const path of input.outputs) {
      const match = path.slice(wikiRoot.length + 1).match(/^资产\/(角色|场景|道具|人群)\/([^/]+?)(?:\.md|\/(角色生图格式提示词|角色生图提示词|场景生图提示词|道具生图提示词|群像生图提示词|服装生图提示词|角色造型融合提示词)\.md)$/)
      if (!match) continue
      // 换装造型：实体名“角色·造型”；服装图单独登记为“服装/…”，融合造型登记为“角色/…”并记下身份图与服装。
      if (match[3] === '服装生图提示词') {
        assets[`服装/${match[2]}`] = { kind: 'costume', prompt_path: path, prompt_hash: outputs[path] }
        continue
      }
      const id = `${match[1]}/${match[2]}`
      if (match[3] === '角色造型融合提示词') {
        const costumePath = `${wikiRoot}/资产/角色/${match[2]}/服装生图提示词.md`
        if (!outputs[costumePath]) throw new Error(`造型 ${match[2]} 缺少服装生图提示词：请同阶段保存 costume_asset`)
        assets[id] = { kind: 'look', prompt_path: path, prompt_hash: outputs[path], base: `角色/${match[2].split('·')[0]}`, costume: `服装/${match[2]}` }
        continue
      }
      if (assets[id]?.prompt_path.endsWith('/角色生图格式提示词.md')) continue
      assets[id] = { kind: kinds[match[1]], prompt_path: path, prompt_hash: outputs[path] }
    }
  }
  // 资产按项目风格清单执行（2026-10-26）：标为“参考图：文字带过”的实体不建资产、不生图。
  if (input.stage === 'assets') {
    const stylePath = `${wikiRoot}/项目风格/影片比例与风格.md`
    const style = files.style?.[stylePath] ? await ctx.fs.readText(await projectTarget(ctx, cwd, stylePath, exec.signal, workspace), exec.signal) : ''
    const skipped = style.split(/^(?=资产名称[：:])/m).slice(1)
      .filter(block => /^参考图[：:]\s*文字带过/m.test(block)).map(block => block.match(/^资产名称[：:]\s*(.+)$/m)[1].trim())
    const id = Object.keys(assets).find(id => skipped.includes(id.split('/')[1].split('·')[0]))
    if (id) throw new Error(`项目风格把 ${id.split('/')[1]} 标为“参考图：文字带过”，不建资产：从 outputs 去掉，或先修改项目风格`)
  }
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
        || segment.end_seconds - segment.start_seconds > maxSeconds + 0.01) throw new Error(`片段命名、连续时间或每段${maxSeconds}秒上限不符合流水线合同`)
      await hashFile(path)
      if (stage === 5 && !outputs[path]) throw new Error('片段必须包含在本阶段outputs中')
      // 参考图按段决定：没有登记资产且本段 refs 为空时即纯文生段，不做 @图/<Picture N> 绑定检查。
      if (stage === 5 && (Object.keys(assets).length || segment.refs?.length)) {
        const text = await ctx.fs.readText(await projectTarget(ctx, cwd, path, exec.signal, workspace), exec.signal)
        // Seedance：每个“@图N：”行；H3 Ref2VA：所有含 <Picture N> 的行（subject_definitions 等处写明对应资产）。
        const h3 = args.video_model === 'H3'
        const label = h3 ? 'Picture' : '@图'
        const lines = h3
          ? (() => {
            const numbers = [...new Set([...text.matchAll(/<Picture (\d+)>/g)].map(match => Number(match[1])))].sort((a, b) => a - b)
            if (numbers.some((number, i) => number !== i + 1)) throw new Error(`片段${index + 1}的<Picture N>须从1连续编号`)
            return numbers.map(number => text.split('\n').filter(line => line.includes(`<Picture ${number}>`)).join('\n'))
          })()
          : [...text.matchAll(/^@图\d+[：:]([^\n]*)$/gm)].map(match => match[1])
        if (!Array.isArray(segment.refs)) throw new Error(`片段${index + 1}缺少refs：按${h3 ? '<Picture 1>' : '@图1'}起的顺序列出资产ID，例如["角色/某人","场景/某地"]`)
        if (limits?.max_refs !== undefined && segment.refs.length > limits.max_refs) throw new Error(`片段${index + 1}用了${segment.refs.length}张参考图，所选视频模型最多 ${limits.max_refs} 张：请拆镜或减少本段入画资产`)
        if (segment.refs.length !== lines.length) throw new Error(`片段${index + 1}的refs数量(${segment.refs.length})与${label}数量(${lines.length})不一致`)
        for (const [i, ref] of segment.refs.entries()) {
          if (!assets[ref]) throw new Error(`片段${index + 1}的refs引用了未登记资产：${ref}`)
          const name = ref.split('/')[1]
          if (!lines[i].includes(name)) throw new Error(h3 ? `片段${index + 1}含<Picture ${i + 1}>的行未写${name}，refs顺序须与<Picture N>编号一致` : `片段${index + 1}的@图${i + 1}行未写${name}，refs顺序须与@图顺序一致`)
        }
      }
      end = segment.end_seconds
    }
    if (Math.abs(end - duration) > 0.01) throw new Error('片段没有覆盖整集工程时长')
  }
  files[input.stage] = outputs
  return JSON.stringify({ stage: input.stage, status: input.stage === 'complete' ? 'completed' : input.status || 'running', reason: input.stage === 'complete' ? '' : input.reason || '',
    video_model: args.video_model, episode_number: args.episode_number, source_path: source, source_hash: sourceHash,
    files, assets, ...(limits && { limits }), duration_seconds: duration, segments }, null, 2) + '\n'
}

const adaptationStates = new WeakMap()
export const adaptationStateFor = agent => adaptationStates.get(agent)
const adaptationStages = ['source', 'materials', 'scheme', 'cuts', 'writing', 'complete']

async function adaptationFile(ctx, exec, path, agent, mustRead = false) {
  if (typeof path !== 'string' || !path) throw new Error('需要真实来源路径')
  const cwd = exec.agent.session.header.cwd
  const target = await ctx.fs.resolve(path, { cwd, signal: exec.signal })
  const info = await ctx.fs.stat(target, exec.signal)
  if (info?.type !== 'file') throw new Error(`文件不存在：${path}`)
  const workspace = await ctx.fs.resolve(cwd, { cwd, signal: exec.signal })
  if (mustRead || !ctx.fs.contains(workspace, target)) {
    const prior = wikiReads.get(agent)?.get(target.targetKey ?? target)
    if (!prior || prior.image || JSON.stringify(prior.version) !== JSON.stringify(info.version)) throw new Error(`必须先实际read且修改后重读：${path}`)
  }
  const text = await ctx.fs.readText(target, exec.signal)
  if (JSON.stringify((await ctx.fs.stat(target, exec.signal))?.version) !== JSON.stringify(info.version)) throw new Error(`读取期间文件变化：${path}`)
  return { text, path: typeof target === 'string' ? target : ctx.fs.processPath(target), hash: createHash('sha256').update(text).digest('hex') }
}

function chapterRanges(text) {
  const headings = [...text.matchAll(/^[\uFEFF \t]*(?:#{1,6}[ \t]*)?(?:第[零〇一二三四五六七八九十百千万两0-9]+[章回节集][^\r\n]*|Chapter[ \t]+[0-9]+[^\r\n]*|(?:序章|楔子|尾声)[^\r\n]*)/gmi)]
  return headings.map((match, index) => ({ heading: match[0].trim().replace(/^#+\s*/, ''), start: match.index + match[0].length,
    end: headings[index + 1]?.index ?? text.length }))
}
// 无可识别章标题的短篇整篇作为一个单元，标题由程序如实记为“全文”。
function adaptationUnits(text) {
  const chapters = chapterRanges(text)
  return chapters.length ? chapters : [{ heading: '全文', start: 0, end: text.length }]
}
// 行号与read一致：从1起，按\n计数；返回不含行尾换行的行范围。
function lineSpan(text, line) {
  let start = 0
  for (let n = 1; n < line; n++) {
    start = text.indexOf('\n', start) + 1
    if (!start) return
  }
  if (start > text.length || (start === text.length && line > 1)) return
  const newline = text.indexOf('\n', start), end = newline < 0 ? text.length : newline
  return { start, end: text[end - 1] === '\r' ? end - 1 : end }
}
// 章号排序键：txt 原文常有章节错位，按章号排（同章号按上、中、下），无章号的保持原相对位置。
const chineseDigits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
function chineseNumber(text) {
  if (/^[0-9]+$/.test(text)) return Number(text)
  let total = 0, section = 0, digit = 0
  for (const char of text) {
    if (char in chineseDigits) digit = chineseDigits[char]
    else if (char === '十' || char === '百' || char === '千') { section += (digit || 1) * { 十: 10, 百: 100, 千: 1000 }[char]; digit = 0 }
    else if (char === '万') { total += (section + digit) * 10000; section = 0; digit = 0 }
  }
  return total + section + digit
}
function chapterOrder(heading) {
  if (/^(?:序章|楔子)/.test(heading)) return [-1, 0]
  if (/^尾声/.test(heading)) return [Number.MAX_SAFE_INTEGER, 0]
  const number = /^(?:第([零〇一二三四五六七八九十百千万两0-9]+)[章回节集]|Chapter[ \t]+([0-9]+))/i.exec(heading)
  if (!number) return undefined
  const part = /[（(]\s*上\s*[）)]/.test(heading) ? 0 : /[（(]\s*中\s*[）)]/.test(heading) ? 1 : /[（(]\s*下\s*[）)]/.test(heading) ? 2 : 0
  return [chineseNumber(number[1] ?? number[2]), part]
}
function sortChapters(items) {
  const keyed = items.map((item, index) => ({ item, index, key: chapterOrder(item.chapter_heading) }))
  if (keyed.some(entry => !entry.key)) return items
  return keyed.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.index - b.index).map(entry => entry.item)
}
// 来源可以是拆分好的章节点目录：展开为其中的 .md（不含 index.md），按文件名排序，逐层展开子目录。
async function expandSourcePaths(ctx, exec, paths) {
  const cwd = exec.agent.session.header.cwd, files = []
  for (const path of paths) {
    const target = await ctx.fs.resolve(path, { cwd, signal: exec.signal })
    if ((await ctx.fs.stat(target, exec.signal))?.type !== 'directory') { files.push(path); continue }
    const entries = [...await ctx.fs.listDir(target, exec.signal)].sort((a, b) => a.name.localeCompare(b.name, 'en'))
    const nested = entries.filter(item => item.type === 'directory').map(item => `${path}/${item.name}`)
    files.push(...entries.filter(item => item.type === 'file' && item.name.endsWith('.md') && item.name !== 'index.md').map(item => `${path}/${item.name}`))
    files.push(...await expandSourcePaths(ctx, exec, nested))
  }
  return files
}
function cutRecord(text) {
  const match = /^---\njc_adaptation_cut: ([^\n]+)\n---\n/.exec(text)
  if (!match) throw new Error('本集缺少真实切分记录，请先按分集规划切分')
  const record = JSON.parse(match[1])
  // 旧切分为单段且正文不带出处标注，按原字符位置继续校验。
  if (!record.segments) record.segments = [{ source_path: record.source_path, source_hash: record.source_hash, chapter_heading: record.chapter_heading, start: record.start, end: record.end, legacy: true }]
  return { ...record, body: text.slice(match[0].length) }
}
function cutBody(segments, texts) {
  if (segments.length === 1 && segments[0].legacy) return texts[0]
  return segments.map((item, index) => `<!-- 出处：${item.chapter_heading} 第${item.start_line}–${item.end_line}行${item.flashback ? '（倒叙）' : ''} -->\n${texts[index]}`).join('\n\n')
}
async function verifiedCut(ctx, exec, text, agent) {
  const cut = cutRecord(text), texts = []
  for (const item of cut.segments) {
    const source = await adaptationFile(ctx, exec, item.source_path, agent)
    const chapter = adaptationUnits(source.text).find(unit => unit.heading === item.chapter_heading)
    if (source.hash !== item.source_hash || !chapter || !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end)
      || item.start < chapter.start || item.end > chapter.end || item.end <= item.start) throw new Error('原作或本集切分已变化/越章，请重新核对分集规划与切分')
    texts.push(source.text.slice(item.start, item.end))
  }
  if (cutBody(cut.segments, texts) !== cut.body) throw new Error('原作或本集切分已变化，请重新核对分集规划与切分')
  return { ...cut, texts }
}
async function cutSegment(ctx, exec, agent, input) {
  const source = await adaptationFile(ctx, exec, input?.source_path, agent, true)
  const heading = String(input.chapter_heading || '').replace(/^#+\s*/, '')
  const units = adaptationUnits(source.text)
  if (heading === '全文' && units[0].heading !== '全文') throw new Error('原文有章标题，不能按全文切分，请提供完整章标题')
  const chapters = units.filter(item => item.heading === heading)
  if (chapters.length !== 1) throw new Error('无法唯一定位真实章节，请提供原文件中完整章标题；无章标题的原文传“全文”，不虚构章节')
  if (![input.start_line, input.end_line].every(Number.isSafeInteger) || input.start_line < 1 || input.end_line < input.start_line)
    throw new Error('请用read显示的行号切分：start_line、end_line为正整数且起行不大于止行')
  const chapter = chapters[0], first = lineSpan(source.text, input.start_line), last = lineSpan(source.text, input.end_line)
  const headingLine = chapter.heading === '全文' ? 0 : source.text.lastIndexOf('\n', chapter.start - 1) + 1
  if (!first || !last || first.start < headingLine || last.end > chapter.end) throw new Error('行号超出所属章节（跨章），未保存；跨章请分成多段')
  const item = { source_path: source.path, source_hash: source.hash, chapter_heading: chapter.heading, start_line: input.start_line, end_line: input.end_line,
    start: Math.max(first.start, chapter.start), end: last.end, ...(input.flashback === true ? { flashback: true } : {}) }
  const text = source.text.slice(item.start, item.end)
  if (item.end <= item.start || !text.trim()) throw new Error('所选行没有正文，未保存')
  return { item, text }
}
async function adaptationCut(ctx, args, exec, agent, content) {
  const input = JSON.parse(content)
  if (!Array.isArray(input.segments) || !input.segments.length) throw new Error('adaptation_cut须传segments数组：每段{source_path, chapter_heading, start_line, end_line, flashback?}，行号即read显示的行号')
  const segments = [], texts = []
  for (const value of input.segments) {
    const { item, text } = await cutSegment(ctx, exec, agent, value)
    segments.push(item); texts.push(text)
  }
  const body = cutBody(segments, texts)
  if (Buffer.byteLength(body, 'utf8') > 1_000_000) throw new Error('本集原文切分超过1MB，请拆成更多集')
  return `---\njc_adaptation_cut: ${JSON.stringify({ episode_number: args.episode_number, segments })}\n---\n${body}`
}

async function episodeScriptFromCut(ctx, args, exec, root, agent) {
  let input
  try { input = JSON.parse(args.content) } catch { input = undefined }
  if (!Number.isSafeInteger(input?.from_cut)) throw new Error('短剧分集剧本只能由程序从切分生成：content 传 {"from_cut":集号}，不传正文')
  if (input.from_cut !== args.episode_number) throw new Error('from_cut 须与本集集号一致')
  const cut = await verifiedCut(ctx, exec, (await adaptationFile(ctx, exec, `${root}/改编方案/分集切分/${episodeFolder(input.from_cut)}原文.md`, agent)).text, agent)
  if (cut.episode_number !== args.episode_number) throw new Error('切分记录与本集集号不一致')
  const body = cut.texts.join('\n\n') + '\n'
  return episodeHeader(await assetIndex(ctx, exec, root), await eventAssetNames(ctx, exec, root, cut.event), root, cut.event, body) + body
}

// ---- 分集剧本文件头：所属事件与出场资产的链接（正文仍只有原文）----
const ASSET_CATEGORIES = [['characters', '人物小传'], ['scenes', '场景'], ['props', '道具']]

/** 资产档案索引：同名时改编版优先；别名取自档案里“姓名/称谓/别名/代号”这类行。 */
async function assetIndex(ctx, exec, root) {
  const cwd = exec.agent.session.header.cwd, found = new Map()
  for (const [group, category] of ASSET_CATEGORIES) for (const version of ['', '原作/', '改编版/']) {
    const directory = `${root}/项目资料/${version}${category}`
    const target = await ctx.fs.resolve(directory, { cwd, signal: exec.signal })
    if ((await ctx.fs.stat(target, exec.signal))?.type !== 'directory') continue
    for (const item of await ctx.fs.listDir(target, exec.signal)) {
      if (item.type !== 'file' || !item.name.endsWith('.md') || item.name === 'index.md') continue
      const name = item.name.slice(0, -3)
      const text = await ctx.fs.readText(await ctx.fs.resolve(`${directory}/${item.name}`, { cwd, signal: exec.signal }), exec.signal)
      const aliases = new Set()
      for (const line of String(text).split(/\r?\n/)) {
        const match = /^[-*]\s*\*\*([^*]+)\*\*\s*[：:]\s*(.+)$/.exec(line.trim())
        if (!match || !/姓名|称谓|别名|代号|昵称|又名|名称|ID/.test(match[1])) continue
        for (const token of match[2].split(/[\/、，,；;（）()\s]+/)) if (token.length >= 2) aliases.add(token)
      }
      // 道具一档一件才能逐集链接；档内有多个无固定分节名的小标题，多半是把一批道具写成了汇总档。
      const entries = String(text).split(/\r?\n/).filter(line => /^##\s+/.test(line) && !/外观|功能|规则|来源|作用|出处|描述|特征|用途|基本|信息|说明|剧情|视觉|登场|归属|别名|设定|备注/.test(line))
      found.set(`${group}/${name}`, { group, name, path: `${directory}/${name}`, terms: [name, ...aliases], aggregate: group === 'props' && entries.length >= 3 })
    }
  }
  return [...found.values()]
}

/** 事件文档里链出的资产：名字（链接目标的最后一段）→ 链接标签（模型在事件里对它的叫法，如“树洞”），标签也算这个资产的别名。 */
async function eventAssetNames(ctx, exec, root, event) {
  const linked = new Map()
  if (!event) return linked
  const cwd = exec.agent.session.header.cwd
  const target = await ctx.fs.resolve(`${root}/改编方案/事件/${event}.md`, { cwd, signal: exec.signal })
  if ((await ctx.fs.stat(target, exec.signal))?.type !== 'file') return linked
  const text = await ctx.fs.readText(target, exec.signal)
  for (const match of text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g)) {
    const name = match[1].replace(/\.md$/, '').split('/').at(-1)
    if (!linked.has(name)) linked.set(name, new Set())
    const label = (match[2] || '').trim()
    if (label.length >= 2) linked.get(name).add(label)
  }
  return linked
}

/** 文件头只放链接：所属事件、本集正文里出现的角色、场景、道具（按首次出现排序）。没有任何内容时不加文件头。 */
function episodeHeader(index, linkedNames, root, event, body, extra = {}) {
  const linked = index.filter(asset => linkedNames.has(asset.name))
  const candidates = linked.length ? linked : index
  const termsOf = asset => [...asset.terms, ...(linkedNames.get(asset.name) ?? [])]
  const present = candidates.map(asset => ({ asset, at: Math.min(...termsOf(asset).map(term => { const at = body.indexOf(term); return at < 0 ? Infinity : at })) }))
    .filter(item => item.at !== Infinity).sort((a, b) => a.at - b.at).map(item => item.asset)
  const lines = []
  if (event) lines.push(`event: "[[${root}/改编方案/事件/${event}|${event}]]"`)
  lines.push(...(extra.before ?? []))
  for (const [group] of ASSET_CATEGORIES) {
    const items = present.filter(asset => asset.group === group)
    if (items.length) lines.push(`${group}:`, ...items.map(asset => `  - "[[${asset.path}|${asset.name}]]"`))
  }
  lines.push(...(extra.after ?? []))
  return lines.length ? `---\n${lines.join('\n')}\n---\n` : ''
}

// ---- 时间账：内容算时间，时间定集数 ----
/** 动作单元参照秒数（中值）：一个镜头约3–5秒，装1–2个动作单元；对白按每分钟240字另算。 */
export const TIME_UNITS = { 快招: 2, 攻防: 4, 技能: 8, 大招: 15, 走位: 3, 反应: 2, 全景: 3, 停顿: 3, 面板: 2.5, 闪回: 6 }
/** 重要度档位：计划时长＝自然时长×系数；细写和决战要写理由，最多展开3倍。 */
export const TIER_FACTORS = { 压缩: 0.6, 如实: 1, 细写: 2, 决战: 3 }
const PLATFORM_MAX_SECONDS = 180
const MANIFEST_PATH = '改编方案/分集清单.json'
const lineOf = (text, offset) => text.slice(0, offset).split('\n').length
const round1 = value => Math.round(value * 10) / 10

/** 对白秒：引号内字数÷4（每分钟240字）＋每段对白0.5秒停顿。 */
export function dialogueSeconds(text) {
  let chars = 0, segments = 0
  for (const match of String(text).matchAll(/[“「"]([^”」"]*)[”」"]/g)) { chars += match[1].replace(/\s/g, '').length; segments += 1 }
  return chars / 4 + segments * 0.5
}

export function unitSeconds(units = {}, pace = 1) {
  let total = 0
  for (const [name, count] of Object.entries(units ?? {})) {
    if (!(name in TIME_UNITS)) throw new Error(`未知动作单元：${name}（可用：${Object.keys(TIME_UNITS).join('、')}）`)
    if (!(typeof count === 'number' && count >= 0)) throw new Error(`动作单元「${name}」的数量须为非负数`)
    total += TIME_UNITS[name] * count * pace
  }
  return total
}

/** 把连续的一段行按计划秒数切成 parts 份，使各份与平均值的偏差平方和最小。 */
function splitRange(lines, from, to, parts) {
  const n = to - from + 1
  parts = Math.min(parts, n)
  if (parts <= 1) return [[from, to]]
  const prefix = [0]
  for (let i = from; i <= to; i += 1) prefix.push(prefix.at(-1) + lines[i].planned)
  const average = prefix[n] / parts
  const cost = Array.from({ length: parts + 1 }, () => Array(n + 1).fill(Infinity)), back = Array.from({ length: parts + 1 }, () => Array(n + 1).fill(0))
  cost[0][0] = 0
  for (let k = 1; k <= parts; k += 1) for (let j = k; j <= n; j += 1) for (let i = k - 1; i < j; i += 1) {
    if (cost[k - 1][i] === Infinity) continue
    const next = cost[k - 1][i] + (prefix[j] - prefix[i] - average) ** 2
    if (next < cost[k][j]) { cost[k][j] = next; back[k][j] = i }
  }
  const out = []
  let j = n
  for (let k = parts; k >= 1; k -= 1) { const i = back[k][j]; out.unshift([from + i, from + j - 1]); j = i }
  return out
}

/**
 * 按计划时长为一个事件定集数并选切点。lines：[{round, planned}]（事件内按顺序的非空行）；rounds：[{hook}]；
 * limits：{min, target, max}（秒）。切点只落在回合边界（计划时长超过最长的回合先按行切开）；
 * 每集不超过最长、不小于最短的一半，优先把钩子回合的末尾作为切点；override 为用户指定的集数。
 */
export function planEventEpisodes(lines, rounds, limits, override) {
  if (!lines.length) return []
  const sum = (a, b) => { let total = 0; for (let i = a; i <= b; i += 1) total += lines[i].planned; return total }
  let atoms = []
  for (let i = 0; i < lines.length;) {
    let j = i
    while (j + 1 < lines.length && lines[j + 1].round === lines[i].round) j += 1
    atoms.push({ from: i, to: j, planned: sum(i, j), hook: rounds[lines[i].round]?.hook === true })
    i = j + 1
  }
  const refine = atom => {
    if (atom.planned <= limits.max + 1e-9 || atom.from === atom.to) return [atom]
    const parts = splitRange(lines, atom.from, atom.to, Math.ceil(atom.planned / limits.max - 1e-9))
      .flatMap(([from, to]) => refine({ from, to, planned: sum(from, to), hook: false }))
    parts.at(-1).hook = atom.hook
    return parts
  }
  atoms = atoms.flatMap(refine)
  const total = sum(0, lines.length - 1)
  let count = override
  if (!count) {
    const lower = Math.max(1, Math.ceil(total / limits.max - 1e-9)), upper = Math.max(lower, Math.floor(total / limits.min + 1e-9))
    count = Math.min(Math.max(Math.round(total / limits.target), lower), upper)
  }
  while (atoms.length < count) {
    let best = -1
    atoms.forEach((atom, index) => { if (atom.to > atom.from && (best < 0 || atom.planned > atoms[best].planned)) best = index })
    if (best < 0) break
    const [first, second] = splitRange(lines, atoms[best].from, atoms[best].to, 2)
    atoms.splice(best, 1, { from: first[0], to: first[1], planned: sum(...first), hook: false }, { from: second[0], to: second[1], planned: sum(...second), hook: atoms[best].hook })
  }
  count = Math.min(count, atoms.length)
  const prefix = [0]
  for (const atom of atoms) prefix.push(prefix.at(-1) + atom.planned)
  const solve = (parts, constrained) => {
    const average = total / parts, size = atoms.length
    const cost = Array.from({ length: parts + 1 }, () => Array(size + 1).fill(Infinity)), back = Array.from({ length: parts + 1 }, () => Array(size + 1).fill(0))
    cost[0][0] = 0
    for (let k = 1; k <= parts; k += 1) for (let j = k; j <= size; j += 1) for (let i = k - 1; i < j; i += 1) {
      if (cost[k - 1][i] === Infinity) continue
      const planned = prefix[j] - prefix[i]
      if (constrained && parts > 1 && (planned > limits.max + 1e-9 || planned < limits.min * 0.5 - 1e-9)) continue
      const next = cost[k - 1][i] + (planned - average) ** 2 - (atoms[j - 1].hook && j < size ? 0.25 * average * average : 0)
      if (next < cost[k][j]) { cost[k][j] = next; back[k][j] = i }
    }
    if (cost[parts][size] === Infinity) return undefined
    const out = []
    let j = size
    for (let k = parts; k >= 1; k -= 1) { const i = back[k][j]; out.unshift({ from: atoms[i].from, to: atoms[j - 1].to, planned: prefix[j] - prefix[i] }); j = i }
    return out
  }
  let plan
  if (override) plan = solve(count, true) ?? solve(count, false)
  else {
    for (let parts = count; parts <= atoms.length && !plan; parts += 1) plan = solve(parts, true)
    plan ??= solve(count, false)
  }
  return plan
}

/** 章的正文行号范围（不含章标题行）。 */
function chapterLines(text, unit) {
  const first = unit.heading === '全文' ? 1 : lineOf(text, unit.start) + 1
  const last = unit.end > 0 ? lineOf(text, Math.max(unit.end - 1, 0)) : 1
  return { first, last }
}

async function readJsonFile(ctx, exec, path) {
  const target = await ctx.fs.resolve(path, { cwd: exec.agent.session.header.cwd, signal: exec.signal })
  return (await ctx.fs.stat(target, exec.signal))?.type === 'file' ? JSON.parse(await ctx.fs.readText(target, exec.signal)) : undefined
}

const chapterKey = chapter => `${chapter.source_path}\0${chapter.chapter_heading}`

/** 一个章节的原文与正文行范围。 */
async function chapterBody(ctx, exec, agent, chapter) {
  const file = await adaptationFile(ctx, exec, chapter.source_path, agent)
  const unit = adaptationUnits(file.text).find(item => item.heading === chapter.chapter_heading)
  if (!unit) throw new Error(`原作已改变，找不到章节：${chapter.chapter_heading}`)
  return { file, ...chapterLines(file.text, unit) }
}

/**
 * 一个事件的非空行及其自然、计划秒数。回合覆盖整个事件：回合 i 从它的起点到下一个回合起点之前；
 * 跳过段的行不计。返回 lines（含 round、natural、planned、breakBefore）与每个回合的汇总。
 */
async function eventLines(ctx, exec, agent, event, pace) {
  const skipped = new Set(event.skip.flatMap(range => Array.from({ length: range.end_line - range.start_line + 1 }, (_, i) => `${range.source_path}\0${range.chapter_heading}#${range.start_line + i}`)))
  const keys = event.chapters.map(chapterKey)
  const starts = event.rounds.map(round => [keys.indexOf(chapterKey(round)), round.line])
  const lines = [], hashes = []
  for (const [ci, chapter] of event.chapters.entries()) {
    const { file, first, last } = await chapterBody(ctx, exec, agent, chapter)
    hashes.push(file.hash)
    const from = ci === 0 ? Math.max(first, event.start.line) : first, to = ci === event.chapters.length - 1 ? Math.min(last, event.end.line) : last
    let previous
    for (let line = from; line <= to; line += 1) {
      const span = lineSpan(file.text, line)
      const text = file.text.slice(span.start, span.end)
      if (skipped.has(`${chapterKey(chapter)}#${line}`) || !text.trim()) continue
      let round = 0
      for (let r = 0; r < starts.length; r += 1) if (starts[r][0] < ci || starts[r][0] === ci && starts[r][1] <= line) round = r
      let breakBefore = previous === undefined
      if (previous !== undefined && line > previous + 1) for (let gap = previous + 1; gap < line; gap += 1) if (skipped.has(`${chapterKey(chapter)}#${gap}`)) breakBefore = true
      lines.push({ ci, chapter, fileText: file.text, line, text, round, dialogue: dialogueSeconds(text), start: span.start, end: span.end, hash: file.hash, breakBefore })
      previous = line
    }
  }
  const rounds = event.rounds.map((round, index) => {
    const own = lines.filter(item => item.round === index)
    const dialogue = own.reduce((total, item) => total + item.dialogue, 0), units = unitSeconds(round.units, pace)
    return { index, lines: own.length, dialogue, units, natural: dialogue + units, planned: (dialogue + units) * TIER_FACTORS[round.tier] }
  })
  for (const item of lines) {
    const info = rounds[item.round], factor = TIER_FACTORS[event.rounds[item.round].tier]
    item.natural = item.dialogue + info.units / info.lines
    item.planned = item.natural * factor
  }
  return { lines, rounds, hashes }
}

/** 校验并规范化一份标注（回合、跳过段）、重切或重新规划。 */
async function adaptationAnnotation(ctx, args, exec, root, content, agent) {
  const input = JSON.parse(content), cwd = exec.agent.session.header.cwd
  const manifest = await readJsonFile(ctx, exec, `${root}/${MANIFEST_PATH}`)
  const current = manifest?.version === 2 ? manifest : undefined
  if (input.replan !== undefined) {
    if (!current?.events?.length) throw new Error('还没有分集清单，无法重新规划')
    if (!(typeof input.replan?.pace === 'number' && input.replan.pace >= 0.5 && input.replan.pace <= 2)) throw new Error('replan.pace 须在 0.5–2 之间')
    return JSON.stringify({ replan: { pace: input.replan.pace } }, null, 2) + '\n'
  }
  if (input.recut !== undefined) {
    const target = current?.events?.find(item => item.event === input.recut?.event && !item.unfinished)
    if (!target) throw new Error(`重切的事件不存在或尚未完成：${input.recut?.event}`)
    if (!Number.isSafeInteger(input.recut.episodes) || input.recut.episodes < 1) throw new Error('重切集数须为正整数')
    return JSON.stringify({ recut: { event: target.event, episodes: input.recut.episodes } }, null, 2) + '\n'
  }
  const rhythm = input.rhythm
  if (!current?.rhythm && rhythm === undefined) throw new Error('首次保存标注须带 rhythm（name、min、target、max 秒，按所选短剧风格）')
  if (rhythm !== undefined) {
    const { min, target, max } = rhythm ?? {}
    if (![min, target, max].every(value => typeof value === 'number' && value > 0) || !(min <= target && target <= max)) throw new Error('rhythm 的 min、target、max 须为正数且 min ≤ target ≤ max（秒）')
    if (max > PLATFORM_MAX_SECONDS) throw new Error(`rhythm.max 不能超过平台上限${PLATFORM_MAX_SECONDS}秒`)
    if (rhythm.pace !== undefined && !(rhythm.pace >= 0.5 && rhythm.pace <= 2)) throw new Error('rhythm.pace 须在 0.5–2 之间')
  }
  if (!Array.isArray(input.events)) throw new Error('标注须带 events 数组')
  if (input.events.some(event => event?.beats !== undefined || event?.delete !== undefined)) throw new Error('标注格式已改为回合（rounds）和跳过段（skip），请按 jc-duanju-fenji 改用新格式')
  const pace = rhythm?.pace ?? current?.rhythm?.pace ?? 1
  const progress = await readJsonFile(ctx, exec, `${root}/改编方案/执行进度.json`)
  const chapters = progress?.chapters ?? []
  if (!chapters.length) throw new Error('请先以 source 进度登记本批章节，再保存标注')
  const bodies = new Map()
  const bodyOf = async chapter => { const key = chapterKey(chapter); if (!bodies.has(key)) bodies.set(key, await chapterBody(ctx, exec, agent, chapter)); return bodies.get(key) }
  // 位置：{chapter_heading, line, source_path?}；按本批章节顺序可比较。
  const resolve = async (pos, what) => {
    const index = chapters.findIndex(item => item.chapter_heading === pos?.chapter_heading && (pos.source_path === undefined || item.source_path === pos.source_path || item.source_path.endsWith(`/${pos.source_path}`)))
    if (index < 0) throw new Error(`${what}的章节不在本批范围内：${pos?.chapter_heading}`)
    const chapter = chapters[index], { first, last } = await bodyOf(chapter)
    if (!Number.isSafeInteger(pos.line) || pos.line < first || pos.line > last) throw new Error(`${what}的行号不在该章正文内（${first}–${last}）：${pos.line}`)
    return { source_path: chapter.source_path, chapter_heading: chapter.chapter_heading, line: pos.line, index }
  }
  const before = (a, b) => a.index < b.index || a.index === b.index && a.line <= b.line
  const plain = pos => ({ source_path: pos.source_path, chapter_heading: pos.chapter_heading, line: pos.line })
  const events = []
  if (input.planned_through !== undefined && !chapters.some(item => item.chapter_heading === input.planned_through)) throw new Error('planned_through 须是本批章节的完整标题')
  for (const event of input.events) {
    const doc = await ctx.fs.resolve(`${root}/改编方案/事件/${event?.event}.md`, { cwd, signal: exec.signal })
    if (typeof event?.event !== 'string' || (await ctx.fs.stat(doc, exec.signal))?.type !== 'file') throw new Error(`事件文档不存在：${event?.event}`)
    const start = await resolve(event.start, `${event.event} 起点`), end = await resolve(event.end, `${event.event} 终点`)
    if (!before(start, end)) throw new Error(`${event.event} 起点晚于终点`)
    const inside = pos => before(start, pos) && before(pos, end)
    const rounds = []
    let last
    for (const round of event.rounds ?? []) {
      const pos = await resolve(round, `${event.event} 回合`)
      if (!inside(pos)) throw new Error(`${event.event} 的回合超出事件范围：${round.chapter_heading} 第${round.line}行`)
      if (!rounds.length && !(pos.index === start.index && pos.line === start.line)) throw new Error(`${event.event} 的第一个回合须从事件起点开始，回合要覆盖整个事件`)
      if (last && !(pos.index > last.index || pos.index === last.index && pos.line > last.line)) throw new Error(`${event.event} 的回合起点须依次递增`)
      last = pos
      const tier = round.tier ?? '如实'
      if (!(tier in TIER_FACTORS)) throw new Error(`${event.event} 回合「${round.desc}」的档位须是：${Object.keys(TIER_FACTORS).join('、')}`)
      if ((tier === '细写' || tier === '决战') && !String(round.why || '').trim()) throw new Error(`${event.event} 回合「${round.desc}」是${tier}，须写 why（理由）：为什么这一段值得展开`)
      unitSeconds(round.units, 1)
      const flashbacks = []
      for (const source of round.flashback_sources ?? []) {
        const from = await resolve({ ...source, line: source?.start_line }, `${event.event} 可闪回素材`), to = await resolve({ ...source, line: source?.end_line }, `${event.event} 可闪回素材`)
        if (from.index !== to.index || from.line > to.line) throw new Error(`${event.event} 的可闪回素材须在同一章内且起止有序`)
        flashbacks.push({ source_path: from.source_path, chapter_heading: from.chapter_heading, start_line: from.line, end_line: to.line })
      }
      rounds.push({ ...plain(pos), desc: String(round.desc || ''), result: String(round.result || ''), units: round.units ?? {}, tier,
        ...(tier === '细写' || tier === '决战' ? { why: String(round.why).trim() } : {}), hook: round.hook === true, peak: round.peak === true,
        ...(round.single === true ? { single: true, ...(round.why ? { why: String(round.why).trim() } : {}) } : {}), flashback_sources: flashbacks })
    }
    if (!event.unfinished && !rounds.length) throw new Error(`${event.event} 已完成但没有回合（rounds）`)
    const skip = []
    for (const range of event.skip ?? []) {
      if (!String(range?.reason || '').trim()) throw new Error(`${event.event} 的跳过段须写 reason（理由），只跳过确定不进剧情的内容`)
      const from = await resolve({ ...range, line: range.start_line }, `${event.event} 跳过段`), to = await resolve({ ...range, line: range.end_line }, `${event.event} 跳过段`)
      if (!before(from, to) || from.index !== to.index || !inside(from) || !inside(to)) throw new Error(`${event.event} 的跳过段须在同一章、事件范围内且起止有序`)
      skip.push({ source_path: from.source_path, chapter_heading: from.chapter_heading, start_line: from.line, end_line: to.line, reason: String(range.reason).trim() })
    }
    const normalized = { event: event.event, unfinished: event.unfinished === true, start: plain(start), end: plain(end), rounds, skip,
      chapters: chapters.slice(start.index, end.index + 1).map(item => ({ source_path: item.source_path, chapter_heading: item.chapter_heading })) }
    if (!normalized.unfinished) {
      // 漏标诊断：一个回合自然时长超过平台上限，几乎一定含多次局势变化。
      const info = await eventLines(ctx, exec, agent, normalized, pace)
      for (const [index, item] of info.rounds.entries()) {
        const round = rounds[index]
        if (item.natural > PLATFORM_MAX_SECONDS && round.single !== true) throw new Error(`${event.event} 回合「${round.desc}」自然时长约${Math.round(item.natural)}秒，超过平台上限${PLATFORM_MAX_SECONDS}秒，可能含多次局势变化：请拆成多个回合；确属一次连续冲突请标 single:true 并写 why`)
        if (round.single === true && !String(round.why || '').trim()) throw new Error(`${event.event} 回合「${round.desc}」标了 single，须写 why（理由）`)
      }
    }
    events.push(normalized)
  }
  return JSON.stringify({ ...(rhythm ? { rhythm } : {}), ...(input.planned_through ? { planned_through: input.planned_through } : {}), events }, null, 2) + '\n'
}

const secondsText = value => Number.isInteger(value) ? String(value) : value.toFixed(1)
const lineRange = segment => `${segment.chapter_heading} ${segment.start_line}–${segment.end_line}行`

/** 一集的原文段：把计划里 from..to 的行按章、连续行分段。 */
function episodeSegments(lines, from, to) {
  const segments = [], texts = []
  let run
  const flush = () => {
    if (!run) return
    segments.push({ source_path: run.chapter.source_path, source_hash: run.hash, chapter_heading: run.chapter.chapter_heading, start_line: run.first, end_line: run.last, start: run.start, end: run.end })
    texts.push(run.fileText.slice(run.start, run.end))
    run = undefined
  }
  for (let i = from; i <= to; i += 1) {
    const item = lines[i]
    if (run && (item.ci !== run.ci || item.breakBefore)) flush()
    if (!run) run = { ci: item.ci, chapter: item.chapter, hash: item.hash, fileText: item.fileText, first: item.line, last: item.line, start: item.start, end: item.end }
    else { run.last = item.line; run.end = item.end }
  }
  flush()
  return { segments, texts }
}

/** 切分卡：切分与改编之间的接口，写明回合、时间预算、峰值、钩子和可闪回素材。 */
function cutCard({ header, event, index, count, entry, limits, rounds, lineRounds }) {
  const rows = entry.rounds.map(i => {
    const round = event.rounds[i], info = rounds[i]
    const units = Object.entries(round.units ?? {}).map(([name, number]) => `${name}×${number}`).join(' ') || '—'
    return `| ${round.desc || '—'} | ${round.result || '—'} | ${round.tier} | ${round1(info.natural)} | ${round1(info.planned)} | ${units} |`
  })
  const peaks = entry.rounds.filter(i => event.rounds[i].peak).map(i => `- ${event.rounds[i].desc || '—'}`)
  const flashbacks = entry.rounds.flatMap(i => event.rounds[i].flashback_sources.map(lineRange)).map(text => `- ${text}`)
  const last = event.rounds[entry.rounds.at(-1)]
  return `${header}# 第${String(entry.episode).padStart(3, '0')}集 切分卡

- 所属事件：${event.event}（第${index + 1}/${count}集）
- 原文：${entry.segments.map(lineRange).join('；')}
- 时间预算：本风格每集 ${limits.min}–${limits.max} 秒（目标 ${limits.target} 秒）；本集计划约 ${entry.planned_s} 秒（自然 ${entry.natural_s} 秒，其中对白 ${entry.dialogue_s} 秒）

## 回合

| 回合 | 局势变化 | 档位 | 自然(秒) | 计划(秒) | 动作单元 |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

## 峰值

${peaks.length ? peaks.join('\n') : '- 本集没有标峰值的回合'}

## 结尾钩子

- ${last.result || '—'}${last.hook ? '（标注为钩子）' : ''}

## 可闪回素材

${flashbacks.length ? flashbacks.join('\n') : '- 无'}
`
}

/** 把分集清单中已完成的事件按时间账切成集，生成切分、切分卡、原文直出的分集剧本与清单。 */
async function assembleEpisodes(ctx, exec, contract, route, agent, root, annotation) {
  const cwd = exec.agent.session.header.cwd
  const workspace = await ctx.fs.resolve(cwd, { cwd, signal: exec.signal })
  const policy = ctx.get('sandboxPolicy')?.resolve({ session: exec.agent.session })
  const old = await readJsonFile(ctx, exec, `${root}/${MANIFEST_PATH}`)
  const manifest = old?.version === 2 ? old : { version: 2, events: [], stale: [], adapted: [] }
  const previousMax = Math.max(0, ...(old?.events ?? []).filter(item => item.episodes).map(item => item.episodes[1]))
  if (annotation.rhythm) manifest.rhythm = { ...annotation.rhythm, pace: annotation.rhythm.pace ?? manifest.rhythm?.pace ?? 1 }
  if (annotation.planned_through) manifest.planned_through = annotation.planned_through
  if (annotation.replan) {
    manifest.rhythm.pace = annotation.replan.pace
    manifest.adapted = []
    for (const event of manifest.events) delete event.signature
  }
  if (annotation.recut) {
    const target = manifest.events.find(item => item.event === annotation.recut.event)
    target.override = annotation.recut.episodes
    delete target.signature
  }
  for (const event of annotation.events ?? []) {
    const index = manifest.events.findIndex(item => item.event === event.event)
    const next = { ...event, ...(index >= 0 && manifest.events[index].override ? { override: manifest.events[index].override } : {}) }
    if (index >= 0) manifest.events[index] = { ...next, signature: manifest.events[index].signature, count: manifest.events[index].count, plan: manifest.events[index].plan, episodes: manifest.events[index].episodes }
    else manifest.events.push(next)
  }
  const limits = manifest.rhythm, pace = limits.pace ?? 1
  const assets = await assetIndex(ctx, exec, root)
  const warnings = assets.filter(asset => asset.aggregate).map(asset => `道具档案「${asset.name}」疑似汇总档（条目过多），请拆成一档一件，否则无法逐集链接道具`)
  const heavy = []
  const adapted = new Set(manifest.adapted ?? [])
  let number = 1
  const written = []
  for (const event of manifest.events) {
    if (event.unfinished) break
    const info = await eventLines(ctx, exec, agent, event, pace)
    const plan = planEventEpisodes(info.lines.map(item => ({ round: item.round, planned: item.planned })), event.rounds.map(round => ({ hook: round.hook })), limits, event.override)
    const range = [number, number + plan.length - 1]
    const signature = JSON.stringify([event.start, event.end, event.rounds, event.skip, event.override ?? null, limits, range, info.hashes])
    event.count = plan.length
    if (event.signature !== signature) {
      const links = await eventAssetNames(ctx, exec, root, event.event)
      event.plan = []
      for (const [i, part] of plan.entries()) {
        const episode = number + i
        const slice = info.lines.slice(part.from, part.to + 1)
        const { segments, texts } = episodeSegments(info.lines, part.from, part.to)
        const body = texts.join('\n\n') + '\n'
        const header = episodeHeader(assets, links, root, event.event, body)
        const entry = { episode, planned_s: round1(part.planned), natural_s: round1(slice.reduce((total, item) => total + item.natural, 0)), dialogue_s: round1(slice.reduce((total, item) => total + item.dialogue, 0)),
          rounds: [...new Set(slice.map(item => item.round))], segments: segments.map(({ source_path, chapter_heading, start_line, end_line }) => ({ source_path, chapter_heading, start_line, end_line })) }
        event.plan.push(entry)
        await saveArtifact(ctx, { artifact_kind: 'adaptation_cut', episode_number: episode }, exec, contract, route, agent,
          `---\njc_adaptation_cut: ${JSON.stringify({ episode_number: episode, event: event.event, segments })}\n---\n${cutBody(segments, texts)}`)
        await saveArtifact(ctx, { artifact_kind: 'adaptation_card', episode_number: episode }, exec, contract, route, agent,
          cutCard({ header, event, index: i, count: plan.length, entry, limits, rounds: info.rounds }))
        await saveArtifact(ctx, { artifact_kind: 'episode_source_script', episode_number: episode }, exec, contract, route, agent, header + body)
        adapted.delete(episode)
        written.push(episode)
      }
      event.signature = signature
    }
    event.episodes = range
    for (const entry of event.plan) if (entry.planned_s > limits.max + 0.05) {
      warnings.push(`${event.event} 第${entry.episode}集计划时长${secondsText(entry.planned_s)}秒，超过本风格最长${limits.max}秒${entry.segments.length === 1 && entry.segments[0].start_line === entry.segments[0].end_line ? '（单行无法再切开）' : '（回合内无法再切开，请复核回合划分）'}`)
    }
    for (const [index, round] of event.rounds.entries()) if (round.tier === '细写' || round.tier === '决战') {
      const planned = info.rounds[index].planned
      heavy.push({ event: event.event, round: round.desc, tier: round.tier, why: round.why, planned_s: round1(planned), episodes: round1(planned / limits.target) })
    }
    number += plan.length
  }
  const max = number - 1
  manifest.adapted = [...adapted].filter(episode => episode <= max).sort((a, b) => a - b)
  manifest.stale = [...new Set([...(manifest.stale ?? []), ...Array.from({ length: Math.max(0, previousMax - max) }, (_, i) => max + 1 + i)])]
    .filter(episode => episode > max).sort((a, b) => a - b)
  manifest.heavy = heavy
  manifest.warnings = warnings
  manifest.gaps = await computeGaps(ctx, exec, agent, root, manifest)
  await writePath(ctx, { artifact_kind: 'adaptation_annotation' }, exec, cwd, workspace, policy, `${root}/${MANIFEST_PATH}`, JSON.stringify(manifest, null, 2) + '\n', 'upsert')
  return written.length ? `已组装第${Math.min(...written)}–${Math.max(...written)}集，共${max}集` : `共${max}集，无新组装`
}

/** 已规划到的章节里，既不属于任何事件也没有跳过的非空行（不再静默丢弃）。 */
async function computeGaps(ctx, exec, agent, root, manifest) {
  const progress = await readJsonFile(ctx, exec, `${root}/改编方案/执行进度.json`)
  const chapters = progress?.chapters ?? []
  const through = chapters.findIndex(item => item.chapter_heading === manifest.planned_through)
  if (through < 0) return []
  const gaps = []
  for (const chapter of chapters.slice(0, through + 1)) {
    const key = chapterKey(chapter)
    const { file, first, last } = await chapterBody(ctx, exec, agent, chapter)
    const covered = new Set()
    for (const event of manifest.events) {
      const ci = event.chapters.findIndex(item => chapterKey(item) === key)
      if (ci < 0) continue
      const from = ci === 0 ? event.start.line : first, to = ci === event.chapters.length - 1 ? event.end.line : last
      for (let line = from; line <= to; line += 1) covered.add(line)
    }
    let run
    const flush = () => { if (run) gaps.push({ chapter_heading: chapter.chapter_heading, start_line: run.start, end_line: run.end, chars: run.chars }); run = undefined }
    for (let line = first; line <= last; line += 1) {
      const span = lineSpan(file.text, line)
      const text = file.text.slice(span.start, span.end)
      if (covered.has(line) || !text.trim()) { if (covered.has(line)) flush(); continue }
      run = run ? { ...run, end: line, chars: run.chars + text.replace(/\s/g, '').length } : { start: line, end: line, chars: text.replace(/\s/g, '').length }
    }
    flush()
  }
  return gaps
}

/**
 * 逐集改编的保存：校验场次、出处、对白时间与总时长，生成文件头（事件、策略、总时长、资产、出处）和带时间标注的正文。
 * 程序保证出处、时间和范围，不保证零新增；改编后的内容由用户抽检。
 */
async function adaptedScript(ctx, args, exec, root, agent, adapted) {
  const manifest = await readJsonFile(ctx, exec, `${root}/${MANIFEST_PATH}`)
  const found = manifest?.version === 2
    ? manifest.events.flatMap(event => (event.plan ?? []).map(item => ({ event, item }))).find(entry => entry.item.episode === args.episode_number) : undefined
  if (!found) throw new Error(`第${args.episode_number}集还没有切分卡，请先保存标注完成切分`)
  const limits = manifest.rhythm
  const strategy = String(adapted?.strategy || '').trim()
  if (!strategy || strategy.length > 20) throw new Error('adapted.strategy（改编策略）须是不超过20字的非空文字，如 顺叙影视化、冷开场')
  if (!Array.isArray(adapted.scenes) || !adapted.scenes.length) throw new Error('adapted.scenes 须至少有一场戏')
  const progress = await readJsonFile(ctx, exec, `${root}/改编方案/执行进度.json`)
  const chapters = progress?.chapters ?? []
  const resolve = async (source, index) => {
    const chapter = chapters.find(item => item.chapter_heading === source?.chapter_heading && (source.source_path === undefined || item.source_path === source.source_path || item.source_path.endsWith(`/${source.source_path}`)))
    if (!chapter) throw new Error(`第${index + 1}场出处的章节不在目标范围内：${source?.chapter_heading}`)
    const { first, last } = await chapterBody(ctx, exec, agent, chapter)
    if (![source.start_line, source.end_line].every(Number.isSafeInteger) || source.start_line < first || source.end_line > last || source.start_line > source.end_line)
      throw new Error(`第${index + 1}场出处的行号须在该章正文内（${first}–${last}）且起止有序`)
    return { source_path: chapter.source_path, chapter_heading: chapter.chapter_heading, start_line: source.start_line, end_line: source.end_line }
  }
  let total = 0, outside = 0
  const scenes = [], sources = []
  for (const [index, scene] of adapted.scenes.entries()) {
    const role = scene?.role ?? 'main'
    if (!['main', 'cold', 'flashback'].includes(role)) throw new Error(`第${index + 1}场 role 只能是 main、cold 或 flashback`)
    if (!(typeof scene.seconds === 'number' && scene.seconds > 0)) throw new Error(`第${index + 1}场须写 seconds（本场时间，秒）`)
    const text = String(scene.text || '').trim()
    if (!text) throw new Error(`第${index + 1}场没有正文`)
    if (!Array.isArray(scene.sources) || !scene.sources.length) throw new Error(`第${index + 1}场须写 sources（出处：章节与行号），每场戏都要能回到原文`)
    const own = []
    for (const source of scene.sources) {
      const resolved = await resolve(source, index)
      if (role === 'main' && !found.item.segments.some(segment => segment.chapter_heading === resolved.chapter_heading && segment.start_line <= resolved.start_line && resolved.end_line <= segment.end_line))
        throw new Error(`第${index + 1}场（main）的出处不在本集原文范围内：${lineRange(resolved)}；要用本集之外的素材请标 cold 或 flashback`)
      own.push(resolved)
    }
    const dialogue = dialogueSeconds(text)
    if (dialogue > scene.seconds + 0.01) throw new Error(`第${index + 1}场对白需要约${secondsText(round1(dialogue))}秒，超过本场时间${secondsText(scene.seconds)}秒：压缩对白或加长本场`)
    total += scene.seconds
    if (role !== 'main') outside += scene.seconds
    for (const source of own) { const label = lineRange(source); if (!sources.includes(label)) sources.push(label) }
    scenes.push({ scene, role, text, dialogue })
  }
  if (total > PLATFORM_MAX_SECONDS) throw new Error(`本集总时长${secondsText(total)}秒，超过平台上限${PLATFORM_MAX_SECONDS}秒`)
  if (outside / total > 0.25 + 1e-9) throw new Error(`冷开场和闪回合计占本集的${Math.round(outside / total * 100)}%，超过25%的上限`)
  const warnings = []
  if (total < limits.min || total > limits.max) warnings.push(`【时间】本集总时长${secondsText(total)}秒，不在本风格的${limits.min}–${limits.max}秒区间`)
  const planned = found.item.planned_s
  if (planned > 0 && Math.abs(total - planned) / planned > 0.25) warnings.push(`【时间】与切分卡计划时长${secondsText(planned)}秒相差${Math.round(Math.abs(total - planned) / planned * 100)}%，请按预算增删`)
  const body = scenes.map(({ scene, role, text, dialogue }, index) => {
    const label = String(scene.title || '').trim() || (role === 'cold' ? '冷开场' : role === 'flashback' ? '闪回' : `场${index + 1}`)
    return `【${label} 约${secondsText(scene.seconds)}秒｜对白${Math.round(dialogue)}秒＋其余${secondsText(round1(scene.seconds - Math.round(dialogue)))}秒】\n${text}\n`
  }).join('\n')
  const header = episodeHeader(await assetIndex(ctx, exec, root), await eventAssetNames(ctx, exec, root, found.event.event), root, found.event.event, body,
    { before: [`strategy: ${strategy}`, `seconds: ${secondsText(total)}`], after: ['sources:', ...sources.map(label => `  - "${label}"`)] })
  return { content: header + body, warnings }
}

async function markAdapted(ctx, exec, root, episode) {
  const cwd = exec.agent.session.header.cwd
  const workspace = await ctx.fs.resolve(cwd, { cwd, signal: exec.signal })
  const policy = ctx.get('sandboxPolicy')?.resolve({ session: exec.agent.session })
  const manifest = await readJsonFile(ctx, exec, `${root}/${MANIFEST_PATH}`)
  if (!manifest) return
  manifest.adapted = [...new Set([...(manifest.adapted ?? []), episode])].sort((a, b) => a - b)
  await writePath(ctx, { artifact_kind: 'adaptation_annotation' }, exec, cwd, workspace, policy, `${root}/${MANIFEST_PATH}`, JSON.stringify(manifest, null, 2) + '\n', 'upsert')
}

async function requireAdaptationReads(ctx, args, exec, contract, agent) {
  if (!wikiReads.has(agent) || ['source_material', 'adaptation_cut', 'adaptation_card', 'episode_source_script', 'adaptation_annotation', 'adaptation_checkpoint', 'production_progress'].includes(args.artifact_kind)) return
  const cwd = exec.agent.session.header.cwd, workspace = await ctx.fs.resolve(cwd, { cwd, signal: exec.signal })
  const root = await chooseWikiRoot(ctx, cwd, exec, workspace, contract)
  const types = Object.fromEntries(Object.entries(contract.types).map(([kind, spec]) => [kind, { ...spec, ...contract.short_drama_layout?.types[kind] }]))
  let spec = artifactSpec(args, { ...contract, types })
  const legacy = artifactSpec(args, contract)
  const exists = async path => (await ctx.fs.stat(await ctx.fs.resolve(path, { cwd, signal: exec.signal }), exec.signal))?.type === 'file'
  if (legacy.path !== spec.path && await exists(`${root}/${legacy.path}`)) spec = legacy
  if (await exists(`${root}/${spec.path}`)) await adaptationFile(ctx, exec, `${root}/${spec.path}`, agent, true)
  if (spec.template.research && !['original', 'adapted'].includes(args.research_version)) throw new Error('短剧改编资料须明确research_version=original或adapted；旧库沿实际索引读取，不混用版本')
  if (args.artifact_kind === 'project_overview') {
    const summary = await exists(`${root}/项目资料/原作/故事梗概.md`) ? `${root}/项目资料/原作/故事梗概.md` : `${root}/项目资料/故事梗概.md`
    await adaptationFile(ctx, exec, summary, agent, true)
  }
  if (['adaptation_episode_plan', 'screenplay'].includes(args.artifact_kind)) await adaptationFile(ctx, exec, `${root}/改编方案/项目总纲.md`, agent, true)
  if (['project_overview', 'adaptation_episode_plan', 'screenplay'].includes(args.artifact_kind)) {
    for (const category of ['人物小传', '场景', '道具']) {
      const selected = new Map()
      for (const version of ['', '原作/', '改编版/']) {
        const directory = `${root}/项目资料/${version}${category}`
        const target = await ctx.fs.resolve(directory, { cwd, signal: exec.signal })
        if ((await ctx.fs.stat(target, exec.signal))?.type !== 'directory') continue
        for (const item of await ctx.fs.listDir(target, exec.signal)) {
          if (item.type !== 'file' || !item.name.endsWith('.md') || item.name === 'index.md') continue
          const name = item.name.slice(0, -3)
          if (String(args.content || '').includes(name)) selected.set(name, `${directory}/${item.name}`)
        }
      }
      for (const path of selected.values()) await adaptationFile(ctx, exec, path, agent, true)
    }
  }
  if (args.artifact_kind !== 'screenplay') return
  const plan = await exists(`${root}/改编方案/逐章规划.md`) ? `${root}/改编方案/逐章规划.md` : `${root}/改编方案/分集规划.md`
  await adaptationFile(ctx, exec, plan, agent, true)
  const cut = await adaptationFile(ctx, exec, `${root}/改编方案/分集切分/${episodeFolder(args.episode_number)}原文.md`, agent, true)
  const record = await verifiedCut(ctx, exec, cut.text, agent)
  if (record.episode_number !== args.episode_number) throw new Error('切分记录与当前集号不一致')
}

/** 删减式改编是否已把分集清单里的每一集都改编完；这些阶段由程序组装，模型没有产物可登记。 */
async function annotationsComplete(ctx, exec, root) {
  const manifest = await readJsonFile(ctx, exec, `${root}/${MANIFEST_PATH}`)
  const total = Math.max(0, ...(manifest?.events ?? []).map(item => Array.isArray(item.episodes) ? item.episodes[1] : 0))
  if (!total) return false
  const adapted = new Set(manifest.adapted ?? [])
  return Array.from({ length: total }, (_, index) => index + 1).every(episode => adapted.has(episode))
}

async function adaptationCheckpoint(ctx, args, exec, root, content, agent) {
  const input = JSON.parse(content), stage = adaptationStages.indexOf(input.stage)
  if (stage < 0 || !Array.isArray(input.outputs)) throw new Error('短剧进度需要有效stage与outputs')
  const cwd = exec.agent.session.header.cwd, target = await ctx.fs.resolve(`${root}/改编方案/执行进度.json`, { cwd, signal: exec.signal })
  const previous = await ctx.fs.stat(target, exec.signal) ? JSON.parse(await ctx.fs.readText(target, exec.signal)) : undefined
  // 删减式改编的 scheme/cuts/writing 由程序按标注组装，模型没有这几个阶段可登记：
  // 分集清单已组装出集且每集都改编完时，允许直接从 materials 及之后完成。
  const assemblyJump = stage === adaptationStages.indexOf('complete') && Boolean(previous) && await annotationsComplete(ctx, exec, root)
  if (stage && (!previous || (!assemblyJump && ![stage - 1, stage].includes(adaptationStages.indexOf(previous.stage))))) throw new Error('短剧流水线不能跳过前置阶段')
  if (input.status !== undefined && !['running', 'blocked', ...(stage === 5 ? ['completed'] : []), ...(stage === 2 ? ['review'] : [])].includes(input.status)) throw new Error('短剧状态无效；review只用于方案阶段等待用户审阅规划书')
  if (input.status === 'blocked' && (!String(input.reason || '').trim() || stage === 5)) throw new Error('阻塞须说明原因，完成阶段不能阻塞')
  const state = stage ? previous : {}, sources = stage ? state.sources : {}
  let chapters = state.chapters
  if (!stage) {
    if (!Array.isArray(input.source_paths) || !input.source_paths.length) throw new Error('首次进度必须登记实际原作source_paths')
    // 登记来源时由程序计算指纹，不要求模型逐个读过；切分时才要求读过所切的那一章。
    let available = []
    for (const path of await expandSourcePaths(ctx, exec, input.source_paths)) {
      const file = await adaptationFile(ctx, exec, path, agent); sources[file.path] = file.hash
      for (const chapter of adaptationUnits(file.text)) available.push({ source_path: file.path, chapter_heading: chapter.heading })
    }
    if (!available.length) throw new Error('来源目录里没有可识别的章节文件')
    available = sortChapters(available)
    if (input.chapters !== undefined && input.chapter_range !== undefined) throw new Error('chapters与chapter_range只能传一个')
    chapters = input.chapters === undefined && input.chapter_range === undefined ? available : []
    if (input.chapter_range !== undefined) {
      const range = input.chapter_range ?? {}
      const file = range.source_path === undefined || (await ctx.fs.stat(await ctx.fs.resolve(range.source_path, { cwd, signal: exec.signal }), exec.signal))?.type === 'directory'
        ? undefined : await adaptationFile(ctx, exec, range.source_path, agent)
      const own = file ? available.filter(item => item.source_path === file.path) : available
      const find = heading => own.flatMap((item, index) => item.chapter_heading === heading ? [index] : [])
      const from = find(range.from), to = find(range.to)
      if (from.length !== 1 || to.length !== 1 || from[0] > to[0]) throw new Error('chapter_range的from/to须是原文中唯一存在的完整章标题，且from在to之前')
      chapters.push(...own.slice(from[0], to[0] + 1))
    }
    if (input.chapters !== undefined) {
      if (!Array.isArray(input.chapters)) throw new Error('chapters须为真实章范围数组')
      for (const selected of input.chapters) {
        const file = await adaptationFile(ctx, exec, selected.source_path, agent)
        const matches = available.filter(item => item.source_path === file.path && item.chapter_heading === selected.chapter_heading)
        if (matches.length !== 1) throw new Error('目标章范围不存在或不唯一')
        chapters.push(matches[0])
      }
    }
    if (!chapters.length || new Set(chapters.map(item => `${item.source_path}\0${item.chapter_heading}`)).size !== chapters.length) throw new Error('原作缺少清晰章节或目标章范围重复')
  }
  for (const [path, hash] of Object.entries(sources)) if ((await adaptationFile(ctx, exec, path, agent)).hash !== hash) throw new Error('原作已改变，请重新规划')
  const files = Object.fromEntries(Object.entries(state.files || {}).filter(([name]) => adaptationStages.indexOf(name) < stage))
  // 逐集改编可补写改编版资料，须在本次writing产物中重新登记；原作、切分和总纲仍不可变。
  const latest = Object.assign({}, ...adaptationStages.slice(0, stage).map(name => files[name] || {}))
  // 分段规划时会补充原作与改编版资料，逐集写作时只补改编版资料；改过的资料须在本次outputs中重新登记。
  const refreshed = path => input.outputs.includes(path) && (stage === 2 && path.startsWith(`${root}/项目资料/`) || stage === 4 && path.startsWith(`${root}/项目资料/改编版/`))
  for (const [path, hash] of Object.entries(latest))
    if (!refreshed(path) && (await adaptationFile(ctx, exec, path, agent)).hash !== hash) throw new Error(`前置产物已改变，请重新规划：${path}`)
  const outputs = {}
  for (const path of input.outputs) {
    if (typeof path !== 'string' || !path.startsWith(`${root}/`) || path.split('/').some(part => ['.', '..'].includes(part))) throw new Error('产物必须在当前Wiki')
    outputs[path] = (await adaptationFile(ctx, exec, path, agent)).hash
  }
  if (stage > 0 && stage < 5 && !Object.keys(outputs).length) throw new Error('阶段没有实际产物')
  if (stage === 1 && !input.outputs.some(path => /项目资料\/原作\/故事梗概\.md$/.test(path))) throw new Error('资料阶段缺少原作梗概')
  if (stage === 2 && !outputs[`${root}/改编方案/项目总纲.md`]) throw new Error('方案阶段缺少项目总纲')
  if (stage === 2 && !input.outputs.some(path => /改编方案\/(?:分集规划|逐章规划)\.md$/.test(path))) throw new Error('方案阶段缺少分集规划')
  // 分段规划时登记已规划到的章，供全自动判断这一段是否完成。
  if (input.planned_through !== undefined && (stage !== 2 || !chapters.some(item => item.chapter_heading === input.planned_through)))
    throw new Error('planned_through只用于方案阶段，且须是本次目标范围内的完整章标题')
  const plannedThrough = stage === 2 ? input.planned_through : state.planned_through
  // 用户决定的每个事件切几集：事件文档须存在，集数为正整数。
  if (input.event_episodes !== undefined) {
    if (stage !== 2 || !Array.isArray(input.event_episodes)) throw new Error('event_episodes只用于方案阶段，须为数组')
    for (const item of input.event_episodes) {
      if (!Number.isSafeInteger(item?.episodes) || item.episodes < 1) throw new Error('event_episodes每项集数须为正整数')
      const doc = await ctx.fs.resolve(`${root}/改编方案/事件/${item.event}.md`, { cwd, signal: exec.signal })
      if (typeof item.event !== 'string' || (await ctx.fs.stat(doc, exec.signal))?.type !== 'file') throw new Error(`事件文档不存在：${item.event}`)
    }
  }
  const eventEpisodes = stage === 2 && input.event_episodes !== undefined ? input.event_episodes : state.event_episodes
  // 批末未完的事件顺延到下一批：记录它的起始章，下一批从这一章开始读。
  if (input.carry_from !== undefined && (stage !== 2 || !chapters.some(item => item.chapter_heading === input.carry_from)))
    throw new Error('carry_from只用于方案阶段，须是本批范围内未完事件起始章的完整标题')
  const carryFrom = stage === 2 && input.carry_from !== undefined ? input.carry_from : state.carry_from
  // 节奏卡与推荐集数：每个事件的节拍数（按轻重折算）按事件名合并保留；风格推荐个数；用户确认的节奏卡。
  let eventBeats = state.event_beats
  if (input.event_beats !== undefined) {
    if (stage !== 2 || !Array.isArray(input.event_beats)) throw new Error('event_beats只用于方案阶段，须为数组')
    const merged = new Map((state.event_beats || []).map(item => [item.event, item]))
    for (const item of input.event_beats) {
      if (typeof item?.beats !== 'number' || !(item.beats > 0)) throw new Error('event_beats每项节拍数须为正数')
      const doc = await ctx.fs.resolve(`${root}/改编方案/事件/${item.event}.md`, { cwd, signal: exec.signal })
      if (typeof item.event !== 'string' || (await ctx.fs.stat(doc, exec.signal))?.type !== 'file') throw new Error(`事件文档不存在：${item.event}`)
      merged.set(item.event, { event: item.event, beats: item.beats })
    }
    eventBeats = [...merged.values()]
  }
  if (input.style_options !== undefined && (stage !== 2 || !Number.isSafeInteger(input.style_options) || input.style_options < 2 || input.style_options > 3))
    throw new Error('style_options只用于方案阶段，为推荐的项目风格个数（2–3）')
  if (input.rhythm !== undefined && (stage !== 2 || !['beats_per_episode', 'compact', 'relaxed'].every(key => typeof input.rhythm?.[key] === 'number' && input.rhythm[key] > 0)))
    throw new Error('rhythm只用于方案阶段，beats_per_episode、compact、relaxed须为正数')
  const styleOptions = stage === 2 && input.style_options !== undefined ? input.style_options : state.style_options
  const rhythm = stage === 2 && input.rhythm !== undefined ? input.rhythm : state.rhythm
  const sourceInputs = stage ? state.source_inputs : input.source_paths
  const episodes = stage === 3 ? input.episodes : state.episodes
  let unused = state.unused
  // 完成时直接跳过切分账目：删减式改编的切分与剧本由程序组装，这里没有新的切分记录要对账。
  if (stage >= 3 && !assemblyJump) {
    if (!Array.isArray(episodes) || !episodes.length || episodes.some((number, index) => !Number.isSafeInteger(number) || number < 1 || number > 9999 || index && number !== episodes[index - 1] + 1)) throw new Error('需要连续且不重复的目标episodes集号')
    const order = new Map(chapters.map((item, index) => [`${item.source_path}\0${item.chapter_heading}`, index]))
    const used = new Map()
    let previous
    for (const number of episodes) {
      const path = `${root}/改编方案/分集切分/${episodeFolder(number)}原文.md`
      const cut = await verifiedCut(ctx, exec, (await adaptationFile(ctx, exec, path, agent)).text, agent)
      if (cut.episode_number !== number) throw new Error('切分与集号不一致')
      for (const item of cut.segments) {
        const key = `${item.source_path}\0${item.chapter_heading}`
        if (sources[item.source_path] !== item.source_hash || !order.has(key)) throw new Error('切分与原作不一致，或混入目标范围外的章节')
        if (!used.has(key)) used.set(key, [])
        used.get(key).push(item)
        if (item.flashback) continue
        const position = [order.get(key), item.start, item.end]
        if (previous && (position[0] < previous[0] || position[0] === previous[0] && position[1] < previous[2])) throw new Error(`第${number}集原文顺序颠倒或与前文重叠；只有倒叙片段（flashback）可以引用后文`)
        previous = position
      }
      if (stage === 3 && !outputs[path]) throw new Error('切分阶段须登记每集真实原文切分')
      if (stage >= 4) {
        // 默认交付删减后的分集剧本（漫剧直接读取）；可选的逐集改写产出剧本/第NNN集/分集剧本.md。
        const candidates = [`${root}/项目资料/分集剧本/第${number}集分集剧本.md`, `${root}/剧本/${episodeFolder(number)}/分集剧本.md`]
        const present = []
        for (const path of candidates) if ((await ctx.fs.stat(await ctx.fs.resolve(path, { cwd, signal: exec.signal }), exec.signal))?.type === 'file') present.push(path)
        if (!present.length) throw new Error(`第${number}集缺少分集剧本（项目资料/分集剧本）或改写剧本`)
        if (stage === 4 && !present.some(path => outputs[path])) throw new Error('逐集阶段须登记所有目标集的分集剧本')
      }
    }
    // 不要求全覆盖：列出目标章节中未被任何一集使用的原文行号，供删减清单核对。
    unused = []
    for (const target of chapters) {
      const source = await adaptationFile(ctx, exec, target.source_path, agent)
      const chapter = adaptationUnits(source.text).find(item => item.heading === target.chapter_heading)
      const lineOf = offset => source.text.slice(0, offset).split('\n').length
      let cursor = chapter.start
      const gaps = []
      for (const item of [...(used.get(`${target.source_path}\0${target.chapter_heading}`) || [])].sort((a, b) => a.start - b.start)) {
        if (item.start > cursor) gaps.push([cursor, item.start])
        cursor = Math.max(cursor, item.end)
      }
      gaps.push([cursor, chapter.end])
      for (const [from, to] of gaps) {
        const piece = source.text.slice(from, to), lead = piece.length - piece.trimStart().length, tail = piece.trimEnd().length
        if (tail > lead) unused.push({ source_path: target.source_path, chapter_heading: target.chapter_heading, start_line: lineOf(from + lead), end_line: lineOf(from + tail - 1) })
      }
    }
  }
  files[input.stage] = outputs
  return JSON.stringify({ stage: input.stage, status: stage === 5 ? 'completed' : input.status || 'running', reason: stage === 5 ? '' : input.reason || '', sources, chapters, files, episodes, ...(sourceInputs ? { source_inputs: sourceInputs } : {}), ...(plannedThrough ? { planned_through: plannedThrough } : {}), ...(eventEpisodes ? { event_episodes: eventEpisodes } : {}), ...(carryFrom ? { carry_from: carryFrom } : {}), ...(eventBeats ? { event_beats: eventBeats } : {}), ...(styleOptions ? { style_options: styleOptions } : {}), ...(rhythm ? { rhythm } : {}), ...(unused ? { unused } : {}) }, null, 2) + '\n'
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
      content: { type: 'string', description: '完成的正文；adaptation_cut/checkpoint按短剧流水线Skill传JSON；pipeline_checkpoint传JSON：stage、outputs路径数组、plan的source_path、engineering的duration_seconds、prompts的segments[{path,start_seconds,end_seconds,refs}]，Seedance的refs按@图顺序列资产ID如"角色/某人"。' },
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
        const content = route === 'short-drama' && args.source_block === undefined
          ? (await adaptationFile(ctx, exec, JSON.parse(args.content).source_path, sourceAgent, true)).text
          : selectWikiSource(sourceAgent, args)
        args = { ...args, content }
      }
      if (route === 'short-drama') await requireAdaptationReads(ctx, args, exec, contract, sourceAgent)
      if (route === 'manju') await requirePipelineReads(ctx, args, exec, sourceAgent)
      const value = await saveArtifact(ctx, args, exec, contract, route, sourceAgent)
      if (args.artifact_kind === 'pipeline_checkpoint') {
        const workspace = await ctx.fs.resolve(exec.agent.session.header.cwd, { cwd: exec.agent.session.header.cwd, signal: exec.signal })
        const target = await projectTarget(ctx, exec.agent.session.header.cwd, value.path, exec.signal, workspace)
        pipelineStates.set(sourceAgent, { ...JSON.parse(await ctx.fs.readText(target, exec.signal)), path: value.path })
      }
      if (args.artifact_kind === 'adaptation_checkpoint') {
        const target = await ctx.fs.resolve(value.path, { cwd: exec.agent.session.header.cwd, signal: exec.signal })
        adaptationStates.set(sourceAgent, { ...JSON.parse(await ctx.fs.readText(target, exec.signal)), path: value.path })
      }
      // 一遍标注：保存后由程序当场把已完成的事件组装成切分与分集剧本。
      const assembled = args.artifact_kind === 'adaptation_annotation'
        ? await assembleEpisodes(ctx, exec, contract, route, sourceAgent, value.wikiRoot, JSON.parse(await ctx.fs.readText(await ctx.fs.resolve(value.path, { cwd: exec.agent.session.header.cwd, signal: exec.signal }), exec.signal)))
        : undefined
      if (route === 'short-drama' && args.artifact_kind === 'episode_source_script' && value.adapted) await markAdapted(ctx, exec, value.wikiRoot, args.episode_number)
      return { status: value.status, path: value.path, operation: value.operation, warnings: value.warnings, ...(assembled ? { assembled } : {}) }
    },
  }
  for (const key of hidden) delete tool.parameters[key]
  return defineTool(tool)
}
