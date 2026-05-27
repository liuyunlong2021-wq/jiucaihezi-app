/**
 * utils/vaultFs.ts — 知识库文件系统映射层 (Tauri 桌面端)
 *
 * 将知识库的虚拟文件夹结构映射到真实文件系统目录：
 *   ~/.jiucaihezi/vaults/<vaultId>/
 *     CLAUDE.md
 *     raw/
 *       对话记录/
 *         sess_xxx.md
 *     wiki/
 *       角色/
 *         小明.md
 *
 * 对外暴露与 useFileStore 兼容的 API，在 Tauri 环境下自动启用。
 * 浏览器环境下所有操作返回 no-op。
 */

import type { FileEntry } from '@/composables/useFileStore'
import { resolveDesktopDataDirs } from './idb'
import { isTauriRuntime } from './tauriEnv'
import { buildVaultScaffold, normalizeVaultPath, parentFoldersForWikiFile, type VaultScaffold } from './vaultScaffold'

const isTauri = isTauriRuntime()

let tauriFs: typeof import('@tauri-apps/plugin-fs') | null = null
let tauriPath: typeof import('@tauri-apps/api/path') | null = null
let vaultsRoot = ''
let legacyVaultsRoot = ''

async function ensureModules() {
  if (!tauriFs) {
    tauriFs = await import('@tauri-apps/plugin-fs')
    tauriPath = await import('@tauri-apps/api/path')
    const appData = await tauriPath.appDataDir()
    const home = await tauriPath.homeDir()
    const dirs = resolveDesktopDataDirs(appData, home)
    vaultsRoot = dirs.dataDir.replace(/\/data$/, '/vaults')
    legacyVaultsRoot = dirs.legacyDataDir.replace(/\/data$/, '/vaults')
    try { await tauriFs.mkdir(vaultsRoot, { recursive: true }) } catch {}
  }
}

/** 获取 vault 的磁盘根目录 */
function vaultDir(vaultId: string): string {
  return `${vaultsRoot}/${sanitizeName(vaultId, 'vault')}`
}

function legacyVaultDir(vaultId: string): string {
  return `${legacyVaultsRoot}/${sanitizeName(vaultId, 'vault')}`
}

/** 将 FileEntry 的虚拟路径解析为磁盘路径 */
function resolveFilePath(vaultId: string, entry: FileEntry, parentPath?: string): string {
  const dir = vaultDir(vaultId)
  if (parentPath) {
    return `${dir}/${safeRelativePath(parentPath)}/${sanitizeName(entry.name)}`
  }
  // 顶级文件
  return `${dir}/${sanitizeName(entry.name)}`
}

/** 清理文件名 (去除不安全字符 + Unicode NFKC 正规化防同形异义攻击) */
export function sanitizeName(name: string, fallback = 'unnamed'): string {
  // NFKC 正规化：将全角、异体等字符转为标准形式，防止同形异义攻击
  const normalized = String(name || '').normalize('NFKC')
  const clean = normalized
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean || clean === '.' || clean === '..') return fallback
  return clean
}

export function safeRelativePath(path: string, fallback = 'unnamed'): string {
  const parts = String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/')
    .split('/')
    .map(part => sanitizeName(part, fallback))
    .filter(Boolean)
  return parts.join('/') || fallback
}

/** 确保文件有正确的扩展名 */
function ensureExtension(name: string, mimeType: string): string {
  if (name.includes('.')) return name
  const ext = mimeToExt(mimeType)
  return ext ? `${name}.${ext}` : name
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'text/markdown': 'md',
    'text/plain': 'txt',
    'text/html': 'html',
    'application/json': 'json',
    'image/png': 'png',
    'image/jpeg': 'jpg',
  }
  return map[mime] || ''
}

// ═══════════════════════════════════════════════════
//  公开 API
// ═══════════════════════════════════════════════════

/**
 * 创建知识库的磁盘目录结构
 */
