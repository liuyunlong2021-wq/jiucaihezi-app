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
