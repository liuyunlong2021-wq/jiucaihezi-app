import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCreationRunPlan } from '../creationMediaPlan'
import { buildCreationSubmitRequest } from '../creationMediaRuntime'

test('local Z-Image uses the ComfyUI route', () => {
  const plan = buildCreationRunPlan({ modelId: 'local-comfy/z-image-turbo', params: { prompt: '一只猫', resolution: '1080p', aspectRatio: '9:16' } })
  const request = buildCreationSubmitRequest(plan)
  assert.equal(plan.route, 'local-comfy')
  assert.equal(request.runtime, 'local-comfy')
  assert.equal(request.imageParams?.resolution, '1080p')
  assert.equal(request.imageParams?.aspectRatio, '9:16')
})
