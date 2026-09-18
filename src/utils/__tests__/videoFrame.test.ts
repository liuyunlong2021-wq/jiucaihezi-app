import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureVideoFrame } from '../videoFrame'

function withFakeCanvas(
  canvas: Record<string, unknown>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = (globalThis as any).document
  ;(globalThis as any).document = { createElement: () => canvas }
  return run().finally(() => {
    ;(globalThis as any).document = previous
  })
}

test('captureVideoFrame 正常截帧返回 PNG Blob', async () => {
  const expected = new Blob(['frame'], { type: 'image/png' })
  await withFakeCanvas(
    {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toBlob: (callback: (blob: Blob | null) => void) => callback(expected),
    },
    async () => {
      const blob = await captureVideoFrame({ videoWidth: 640, videoHeight: 360 } as HTMLVideoElement)
      assert.equal(blob, expected)
    },
  )
})

test('captureVideoFrame 无画面时给出明确错误', async () => {
  await assert.rejects(
    captureVideoFrame({ videoWidth: 0, videoHeight: 0 } as HTMLVideoElement),
    /还没有可截取的画面/,
  )
})

test('captureVideoFrame 画布被跨域污染时引导先保存到项目', async () => {
  await withFakeCanvas(
    {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toBlob: () => {
        throw new DOMException('tainted', 'SecurityError')
      },
    },
    async () => {
      await assert.rejects(
        captureVideoFrame({ videoWidth: 640, videoHeight: 360 } as HTMLVideoElement),
        /请先保存到项目后再试/,
      )
    },
  )
})
