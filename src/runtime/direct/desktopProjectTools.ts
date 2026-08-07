import type { DirectToolExecutor, DirectToolResult } from './directTypes'
import {
  boundedInteger,
  createCreativeSkillSession,
  globMatcher,
  linesPage,
  normalizeCreativeProjectPath,
  parseCreativeToolArguments,
  WIKI_SEARCH_TOOL_DEFINITION,
} from './creativeToolContract'
import { executeMcpBridgeToolCall, isMcpToolName } from '@/runtime/tools/mcpBridge'
import { executeWikiAction, sha256Hex, type WikiWorkspace } from './wikiRuntime'
import { uint8ArrayToBase64 } from '@/utils/exportSave'
import {
  artifactFilename,
  createArtifactHtml,
  createDocumentArtifact,
  createMarkdownSlidesArtifact,
  renderMemoryArtifactImage,
  type MemoryImageRenderer,
} from '@/runtime/memory/memoryArtifactTools'
import { applyScene3DEdits, createScene3DDocument, parseScene3DDocument, scene3DResultMarker, serializeScene3DDocument, type Scene3DDocument } from '@/runtime/memory/scene3d'

type DesktopFileEntry = { path: string; isDir: boolean; size?: number | null }
type DesktopReadFile = { path: string; content: string; base64: string; size: number; truncated: boolean }
type Invoke = (command: string, payload: { input: Record<string, unknown> }) => Promise<any>
type TerminalAttachment = { name: string; inputPath: string }
export interface LocalCreativeSkill {
  content: string
  resources: string[]
  readResource: (path: string) => Promise<string>
}
type LocalSkillLoader = (name: string) => Promise<LocalCreativeSkill | null>

function resolveTerminalAttachments(command: string, attachments: TerminalAttachment[]): string {
  return command.replace(/\{\{attachment:([^}]+)\}\}/g, (_token, rawName) => {
    const name = String(rawName || '').trim()
    const attachment = attachments.find(item => item.name === name)
    if (!attachment?.inputPath) throw new Error(`当前对话附件不存在: ${name}`)
    return JSON.stringify(attachment.inputPath)
  })
}

function redactTerminalOutput(output: string, attachments: TerminalAttachment[]): string {
  return attachments.reduce(
    (value, attachment) => attachment.inputPath
      ? value.split(attachment.inputPath).join(`{{attachment:${attachment.name}}}`)
      : value,
    output,
  )
}

function localSkillBase(name: string): string {
  return `skill://local/${encodeURIComponent(name)}`
}

function localSkillOutput(name: string, skill: LocalCreativeSkill): string {
  const baseDirectory = localSkillBase(name)
  return [
    `<skill_content name="${name}">`,
    `# Skill: ${name}`,
    '',
    skill.content.trim(),
    '',
    `Base directory for this skill: ${baseDirectory}`,
    '<skill_files>',
    ...skill.resources.slice(0, 100).map(path => `<file>${path}</file>`),
    '</skill_files>',
    '</skill_content>',
  ].join('\n')
}

function mimeForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'svg') return 'image/svg+xml'
  if (extension === 'mp4') return 'video/mp4'
  if (extension === 'mov') return 'video/quicktime'
  if (extension === 'mp3') return 'audio/mpeg'
  if (extension === 'wav') return 'audio/wav'
  return 'text/plain'
}

function isTextPath(path: string): boolean {
  return !/\.(?:png|jpe?g|gif|webp|svg|mp4|mov|avi|mkv|mp3|wav|m4a|ogg|pdf)$/i.test(path)
}

function listDirectory(entries: DesktopFileEntry[], path: string): DesktopFileEntry[] {
  const prefix = path ? `${path}/` : ''
  return entries.filter(entry => entry.path.startsWith(prefix) && !entry.path.slice(prefix.length).includes('/'))
}

function isAbsolutePath(path: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path)
}

function joinToolPath(prefix: string, pattern: string): string {
  return prefix ? `${prefix.replace(/\/+$/, '')}/${pattern.replace(/^\/+/, '')}` : pattern
}

