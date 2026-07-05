/**
 * editorDiffBridge.ts — 编辑区 ↔ 变更审查桥接
 *
 * 职责:
 *   1. 从 diff 文件路径解析真实文件内容（桌面端 Tauri FS）
 *   2. 行号映射：diff hunk 行号 → 编辑器文档位置
 *   3. 编辑器光标跳转到指定行
 *   4. 变更行高亮 decoration（Phase 2）
 *
 * 安全: 路径验证对齐 Rust dev_read_file/dev_write_file 的 clean_relative_path 逻辑
 */

import type { Editor } from '@tiptap/vue-3'
import type { DiffReviewFile, DiffReviewLine } from '@/opencodeClient/diffReview'

// ─── 路径安全 (对齐 Rust clean_relative_path) ───

/** 拒绝空字节（路径截断攻击） */
function validateNoNullBytes(p: string): void {
  if (p.includes('\0')) throw new Error('路径包含空字节')
}

/** 拒绝父目录遍历 */
function validateNoParentTraversal(p: string): void {
  const segments = p.replace(/\\/g, '/').split('/')
  if (segments.includes('..')) throw new Error('路径包含父目录遍历')
}

/** 拒绝绝对路径 */
function validateRelative(p: string): void {
  if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) throw new Error('路径不允许为绝对路径')
}

