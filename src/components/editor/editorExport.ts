/**
 * editorExport.ts
 *
 * 编辑区统一导出服务 — 单一入口，负责 DOCX 导出的完整生命周期：
 *   - Tiptap JSON → DOCX（调用 localDocxV2）
 *   - 文件保存（调用 exportSave）
 *   - 诊断报告构建（节点统计、资产、耗时）
 *   - metadata 写入（lastExportedAt、exportHistory、lastExportDiagnostic）
 *
 * 架构收敛状态（Phase B 完成）：
 *   ✅ EditorPanel.confirmExportOptions() → exportDocx()            ← Phase A
 *   ✅ EditorPanel.exportDoc() → exportDocument()                  ← Phase B
 *   ✅ EditorPanel (LLM 工具) → exportDocument()                   ← Phase B
 *   ✅ officeTools.ts → emitEvent → EditorPanel → exportDocument()  ← 间接收敛
 *
 * EditorPanel 不再直接引用 localDocxV2 / exportSave（导出路径）。
 */

import type { JSONContent } from '@tiptap/core'
import type { EditorAssetRef } from './editorDocument'
import { renderToHTMLString } from '@tiptap/static-renderer/pm/html-string'
import { getStaticRenderExtensions } from './editorDocument'

// ─── 类型 ───

export interface ExportOptions {
  format: 'docx' | 'pdf' | 'html' | 'md'
  embedImages?: boolean
  title?: string
}

export interface ExportDiagnostic {
  format: string
  title: string
  contentSize: number
  imageCount: number
  imagesEmbedded: boolean
  timestamp: string
  status: string
  path: string | null
  nodeTypes: Record<string, number>
  errors?: string[]
  durationMs?: number
}

export interface ExportResult {
  status: 'success' | 'failed' | 'cancelled'
  path?: string
  diagnostics?: ExportDiagnostic
  metadataUpdated?: boolean
}

// ─── 工具函数 ───

function buildNodeStats(json: JSONContent): Record<string, number> {
  const stats: Record<string, number> = {}
  function walk(node: JSONContent) {
    const type = node.type || 'unknown'
    stats[type] = (stats[type] || 0) + 1
    if (node.content) node.content.forEach(walk)
  }
  walk(json)
  return stats
}

// ─── 核心导出 ───

/**
 * DOCX 导出 — 统一入口（Phase A 强化版）
 *
 * 职责：Tiptap JSON → DOCX 字节 → 保存文件 → 写 metadata → 返回完整诊断
 *
 * 调用方只需传入 json + assets + options，无需关心底层 localDocxV2 / exportSave。
 */
export async function exportDocx(
  tiptapJson: JSONContent,
  assets: EditorAssetRef[] = [],
  options: {
    title?: string
    embedImages?: boolean
    fileId?: string  // 如果提供，会自动写 metadata
    maxImageWidth?: number
  } = {}
): Promise<ExportResult> {
  const { createDocxFromTiptap } = await import('@/utils/localDocxV2')
  const { saveGeneratedFile, normalizeExportFilename } = await import('@/utils/exportSave')

  const title = options.title || '未命名文档'
  const startTime = Date.now()

  try {
    // 1. 生成 DOCX
    const bytes = await createDocxFromTiptap({
      title,
      json: tiptapJson,
      assets,
      compressImages: options.embedImages !== false,
      maxImageWidth: options.maxImageWidth || 1600,
    })

    // 2. 保存文件
    const saveResult = await saveGeneratedFile({
      filename: normalizeExportFilename(title + '.docx', 'docx'),
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      data: bytes,
    })

    // 3. 构建诊断
    const diagnostic: ExportDiagnostic = {
      format: 'docx',
      title,
      contentSize: JSON.stringify(tiptapJson).length,
      imageCount: assets.length,
      imagesEmbedded: options.embedImages !== false,
      timestamp: new Date().toISOString(),
      status: saveResult.status,
      path: saveResult.path || null,
      nodeTypes: buildNodeStats(tiptapJson),
      durationMs: Date.now() - startTime,
    }

    // 4. 写入 metadata（如果有 fileId）
    let metadataUpdated = false
    if (options.fileId && saveResult.status === 'saved') {
      try {
        const { getRecord, setRecord } = await import('@/utils/idb')
        const file = await getRecord('documents', options.fileId)
        if (file) {
          const prev = file.metadata || {}
          const history = Array.isArray(prev.exportHistory) ? prev.exportHistory : []
          history.unshift({
            format: 'docx',
            title,
            path: saveResult.path,
            timestamp: diagnostic.timestamp,
          })
          await setRecord('documents', {
            ...file,
            metadata: {
              ...prev,
              lastExportedAt: Date.now(),
              exportHistory: history.slice(0, 20),
              lastExportDiagnostic: diagnostic,
            },
          })
          metadataUpdated = true
        }
      } catch (metaErr) {
        console.warn('[editorExport] metadata 写入失败（不影响导出）:', metaErr)
      }
    }

    // 5. 发送事件
    try {
      const { emitEvent } = await import('@/utils/eventBus')
      emitEvent('editor-exported', {
        format: 'docx',
        title,
        path: saveResult.path,
        diagnostic,
      })
    } catch { /* eventBus 不可用时静默 */ }

    return {
      status: saveResult.status === 'cancelled' ? 'cancelled' : 'success',
      path: saveResult.path,
      diagnostics: diagnostic,
      metadataUpdated,
    }
  } catch (err: any) {
    return {
      status: 'failed',
      diagnostics: {
        format: 'docx',
        title,
        contentSize: JSON.stringify(tiptapJson).length,
        imageCount: assets.length,
        imagesEmbedded: options.embedImages !== false,
        timestamp: new Date().toISOString(),
        status: 'failed',
        path: null,
        nodeTypes: {},
        errors: [err.message || 'Unknown export error'],
        durationMs: Date.now() - startTime,
      },
      metadataUpdated: false,
    }
  }
}

