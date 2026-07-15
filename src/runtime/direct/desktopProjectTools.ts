import type { DirectToolExecutor, DirectToolResult } from './directTypes'
import {
  boundedInteger,
  createCreativeSkillSession,
  globMatcher,
  linesPage,
  normalizeCreativeProjectPath,
  parseCreativeToolArguments,
} from './creativeToolContract'

type DesktopFileEntry = { path: string; isDir: boolean; size?: number | null }
type DesktopReadFile = { path: string; content: string; base64: string; size: number; truncated: boolean }
type Invoke = (command: string, payload: { input: Record<string, unknown> }) => Promise<any>

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

export function createDesktopProjectToolExecutor(input: {
  projectDir: string
  invoke?: Invoke
  fetcher?: typeof fetch
}): DirectToolExecutor {
  const root = String(input.projectDir || '').trim()
  const skills = createCreativeSkillSession(input.fetcher)

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

  return async (call): Promise<DirectToolResult> => {
    const args = parseCreativeToolArguments(call)
    const name = call.function.name

    if (name === 'skill') return { content: await skills.load(String(args.name)) }

    if (name === 'read') {
      const rawPath = String(args.path)
      const resource = await skills.read(rawPath)
      if (resource !== null) return { content: linesPage(resource, args.offset, args.limit) }
      const path = normalizeCreativeProjectPath(rawPath, true)
      const entries = await listFiles()
      const matching = entries.find(entry => entry.path === path)
      if (!path || matching?.isDir) {
        const offset = boundedInteger(args.offset, 1)
        const limit = boundedInteger(args.limit, 200)
        const children = listDirectory(entries, path).slice(offset - 1, offset - 1 + limit)
        return { content: children.map(entry => `${entry.isDir ? 'dir' : 'file'}\t${entry.path}`).join('\n') || 'Directory is empty' }
      }
      const file = await readFile(path)
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

    if (name === 'glob') {
      const prefix = normalizeCreativeProjectPath(String(args.path || ''), true)
      const pattern = prefix ? `${prefix}/${String(args.pattern)}` : String(args.pattern)
      const result = (await listFiles()).filter(entry => globMatcher(pattern).test(entry.path))
      return { content: result.slice(0, boundedInteger(args.limit, 200)).map(entry => entry.path).join('\n') || 'No files found' }
    }

    if (name === 'grep') {
      let matcher: RegExp
      try { matcher = new RegExp(String(args.pattern), 'u') } catch { throw new Error('搜索表达式无效') }
      const prefix = normalizeCreativeProjectPath(String(args.path || ''), true)
      const include = String(args.include || '').replace(/^\*+/, '')
      const limit = boundedInteger(args.limit, 1000)
      const matches: Array<{ path: string; line: number; text: string }> = []
      for (const entry of await listFiles()) {
        if (entry.isDir || !isTextPath(entry.path) || (prefix && entry.path !== prefix && !entry.path.startsWith(`${prefix}/`)) || (include && !entry.path.endsWith(include))) continue
        const file = await readFile(entry.path)
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
      const path = normalizeCreativeProjectPath(String(args.path))
      const file = await invoke('dev_write_file', { root: requireProject(), relativePath: path, content: String(args.content) })
      return { content: `Wrote file successfully: ${String(file.path || path)}` }
    }

    if (name === 'edit') {
      const path = normalizeCreativeProjectPath(String(args.path))
      const result = await invoke('dev_replace_in_file', {
        root: requireProject(), relativePath: path, oldText: String(args.oldString), newText: String(args.newString), replaceAll: args.replaceAll === true,
      })
      return { content: `Edited file successfully: ${path}\nReplacements: ${Number(result.replacements || 0)}` }
    }

    throw new Error(`Unsupported tool: ${name}`)
  }
}
