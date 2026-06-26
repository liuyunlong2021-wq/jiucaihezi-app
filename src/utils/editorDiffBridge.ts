/**
 * editorDiffBridge.ts — 编辑区 ↔ 变更审查桥接
 *
 * 职责:
 *   1. 从 diff 文件路径解析真实文件内容（桌面端 Tauri FS）
 *   2. 行号映射：diff hunk 行号 → 编辑器文档位置
 *   3. 编辑器光标跳转到指定行
 *   4. 变更行高亮 decoration（Phase 2）
 */

import type { Editor } from '@tiptap/vue-3'
import type { DiffReviewFile, DiffReviewLine } from '@/opencodeClient/diffReview'

/** 解析 diff 文件路径，返回可能的真实文件路径 */
export function resolveDiffFilePath(diffFile: DiffReviewFile): string {
  // diff 文件路径可能是相对路径，需要结合 OpenCode project directory
  const name = diffFile.file || ''
  // 去掉可能的 a/ b/ 前缀 (git diff 格式)
  return name.replace(/^[ab]\//, '')
}

/**
 * 读取真实文件内容（桌面端 Tauri FS），Web 端返回 null
 * ponytail: Web 端不实现本地 FS 读取，返回 null 触发降级
 */
export async function readRealFileContent(filePath: string, projectDir?: string): Promise<string | null> {
  // 桌面端: 通过 Tauri FS API 读取
  try {
    // @ts-ignore — Tauri API 仅在桌面环境可用
    if (window.__TAURI_INTERNALS__) {
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const fullPath = projectDir ? `${projectDir}/${filePath}` : filePath
      return await readTextFile(fullPath)
    }
  } catch {
    // 文件不存在 / 权限不足 / 非 Tauri 环境
  }
  return null
}

/**
 * 写入真实文件内容（桌面端 Tauri FS），Web 端返回 false
 * ponytail: Web 端不实现本地 FS 写入，返回 false 触发降级
 */
export async function writeRealFileContent(filePath: string, content: string): Promise<boolean> {
  try {
    // @ts-ignore — Tauri API 仅在桌面环境可用
    if (window.__TAURI_INTERNALS__) {
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      await writeTextFile(filePath, content)
      return true
    }
  } catch {
    // 权限不足 / 非 Tauri 环境
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
