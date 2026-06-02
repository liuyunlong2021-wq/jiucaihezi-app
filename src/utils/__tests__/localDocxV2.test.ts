/**
 * Phase 3 / Audit Item 4: localDocxV2 真实单元测试（node:test 风格）
 * 验证核心导出路径：统一渲染器、图片嵌入、marks、列表、wikiLink、命名空间、ZIP 结构。
 * 这些测试必须通过 pnpm run test:focused 门禁。
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDocxFromTiptap } from '../localDocxV2'

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b // PK..
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

test('localDocxV2: 基础文档 + 标题 + 段落 + marks 应生成有效 ZIP', async () => {
  const json = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', marks: [{ type: 'bold' }], text: '测试标题' }] },
      { type: 'paragraph', content: [
        { type: 'text', marks: [{ type: 'bold' }], text: '加粗' },
        { type: 'text', marks: [{ type: 'italic' }], text: '斜体' },
        { type: 'text', marks: [{ type: 'underline' }], text: '下划线' }
      ]}
    ]
  }
  const bytes = await createDocxFromTiptap({ title: 'Marks测试', json })
  assert.ok(isZip(bytes), '应为 ZIP 签名')
  assert.ok(bytes.length > 200, '体积应 >200 字节')
  const txt = decode(bytes)
  assert.match(txt, /xmlns:w="http:\/\/schemas.openxmlformats.org\/wordprocessingml\/2006\/main"/)
  assert.match(txt, /测试标题/)
  assert.match(txt, /加粗/)
})

test('localDocxV2: WikiLink 应降级为 [[文本]] 并生成文档', async () => {
  const json = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'wikiLink', attrs: { label: '需求文档', target: '需求文档' } }] }
    ]
  }
  const bytes = await createDocxFromTiptap({ title: 'WikiLink测试', json })
  assert.ok(isZip(bytes))
  const txt = decode(bytes)
  assert.match(txt, /\[\[需求文档\]\]/)
})

test('localDocxV2: 任务列表（checked/unchecked）应生成对应 OOXML', async () => {
  const json = {
    type: 'doc',
    content: [{
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '已完成任务' }] }] },
        { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '待办' }] }] }
      ]
    }]
  }
  const bytes = await createDocxFromTiptap({ title: 'TaskList测试', json })
  assert.ok(isZip(bytes))
  const txt = decode(bytes)
  assert.match(txt, /已完成任务/)
  assert.match(txt, /待办/)
})

test('localDocxV2: 含 dataURL 图片 应嵌入 media/ 或安全降级为占位（TDD 关键，node 环境无 Image 时走降级）', async () => {
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
  const json = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '图片测试' }] },
      { type: 'image', attrs: { src: tinyPng, alt: 'tiny' } }
    ]
  }
  const bytes = await createDocxFromTiptap({ title: 'Image测试', json, embedImages: true, compressImages: true })
  assert.ok(isZip(bytes))
  const txt = decode(bytes)
  assert.match(txt, /图片测试/)
  // 真实浏览器/Editor 环境（有 Image + Canvas）会走完整 drawing + media/ 嵌入 + <a:blip
  // node test 环境无 DOM Image，会安全跳过图片处理并降级为 [图片] 占位文本（代码已做防御）
  if (txt.includes('<w:drawing') || txt.includes('media/image_') || txt.includes('<a:blip')) {
    assert.match(txt, /xmlns:pic="http:\/\/schemas.openxmlformats.org\/drawingml\/2006\/picture"/)
    assert.match(txt, /<a:blip r:embed="rId/)
  } else {
    // 降级路径也必须通过（不崩溃 + 占位存在）
    assert.match(txt, /\[图片\]/)
  }
})

test('localDocxV2: 简单表格 JSON 应渲染为 w:tbl（gridSpan 等）', async () => {
  const json = {
    type: 'doc',
    content: [{
      type: 'table',
      content: [
        { type: 'tableRow', content: [
          { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] }
        ]}
      ]
    }]
  }
  const bytes = await createDocxFromTiptap({ title: 'Table测试', json })
  assert.ok(isZip(bytes))
  const txt = decode(bytes)
  assert.match(txt, /<w:tbl/)
  assert.match(txt, /A/)
  assert.match(txt, /B/)
})

test('localDocxV2: 命名空间根声明完整（6 个关键 ns）- TDD 4.1 要求', async () => {
  const bytes = await createDocxFromTiptap({ title: 'NS测试', json: { type: 'doc', content: [{ type: 'paragraph', content: [] }] } })
  const txt = decode(bytes)
  assert.match(txt, /xmlns:w="http:\/\/schemas.openxmlformats.org\/wordprocessingml\/2006\/main"/)
  assert.match(txt, /xmlns:r="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships"/)
  assert.match(txt, /xmlns:wp="http:\/\/schemas.openxmlformats.org\/drawingml\/2006\/wordprocessingDrawing"/)
  assert.match(txt, /xmlns:a="http:\/\/schemas.openxmlformats.org\/drawingml\/2006\/main"/)
  assert.match(txt, /xmlns:pic="http:\/\/schemas.openxmlformats.org\/drawingml\/2006\/picture"/)
  // mc 也应存在（用于图片 fallback）
  assert.match(txt, /xmlns:mc=/)
})

test('localDocxV2: 空/最小文档不应崩溃且为有效 ZIP', async () => {
  const bytes = await createDocxFromTiptap({ title: '空文档', json: { type: 'doc', content: [] } })
  assert.ok(isZip(bytes))
  assert.ok(bytes.length > 50)
})