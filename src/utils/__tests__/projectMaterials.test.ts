import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextMaterialPath, materialMarkdownPath } from '../projectMaterials'

test('material paths preserve names and never overwrite an existing upload', () => {
  const existing = new Set([
    '.raw/jc-media/文档/方案.docx',
    '.raw/jc-media/文档/方案 (1).docx',
  ])

  const original = nextMaterialPath('.raw/jc-media/文档', '方案.docx', existing)
  assert.equal(original, '.raw/jc-media/文档/方案 (2).docx')
  assert.equal(materialMarkdownPath(original), '.raw/jc-media/文档/方案 (2).md')
})

test('material paths remove path traversal without losing the user-facing filename', () => {
  assert.equal(
    nextMaterialPath('.raw/jc-media/文档', '../会议/纪要?.docx', new Set()),
    '.raw/jc-media/文档/纪要_.docx',
  )
})
