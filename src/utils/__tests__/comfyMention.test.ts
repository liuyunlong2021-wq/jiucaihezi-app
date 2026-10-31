import assert from 'node:assert/strict'
import test from 'node:test'
import { stripExplicitComfyMention } from '../comfyMention'

test('literal @comfyui becomes an execution target instead of prompt text', () => {
  assert.deepEqual(stripExplicitComfyMention('@comfyui 生成一张图'), { explicit: true, message: '生成一张图' })
  assert.deepEqual(stripExplicitComfyMention('请用 @ComfyUI 生成视频'), { explicit: true, message: '请用 生成视频' })
  assert.deepEqual(stripExplicitComfyMention('介绍 ComfyUI'), { explicit: false, message: '介绍 ComfyUI' })
})
