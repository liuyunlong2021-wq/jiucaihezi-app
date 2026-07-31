import assert from 'node:assert/strict'
import { test } from 'node:test'

import { nextMaterialPath, materialMarkdownPath } from '../projectMaterials'

test('material paths preserve names and never overwrite an existing upload', () => {
  const existing = new Set([
    'jc-materials/originals/方案.docx',
    'jc-materials/originals/方案 (1).docx',
  ])

  const original = nextMaterialPath('jc-materials/originals', '方案.docx', existing)
  assert.equal(original, 'jc-materials/originals/方案 (2).docx')
  assert.equal(materialMarkdownPath(original), 'jc-materials/markdown/方案 (2).docx.md')
})

test('material paths remove path traversal without losing the user-facing filename', () => {
  assert.equal(
    nextMaterialPath('jc-materials/originals', '../会议/纪要?.docx', new Set()),
    'jc-materials/originals/纪要_.docx',
  )
})
