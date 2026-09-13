import type { DirectToolCall } from '@/runtime/direct/directTypes'
import { resolveCreativeProjectPath } from '@/runtime/direct/creativeToolContract'

/**
 * 文件能力合同（2026-09-13）：
 * - `@文件` 是唯一的本机操作开关；开就是全权：文件工具 + 终端 + Skill 脚本 + 3D 导出；
 * - 没有任何弹窗；行为约束靠 Skill 与用户指令，不靠审批层；
 * - 文件工具仍保留路径边界：项目外路径只能来自用户消息里给出的绝对路径；
 * - 终端不受该边界约束（用户 2026-09-13 显式选择：终端拿到就随便用）。
 * 详见 docs/wiki/开发/记忆工作台文件能力合同与TDD-2026-09-13.md
 */

const FILE_TOOL_NAMES = new Set([
  'read',
  'glob',
  'grep',
  'write',
  'edit',
  'write_text_batch',
  'mkdir',
  'move',
  'copy',
  'delete',
])

const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/
// 路径前面必须是行首或分隔符，避免把 `wiki/改编方案` 里的 `/改编方案` 当成绝对路径
const AUTHORIZED_PATH_TOKEN = /(?:^|[\s（(【[「"'`、，。；：=])((?:\/|[A-Za-z]:[\\/]|\\\\)[^\s'"`，。；：、！？（）【】《》,;:!?]*)/gmu
const EDGE_PUNCTUATION = /^[\s（(【[「"'`]+|[\s.，。；：、！？（）)【】\]」"'`,;:!?]+$/g
// 中文紧贴在路径尾部时（`/Users/a/b.md然后继续`）截到第一个中日韩字符
const CJK_TAIL = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff].*$/u

function argumentsOf(call: DirectToolCall): Record<string, unknown> {
  try {
    const value = JSON.parse(call.function.arguments || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

/**
 * 归一化为绝对路径。必须折叠 `.` 与 `..`：前缀比较是纯字符串操作，
 * 而文件系统会先把 `..` 解析掉，不折叠就会出现「授权目录/../../etc」被放行。
 */
function normalizeAbsolutePath(value: string): string {
  const raw = String(value || '')
    .trim()
    .replace(/\\/g, '/')
  const drive = /^([A-Za-z]:)\//.exec(raw)?.[1] || ''
  if (!drive && !raw.startsWith('/')) return raw.replace(/\/+$/, '')
  const parts: string[] = []
  for (const part of (drive ? raw.slice(drive.length) : raw).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return `${drive}/${parts.join('/')}`.replace(/\/+$/, '')
}

export function isAbsoluteToolPath(path: string): boolean {
  return !path.startsWith('skill://') && ABSOLUTE_PATH.test(path)
}

/** 从用户消息里抽出被授权的绝对路径：项目外路径的唯一合法来源。 */
export function collectAuthorizedPaths(userText: string): string[] {
  const found = new Set<string>()
  for (const match of String(userText || '').matchAll(AUTHORIZED_PATH_TOKEN)) {
    const candidate = (match[1] || '').replace(CJK_TAIL, '').replace(EDGE_PUNCTUATION, '')
    const normalized = normalizeAbsolutePath(candidate)
    if (normalized.length > 1) found.add(normalized)
  }
  return [...found]
}

/**
 * 路径前缀授权：给目录放开整棵子树，给文件只放开该文件。
 * ponytail: 纯字面前缀比较，挡不住授权树内的符号链接（Rust 侧 canonicalize 会跟随）。
 * ceiling = “授权目录里存在指向外部的软链”；升级路径 = 把授权根下传 Rust，canonicalize 后复验前缀。
 */
export function isAuthorizedPath(target: string, authorizedPaths: string[]): boolean {
  const normalized = normalizeAbsolutePath(target)
  if (!normalized) return false
  const insensitive = /^[A-Za-z]:\//.test(normalized)
  const candidate = insensitive ? normalized.toLowerCase() : normalized
  return authorizedPaths.some(entry => {
    const base = normalizeAbsolutePath(entry)
    if (!base) return false
    const comparable = insensitive ? base.toLowerCase() : base
    return candidate === comparable || candidate.startsWith(`${comparable}/`)
  })
}

function fileToolPaths(args: Record<string, unknown>): string[] {
  const values: unknown[] = [args.path, args.destination]
  if (Array.isArray(args.files))
    for (const file of args.files)
      if (file && typeof file === 'object' && !Array.isArray(file))
        values.push((file as Record<string, unknown>).path)
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
}

/**
 * 是否需要弹窗。
 * 现在只剩一种情况：文件工具碰到未获授权的项目外路径时，直接抛错让模型向用户要路径；
 * 其余工具（终端、Skill 脚本、3D 导出、MCP、生成类）一律零弹窗。
 */
export function memoryToolNeedsApproval(
  call: DirectToolCall,
  authorizedPaths: string[] = [],
  projectRoot = '',
): boolean {
  const name = call.function.name
  const args = argumentsOf(call)
  if (FILE_TOOL_NAMES.has(name)) {
    for (const path of fileToolPaths(args)) {
      if (!isAbsoluteToolPath(path)) continue
      if (!resolveCreativeProjectPath(path, projectRoot, true).external) continue
      if (!isAuthorizedPath(path, authorizedPaths))
        throw new Error(`项目外路径必须先由用户提供: ${path}。请把要操作的路径发给我（目录或文件都可以）。`)
    }
  }
  return false
}
