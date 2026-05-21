import assert from 'node:assert/strict'
import { test } from 'node:test'

import { vaultRootFolderTypeForPath } from '../vaultPath'

test('vaultRootFolderTypeForPath resolves report and template roots', () => {
  assert.equal(vaultRootFolderTypeForPath('_reports/健康检查'), 'reports')
  assert.equal(vaultRootFolderTypeForPath('_templates/entity.md'), 'templates')
})

test('vaultRootFolderTypeForPath keeps raw and wiki roots unchanged', () => {
  assert.equal(vaultRootFolderTypeForPath('raw/对话记录'), 'raw')
  assert.equal(vaultRootFolderTypeForPath('wiki/角色'), 'wiki')
})
