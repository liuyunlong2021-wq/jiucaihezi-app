import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCreationRunPlan } from '../creationMediaPlan'
import { buildComfyUploadRequestData, buildCreationSubmitRequest, buildLocalGrokVideoPrompt, firstComfyVideoUrl } from '../creationMediaRuntime'

test('local Z-Image uses the ComfyUI route', () => {
  const plan = buildCreationRunPlan({ modelId: 'local-comfy/z-image-turbo', params: { prompt: '一只猫', resolution: '1080p', aspectRatio: '9:16' } })
  const request = buildCreationSubmitRequest(plan)
  assert.equal(plan.route, 'local-comfy')
  assert.equal(request.runtime, 'local-comfy')
  assert.equal(request.imageParams?.resolution, '1080p')
  assert.equal(request.imageParams?.aspectRatio, '9:16')
})

test('local Grok workflow maps seven images to the verified ComfyUI slots', () => {
  const images = ['1.png', '2.png', '3.png', '4.png', '5.png', '6.png', '7.png']
  const workflow = buildLocalGrokVideoPrompt({
    prompt: '镜头提示词', ratio: '16:9', duration: '8', resolution: '720P', apiKey: 'secret', images,
  })
  assert.equal(workflow['7'].inputs.prompt[0], '16')
  assert.deepEqual(images.map((_, index) => workflow['7'].inputs[`image${index + 1}`]), [
    ['22', 0], ['10', 0], ['13', 0], ['9', 0], ['11', 0], ['12', 0], ['23', 0],
  ])
  assert.equal(workflow['22'].inputs.image, '1.png')
  assert.equal(workflow['23'].inputs.image, '7.png')
  assert.deepEqual(workflow['18'].inputs.anything, ['7', 3])
  assert.equal(workflow['20'], undefined)
  assert.equal(JSON.stringify(workflow).includes('secret'), true)
})

test('local Grok workflow reads the remote video URL without SaveVideo', () => {
  assert.equal(
    firstComfyVideoUrl({ 18: { text: ['https://cdn.example.test/video.mp4?token=ok'] } }),
    'https://cdn.example.test/video.mp4?token=ok',
  )
})

test('local Comfy upload uses Rust snake_case request fields', () => {
  const request = buildComfyUploadRequestData('http://127.0.0.1:8000', 0, 'image/png', 'abc')
  assert.equal(request.mime_type, 'image/png')
  assert.equal(request.data_base64, 'abc')
  assert.equal('mimeType' in request, false)
})

test('local Grok plan accepts up to seven canvas references', () => {
  const plan = buildCreationRunPlan({
    modelId: 'local-comfy/grok-video-3-30s',
    params: { prompt: '镜头提示词', ratio: '16:9', resolution: '720P', duration: 8, images: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
  })
  assert.equal(plan.task, 'video')
  assert.equal(plan.route, 'local-comfy')
  assert.equal(plan.debug.referenceImageCount, 7)
})