export function createDesktopProjectToolExecutor(input: {
  projectDir: string
  invoke?: Invoke
  fetcher?: typeof fetch
  loadSkill?: LocalSkillLoader
  attachments?: TerminalAttachment[]
  renderImage?: MemoryImageRenderer
  recordSceneVideo?: (document: Scene3DDocument) => Promise<Blob>
}): DirectToolExecutor {
  const root = String(input.projectDir || '').trim()
  const skills = createCreativeSkillSession(input.fetcher)
  const localSkills = new Map<string, LocalCreativeSkill>()
  let lastFailedTerminalCommand = ''

  async function invoke(command: string, payload: Record<string, unknown>) {
    if (input.invoke) return await input.invoke(command, { input: payload })
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke(command, { input: payload })
  }

  function requireProject() {
    if (!root) throw new Error('请先在第二列创建或选择项目')
    return root
  }

  async function listFiles(): Promise<DesktopFileEntry[]> {
    return await invoke('dev_list_files', { root: requireProject(), maxEntries: 1000 })
  }

  async function readFile(path: string): Promise<DesktopReadFile> {
    return await invoke('dev_read_file', { root: requireProject(), relativePath: path, maxBytes: 30_000_000 })
  }

  async function listExternalFiles(path: string): Promise<DesktopFileEntry[]> {
    return await invoke('dev_list_external_files', { path, maxEntries: 1000 })
  }

  async function readExternalFile(path: string): Promise<DesktopReadFile> {
    return await invoke('dev_read_external_file', { path, maxBytes: 30_000_000 })
  }

  async function writeGeneratedFile(path: string, data: Blob | Uint8Array | string): Promise<string> {
    const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data
    const encoded = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
    const result = await invoke('save_generated_file', {
      path: `${requireProject().replace(/[\\/]+$/, '')}/${path}`,
      dataBase64: uint8ArrayToBase64(encoded),
      keepBoth: true,
    })
    const rootPath = requireProject().replace(/\\/g, '/').replace(/\/+$/, '')
    const outputPath = String(result.path || '').replace(/\\/g, '/')
    return outputPath.startsWith(`${rootPath}/`) ? outputPath.slice(rootPath.length + 1) : path
  }

  const wikiWorkspace: WikiWorkspace = {
    async list() {
      return (await listFiles()).map(entry => ({ path: entry.path, isDir: entry.isDir }))
    },
    async read(path) {
      return (await readFile(path)).content
    },
    async fingerprint(path) {
      const file = await readFile(path)
      if (file.truncated) throw new Error(`文件超过 30 MB，无法计算完整指纹: ${path}`)
      return await sha256Hex(Uint8Array.from(atob(file.base64), char => char.charCodeAt(0)))
    },
    async write(path, content) {
      await invoke('dev_write_file', { root: requireProject(), relativePath: path, content })
    },
    async createDirectory(path) {
      await invoke('dev_create_dir', { root: requireProject(), relativePath: path })
    },
    async gitEvidence() {
      const status = await invoke('dev_run_command', {
        root: requireProject(), command: 'git status --short', workdir: '.', timeoutSeconds: 30,
      })
      const diff = await invoke('dev_run_command', {
        root: requireProject(), command: 'git diff --no-ext-diff --binary HEAD', workdir: '.', timeoutSeconds: 30,
      })
      if (Number(status.exitCode ?? status.exit_code) !== 0 || Number(diff.exitCode ?? diff.exit_code) !== 0) return null
      return { status: String(status.stdout || ''), diff: String(diff.stdout || '') }
    },
  }

  function renderReadFile(path: string, file: DesktopReadFile, args: Record<string, unknown>): DirectToolResult {
    const mime = mimeForPath(path)
    if (mime.startsWith('image/')) {
      return {
        content: `Image read successfully: ${path}`,
        followupMessages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${file.base64}` } }] }],
      }
    }
    if (!isTextPath(path)) {
      return { content: [`Binary ${mime.split('/')[0]} file: ${path}`, `MIME: ${mime}`, `Size: ${file.size} bytes`, `Path: ${path}`].join('\n') }
    }
    return { content: linesPage(file.content, args.offset, args.limit) }
  }

  return async (call): Promise<DirectToolResult> => {
    const args = parseCreativeToolArguments(call)
    const name = call.function.name

    if (name === 'skill') {
      const skillName = String(args.name)
      if (!input.loadSkill) return { content: await skills.load(skillName) }
      const skill = await input.loadSkill(skillName)
      if (skill?.content.trim()) {
        localSkills.set(localSkillBase(skillName), skill)
        return { content: localSkillOutput(skillName, skill) }
      }
      return { content: await skills.load(skillName) }
    }

    if (name === 'wiki') {
      return { content: await executeWikiAction(wikiWorkspace, args as any) }
    }

    if (name === WIKI_SEARCH_TOOL_DEFINITION.function.name) {
      return { content: await executeWikiAction(wikiWorkspace, { ...args, action: 'search' } as any) }
    }

    if (name === 'read') {
      const rawPath = String(args.path)
      const resource = await skills.read(rawPath)
      if (resource !== null) return { content: linesPage(resource, args.offset, args.limit) }
      const localEntry = [...localSkills.entries()].find(([base]) => rawPath.startsWith(`${base}/`))
      if (localEntry) {
        const [base, skill] = localEntry
        const relative = rawPath.slice(base.length + 1)
        if (!skill.resources.includes(relative)) throw new Error(`Skill 资源不存在: ${relative}`)
        return { content: linesPage(await skill.readResource(relative), args.offset, args.limit) }
      }
      if (rawPath.startsWith('skill://local/')) {
        const resources = [...localSkills.values()].flatMap(skill => skill.resources)
        throw new Error(`Skill 资源路径不匹配。请使用加载结果中的完整路径。可读取：${resources.join(', ') || '无'}`)
      }
      if (isAbsolutePath(rawPath)) {
        const entries = await listExternalFiles(rawPath)
        const matching = entries.find(entry => entry.path === rawPath)
        if (entries.length === 1 && !entries[0]!.isDir) {
          return renderReadFile(rawPath, await readExternalFile(rawPath), args)
        }
        if (!matching || matching.isDir) {
          const offset = boundedInteger(args.offset, 1)
          const limit = boundedInteger(args.limit, 200)
          const directory = matching?.path || entries.find(entry => entry.isDir)?.path || rawPath
          const children = listDirectory(entries, directory).slice(offset - 1, offset - 1 + limit)
          return { content: children.map(entry => `${entry.isDir ? 'dir' : 'file'}\t${entry.path}`).join('\n') || 'Directory is empty' }
        }
        return renderReadFile(rawPath, await readExternalFile(rawPath), args)
      }
      const path = normalizeCreativeProjectPath(rawPath, true)
      const entries = await listFiles()
      const matching = entries.find(entry => entry.path === path)
      if (!path || matching?.isDir) {
        const offset = boundedInteger(args.offset, 1)
        const limit = boundedInteger(args.limit, 200)
        const children = listDirectory(entries, path).slice(offset - 1, offset - 1 + limit)
        return { content: children.map(entry => `${entry.isDir ? 'dir' : 'file'}\t${entry.path}`).join('\n') || 'Directory is empty' }
      }
      return renderReadFile(path, await readFile(path), args)
    }

    if (name === 'glob') {
      const rawPrefix = String(args.path || '')
      const isExternal = isAbsolutePath(rawPrefix)
      const prefix = isExternal ? rawPrefix : normalizeCreativeProjectPath(rawPrefix, true)
      const pattern = joinToolPath(prefix, String(args.pattern))
      const entries = await (isExternal ? listExternalFiles(prefix) : listFiles())
      const result = isExternal
        ? (() => {
            const rootPath = entries.find(entry => entry.isDir)?.path || prefix
            const matcher = globMatcher(String(args.pattern))
            return entries.filter(entry => entry.path !== rootPath && matcher.test(entry.path.slice(rootPath.length + 1)))
          })()
        : entries.filter(entry => globMatcher(pattern).test(entry.path))
      return { content: result.slice(0, boundedInteger(args.limit, 200)).map(entry => entry.path).join('\n') || 'No files found' }
    }

    if (name === 'grep') {
      let matcher: RegExp
      try { matcher = new RegExp(String(args.pattern), 'u') } catch { throw new Error('搜索表达式无效') }
      const rawPrefix = String(args.path || '')
      const isExternal = isAbsolutePath(rawPrefix)
      const prefix = isExternal ? rawPrefix : normalizeCreativeProjectPath(rawPrefix, true)
      const include = String(args.include || '').replace(/^\*+/, '')
      const limit = boundedInteger(args.limit, 1000)
      const matches: Array<{ path: string; line: number; text: string }> = []
      const entries = await (isExternal ? listExternalFiles(prefix) : listFiles())
      const externalRoot = isExternal ? entries.find(entry => entry.isDir)?.path || prefix : ''
      for (const entry of entries) {
        const inPrefix = isExternal
          ? entry.path === externalRoot || entry.path.startsWith(`${externalRoot}/`)
          : !prefix || entry.path === prefix || entry.path.startsWith(`${prefix}/`)
        if (entry.isDir || !isTextPath(entry.path) || !inPrefix || (include && !entry.path.endsWith(include))) continue
        const file = await (isExternal ? readExternalFile(entry.path) : readFile(entry.path))
        for (const [index, line] of file.content.split(/\r?\n/).entries()) {
          matcher.lastIndex = 0
          if (matcher.test(line)) matches.push({ path: entry.path, line: index + 1, text: line })
          if (matches.length >= limit) break
        }
        if (matches.length >= limit) break
      }
      return { content: matches.length ? ['Found ' + matches.length + ' matches', ...matches.map(match => `${match.path}: Line ${match.line}: ${match.text}`)].join('\n') : 'No files found' }
    }

    if (name === 'write') {
      const rawPath = String(args.path)
      const external = isAbsolutePath(rawPath)
      const path = external ? rawPath : normalizeCreativeProjectPath(rawPath)
      const file = await invoke(external ? 'dev_write_external_file' : 'dev_write_file', external
        ? { path, content: String(args.content) }
        : { root: requireProject(), relativePath: path, content: String(args.content) })
      return { content: `Wrote file successfully: ${String(file.path || path)}` }
    }

    if (name === 'edit') {
      const rawPath = String(args.path)
      const external = isAbsolutePath(rawPath)
      const path = external ? rawPath : normalizeCreativeProjectPath(rawPath)
      const result = await invoke(external ? 'dev_replace_in_external_file' : 'dev_replace_in_file', external
        ? { path, oldText: String(args.oldString), newText: String(args.newString), replaceAll: args.replaceAll === true }
        : { root: requireProject(), relativePath: path, oldText: String(args.oldString), newText: String(args.newString), replaceAll: args.replaceAll === true })
      return { content: `Edited file successfully: ${path}\nReplacements: ${Number(result.replacements || 0)}` }
    }

    if (name === 'mkdir') {
      const path = normalizeCreativeProjectPath(String(args.path))
      await invoke('dev_create_dir', { root: requireProject(), relativePath: path, content: '' })
      return { content: `已创建文件夹: ${path}` }
    }

    if (name === 'move') {
      const path = normalizeCreativeProjectPath(String(args.path))
      const destination = normalizeCreativeProjectPath(String(args.destination))
      const moved = await invoke('dev_rename_file', {
        root: requireProject(), oldRelativePath: path, newRelativePath: destination,
      })
      return { content: `已移动: ${path} -> ${String(moved || destination)}` }
    }

    if (name === 'delete') {
      const path = normalizeCreativeProjectPath(String(args.path))
      const result = await invoke('dev_delete_file', { root: requireProject(), relativePath: path })
      return { content: result.status === 'missing' ? `文件不存在，未删除: ${path}` : `已移入废纸篓: ${path}` }
    }

    if (name === 'export_markdown_png') {
      const blob = await (input.renderImage || renderMemoryArtifactImage)({
        title: String(args.title), content: String(args.content), width: args.width as number | undefined,
      })
      const path = await writeGeneratedFile(`.raw/jc-media/图片/${artifactFilename(String(args.title), 'png')}`, blob)
      return { content: `已导出 Markdown 图片: ${path}` }
    }

    if (name === 'create_document') {
      const artifact = createDocumentArtifact(String(args.title), String(args.content), String(args.format) as 'docx' | 'md' | 'txt')
      const path = await writeGeneratedFile(`.raw/jc-media/文档/${artifact.filename}`, artifact.data)
      return { content: `已生成文档: ${path}` }
    }

    if (name === 'create_html') {
      const path = await writeGeneratedFile(
        `.raw/jc-media/文档/${artifactFilename(String(args.title), 'html')}`,
        createArtifactHtml(String(args.title), String(args.content)),
      )
      return { content: `已生成 HTML: ${path}` }
    }

    if (name === 'export_markdown_slides') {
      const artifact = await createMarkdownSlidesArtifact(String(args.title), String(args.content), String(args.format) as 'html' | 'pdf' | 'pptx')
      const path = await writeGeneratedFile(`.raw/jc-media/文档/${artifact.filename}`, artifact.data)
      return { content: `已生成 Markdown 幻灯片: ${path}` }
    }

    if (name === 'create_3d_scene') {
      const scene = createScene3DDocument(args)
      const existingPath = String(args.existingPath || '')
      if (existingPath && !/^\.raw\/jc-media\/文档\/[^/]+\.jcscene$/i.test(existingPath)) throw new Error('已有白膜场景路径无效')
      const content = serializeScene3DDocument(scene)
      const path = existingPath
        ? (await invoke('dev_write_file', { root: requireProject(), relativePath: existingPath, content }), existingPath)
        : await writeGeneratedFile(`.raw/jc-media/文档/${artifactFilename(scene.title, 'jcscene')}`, content)
      return { content: `已生成 3D 白膜场景: ${path}\n${scene3DResultMarker({ path, title: scene.title, objectCount: scene.objects.length, formationCount: scene.formations.length })}` }
    }

    if (name === 'edit_3d_scene') {
      const path = normalizeCreativeProjectPath(String(args.path))
      if (!/^\.raw\/jc-media\/文档\/[^/]+\.jcscene$/i.test(path)) throw new Error('白膜场景路径无效')
      const scene = parseScene3DDocument(JSON.parse((await readFile(path)).content))
      const next = applyScene3DEdits(scene, args.operations)
      await invoke('dev_write_file', { root: requireProject(), relativePath: path, content: serializeScene3DDocument(next) })
      return { content: `已增量修改 3D 白膜场景: ${path}\n${scene3DResultMarker({ path, title: next.title, objectCount: next.objects.length, formationCount: next.formations.length })}` }
    }

    if (name === 'export_3d_scene_video') {
      const path = normalizeCreativeProjectPath(String(args.path))
      if (!/^\.raw\/jc-media\/文档\/[^/]+\.jcscene$/i.test(path)) throw new Error('动画场景路径无效')
      if (!input.recordSceneVideo) throw new Error('当前环境不能录制 3D 动画')
      const scene = parseScene3DDocument(JSON.parse((await readFile(path)).content))
      const recording = await input.recordSceneVideo(scene)
      const result = await invoke('dev_export_scene_video', {
        root: requireProject(), dataBase64: uint8ArrayToBase64(new Uint8Array(await recording.arrayBuffer())),
        mimeType: recording.type, outputFilename: artifactFilename(scene.title, 'mp4'),
      })
      return { content: `已导出 3D 动画 MP4: ${String(result.path || '')}` }
    }

    if (name === 'terminal') {
      const command = String(args.command || '').trim()
      if (command && command === lastFailedTerminalCommand) {
        return {
          content: '这条命令刚刚失败。不要原样重复失败命令；请根据上次输出改用替代命令、Skill 降级方案，或安装缺失依赖后验证再重试。',
          status: 'failed',
        }
      }
      const resolvedCommand = resolveTerminalAttachments(command, input.attachments || [])
      const rawWorkdir = String(args.workdir || '')
      const externalWorkdir = isAbsolutePath(rawWorkdir) ? rawWorkdir : undefined
      const workdir = externalWorkdir ? undefined : normalizeCreativeProjectPath(rawWorkdir, true) || '.'
      const result = await invoke('dev_run_command', {
        root: requireProject(),
        command: resolvedCommand,
        workdir,
        externalWorkdir,
        timeoutSeconds: boundedInteger(args.timeoutSeconds, 120, 900),
      })
      const exitCode = result.exitCode ?? result.exit_code ?? 'unknown'
      const stdout = redactTerminalOutput(String(result.stdout || '').trim(), input.attachments || [])
      const stderr = redactTerminalOutput(String(result.stderr || '').trim(), input.attachments || [])
      const duration = Number(result.durationMs ?? result.duration_ms ?? 0)
      const succeeded = Number(exitCode) === 0
      lastFailedTerminalCommand = succeeded ? '' : command
      return { content: [
        `Command: ${command}`,
        `Exit code: ${exitCode}`,
        `Duration: ${duration}ms`,
        stdout && `stdout:\n${stdout}`,
        stderr && `stderr:\n${stderr}`,
      ].filter(Boolean).join('\n'), status: succeeded ? 'succeeded' : 'failed' }
    }

    if (isMcpToolName(name)) {
      return { content: await executeMcpBridgeToolCall(name, args) }
    }

    throw new Error(`Unsupported tool: ${name}`)
  }
}
