import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('desktop ComfyUI no longer owns HTTP probes, uploads or polling', () => {
  const source = readFileSync('src/runtime/creation/creationMediaRuntime.ts', 'utf8')
  assert.doesNotMatch(source, /localComfyJson|comfy_upload_image|\/history\/|comfyServiceHeaders/)
  assert.match(source, /runComfyWorkflow/)
  const settings = readFileSync('src/components/memory/MemorySettings.vue', 'utf8')
  assert.doesNotMatch(settings, /refreshComfyUi|saveWorkflowConnection|probeComfyUi/)
  assert.match(settings, /打开 MCP 设置/)
})
