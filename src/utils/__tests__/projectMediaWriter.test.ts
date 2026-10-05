import assert from 'node:assert/strict'
import { test } from 'node:test'
import { downloadProjectMedia } from '../projectMediaWriter'

test('project download routes original credential reference and byte progress then cancels the native transfer', { concurrency: false }, async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const calls: string[] = []
  let rejectTransfer: (error: Error) => void = () => {}
  let lastBytes = 0
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __TAURI_INTERNALS__: {
    transformCallback() { return 1 }, unregisterCallback() {},
    async invoke(command: string, args: any) {
      calls.push(command)
      if (command === 'http_download_to_project') {
        assert.equal(args.request.credential_ref, 'original-key-reference')
        assert.equal(args.request.root, '/projects/original')
        args.onProgress.onmessage({ bytes: 4096, total: 8192, attempt: 1 })
        return new Promise((_resolve, reject) => { rejectTransfer = reject })
      }
      if (command === 'http_cancel_project_download') { rejectTransfer(new Error('下载已暂停')); return }
      throw new Error(`unexpected ${command}`)
    },
  } } })
  const controller = new AbortController()
  try {
    const promise = downloadProjectMedia({ url: 'https://api.jiucaihezi.studio/v1/videos/task_test/content', credentialRef: 'original-key-reference',
      signal: controller.signal, onProgress: p => { lastBytes = p.bytes }, projectDir: '/projects/original', mime: 'video/mp4', kind: 'video', taskId: 'test' })
    const stopped = assert.rejects(promise, /暂停/)
    for (let n = 0; n < 30 && !lastBytes; n++) await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(lastBytes, 4096)
    controller.abort()
    await stopped
    assert.deepEqual(calls, ['http_download_to_project', 'http_cancel_project_download'])
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else delete (globalThis as any).window
  }
})