// ─── 通用分发器 ───

export interface ExportDocumentInput {
  format: 'docx' | 'pdf' | 'html' | 'md'
  title?: string
  tiptapJson: JSONContent
  html?: string         // pdf/html 需要
  assets?: EditorAssetRef[]
  embedImages?: boolean
  fileId?: string
  /** 仅 pdf: 用户自定义打印 CSS（覆盖默认） */
  printCss?: string
}

/**
 * 通用导出分发器 — 格式无关的统一入口
 *
 * 用法：EditorPanel / LLM 工具 / 其他模块只需调此函数，无需关心底层实现。
 */
export async function exportDocument(
  input: ExportDocumentInput
): Promise<ExportResult> {
  const { format, title = '未命名文档', tiptapJson, html, assets = [], embedImages = true, fileId } = input

  const startTime = Date.now()

  try {
    if (format === 'docx') {
      return await exportDocx(tiptapJson, assets, { title, embedImages, fileId })
    }

    // md / html / pdf → 走通用文件保存路径
    const { saveGeneratedFile, normalizeExportFilename } = await import('@/utils/exportSave')

    let data: string | Uint8Array
    let ext: string
    let mimeType: string

    if (format === 'md') {
      // Prefer official Markdown extension when possible in editor context; fallback to enhanced custom renderer
      const { tiptapJsonToMarkdown } = await import('./editorDocument')
      data = tiptapJsonToMarkdown(tiptapJson) || ''
      ext = 'md'
      mimeType = 'text/markdown;charset=utf-8'
    } else if (format === 'html') {
      // Use static-renderer for high-fidelity HTML (better custom nodes, attrs)
      const staticHtml = renderToHTMLString({
        content: tiptapJson,
        extensions: getStaticRenderExtensions(),
      })
      const styledHtml = html || staticHtml
      data = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    ${input.printCss || getDefaultPrintCss()}
  </style>
</head>
<body>
  <div class="print-theme-minimal">
    ${styledHtml}
  </div>
</body>
</html>`
      ext = 'html'
      mimeType = 'text/html'
    } else if (format === 'pdf') {
      // pdf: 生成高保真 HTML 文件（保存后可在浏览器中打印为 PDF）
      const styledHtml = html || ''
      data = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    ${input.printCss || getDefaultPrintCss()}
  </style>
</head>
<body>
  <div class="print-theme-minimal">
    ${styledHtml}
  </div>
</body>
</html>`
      ext = 'html'
      mimeType = 'text/html;charset=utf-8'
    } else {
      // fallback: treat as plain text
      data = typeof html === 'string' && html ? html : JSON.stringify(tiptapJson, null, 2)
      ext = 'txt'
      mimeType = 'text/plain;charset=utf-8'
    }

    const saveResult = await saveGeneratedFile({
      filename: normalizeExportFilename(`${title}.${ext}`, ext),
      mimeType,
      data,
    })

    const diagnostic: ExportDiagnostic = {
      format,
      title,
      contentSize: JSON.stringify(tiptapJson).length,
      imageCount: assets.length,
      imagesEmbedded: false,
      timestamp: new Date().toISOString(),
      status: saveResult.status,
      path: saveResult.path || null,
      nodeTypes: buildNodeStats(tiptapJson),
      durationMs: Date.now() - startTime,
    }

    // metadata
    let metadataUpdated = false
    if (fileId && saveResult.status === 'saved') {
      try {
        const { getRecord, setRecord } = await import('@/utils/idb')
        const file = await getRecord('documents', fileId)
        if (file) {
          const prev = file.metadata || {}
          const history = Array.isArray(prev.exportHistory) ? prev.exportHistory : []
          history.unshift({ format, title, path: saveResult.path, timestamp: diagnostic.timestamp })
          await setRecord('documents', {
            ...file,
            metadata: {
              ...prev,
              lastExportedAt: Date.now(),
              exportHistory: history.slice(0, 20),
              lastExportDiagnostic: diagnostic,
            },
          })
          metadataUpdated = true
        }
      } catch { /* 静默 */ }
    }

    return {
      status: saveResult.status === 'cancelled' ? 'cancelled' : 'success',
      path: saveResult.path,
      diagnostics: diagnostic,
      metadataUpdated,
    }
  } catch (err: any) {
    return {
      status: 'failed',
      diagnostics: {
        format,
        title,
        contentSize: JSON.stringify(tiptapJson).length,
        imageCount: assets.length,
        imagesEmbedded: false,
        timestamp: new Date().toISOString(),
        status: 'failed',
        path: null,
        nodeTypes: {},
        errors: [err.message || 'Unknown export error'],
        durationMs: Date.now() - startTime,
      },
      metadataUpdated: false,
    }
  }
}

