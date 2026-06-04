import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  assetUrlToLocalPath,
  buildToolArtifactFromDownloadFile,
  openOfficeDownloadFile,
} from '../artifacts'

test('assetUrlToLocalPath decodes safe local asset urls and rejects traversal', () => {
  assert.equal(
    assetUrlToLocalPath('asset://localhost/Users/by3/Library/Application%20Support/jiucaihezi/skill-workspaces/review/eval-review.html'),
    '/Users/by3/Library/Application Support/jiucaihezi/skill-workspaces/review/eval-review.html',
  )
  assert.equal(assetUrlToLocalPath('asset://localhost/Users/by3/../secret.txt'), '')
  assert.equal(assetUrlToLocalPath('asset://remotehost/Users/by3/file.docx'), '')
  assert.equal(assetUrlToLocalPath('https://example.com/file.docx'), '')
})

test('buildToolArtifactFromDownloadFile creates stable local artifact metadata', () => {
  const artifact = buildToolArtifactFromDownloadFile({
    filename: 'Skill评审页.html',
    url: 'asset://localhost/Users/by3/Library/Application%20Support/jiucaihezi/skill-workspaces/review/eval-review.html',
    size: 2048,
  }, 1710000000000)

  assert.equal(artifact.id, 'artifact_asset_Skill评审页.html_asset___localhost_Users_by3_Library_Application_20Support_jiucaihezi_skill_workspaces_review_eval_review_html')
  assert.equal(artifact.kind, 'html')
  assert.equal(artifact.filename, 'Skill评审页.html')
  assert.equal(artifact.path, '/Users/by3/Library/Application Support/jiucaihezi/skill-workspaces/review/eval-review.html')
  assert.equal(artifact.localPath, '/Users/by3/Library/Application Support/jiucaihezi/skill-workspaces/review/eval-review.html')
  assert.equal(artifact.mimeType, 'text/html')
  assert.equal(artifact.bytes, 2048)
  assert.equal(artifact.createdAt, 1710000000000)
})

test('buildToolArtifactFromDownloadFile keeps remote documents openable with mime metadata', () => {
  const artifact = buildToolArtifactFromDownloadFile({
    filename: 'report.docx',
    url: 'https://example.com/report.docx',
  }, 1710000000001)

  assert.equal(artifact.kind, 'document')
  assert.equal(artifact.path, 'https://example.com/report.docx')
  assert.equal(artifact.localPath, undefined)
  assert.equal(artifact.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
})

test('buildToolArtifactFromDownloadFile records skill package manifest metadata', () => {
  const artifact = buildToolArtifactFromDownloadFile({
    filename: 'skill-package.json',
    url: 'asset://localhost/Users/by3/Library/Application%20Support/jiucaihezi/skills/skill_abc/skill-package.json',
  }, 1710000000002)

  assert.equal(artifact.kind, 'text')
  assert.equal(artifact.path, '/Users/by3/Library/Application Support/jiucaihezi/skills/skill_abc/skill-package.json')
  assert.equal(artifact.mimeType, 'application/json')
})

test('openOfficeDownloadFile opens local asset files through native shell first', async () => {
  const calls: string[] = []
  await openOfficeDownloadFile({
    filename: 'Skill评审页.html',
    url: 'asset://localhost/Users/by3/Library/Application%20Support/jiucaihezi/skill-workspaces/review/eval-review.html',
  }, {
    shellOpen: async path => { calls.push(`shell:${path}`) },
    windowOpen: url => { calls.push(`window:${url}`) },
    openExternal: async url => { calls.push(`external:${url}`) },
  })

  assert.deepEqual(calls, [
    'shell:/Users/by3/Library/Application Support/jiucaihezi/skill-workspaces/review/eval-review.html',
  ])
})

test('openOfficeDownloadFile falls back to window open when shell open fails', async () => {
  const calls: string[] = []
  await openOfficeDownloadFile({
    filename: 'Skill评审页.html',
    url: 'asset://localhost/Users/by3/Library/Application%20Support/jiucaihezi/skill-workspaces/review/eval-review.html',
  }, {
    shellOpen: async () => { throw new Error('shell unavailable') },
    windowOpen: url => { calls.push(`window:${url}`) },
    openExternal: async url => { calls.push(`external:${url}`) },
  })

  assert.deepEqual(calls, [
    'window:asset://localhost/Users/by3/Library/Application%20Support/jiucaihezi/skill-workspaces/review/eval-review.html',
  ])
})

test('openOfficeDownloadFile sends http urls to openExternal', async () => {
  const calls: string[] = []
  await openOfficeDownloadFile({
    filename: 'report.pdf',
    url: 'https://example.com/report.pdf',
  }, {
    shellOpen: async path => { calls.push(`shell:${path}`) },
    windowOpen: url => { calls.push(`window:${url}`) },
    openExternal: async url => { calls.push(`external:${url}`) },
  })

  assert.deepEqual(calls, ['external:https://example.com/report.pdf'])
})
