import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

test('canvas result node types persist poll metadata for recovery', () => {
  const source = readSource('src/types/canvas.ts')

  assert.equal(source.includes("pollKind?: 'image' | 'video' | 'audio'"), true)
  assert.equal(source.includes('export interface CanvasAudioResultNodeData'), true)
  assert.equal(source.includes('export interface CanvasVideoResultNodeData'), true)
})

test('canvas import sanitizes untrusted result urls and poll urls', () => {
  const source = readSource('src/components/canvas/utils/canvasSerialization.ts')

  assert.equal(source.includes("import { isAllowedCreationPollUrl, isAllowedCreationResultUrl } from '@/utils/urlSafety'"), true)
  assert.equal(source.includes('function sanitizeResultNodeData'), true)
  assert.equal(source.includes("delete next.url"), true)
  assert.equal(source.includes("delete next.pollUrl"), true)
})

test('canvas media runtime can resume submitted result nodes safely', () => {
  const source = readSource('src/components/canvas/runtime/canvasMediaRuntime.ts')

  assert.equal(source.includes("import { generateAudio, generateImage, generateVideo, pollTask } from '@/api/media-generation'"), true)
  assert.equal(source.includes("import { isCloudLoggedIn } from '@/services/newApiAuth'"), true)
  assert.equal(source.includes('function assertCanvasMediaCloudLoggedIn'), true)
  assert.equal(source.includes("throw new Error('使用云端模型需要先登录，请在设置中登录')"), true)
  assert.equal(source.includes('export async function resumeCanvasResultNode'), true)
  assert.equal(source.includes('assertSafePollUrl(pollUrl)'), true)
  assert.equal(source.includes('const safeUrl = assertSafeCanvasResultUrl(mediaUrl)'), true)
  assert.equal(source.includes("detail: '恢复完成'"), true)
  assert.equal(source.includes('pollKind: result.pollKind'), true)
})

test('audio and video result nodes expose a bounded resume action', () => {
  const video = readSource('src/components/canvas/nodes/CanvasVideoResultNode.vue')
  const audio = readSource('src/components/canvas/nodes/CanvasAudioResultNode.vue')

  for (const source of [video, audio]) {
    assert.equal(source.includes("import { resumeCanvasResultNode } from '@/components/canvas/runtime/canvasMediaRuntime'"), true)
    assert.equal(source.includes('const canResume = computed(() =>'), true)
    assert.equal(source.includes('async function resumeTask()'), true)
    assert.equal(source.includes('@click.stop="resumeTask"'), true)
    assert.equal(source.includes('恢复'), true)
  }
})