export async function createVaultOnDisk(vaultId: string, opts?: {
  claudeMd?: string
  rawFolders?: string[]
  wikiFolders?: string[]
  seedPages?: Array<{ path: string; title?: string; summary?: string; content?: string; sources?: string[]; tags?: string[] }>
  scaffold?: VaultScaffold
}): Promise<void> {
  if (!isTauri) return
  await ensureModules()
  const scaffold = opts?.scaffold || buildVaultScaffold({
    name: '知识库',
    rawFolders: opts?.rawFolders,
    wikiFolders: opts?.wikiFolders,
    templateRulebook: opts?.claudeMd,
    seedPages: opts?.seedPages,
  })

  const dir = vaultDir(vaultId)
  await tauriFs!.mkdir(dir, { recursive: true })

  // CLAUDE.md
  await tauriFs!.writeTextFile(`${dir}/CLAUDE.md`, scaffold.claudeMd)

  // raw/
  await tauriFs!.mkdir(`${dir}/raw`, { recursive: true })
  for (const folder of scaffold.rawFolders) {
    await tauriFs!.mkdir(`${dir}/raw/${safeRelativePath(folder)}`, { recursive: true })
  }

  // wiki/
  await tauriFs!.mkdir(`${dir}/wiki`, { recursive: true })
  const wikiFolders = new Set(scaffold.wikiFolders)
  for (const file of scaffold.wikiFiles) {
    parentFoldersForWikiFile(file.path).forEach(path => wikiFolders.add(path))
  }
  for (const path of wikiFolders) {
    await tauriFs!.mkdir(`${dir}/wiki/${safeRelativePath(path)}`, { recursive: true })
  }
  for (const file of scaffold.wikiFiles) {
    const relativePath = safeRelativePath(normalizeVaultPath(file.path))
    const filePath = `${dir}/wiki/${relativePath}`
    const parentDir = filePath.substring(0, filePath.lastIndexOf('/'))
    try { await tauriFs!.mkdir(parentDir, { recursive: true }) } catch {}
    await tauriFs!.writeTextFile(filePath, file.content)
  }

  // _reports/
  for (const folder of scaffold.reportFolders) {
    await tauriFs!.mkdir(`${dir}/_reports/${safeRelativePath(folder)}`, { recursive: true })
  }

  // _templates/
  await tauriFs!.mkdir(`${dir}/_templates`, { recursive: true })
  for (const file of scaffold.templateFiles) {
    const relativePath = safeRelativePath(normalizeVaultPath(file.path))
    const filePath = `${dir}/_templates/${relativePath}`
    const parentDir = filePath.substring(0, filePath.lastIndexOf('/'))
    try { await tauriFs!.mkdir(parentDir, { recursive: true }) } catch {}
    await tauriFs!.writeTextFile(filePath, file.content)
  }

  console.log(`[VaultFS] 创建知识库目录: ${dir}`)
}

/**
 * 只确保知识库根目录存在，不写默认脚手架文件。
 * 导入已有知识库时使用，避免默认 CLAUDE/wiki 文件覆盖导入内容。
 */
export async function ensureVaultOnDisk(vaultId: string): Promise<void> {
  if (!isTauri) return
  await ensureModules()
  await tauriFs!.mkdir(vaultDir(vaultId), { recursive: true })
}

/**
 * 将文件写入知识库磁盘目录
 */
export async function writeFileToDisk(
  vaultId: string,
  relativePath: string, // e.g. "raw/对话记录/sess_xxx.md"
  content: string,
  opts: { metadata?: Record<string, unknown>; mimeType?: string } = {},
): Promise<string> {
  if (!isTauri) return ''
  await ensureModules()

  const filePath = `${vaultDir(vaultId)}/${safeRelativePath(relativePath)}`
  // 确保父目录存在
  const parentDir = filePath.substring(0, filePath.lastIndexOf('/'))
  try { await tauriFs!.mkdir(parentDir, { recursive: true }) } catch {}
  const binary = shouldWriteBinaryContent(content, opts.metadata)
    ? dataUrlToBytes(content)
    : null
  if (binary) {
    await tauriFs!.writeFile(filePath, binary)
  } else if (shouldWriteBinaryContent(content, opts.metadata)) {
    throw new Error('DataURL 原始文件解析失败，已阻止写入文本占位内容')
  } else {
    await tauriFs!.writeTextFile(filePath, content)
  }
  return filePath
}

function shouldWriteBinaryContent(content: string, metadata?: Record<string, unknown>): boolean {
  return metadata?.storage === 'data-url' || /^data:[^,]*,/i.test(String(content || ''))
}

function dataUrlToBytes(content: string): Uint8Array | null {
  const match = String(content || '').match(/^data:([^,]*?),(.*)$/s)
  if (!match) return null
  const meta = match[1] || ''
  const payload = match[2] || ''
  try {
    if (/;base64/i.test(meta)) {
      const binary = atob(payload.replace(/\s+/g, ''))
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return bytes
    }
    return new TextEncoder().encode(decodeURIComponent(payload))
  } catch {
    return null
  }
}

/**
 * 从磁盘读取文件内容
 */
export async function readFileFromDisk(
  vaultId: string,
  relativePath: string,
): Promise<string | null> {
  if (!isTauri) return null
  await ensureModules()

  try {
    return await tauriFs!.readTextFile(`${vaultDir(vaultId)}/${safeRelativePath(relativePath)}`)
  } catch {
    return null
  }
}

