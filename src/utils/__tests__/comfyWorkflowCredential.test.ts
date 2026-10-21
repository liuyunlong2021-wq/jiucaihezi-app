import assert from 'node:assert/strict'
import test from 'node:test'
import { getComfyWorkflowApiKey, saveComfyWorkflowApiKey } from '../comfyWorkflowCredential'

test('workflow secrets migrate only after secure storage succeeds and failed updates retain the previous key', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const values = new Map([['jcComfyWorkflowApiKeySession', 'legacy-test-key']])
  let saved = ''
  let fail = true
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { __TAURI_INTERNALS__: {
    async invoke(command: string, args: any) {
      if (command === 'get_comfy_workflow_api_key') return saved
      if (command === 'set_comfy_workflow_api_key') { if (fail) throw Error('keychain unavailable'); saved = args.value; return }
      throw Error(command)
    },
  } } })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) || null,
    removeItem: (key: string) => values.delete(key),
  } })
  try {
    await assert.rejects(getComfyWorkflowApiKey(), /keychain unavailable/)
    assert.equal(values.get('jcComfyWorkflowApiKeySession'), 'legacy-test-key')
    fail = false
    assert.equal(await getComfyWorkflowApiKey(), 'legacy-test-key')
    assert.equal(saved, 'legacy-test-key')
    assert.equal(values.size, 0)
    fail = true
    await assert.rejects(saveComfyWorkflowApiKey('new-test-key'), /keychain unavailable/)
    assert.equal(await getComfyWorkflowApiKey(), 'legacy-test-key')
    fail = false
    await saveComfyWorkflowApiKey('new-test-key')
    assert.equal(await getComfyWorkflowApiKey(), 'new-test-key')
    assert.equal(values.size, 0)
  } finally {
    for (const [name, descriptor] of [['window', previousWindow], ['sessionStorage', previousSession]] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
})
