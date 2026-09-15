import assert from 'node:assert/strict'
import test from 'node:test'
import { acquireProjectMediaDisplay } from '../projectMediaResolver'
import type { ProjectResource } from '@/utils/projectResource'

function media(runtime: 'desktop' | 'web'): ProjectResource {
  return {
    runtime,
    owner: runtime === 'desktop' ? '/projects/demo/' : 'web-demo',
    path: 'jc-media/videos/demo.mp4',
    name: 'demo.mp4',
    isDirectory: false,
    kind: 'media',
    mimeType: 'video/mp4',
  }
}

test('desktop display lease resolves a stable project resource without reading bytes', async () => {
  let converted = ''
  const lease = await acquireProjectMediaDisplay(media('desktop'), {
    async convertDesktopPath(path) { converted = path; return `asset:${path}` },
    async readWebSource() { throw new Error('must not read web bytes') },
    createObjectUrl() { throw new Error('must not create object URL') },
    revokeObjectUrl() { throw new Error('must not revoke desktop URL') },
  })
  assert.equal(converted, '/projects/demo/jc-media/videos/demo.mp4')
  assert.equal(lease.url, 'asset:/projects/demo/jc-media/videos/demo.mp4')
  lease.release()
})

test('web display lease owns and releases its object URL exactly once', async () => {
  let revoked = 0
  const lease = await acquireProjectMediaDisplay(media('web'), {
    async convertDesktopPath() { throw new Error('must not convert web path') },
    async readWebSource(owner, path) {
      assert.equal(owner, 'web-demo')
      assert.equal(path, 'jc-media/videos/demo.mp4')
      return new Blob(['video'], { type: 'video/mp4' })
    },
    createObjectUrl(blob) { assert.equal(blob.type, 'video/mp4'); return 'blob:demo' },
    revokeObjectUrl(url) { assert.equal(url, 'blob:demo'); revoked++ },
  })
  assert.equal(lease.url, 'blob:demo')
  lease.release()
  lease.release()
  assert.equal(revoked, 1)
})

test('web legacy or remote media URL remains a runtime product, not a new identity', async () => {
  const lease = await acquireProjectMediaDisplay(media('web'), {
    async convertDesktopPath() { throw new Error('must not convert web path') },
    async readWebSource() { return 'https://cdn.example.com/demo.mp4' },
    createObjectUrl() { throw new Error('must not create object URL') },
    revokeObjectUrl() { throw new Error('must not revoke remote URL') },
  })
  assert.equal(lease.url, 'https://cdn.example.com/demo.mp4')
  lease.release()
})

test('display lease rejects non-media resources', async () => {
  await assert.rejects(
    () => acquireProjectMediaDisplay({ ...media('web'), kind: 'document' }),
    /不是有效的项目媒体资源/,
  )
})
