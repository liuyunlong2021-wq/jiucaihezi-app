import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildVaultScaffold, normalizeVaultPath, parentFoldersForWikiFile } from '../vaultScaffold'

test('buildVaultScaffold creates the 2.0 default protocol', () => {
  const scaffold = buildVaultScaffold({
    name: '小红书工具书',
    oneLineDesc: '小红书运营方法和模板',
    keywords: ['小红书', '运营'],
    wikiFolders: ['基础概念', '操作流程'],
  })

  assert.ok(scaffold.claudeMd.includes('raw/转换后的MD'))
  assert.ok(scaffold.claudeMd.includes('wiki/index.md'))
  assert.deepEqual(scaffold.rawFolders, ['对话记录', '上传资料', '原始文件', '转换后的MD'])
  assert.ok(scaffold.wikiFolders.includes('meta'))
  assert.ok(scaffold.wikiFolders.includes('基础概念'))
  assert.ok(scaffold.reportFolders.includes('健康检查'))
  assert.ok(scaffold.reportFolders.includes('覆盖率报告'))
  assert.ok(scaffold.wikiFiles.some(file => file.path === 'index.md'))
  assert.ok(scaffold.wikiFiles.some(file => file.path === 'overview.md'))
  assert.ok(scaffold.wikiFiles.some(file => file.path === 'hot.md'))
  assert.ok(scaffold.wikiFiles.some(file => file.path === 'log.md'))
  assert.ok(scaffold.wikiFiles.some(file => file.path === 'meta/dashboard.md'))
  assert.ok(scaffold.wikiFiles.some(file => file.path === 'meta/health.md'))
  assert.ok(scaffold.templateFiles.some(file => file.path === 'entity.md'))
})

test('buildVaultScaffold turns seed page specs into wiki markdown files', () => {
  const scaffold = buildVaultScaffold({
    name: '工具书',
    seedPages: [
      {
        path: '操作流程/账号冷启动流程',
        title: '账号冷启动流程',
        summary: '新账号前 7-14 天的启动流程。',
        sources: ['raw/转换后的MD/工具书.md#第三章'],
        tags: ['流程'],
        confidence: 'high',
      },
    ],
  })

  const seed = scaffold.wikiFiles.find(file => file.path === '操作流程/账号冷启动流程.md')
  assert.ok(seed)
  assert.ok(seed!.content.includes('# 账号冷启动流程'))
  assert.ok(seed!.content.includes('raw/转换后的MD/工具书.md#第三章'))
  assert.ok(seed!.content.includes('## 适用场景'))
  assert.ok(scaffold.wikiFolders.includes('操作流程'))
})

test('parentFoldersForWikiFile skips root wiki files and expands nested folders', () => {
  assert.deepEqual(parentFoldersForWikiFile('index.md'), [])
  assert.deepEqual(parentFoldersForWikiFile('meta/dashboard.md'), ['meta'])
  assert.deepEqual(parentFoldersForWikiFile('角色/主角/张三.md'), ['角色', '角色/主角'])
})

test('normalizeVaultPath drops traversal-only path segments', () => {
  assert.equal(normalizeVaultPath('../wiki/./角色/../../张三.md'), 'wiki/角色/张三.md')
})
