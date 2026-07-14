import type { FileEntry } from '@/composables/useFileStore'
import { getAll, getRecord, removeRecord, setRecord } from '@/utils/idb'

export interface WebProjectRecordAdapter {
  all(): Promise<FileEntry[]>
  get(id: string): Promise<FileEntry | undefined>
  put(entry: FileEntry): Promise<void>
  remove(id: string): Promise<void>
}

export interface WebProjectListEntry {
  id: string
  path: string
  isDir: boolean
  size: number
  mimeType: string
  content: string
}

export interface WebProjectGrepMatch {
  path: string
  line: number
  text: string
}

const projectAdapter: WebProjectRecordAdapter = {
  async all() { return await getAll('documents') as FileEntry[] },
  async get(id) { return await getRecord('documents', id) as FileEntry | undefined },
  async put(entry) { await setRecord('documents', entry) },
  async remove(id) { await removeRecord('documents', id) },
}

function makeId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `${prefix}_${uuid || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`}`
}

function normalizePath(input: string, allowRoot = false): string {
  const raw = String(input || '').replace(/\\/g, '/')
  if (raw.startsWith('/') || raw.includes('\0')) throw new Error('项目路径无效')
  const parts = raw.split('/').filter(part => part && part !== '.')
  if (parts.some(part => part === '..')) throw new Error('项目路径不能越过项目根目录')
  const path = parts.join('/')
  if (!path && !allowRoot) throw new Error('项目路径不能为空')
  return path
}

function entryPath(entry: FileEntry): string {
  return String(entry.metadata?.relativePath || '')
}

function entryProjectId(entry: FileEntry): string {
  return String(entry.metadata?.projectId || '')
}

function isFolder(entry: FileEntry): boolean {
  return entry.mimeType === 'folder' || entry.metadata?.isFolder === true
}

function mimeForPath(path: string): string {
  const extension = path.split('.').pop()?.toLowerCase()
  if (extension === 'md' || extension === 'markdown') return 'text/markdown'
  if (extension === 'json') return 'application/json'
  if (extension === 'csv') return 'text/csv'
  if (extension === 'html') return 'text/html'
  return 'text/plain'
}

function comparePath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function globRegex(pattern: string): RegExp {
  const value = normalizePath(pattern)
  let source = '^'
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '*' && value[index + 1] === '*') {
      if (value[index + 2] === '/') {
        source += '(?:.*/)?'
        index += 2
      } else {
        source += '.*'
        index += 1
      }
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`, 'u')
}

