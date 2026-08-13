import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_COMFY_UI_API_BASE, getComfyUiApiBase, saveComfyUiApiBase } from '../comfyUiRuntime'

test('ComfyUI address uses a local default and persists a normalized URL', () => {
  const store = new Map<string, string>()
  assert.equal(getComfyUiApiBase(store), DEFAULT_COMFY_UI_API_BASE)
  assert.equal(saveComfyUiApiBase(' http://127.0.0.1:8000/// ', store), DEFAULT_COMFY_UI_API_BASE)
  assert.equal(getComfyUiApiBase(store), DEFAULT_COMFY_UI_API_BASE)
})

test('ComfyUI address rejects non-http URLs', () => {
  assert.throws(() => saveComfyUiApiBase('file:///tmp/comfyui', new Map()), /http/)
})
