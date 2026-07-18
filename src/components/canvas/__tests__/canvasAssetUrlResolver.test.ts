import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CanvasAssetUrlResolver } from '../canvasAssetUrlResolver'

test('reuses and revokes a Web object URL when its canvas session is released', async () => {
  const revoked: string[] = []
  let created = 0
  const resolver = new CanvasAssetUrlResolver(url => revoked.push(url))

  const first = await resolver.acquire('project-a', 'jc-media/audios/voice.mp3', async () => {
    created++
    return { url: 'blob:voice', revoke: true }
  })
  const second = await resolver.acquire('project-a', 'jc-media/audios/voice.mp3', async () => {
    created++
    return { url: 'blob:unexpected', revoke: true }
  })

  assert.equal(first.url, 'blob:voice')
  assert.equal(second.url, 'blob:voice')
  assert.equal(created, 1)
  resolver.releaseAll()
  assert.deepEqual(revoked, ['blob:voice'])
})

test('does not revoke a Desktop runtime URL', async () => {
  const revoked: string[] = []
  const resolver = new CanvasAssetUrlResolver(url => revoked.push(url))

  await resolver.acquire('/project-a', 'jc-media/audios/voice.mp3', async () => ({
    url: 'asset://localhost/project-a/jc-media/audios/voice.mp3',
  }))
  resolver.releaseAll()

  assert.deepEqual(revoked, [])
})

test('releases a deleted card URL without clearing another card URL', async () => {
  const revoked: string[] = []
  const resolver = new CanvasAssetUrlResolver(url => revoked.push(url))

  await resolver.acquire('project-a', 'jc-media/images/a.png:file-a', async () => ({ url: 'blob:a', revoke: true }))
  await resolver.acquire('project-a', 'jc-media/images/b.png:file-b', async () => ({ url: 'blob:b', revoke: true }))
  resolver.releaseMatching('project-a', 'jc-media/images/a.png')

  assert.deepEqual(revoked, ['blob:a'])
})
