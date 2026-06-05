import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { getLocalCapabilities } from '../localCapabilities'

const root = process.cwd()

function installStorage() {
  const store = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)) },
    removeItem: (key: string) => { store.delete(key) },
  }
  ;(globalThis as any).window = {
    dispatchEvent: () => true,
  }
}

test('media url capture is an active tool, not a local capability setup item', async () => {
  installStorage()

  const ids = getLocalCapabilities().map(cap => cap.id)
  assert.equal(ids.includes('ytdlp'), false)
  assert.equal(ids.includes('local_media_url_download'), false)
})

test('local capabilities do not expose media capture component detection', () => {
  const source = readFileSync(join(root, 'src/utils/localCapabilities.ts'), 'utf8')

  assert.doesNotMatch(source, /detectYtdlpCapability/)
  assert.doesNotMatch(source, /ytdlp/i)
  assert.doesNotMatch(source, /yt-dlp/i)
  assert.doesNotMatch(source, /jc_ytdlp/)
  assert.doesNotMatch(source, /ytdlp_detect/)
})
