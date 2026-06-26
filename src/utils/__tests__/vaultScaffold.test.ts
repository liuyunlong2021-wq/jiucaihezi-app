import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildVaultScaffoldInput } from '../vaultScaffold'

const template = {
  id: 'tpl_test',
  name: '测试库',
  icon: 'folder',
  oneLineDesc: '测试模板',
  keywords: [],
  type: 'general' as const,
  claudeMd: '# 测试库',
  rawFolders: ['草稿', '资料/原文'],
  wikiFolders: ['角色/主角', '世界观'],
}

test('builds deterministic vault scaffold folders and files from a template', () => {
  const input = buildVaultScaffoldInput(template)

  assert.deepEqual(input.folders, [
    '.raw',
    '.raw/草稿',
    '.raw/资料/原文',
    'wiki',
    'wiki/角色/主角',
    'wiki/世界观',
  ])
  assert.deepEqual(input.files, [
    ['CLAUDE.md', '# 测试库'],
    ['wiki/hot.md', '# 热缓存\n\n'],
    ['wiki/index.md', '# 测试库索引\n\n'],
  ])
})

test('rejects unsafe template folder paths before invoking native writes', () => {
  assert.throws(
    () => buildVaultScaffoldInput({ ...template, rawFolders: ['../secret'] }),
    /路径不能跳出知识库目录/,
  )
})
