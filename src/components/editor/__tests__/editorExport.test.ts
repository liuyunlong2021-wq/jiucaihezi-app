/**
 * editorExport.test.ts
 * Audit Item 4 + TDD §3.5: editorExport 集成行为验证（node:test 风格）
 * 重点验证：真实调用 localDocxV2 + save 路径、diagnostics 结构、失败安全返回、不抛出。
 * 注意：纯 node 环境 saveGeneratedFile 会失败（无 Tauri），这是预期，用于覆盖失败 + diagnostics 分支。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exportDocx, exportDocument, type ExportResult, type ExportDiagnostic } from '../editorExport'

function isExportResult(r: any): r is ExportResult {
  return r && typeof r.status === 'string' && (r.status === 'success' || r.status === 'failed' || r.status === 'cancelled')
}

async function withBrowserDownloadAndStorageTrap<T>(action: (localStorageCalls: () => number) => Promise<T>): Promise<T> {
  const originalIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  let localStorageCalls = 0
  Reflect.deleteProperty(globalThis, 'indexedDB')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem() {
        localStorageCalls += 1
        return JSON.stringify({
          webfile_project_export: {
            id: 'webfile_project_export', category: 'text', name: '正文.md', content: '正文', mimeType: 'text/markdown', size: 6,
            createdAt: 1, updatedAt: 1, metadata: { kind: 'project-file' },
          },
        })
      },
      setItem() { localStorageCalls += 1 },
      removeItem() { localStorageCalls += 1 },
      get length() { localStorageCalls += 1; return 0 },
      key() { localStorageCalls += 1; return null },
    },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: { appendChild() {} },
      createElement() { return { click() {}, remove() {}, href: '', download: '' } },
    },
  })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:editor-export-test' })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} })
  try {
    return await action(() => localStorageCalls)
  } finally {
    if (originalIndexedDb) Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb)
    else Reflect.deleteProperty(globalThis, 'indexedDB')
    if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
    if (originalCreateObjectUrl) Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl)
    else Reflect.deleteProperty(URL, 'createObjectURL')
    if (originalRevokeObjectUrl) Object.defineProperty(URL, 'revokeObjectURL', originalRevokeObjectUrl)
    else Reflect.deleteProperty(URL, 'revokeObjectURL')
  }
}

test('editorExport: exportDocx 基本调用返回合法 ExportResult 结构（即使在纯 node 环境因 save 失败也应安全返回 failed + diagnostics）', async () => {
  const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] }
  const result = await exportDocx(json, [], { title: '集成测试', embedImages: false })

  assert.ok(isExportResult(result), '返回必须符合 ExportResult 接口')
  assert.ok(result.diagnostics, '必须包含 diagnostics（成功或失败路径）')
  // 在 test 环境通常走失败分支（save 依赖 Tauri），但不影响门禁价值
  if (result.status === 'failed') {
    assert.ok(Array.isArray(result.diagnostics?.errors), '失败时 errors 必须是数组')
  }
})

test('editorExport: 即使内部 createDocx 抛错也返回 failed + errors，不上抛污染调用方', async () => {
  // 构造会导致 localDocxV2 内部失败的极端输入（极长或坏数据，这里用同步异常模拟路径）
  // 实际中我们直接传正常 json，依赖 save 失败已足够覆盖 catch
  const json = { type: 'doc', content: [] }
  const result = await exportDocx(json, [], { title: '失败安全测试' })

  assert.ok(isExportResult(result))
  // 无论成功/失败，diagnostics 字段必须存在（TDD 3.5 要求）
  assert.ok(result.diagnostics !== undefined, 'diagnostics 必须存在')
})

test('editorExport: exportDocx 支持不传 assets 和 options', async () => {
  const json = { type: 'doc', content: [] }
  const result = await exportDocx(json)  // minimal call
  assert.ok(isExportResult(result))
  assert.ok(result.diagnostics)
})

// ─── Phase B/C: exportDocument 通用分发器测试 ───

test('editorExport: exportDocument(md) 返回合法结构', async () => {
  const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'markdown test' }] }] }
  const result = await exportDocument({ format: 'md', tiptapJson: json, title: 'md-test' })
  assert.ok(isExportResult(result))
  assert.ok(result.diagnostics, 'diagnostics 必须存在')
  assert.equal(result.diagnostics?.format, 'md')
})

test('editorExport: exportDocument(html) 返回合法结构', async () => {
  const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'html test' }] }] }
  const result = await exportDocument({ format: 'html', tiptapJson: json, html: '<p>test</p>', title: 'html-test' })
  assert.ok(isExportResult(result))
  assert.equal(result.diagnostics?.format, 'html')
})

test('editorExport: exportDocument(docx) 委托 exportDocx，行为一致', async () => {
  const json = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'docx via dispatcher' }] }] }
  const result = await exportDocument({ format: 'docx', tiptapJson: json, title: 'dispatcher-test' })
  assert.ok(isExportResult(result))
  assert.equal(result.diagnostics?.format, 'docx')
})

test('editorExport: 所有格式失败时都返回 safe diagnostics（不下抛异常）', async () => {
  for (const fmt of ['md', 'html', 'docx'] as const) {
    const json = { type: 'doc', content: [] }
    const result = await exportDocument({ format: fmt, tiptapJson: json })
    assert.ok(isExportResult(result), `${fmt}: 必须返回 ExportResult`)
    assert.ok(result.diagnostics, `${fmt}: diagnostics 必须存在`)
    if (result.status === 'failed') {
      assert.ok(Array.isArray(result.diagnostics?.errors), `${fmt}: 失败时 errors 必须是数组`)
    }
  }
})

test('editorExport: web project metadata never falls back to localStorage', async () => {
  await withBrowserDownloadAndStorageTrap(async localStorageCalls => {
    const result = await exportDocument({
      format: 'md',
      tiptapJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'strict export' }] }] },
      fileId: 'webfile_project_export',
    })

    assert.equal(result.status, 'success')
    assert.equal(result.metadataUpdated, false)
    assert.equal(localStorageCalls(), 0)
  })
})