export function createWebProjectFiles(adapter: WebProjectRecordAdapter = projectAdapter) {
  async function allProjectEntries(projectId: string): Promise<FileEntry[]> {
    const root = await adapter.get(projectId)
    if (!root || root.metadata?.kind !== 'project-root') throw new Error('Web 项目不存在')
    return (await adapter.all()).filter(entry => entryProjectId(entry) === projectId && entry.id !== projectId)
  }

  async function findEntry(projectId: string, rawPath: string): Promise<FileEntry | undefined> {
    const path = normalizePath(rawPath)
    return (await allProjectEntries(projectId)).find(entry => entryPath(entry) === path)
  }

  async function ensureParents(projectId: string, path: string): Promise<string> {
    const parts = normalizePath(path).split('/').slice(0, -1)
    const entries = await allProjectEntries(projectId)
    let parentId = projectId
    let current = ''
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      let folder = entries.find(entry => entryPath(entry) === current)
      if (folder && !isFolder(folder)) throw new Error(`父路径不是文件夹: ${current}`)
      if (!folder) {
        const now = Date.now()
        folder = {
          id: makeId('webdir'),
          category: 'text',
          name: part,
          content: '',
          mimeType: 'folder',
          size: 0,
          folderId: parentId,
          createdAt: now,
          updatedAt: now,
          metadata: { kind: 'project-folder', isFolder: true, projectId, relativePath: current },
        }
        await adapter.put(folder)
        entries.push(folder)
      }
      parentId = folder.id
    }
    return parentId
  }

  async function listProjects(): Promise<FileEntry[]> {
    return (await adapter.all())
      .filter(entry => entry.metadata?.kind === 'project-root')
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  async function createProject(name: string): Promise<FileEntry> {
    const cleanName = String(name || '').trim()
    if (!cleanName) throw new Error('项目名称不能为空')
    const now = Date.now()
    const id = makeId('webproject')
    const project: FileEntry = {
      id,
      category: 'project',
      name: cleanName,
      content: '',
      mimeType: 'folder',
      size: 0,
      createdAt: now,
      updatedAt: now,
      metadata: { kind: 'project-root', isFolder: true, projectId: id, relativePath: '' },
    }
    await adapter.put(project)
    return project
  }

  async function list(projectId: string): Promise<WebProjectListEntry[]> {
    return (await allProjectEntries(projectId))
      .map(entry => ({
        id: entry.id,
        path: entryPath(entry),
        isDir: isFolder(entry),
        size: entry.size || 0,
        mimeType: entry.mimeType,
        content: entry.content,
      }))
      .sort((a, b) => comparePath(a.path, b.path))
  }

  async function read(projectId: string, path: string): Promise<FileEntry> {
    const entry = await findEntry(projectId, path)
    if (!entry) throw new Error(`文件不存在: ${normalizePath(path)}`)
    return entry
  }

  async function createFolder(projectId: string, path: string): Promise<FileEntry> {
    const normalized = normalizePath(path)
    const existing = await findEntry(projectId, normalized)
    if (existing) {
      if (!isFolder(existing)) throw new Error(`路径已被文件占用: ${normalized}`)
      return existing
    }
    const parentId = await ensureParents(projectId, `${normalized}/placeholder`)
    const now = Date.now()
    const folder: FileEntry = {
      id: makeId('webdir'),
      category: 'text',
      name: normalized.split('/').pop()!,
      content: '',
      mimeType: 'folder',
      size: 0,
      folderId: parentId,
      createdAt: now,
      updatedAt: now,
      metadata: { kind: 'project-folder', isFolder: true, projectId, relativePath: normalized },
    }
    await adapter.put(folder)
    return folder
  }

  async function write(projectId: string, path: string, content: string): Promise<FileEntry> {
    const normalized = normalizePath(path)
    const existing = await findEntry(projectId, normalized)
    if (existing && isFolder(existing)) throw new Error(`路径是文件夹: ${normalized}`)
    const parentId = existing?.folderId || await ensureParents(projectId, normalized)
    const now = Date.now()
    const file: FileEntry = {
      ...(existing || {} as FileEntry),
      id: existing?.id || makeId('webfile'),
      category: existing?.category || 'text',
      name: normalized.split('/').pop()!,
      content: String(content ?? ''),
      mimeType: existing?.mimeType || mimeForPath(normalized),
      size: new TextEncoder().encode(String(content ?? '')).length,
      folderId: parentId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      metadata: { ...(existing?.metadata || {}), kind: 'project-file', projectId, relativePath: normalized },
    }
    await adapter.put(file)
    return file
  }

  async function glob(projectId: string, pattern: string): Promise<WebProjectListEntry[]> {
    const matcher = globRegex(pattern)
    return (await list(projectId)).filter(entry => matcher.test(entry.path))
  }

  async function grep(projectId: string, pattern: string, limit = 100): Promise<WebProjectGrepMatch[]> {
    let matcher: RegExp
    try { matcher = new RegExp(pattern, 'u') } catch { throw new Error('搜索表达式无效') }
    const matches: WebProjectGrepMatch[] = []
    for (const entry of await allProjectEntries(projectId)) {
      if (isFolder(entry) || !entry.mimeType.startsWith('text/') && entry.mimeType !== 'application/json') continue
      for (const [index, line] of entry.content.split(/\r?\n/).entries()) {
        matcher.lastIndex = 0
        if (matcher.test(line)) matches.push({ path: entryPath(entry), line: index + 1, text: line })
        if (matches.length >= limit) return matches
      }
    }
    return matches.sort((a, b) => comparePath(a.path, b.path) || a.line - b.line)
  }

  async function edit(
    projectId: string,
    path: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ): Promise<number> {
    if (!oldString) throw new Error('oldString 不能为空')
    if (oldString === newString) throw new Error('新旧内容相同')
    const entry = await read(projectId, path)
    const count = entry.content.split(oldString).length - 1
    if (count === 0) throw new Error('没有找到要替换的内容')
    if (count > 1 && !replaceAll) throw new Error('匹配到多处内容，请使用 replaceAll')
    const content = replaceAll ? entry.content.split(oldString).join(newString) : entry.content.replace(oldString, newString)
    await write(projectId, path, content)
    return replaceAll ? count : 1
  }

  async function rename(projectId: string, path: string, newName: string): Promise<FileEntry> {
    const normalized = normalizePath(path)
    const cleanName = String(newName || '').trim()
    if (!cleanName || cleanName.includes('/') || cleanName === '.' || cleanName === '..') throw new Error('新名称无效')
    const entry = await read(projectId, normalized)
    const parentPath = normalized.split('/').slice(0, -1).join('/')
    const nextPath = parentPath ? `${parentPath}/${cleanName}` : cleanName
    if (await findEntry(projectId, nextPath)) throw new Error(`目标已存在: ${nextPath}`)
    const entries = [entry, ...(isFolder(entry)
      ? (await allProjectEntries(projectId)).filter(item => entryPath(item).startsWith(`${normalized}/`))
      : [])]
    for (const item of entries) {
      const oldPath = entryPath(item)
      const relativePath = oldPath === normalized ? nextPath : `${nextPath}${oldPath.slice(normalized.length)}`
      await adapter.put({
        ...item,
        name: item.id === entry.id ? cleanName : item.name,
        updatedAt: Date.now(),
        metadata: { ...(item.metadata || {}), relativePath },
      })
    }
    return (await adapter.get(entry.id))!
  }

  async function remove(projectId: string, path: string): Promise<void> {
    const normalized = normalizePath(path)
    const entry = await read(projectId, normalized)
    const targets = [entry, ...(isFolder(entry)
      ? (await allProjectEntries(projectId)).filter(item => entryPath(item).startsWith(`${normalized}/`))
      : [])]
    for (const target of targets) await adapter.remove(target.id)
  }

  async function addMedia(
    projectId: string,
    path: string,
    url: string,
    category: 'image' | 'video' | 'audio',
    mimeType: string,
    metadata: Record<string, unknown> = {},
  ): Promise<FileEntry> {
    const file = await write(projectId, path, url)
    const updated: FileEntry = {
      ...file,
      category,
      mimeType,
      size: 0,
      metadata: { ...(file.metadata || {}), ...metadata, sourceUrl: url },
    }
    await adapter.put(updated)
    return updated
  }

  return { listProjects, createProject, list, read, createFolder, write, glob, grep, edit, rename, remove, addMedia }
}

export const webProjectFiles = createWebProjectFiles()
