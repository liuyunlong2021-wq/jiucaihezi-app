import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readLocalToolsEnabled, writeLocalToolsEnabled } from '../localToolsPreference'

function createStore(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial))
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => { data.delete(key) },
    setItem: (key: string, value: string) => { data.set(key, value) },
  }
}

test('local tools are disabled by default for a manual workbench', () => {
  assert.equal(readLocalToolsEnabled(createStore()), false)
})

test('stored preference explicitly controls local tools', () => {
  assert.equal(readLocalToolsEnabled(createStore({ jc_local_tools_enabled: '0' })), false)
  assert.equal(readLocalToolsEnabled(createStore({ jc_local_tools_enabled: '1' })), true)
})

test('writes persisted local tools preference', () => {
  const store = createStore()

  writeLocalToolsEnabled(false, store)
  assert.equal(store.getItem('jc_local_tools_enabled'), '0')

  writeLocalToolsEnabled(true, store)
  assert.equal(store.getItem('jc_local_tools_enabled'), '1')
})
