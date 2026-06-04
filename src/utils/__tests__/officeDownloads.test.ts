import assert from 'node:assert/strict'
import { test } from 'node:test'

import { extractOfficeDownloadFiles } from '../officeDownloads'

test('extracts local media asset downloads from tool JSON', () => {
  const files = extractOfficeDownloadFiles(JSON.stringify({
    status: 'success',
    output_files: [
      {
        filename: 'lesson_audio.mp3',
        download_url: 'asset://localhost/Users/by3/Library/Application%20Support/jiucaihezi/media-outputs/lesson_audio.mp3',
        size: 12345,
      },
    ],
  }))

  assert.equal(files.length, 1)
  assert.equal(files[0].filename, 'lesson_audio.mp3')
  assert.match(files[0].url, /^asset:\/\//)
})

test('extracts local html review artifacts only from asset URLs', () => {
  const files = extractOfficeDownloadFiles(JSON.stringify({
    output_files: [
      {
        filename: 'Skill评审页.html',
        download_url: 'asset://localhost/Users/by3/Library/Application%20Support/jiucaihezi/skill-workspaces/review/eval-review.html',
        size: 2048,
      },
      {
        filename: 'remote.html',
        download_url: 'https://example.com/remote.html',
      },
    ],
  }))

  assert.equal(files.length, 1)
  assert.equal(files[0].filename, 'Skill评审页.html')
  assert.match(files[0].url, /^asset:\/\//)
  assert.equal(files[0].artifactKind, 'html')
  assert.equal(files[0].localPath, '/Users/by3/Library/Application Support/jiucaihezi/skill-workspaces/review/eval-review.html')
  assert.equal(files[0].mimeType, 'text/html')
  assert.match(files[0].artifactId || '', /^artifact_asset_/)
})

test('rejects asset html outside Skill Creator review workspace', () => {
  const files = extractOfficeDownloadFiles(JSON.stringify({
    output_files: [
      {
        filename: 'Skill评审页.html',
        download_url: 'asset://localhost/Users/by3/Documents/random/eval-review.html',
      },
      {
        filename: 'other.html',
        download_url: 'asset://localhost/Users/by3/Library/Application%20Support/jiucaihezi/skill-workspaces/review/eval-results.html',
      },
    ],
  }))

  assert.equal(files.length, 0)
})

test('extracts local skill package manifest artifacts only from skill package assets', () => {
  const files = extractOfficeDownloadFiles(JSON.stringify({
    output_files: [
      {
        filename: 'skill-package.json',
        download_url: 'asset://localhost/Users/by3/Library/Application%20Support/jiucaihezi/skills/skill_abc/skill-package.json',
      },
      {
        filename: 'random.json',
        download_url: 'asset://localhost/Users/by3/Documents/random.json',
      },
      {
        filename: 'remote.json',
        download_url: 'https://example.com/remote.json',
      },
    ],
  }))

  assert.equal(files.length, 1)
  assert.equal(files[0].filename, 'skill-package.json')
  assert.equal(files[0].artifactKind, 'text')
  assert.equal(files[0].mimeType, 'application/json')
  assert.equal(files[0].localPath, '/Users/by3/Library/Application Support/jiucaihezi/skills/skill_abc/skill-package.json')
})

test('rejects broad data url downloads from tool output', () => {
  const files = extractOfficeDownloadFiles(JSON.stringify({
    filename: 'payload.html',
    download_url: 'data:text/html,<script>alert(1)</script>.html',
  }))

  assert.equal(files.length, 0)
})
