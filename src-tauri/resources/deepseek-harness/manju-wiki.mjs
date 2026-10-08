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
    '用途：统一管理本项目的创作规划、来源材料、漫剧制作资料与可复用资产。',
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
    .replace(/[\r\n|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const clipped = [...summary].slice(0, 160).join('')
  return clipped || `${label}正文。`
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
  const template = contract.types[args.artifact_kind]
  if (!template) throw new Error(`不支持的 Wiki 产物类型：${args.artifact_kind}`)
  const values = {}
  if (template.episode) values.episode = episodeFolder(args.episode_number)
  if (template.entity) values.entity = safeName(args.entity_name, 'entity_name')
  if (template.model) {
    if (!template.model.includes(args.video_model)) throw new Error(`video_model 必须是 ${template.model.join(' 或 ')}`)
    values.model = args.video_model
  }
  if (template.path.includes('{segment}')) values.segment = safeName(args.segment, 'segment')
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
    const existingLine = lines.findIndex(line => line.includes(`[[${targetKey}|`))
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
  return entries
}

async function ensureDynamicIndexes(ctx, args, exec, cwd, workspace, policy, wikiRoot, spec, contract) {
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

async function saveArtifact(ctx, args, exec, contract) {
  const cwd = exec.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || !cwd) throw new Error('Wiki 产物必须保存到当前项目，请先打开项目目录。')
  const workspace = await ctx.fs.resolve(cwd, { cwd, signal: exec.signal })
  const policyService = ctx.get('sandboxPolicy')
  if (ctx.fs.sandboxMode !== undefined && !policyService)
    throw new Error('Wiki 产物保存失败：当前文件系统缺少沙箱策略服务。')
  const policy = policyService?.resolve({ session: exec.agent.session })
  const spec = artifactSpec(args, contract)
  const content = normalizedMarkdown(args.content)
  spec.summary = indexSummary(args.summary, content, spec.label)
  const wikiRoot = await chooseWikiRoot(ctx, cwd, exec, workspace, contract)

  let saved
  if (spec.mode === 'chapter_source') {
    saved = await saveConfirmedChapter(ctx, args, exec, cwd, workspace, policy, wikiRoot, spec, content)
  } else {
    const pageContent = spec.mode === 'chapter_draft' ? chapterDocument(spec, content) : content
    const operation = await writePath(ctx, args, exec, cwd, workspace, policy,
      `${wikiRoot}/${spec.path}`, pageContent, spec.writeMode)
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

export function createWikiArtifactTool(ctx, contract) {
  if (!ctx.fs || !ctx.tools) throw new Error('Wiki 归档工具缺少 Harness 文件或工具服务')
  if (ctx.fs.sandboxMode !== undefined && !ctx.get('sandboxPolicy'))
    throw new Error('Wiki 归档工具缺少 Harness 沙箱策略')
  return defineTool({
    name: 'wiki_save_artifact',
    description: '把已完成且用户要求保存的漫剧或小说产物，按固定类型写入当前项目统一 Wiki 并更新直属索引。不得接收任意路径。小说章节先保存草稿，只有用户明确确认后才能追加到原文。',
    parameters: {
      artifact_kind: {
        type: 'string', required: true,
        enum: Object.keys(contract.types),
        description: '产物类型，决定唯一保存目录。',
      },
      content: { type: 'string', required: true, description: '本次完成的 Markdown 正文。小说章节传章节正文，不含工具自动生成的章标题。' },
      summary: { type: 'string', description: '一条简短、可检索的内容摘要；缺省时由工具提取正文首个有效句。' },
      episode_number: { type: 'integer', description: '分集剧本、工程剧本或视频提示词对应的集数。' },
      entity_name: { type: 'string', description: '人物、角色、场景或道具名称。' },
      video_model: { type: 'string', enum: ['H3', 'Seedance'], description: '视频提示词使用的模型分支。' },
      segment: { type: 'string', description: '视频提示词的片段或镜头范围，如 片段001-003。' },
      write_mode: { type: 'string', enum: ['create', 'update', 'append'], description: '默认 create；update 替换完整文件，append 保留现有文件并新增章节。' },
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
      const value = await saveArtifact(ctx, args, exec, contract)
      return { status: value.status, path: value.path, operation: value.operation, warnings: value.warnings }
    },
  })
}
