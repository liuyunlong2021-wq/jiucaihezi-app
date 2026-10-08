import { join, posix } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['saved'], required: true },
    path: { type: 'string', required: true },
    operation: { type: 'string', enum: ['created', 'updated'], required: true },
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

function normalizedMarkdown(content) {
  const normalized = content.replace(/\r\n/g, '\n').trimEnd()
  if (!normalized.trim()) throw new Error('产物内容不能为空')
  if (Buffer.byteLength(normalized, 'utf8') > 1_000_000) throw new Error('单份漫剧产物不能超过 1 MB')
  return `${normalized}\n`
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

function artifactSpec(args) {
  const episodeKinds = new Set(['screenplay', 'engineering_script', 'video_prompt'])
  const entityKinds = new Map([
    ['character_bio', ['项目资料/人物小传', '人物小传']],
    ['character_asset', ['资产/角色', '角色']],
    ['scene_asset', ['资产/场景', '场景']],
    ['prop_asset', ['资产/道具', '道具']],
  ])
  let path
  let index
  let label
  let episode
  let modelFolder
  let entityFolder

  switch (args.artifact_kind) {
    case 'story_summary': path = '项目资料/故事梗概.md'; index = '项目资料/index.md'; label = '故事梗概'; break
    case 'episode_summaries': path = '项目资料/分集梗概.md'; index = '项目资料/index.md'; label = '分集梗概'; break
    case 'story_background': path = '项目资料/故事背景.md'; index = '项目资料/index.md'; label = '故事背景'; break
    case 'world_rules': path = '项目资料/世界规则.md'; index = '项目资料/index.md'; label = '世界规则'; break
    case 'project_overview': path = '改编方案/项目总纲.md'; index = '改编方案/index.md'; label = '项目总纲'; break
    case 'screenplay':
    case 'engineering_script':
    case 'video_prompt': {
      episode = episodeFolder(args.episode_number)
      const episodePath = `剧本/${episode}`
      if (args.artifact_kind === 'screenplay') {
        path = `${episodePath}/分集剧本.md`
        label = `${episode}分集剧本`
      } else if (args.artifact_kind === 'engineering_script') {
        path = `${episodePath}/工程剧本.md`
        label = `${episode}工程剧本`
      } else {
        if (!['H3', 'Seedance'].includes(args.video_model)) throw new Error('video_model 必须是 H3 或 Seedance')
        modelFolder = args.video_model
        const segment = safeName(args.segment, 'segment')
        path = `${episodePath}/视频提示词/${modelFolder}/${segment}.md`
        label = `${episode}${modelFolder} ${segment}`
      }
      index = '剧本/index.md'
      break
    }
    default: {
      const entity = entityKinds.get(args.artifact_kind)
      if (!entity) throw new Error(`不支持的漫剧产物类型：${args.artifact_kind}`)
      entityFolder = entity[0]
      const name = safeName(args.entity_name, 'entity_name')
      path = `${entityFolder}/${name}.md`
      index = `${entityFolder}/index.md`
      label = name
    }
  }

  if (episodeKinds.has(args.artifact_kind) && !episode) throw new Error('缺少 episode_number')
  if (entityKinds.has(args.artifact_kind) && !args.entity_name?.trim()) throw new Error('缺少 entity_name')
  const mode = args.write_mode || 'create'
  if (!['create', 'update', 'append'].includes(mode)) throw new Error('write_mode 必须是 create、update 或 append')
  if (mode === 'append' && !entityKinds.has(args.artifact_kind))
    throw new Error('write_mode=append 只用于同一人物、角色、场景或道具档案新增独立章节')
  const sectionName = mode === 'append' ? safeName(args.section_name, 'section_name') : ''
  return { path, index, label, episode, modelFolder, entityFolder, mode, sectionName, kind: args.artifact_kind }
}

function relativeIndexLink(indexPath, targetPath, label) {
  const target = posix.relative(posix.dirname(indexPath), targetPath).replace(/\.md$/i, '')
  return `- [[${target}|${label}]]`
}

async function projectTarget(ctx, cwd, relativePath, signal, workspace) {
  const parts = relativePath.split('/').filter(Boolean)
  if (!parts.length || parts.some(part => part === '.' || part === '..')) throw new Error('目标路径不在漫剧文件范围内')
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

async function writePath(ctx, args, exec, cwd, workspace, policy, relativePath, content, mode = 'create') {
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

async function appendIndexLink(ctx, exec, cwd, workspace, policy, indexPath, targetPath, label) {
  const link = relativeIndexLink(indexPath, targetPath, label)
  const targetKey = link.slice(link.indexOf('[[') + 2, link.indexOf('|'))
  const target = await projectTarget(ctx, cwd, indexPath, exec.signal, workspace)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const info = await ctx.fs.stat(target, exec.signal)
    if (!info || info.type !== 'file') throw new Error(`索引文件不可用：${indexPath}`)
    const current = await ctx.fs.readText(target, exec.signal)
    if (current.includes(`[[${targetKey}|`)) return
    const next = `${current.trimEnd()}\n\n${link}\n`
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

async function chooseWikiRoot(ctx, cwd, exec, workspace) {
  const candidates = ['wiki', 'docs/wiki']
  const roots = []
  for (const path of candidates) {
    const target = await projectTarget(ctx, cwd, path, exec.signal, workspace)
    const info = await ctx.fs.stat(target, exec.signal)
    if (!info) { roots.push({ path, kind: 'missing', actual: false }); continue }
    if (info.type !== 'directory') { roots.push({ path, kind: 'occupied', actual: false }); continue }
    const entries = await ctx.fs.listDir(target, exec.signal)
    const markers = new Set(entries.map(entry => entry.name))
    const markerCount = ['原始材料', '项目资料', '改编方案'].filter(name => markers.has(name)).length
    const supportingMarker = ['剧本', '资产'].some(name => markers.has(name))
    const progress = markers.has('制作进度.md')
    roots.push({ path, kind: 'directory', actual: markerCount >= 2 || (progress && (markerCount >= 1 || supportingMarker)) })
  }
  const actual = roots.filter(root => root.actual)
  if (actual.length > 1) throw new Error('检测到 wiki/ 与 docs/wiki/ 两套漫剧 Wiki，未自动选择。请先明确保留哪一套。')
  if (actual.length === 1) return actual[0].path
  const wiki = roots[0]
  if (wiki.kind === 'occupied') throw new Error('wiki 路径被普通文件占用，无法建立漫剧 Wiki。')
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

async function ensureScaffold(ctx, args, exec, cwd, workspace, policy, wikiRoot) {
  const staticIndexes = [
    { path: `${wikiRoot}/index.md`, content: ROOT_INDEX },
    { path: `${wikiRoot}/制作进度.md`, content: PROGRESS_INDEX },
    ...ROOT_INDEXES.map(item => ({ path: `${wikiRoot}/${item.path}`, content: folderIndex(item) })),
    { path: `${wikiRoot}/项目资料/index.md`, content: PROJECT_MATERIALS_INDEX },
    { path: `${wikiRoot}/资产/index.md`, content: ASSET_INDEX },
  ]
  for (const item of staticIndexes)
    await ensureFile(ctx, args, exec, cwd, workspace, policy, item.path, item.content)
}

function indexEntries(spec, wikiRoot) {
  const index = `${wikiRoot}/${spec.index}`
  const target = `${wikiRoot}/${spec.path}`
  const entries = [{ index, target, label: spec.label }]
  if (spec.episode) {
    const episodePath = `剧本/${spec.episode}`
    entries.push({ index: `${wikiRoot}/剧本/index.md`, target: `${wikiRoot}/${episodePath}/index.md`, label: spec.episode })
    entries.push({ index: `${wikiRoot}/${episodePath}/index.md`, target: `${wikiRoot}/${episodePath}/视频提示词/index.md`, label: '视频提示词' })
    if (spec.kind === 'screenplay' || spec.kind === 'engineering_script')
      entries.push({ index: `${wikiRoot}/${episodePath}/index.md`, target, label: spec.label })
  }
  if (spec.modelFolder) {
    const promptRoot = `剧本/${spec.episode}/视频提示词`
    entries.push({ index: `${wikiRoot}/${promptRoot}/index.md`, target: `${wikiRoot}/${promptRoot}/${spec.modelFolder}/index.md`, label: spec.modelFolder })
    entries.push({ index: `${wikiRoot}/${promptRoot}/${spec.modelFolder}/index.md`, target, label: spec.label })
  }
  entries.push({ index: `${wikiRoot}/制作进度.md`, target, label: spec.label })
  return entries
}

async function saveArtifact(ctx, args, exec) {
  const cwd = exec.agent?.session?.header?.cwd
  if (typeof cwd !== 'string' || !cwd) throw new Error('漫剧产物必须保存到当前项目，请先打开项目目录。')
  const workspace = await ctx.fs.resolve(cwd, { cwd, signal: exec.signal })
  const policyService = ctx.get('sandboxPolicy')
  if (ctx.fs.sandboxMode !== undefined && !policyService)
    throw new Error('漫剧产物保存失败：当前文件系统缺少沙箱策略服务。')
  const policy = policyService?.resolve({ session: exec.agent.session })
  const spec = artifactSpec(args)
  const content = normalizedMarkdown(args.content)
  const wikiRoot = await chooseWikiRoot(ctx, cwd, exec, workspace)

  const operation = await writePath(ctx, args, exec, cwd, workspace, policy,
    `${wikiRoot}/${spec.path}`, content, spec.mode)

  // 业务文件已可靠读回。索引异常只降级为警告，不能把已保存的产物伪报成失败。
  const indexWarnings = []
  try {
    await ensureScaffold(ctx, args, exec, cwd, workspace, policy, wikiRoot)
  } catch (error) {
    indexWarnings.push(`${wikiRoot}/: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (spec.episode) {
    const episodeRoot = `${wikiRoot}/剧本/${spec.episode}`
    try {
      await ensureFile(ctx, args, exec, cwd, workspace, policy, `${episodeRoot}/index.md`, episodeIndex(spec.episode))
      await ensureFile(ctx, args, exec, cwd, workspace, policy, `${episodeRoot}/视频提示词/index.md`, promptIndex(spec.episode))
      if (spec.modelFolder)
        await ensureFile(ctx, args, exec, cwd, workspace, policy,
          `${episodeRoot}/视频提示词/${spec.modelFolder}/index.md`, modelIndex(spec.episode, spec.modelFolder))
    } catch (error) {
      indexWarnings.push(`${episodeRoot}/: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  for (const entry of indexEntries(spec, wikiRoot)) {
    try {
      await appendIndexLink(ctx, exec, cwd, workspace, policy,
        entry.index, entry.target, entry.label)
    } catch (error) {
      indexWarnings.push(`${entry.index}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (indexWarnings.length) console.warn('[manju-wiki] saved with index warnings:', indexWarnings)
  return { status: 'saved', path: `${wikiRoot}/${spec.path}`, operation, indexWarnings }
}

export function createManjuArtifactTool(ctx) {
  if (!ctx.fs || !ctx.tools) throw new Error('漫剧产物保存工具缺少 Harness 文件或工具服务')
  if (ctx.fs.sandboxMode !== undefined && !ctx.get('sandboxPolicy'))
    throw new Error('漫剧产物保存工具缺少 Harness 沙箱策略')
  return defineTool({
    name: 'manju_save_artifact',
    description: '把已经完成的漫剧制作交付物按固定类型保存到当前项目 Wiki，并更新文件树索引。只保存用户本轮要求的产物，不接收任意文件路径。',
    parameters: {
      artifact_kind: {
        type: 'string', required: true,
        enum: ['story_summary', 'episode_summaries', 'story_background', 'world_rules', 'character_bio', 'project_overview', 'screenplay', 'engineering_script', 'character_asset', 'scene_asset', 'prop_asset', 'video_prompt'],
        description: '产物类型，决定唯一保存目录。',
      },
      content: { type: 'string', required: true, description: '本次完成的整份 Markdown 产物正文。' },
      episode_number: { type: 'integer', description: '分集剧本、工程剧本或视频提示词对应的集数。' },
      entity_name: { type: 'string', description: '人物、角色、场景或道具名称。' },
      video_model: { type: 'string', enum: ['H3', 'Seedance'], description: '视频提示词使用的模型分支。' },
      segment: { type: 'string', description: '视频提示词的片段或镜头范围，如 片段001-003。' },
      write_mode: { type: 'string', enum: ['create', 'update', 'append'], description: '默认 create；update 替换完整文件，append 保留现有文件并新增章节。' },
      section_name: { type: 'string', description: 'write_mode=append 时用于新章节的标题。' },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const value = await saveArtifact(ctx, args, exec)
      return { status: value.status, path: value.path, operation: value.operation, warnings: value.indexWarnings }
    },
  })
}