/**
 * 删除磁盘上的文件
 */
export async function removeFileFromDisk(
  vaultId: string,
  relativePath: string,
): Promise<void> {
  if (!isTauri) return
  await ensureModules()

  await tauriFs!.remove(`${vaultDir(vaultId)}/${safeRelativePath(relativePath)}`, { recursive: true })
}

/**
 * 删除整个知识库目录
 */
export async function removeVaultFromDisk(vaultId: string): Promise<void> {
  if (!isTauri) return
  await ensureModules()

  try {
    await tauriFs!.remove(vaultDir(vaultId), { recursive: true })
    console.log(`[VaultFS] 已删除知识库目录: ${vaultDir(vaultId)}`)
  } catch {}
}

/**
 * 扫描磁盘上的知识库目录，返回文件树
 */
export interface DiskFileNode {
  name: string
  path: string        // 相对于 vault 根目录
  isDir: boolean
  children?: DiskFileNode[]
  size?: number
}

export async function scanVaultDir(vaultId: string): Promise<DiskFileNode[]> {
  if (!isTauri) return []
  await ensureModules()

  const dir = vaultDir(vaultId)
  let nodes = await scanDirRecursive(dir, '')
  if (nodes.length === 0 && legacyVaultsRoot && legacyVaultsRoot !== vaultsRoot) {
    nodes = await scanDirRecursive(legacyVaultDir(vaultId), '')
  }
  return nodes
}

async function scanDirRecursive(baseDir: string, relativePath: string): Promise<DiskFileNode[]> {
  const nodes: DiskFileNode[] = []
  const fullPath = relativePath ? `${baseDir}/${relativePath}` : baseDir

  try {
    const entries = await tauriFs!.readDir(fullPath)
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue // 跳过隐藏文件

      const childRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name

      if (entry.isDirectory) {
        const children = await scanDirRecursive(baseDir, childRelPath)
        nodes.push({
          name: entry.name,
          path: childRelPath,
          isDir: true,
          children,
        })
      } else {
        nodes.push({
          name: entry.name,
          path: childRelPath,
          isDir: false,
        })
      }
    }
  } catch {}

  // 排序：目录在前，文件在后，按名字排序
  nodes.sort((a, b) => {
    if (a.isDir && !b.isDir) return -1
    if (!a.isDir && b.isDir) return 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  return nodes
}

/**
 * 从 FileEntry 推导出磁盘相对路径
 * 用于将 useFileStore 的操作映射到真实文件
 */
export function inferRelativePath(entry: FileEntry, allEntries: FileEntry[]): string {
  const parts: string[] = []
  const visited = new Set<string>()

  // 向上遍历 folderId 链
  let current: FileEntry | undefined = entry
  while (current) {
    if (visited.has(current.id)) break
    visited.add(current.id)
    parts.unshift(sanitizeName(current.name))
    if (!current.folderId) break
    current = allEntries.find(f =>
      f.id === current!.folderId &&
      f.vaultId === entry.vaultId &&
      f.category === entry.category
    )
  }

  // 文件夹的路径就是目录本身，文件需要加扩展名
  if (entry.mimeType !== 'folder') {
    const last = parts.length - 1
    parts[last] = ensureExtension(parts[last], entry.mimeType)
  }

  return parts.join('/')
}

/**
 * 将 FileEntry 的知识库操作同步到磁盘
 * 在 useFileStore 的 addFile/updateFile/deleteFile 中调用
 */
export async function syncEntryToDisk(
  action: 'write' | 'delete',
  entry: FileEntry,
  allEntries: FileEntry[],
): Promise<void> {
  if (!isTauri || !entry.vaultId || entry.category !== 'knowledge') return

  const relativePath = inferRelativePath(entry, allEntries)

  if (action === 'delete') {
    await removeFileFromDisk(entry.vaultId, relativePath)
    return
  }

  // write
  if (entry.mimeType === 'folder') {
    // 创建目录
    await ensureModules()
    try {
      await tauriFs!.mkdir(`${vaultDir(entry.vaultId)}/${safeRelativePath(relativePath)}`, { recursive: true })
    } catch {}
  } else {
    // 写入文件内容
    await writeFileToDisk(entry.vaultId, relativePath, entry.content, {
      metadata: entry.metadata,
      mimeType: entry.mimeType,
    })
  }
}

/**
 * 获取知识库磁盘根路径
 */
export async function getVaultsRoot(): Promise<string> {
  if (!isTauri) return ''
  await ensureModules()
  return vaultsRoot
}

/**
 * 检查是否在 Tauri 环境
 */
export function isDesktop(): boolean {
  return isTauri
}
