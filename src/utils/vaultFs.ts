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

const isTauri = typeof window !== 'undefined' && '__TAURI__' in window

let tauriFs: typeof import('@tauri-apps/plugin-fs') | null = null
let tauriPath: typeof import('@tauri-apps/api/path') | null = null
let vaultsRoot = '' // ~/.jiucaihezi/vaults

async function ensureModules() {
  if (!tauriFs) {
    tauriFs = await import('@tauri-apps/plugin-fs')
    tauriPath = await import('@tauri-apps/api/path')
    const home = await tauriPath.homeDir()
    vaultsRoot = `${home}.jiucaihezi/vaults`
    try { await tauriFs.mkdir(vaultsRoot, { recursive: true }) } catch {}
  }
}

/** 获取 vault 的磁盘根目录 */
function vaultDir(vaultId: string): string {
  return `${vaultsRoot}/${vaultId}`
}

/** 将 FileEntry 的虚拟路径解析为磁盘路径 */
function resolveFilePath(vaultId: string, entry: FileEntry, parentPath?: string): string {
  const dir = vaultDir(vaultId)
  if (parentPath) {
    return `${dir}/${parentPath}/${sanitizeName(entry.name)}`
  }
  // 顶级文件
  return `${dir}/${sanitizeName(entry.name)}`
}

/** 清理文件名 (去除不安全字符) */
function sanitizeName(name: string): string {
  // 保留中文、字母、数字、点、连字符、下划线
  return name
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    || 'unnamed'
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
}): Promise<void> {
  if (!isTauri) return
  await ensureModules()

  const dir = vaultDir(vaultId)
  await tauriFs!.mkdir(dir, { recursive: true })

  // CLAUDE.md
  const claudeContent = opts?.claudeMd || `# 知识库配置\n\n此知识库尚未配置。\n`
  await tauriFs!.writeTextFile(`${dir}/CLAUDE.md`, claudeContent)

  // raw/
  await tauriFs!.mkdir(`${dir}/raw`, { recursive: true })
  for (const folder of (opts?.rawFolders || ['对话记录'])) {
    await tauriFs!.mkdir(`${dir}/raw/${sanitizeName(folder)}`, { recursive: true })
  }

  // wiki/
  await tauriFs!.mkdir(`${dir}/wiki`, { recursive: true })
  for (const path of (opts?.wikiFolders || [])) {
    const parts = path.split('/').map(sanitizeName)
    await tauriFs!.mkdir(`${dir}/wiki/${parts.join('/')}`, { recursive: true })
  }

  console.log(`[VaultFS] 创建知识库目录: ${dir}`)
}

/**
 * 将文件写入知识库磁盘目录
 */
export async function writeFileToDisk(
  vaultId: string,
  relativePath: string, // e.g. "raw/对话记录/sess_xxx.md"
  content: string,
): Promise<string> {
  if (!isTauri) return ''
  await ensureModules()

  const filePath = `${vaultDir(vaultId)}/${relativePath}`
  // 确保父目录存在
  const parentDir = filePath.substring(0, filePath.lastIndexOf('/'))
  try { await tauriFs!.mkdir(parentDir, { recursive: true }) } catch {}
  await tauriFs!.writeTextFile(filePath, content)
  return filePath
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
    return await tauriFs!.readTextFile(`${vaultDir(vaultId)}/${relativePath}`)
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

  try {
    await tauriFs!.remove(`${vaultDir(vaultId)}/${relativePath}`)
  } catch {}
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
  return scanDirRecursive(dir, '')
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

  // 向上遍历 folderId 链
  let current: FileEntry | undefined = entry
  while (current) {
    parts.unshift(sanitizeName(current.name))
    if (!current.folderId) break
    current = allEntries.find(f => f.id === current!.folderId)
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
      await tauriFs!.mkdir(`${vaultDir(entry.vaultId)}/${relativePath}`, { recursive: true })
    } catch {}
  } else {
    // 写入文件内容
    await writeFileToDisk(entry.vaultId, relativePath, entry.content)
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