/** 默认打印 CSS（@media print 规则），可被输入覆盖 */
function getDefaultPrintCss(): string {
  return `
    @media print {
      @page { size: A4; margin: 1.5cm; }
      body { margin: 0; padding: 0; font-size: 11pt; line-height: 1.6; }
      table, pre, img, blockquote { page-break-inside: avoid; }
      h1, h2, h3 { page-break-after: avoid; }
      img { max-width: 100%; height: auto; }
      .ep-toolbar, .ep-bubble-menu, .ep-backlinks, .ep-find-bar { display: none !important; }
    }
  `
}

// ==================== Phase 2: 导出为模板 ====================

export async function exportAsTemplate(
  title: string,
  json: any,
  assets: any[] = []
): Promise<{ status: string; path?: string }> {
  const templateName = title.replace(/[\\/:*?"<>|]/g, '_').trim() || '未命名模板'
  const templateData = {
    name: templateName,
    createdAt: Date.now(),
    tiptapJson: json,
    assets: assets.map(a => ({
      name: a.name,
      mimeType: a.mimeType,
      // 注意：大图片建议不全量存储，这里简化存储 dataURL（实际项目可优化为引用）
      src: a.src,
    })),
    version: 1,
  }

  const filename = `${templateName}.jctemplate.json`

  // 使用现有的保存逻辑，但建议用户保存到模板目录
  const { saveGeneratedFile, normalizeExportFilename } = await import('@/utils/exportSave')

  const result = await saveGeneratedFile({
    filename: normalizeExportFilename(filename, 'json'),
    mimeType: 'application/json',
    data: JSON.stringify(templateData, null, 2),
  })

  return {
    status: result.status === 'cancelled' ? 'cancelled' : 'success',
    path: result.path,
  }
}

/**
 * Phase 2 收尾：加载模板
 * 读取 .jctemplate.json 并返回可直接用于编辑器的内容
 */
export async function loadTemplate(file: File): Promise<{
  title: string
  json: any
  assets: any[]
} | null> {
  try {
    const text = await file.text()
    const data = JSON.parse(text)

    if (!data.tiptapJson) {
      throw new Error('无效的模板文件')
    }

    return {
      title: data.name || file.name.replace('.jctemplate.json', ''),
      json: data.tiptapJson,
      assets: data.assets || [],
    }
  } catch (e) {
    console.error('加载模板失败:', e)
    return null
  }
}

export async function exportDocumentTemplate(
  title: string,
  json: any,
  assets: any[] = [],
): Promise<{ status: string; exportPath?: string }> {
  const exportRes = await exportAsTemplate(title, json, assets) // 复用模板逻辑作为文档导出

  if (exportRes.status !== 'success' || !exportRes.path) {
    return { status: exportRes.status }
  }

  return {
    status: 'success',
    exportPath: exportRes.path,
  }
}