/** 安全清理相对路径：拒绝空字节/../绝对路径，返回清理后的路径片段 */
function sanitizeRelativePath(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) throw new Error('路径为空')
  validateNoNullBytes(trimmed)
  validateNoParentTraversal(trimmed)
  validateRelative(trimmed)
  // 正规化: 统一斜杠方向，去除 a/ b/ git diff 前缀
  let clean = trimmed.replace(/\\/g, '/').replace(/^[a-z]\//, '')
  // 去除多余斜杠、前导 ./
  clean = clean.replace(/\/+/g, '/').replace(/^\.\//, '')
  return clean
}

/** 安全拼接 projectDir + relativePath，确保结果在 projectDir 内 */
function resolveWithinRoot(projectDir: string | undefined, relativePath: string): string {
  if (!projectDir) return relativePath
  const clean = sanitizeRelativePath(relativePath)
  const normalizedRoot = projectDir.replace(/\\/g, '/').replace(/\/+$/, '')
  return `${normalizedRoot}/${clean}`
}

/** 解析 diff 文件路径，返回安全的相对路径 */
export function resolveDiffFilePath(diffFile: DiffReviewFile): string {
  const name = diffFile.file || ''
  try {
    return sanitizeRelativePath(name)
  } catch {
    // ponytail: 恶意路径 → 返回安全的默认名
    return 'unknown-file'
  }
}

/**
 * 读取真实文件内容（桌面端 Tauri FS），Web 端返回 null
 * projectDir 传入时使用 Rust dev_read_file（绕过 Tauri fs 插件 scope 限制）；
 * 不传 projectDir 时走 Tauri fs 插件 readTextFile（仅限 $APPDATA/$HOME 白名单路径）。
 */
export async function readRealFileContent(filePath: string, projectDir?: string): Promise<string | null> {
  try {
    // 有 projectDir → 使用 Rust dev_read_file 命令（无 Tauri fs scope 限制）
    if (projectDir) {
      const safeRelative = sanitizeRelativePath(filePath)
      // @ts-ignore — Tauri API 仅在桌面环境可用
      if (window.__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core')
        const result = await invoke<{ content: string; truncated: boolean; size: number }>('dev_read_file', {
          input: {
            root: projectDir,
            relativePath: safeRelative,
            maxBytes: 500000,
          },
        })
        return result.content
      }
      return null
    }

    // 无 projectDir → 旧路径：Tauri fs 插件（scope 限制在 $APPDATA/** 等白名单）
    const safePath = sanitizeRelativePath(filePath)
    // @ts-ignore — Tauri API 仅在桌面环境可用
    if (window.__TAURI_INTERNALS__) {
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      return await readTextFile(safePath)
    }
  } catch {
    // 文件不存在 / 权限不足 / 非 Tauri 环境 / 路径验证失败
  }
  return null
}

/**
 * 写入真实文件内容（桌面端），Web 端返回 false
 * projectDir 传入时使用 Rust dev_write_file（绕过 Tauri fs 插件 scope 限制）；
 * 不传 projectDir 时走 Tauri fs 插件 writeTextFile（仅限 $APPDATA/$HOME 白名单路径）。
 */
export async function writeRealFileContent(filePath: string, content: string, projectDir?: string): Promise<boolean> {
  try {
    // 有 projectDir → 使用 Rust dev_write_file 命令（无 Tauri fs scope 限制）
    if (projectDir) {
      // 从完整路径提取相对路径：/abs/root/src/file.ts → src/file.ts
      const normalizedRoot = projectDir.replace(/\\/g, '/').replace(/\/+$/, '')
      const normalizedPath = filePath.replace(/\\/g, '/')
      const relativePath = normalizedPath.startsWith(normalizedRoot + '/')
        ? normalizedPath.slice(normalizedRoot.length + 1)
        : filePath
      // @ts-ignore — Tauri API 仅在桌面环境可用
      if (window.__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('dev_write_file', { input: { root: projectDir, relativePath, content } })
        return true
      }
      return false
    }

    // 无 projectDir → 旧路径：Tauri fs 插件（scope 限制在白名单路径）
    const safePath = sanitizeRelativePath(filePath)
    // @ts-ignore — Tauri API 仅在桌面环境可用
    if (window.__TAURI_INTERNALS__) {
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      await writeTextFile(safePath, content)
      return true
    }
  } catch {
    // 权限不足 / 非 Tauri 环境 / 路径验证失败
  }
  return false
}

/**
 * 从 diff 行号映射到编辑器中该行的大致位置
 * 返回 Tiptap 文档中的 pos (字符偏移)
 */
export function mapDiffLineToEditorPos(
  line: DiffReviewLine,
  _fileContent: string,
): { pos: number; lineText: string } | null {
  // 只处理 add / context 行（这些行在"新文件"中存在）
  if (line.kind === 'del' || line.kind === 'meta') return null

  const lineNum = line.newLine
  if (lineNum === undefined) return null

  // ponytail: 简单实现 — 扫描换行符定位行号位置
  // 升级路径: 使用 Tiptap posAtCoords / resolvePosition 做精确映射
  const lines = _fileContent.split('\n')
  if (lineNum < 1 || lineNum > lines.length) return null

  let pos = 0
  for (let i = 0; i < lineNum - 1; i++) {
    pos += lines[i].length + 1 // +1 for \n
  }

  return {
    pos,
    lineText: lines[lineNum - 1] || '',
  }
}

/**
 * 跳转编辑器光标到指定行，并滚动可见
 */
export function jumpEditorToLine(editor: Editor, lineNumber: number): void {
  if (!editor || lineNumber < 1) return

  try {
    const doc = editor.state.doc
    let pos = 0
    let currentLine = 1

    doc.descendants((node, nodePos) => {
      if (currentLine > lineNumber) return false // stop
      if (node.isText) {
        const text = node.text || ''
        const lineCount = text.split('\n').length
        if (currentLine + lineCount - 1 >= lineNumber) {
          // 找到了目标行所在的 text node
          const linesBefore = lineNumber - currentLine
          let offset = 0
          const parts = text.split('\n')
          for (let i = 0; i < linesBefore; i++) {
            offset += parts[i].length + 1
          }
          pos = nodePos + offset
          return false // stop
        }
        currentLine += lineCount - 1
      }
      return true // continue
    })

    if (pos > 0) {
      editor.commands.setTextSelection(pos)
      // 尝试滚动到视图中央
      const dom = editor.view.domAtPos(pos)
      if (dom.node) {
        const el = dom.node.nodeType === 3 ? dom.node.parentElement : (dom.node as HTMLElement)
        el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
      }
    }
  } catch {
    // ponytail: 静默降级 — 跳转失败不影响编辑区正常工作
  }
}

/**
 * 解析 diff 中的变更行范围，返回 { startLine, endLine, kind }
 * 用于在编辑区 gutter 中标记变更行 (Phase 2)
 */
export interface DiffLineRange {
  startLine: number
  endLine: number
  kind: 'add' | 'del' | 'modify'
}

export function extractDiffLineRanges(diffFile: DiffReviewFile): DiffLineRange[] {
  const ranges: DiffLineRange[] = []

  for (const hunk of diffFile.hunks) {
    let currentAddStart: number | null = null
    let currentDelStart: number | null = null
    let lastAddLine = 0
    let lastDelLine = 0

    for (const line of hunk.lines) {
      if (line.kind === 'add' && line.newLine !== undefined) {
        if (currentAddStart === null) currentAddStart = line.newLine
        lastAddLine = line.newLine
        // 如果前面有连续 del（修改场景），也记录
        if (currentDelStart !== null) {
          ranges.push({ startLine: currentDelStart, endLine: lastDelLine, kind: 'modify' })
          currentDelStart = null
        }
      } else if (line.kind === 'del' && line.oldLine !== undefined) {
        if (currentDelStart === null) currentDelStart = line.oldLine
        lastDelLine = line.oldLine
      } else {
        // context line — flush pending ranges
        if (currentAddStart !== null) {
          ranges.push({ startLine: currentAddStart, endLine: lastAddLine, kind: 'add' })
          currentAddStart = null
        }
        if (currentDelStart !== null) {
          ranges.push({ startLine: currentDelStart, endLine: lastDelLine, kind: 'del' })
          currentDelStart = null
        }
      }
    }

    // flush remaining
    if (currentAddStart !== null) {
      ranges.push({ startLine: currentAddStart, endLine: lastAddLine, kind: 'add' })
    }
    if (currentDelStart !== null) {
      ranges.push({ startLine: currentDelStart, endLine: lastDelLine, kind: 'del' })
    }
  }

  return ranges
}
