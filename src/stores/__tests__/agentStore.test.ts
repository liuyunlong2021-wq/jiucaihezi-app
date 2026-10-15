import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { useAgentStore } from '../agentStore'
import type { SkillConfig } from '../../types/skill'
import { __resetApiKeyMemoryCacheForTests } from '../../services/newApiClient'

function installLocalStorage(values: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(values))
  const previous = (globalThis as any).localStorage
  const previousWindow = (globalThis as any).window
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
  ;(globalThis as any).window = { location: { href: 'http://localhost/' } }
  return {
    restore() {
      ;(globalThis as any).localStorage = previous
      ;(globalThis as any).window = previousWindow
    },
    get(key: string) {
      return store.get(key) ?? null
    },
  }
}

function skill(patch: Partial<SkillConfig> = {}): SkillConfig {
  return {
    id: 'custom-skill-create-test',
    name: '测试 Skill',
    description: '用于验证创建链路',
    triggers: ['测试'],
    skillContent: '## 角色\n你是测试 Skill',
    references: [],
    examples: [],
    version: 1,
    source: 'user',
    createdAt: 1,
    updatedAt: 1,
    evolutionLog: [],
    ...patch,
  }
}

test('Web restores only installed user Skills', { concurrency: false }, async () => {
  const legacySkill = skill({ id: 'legacy-writing-skill', name: '旧写作 Skill' })
  const storage = installLocalStorage({ jc_web_skills_v1: JSON.stringify([legacySkill]) })
  try {
    setActivePinia(createPinia())
    const agentStore = useAgentStore()

    await agentStore.bootstrapWebSkills()

    assert.deepEqual(agentStore.inMemorySkills.map(item => item.id), ['legacy-writing-skill'])
    assert.equal(agentStore.getSkillById('legacy-writing-skill')?.source, 'user')
  } finally {
    storage.restore()
  }
})

test('Web creates, edits, and deletes user Skills in local storage', async () => {
  const storage = installLocalStorage()
  try {
    setActivePinia(createPinia())
    const agentStore = useAgentStore()

    await agentStore.createAgent(skill())
    assert.equal(JSON.parse(storage.get('jc_web_skills_v1') || '[]')[0]?.name, '测试 Skill')
    assert.equal(agentStore.getMySkills().some(item => item.id === 'custom-skill-create-test'), true)

    agentStore.updateSkill('custom-skill-create-test', { name: '修改后的 Skill' })
    assert.equal(JSON.parse(storage.get('jc_web_skills_v1') || '[]')[0]?.name, '修改后的 Skill')

    await agentStore.deleteAgent('custom-skill-create-test')
    assert.deepEqual(JSON.parse(storage.get('jc_web_skills_v1') || '[]'), [])

  } finally {
    storage.restore()
  }
})

test('agentStore initialization does not delete legacy persisted Skill data', () => {
  const storage = installLocalStorage({
    jc_skills_v2: JSON.stringify([{ id: 'legacy-skill' }]),
    jc_my_skills: JSON.stringify(['legacy-skill']),
    jc_call_counts: JSON.stringify({ 'legacy-skill': 3 }),
  })
  try {
    setActivePinia(createPinia())
    useAgentStore()

    assert.equal(storage.get('jc_skills_v2'), JSON.stringify([{ id: 'legacy-skill' }]))
    assert.equal(storage.get('jc_my_skills'), JSON.stringify(['legacy-skill']))
    assert.equal(storage.get('jc_call_counts'), JSON.stringify({ 'legacy-skill': 3 }))
  } finally {
    storage.restore()
  }
})

test('old fabricated 1M cache is estimated conservatively, while declared 1M remains intact', () => {
  for (const declared of [false, true]) {
    const models = Array.from({ length: 20 }, (_, i) => ({ id: `cached-${i}`, label: `cached-${i}`, providerId: 'jiucaihezi', capability: 'text', contextWindow: 1_000_000, maxOutputTokens: 128000, ...(declared ? { contextWindowEstimated: false } : {}) }))
    const storage = installLocalStorage({ jc_models_cache: JSON.stringify(models) })
    try {
      setActivePinia(createPinia())
      const model = useAgentStore().availableModels.find(item => item.id === 'cached-0')!
      assert.ok(model)
      assert.equal(model.contextWindow, declared ? 1_000_000 : 32768)
      assert.equal(model.contextWindowEstimated, !declared)
    } finally { storage.restore() }
  }
})

test('Web Skill warehouse does not expose the bundled product catalog', { concurrency: false }, async () => {
  const storage = installLocalStorage()
  try {
    setActivePinia(createPinia())
    const agentStore = useAgentStore()

    await agentStore.bootstrapWebSkills()

    assert.deepEqual(agentStore.inMemorySkills, [])
    assert.deepEqual(agentStore.getCustomSkills(), [])
  } finally {
    storage.restore()
  }
})

test('known model caches upgrade both old 1M and estimated 32K without replacing explicit channel limits', () => {
  for (const cached of [
    { contextWindow: 1_000_000, maxOutputTokens: 128_000 },
    { contextWindow: 32_768, maxOutputTokens: 4_096, contextWindowEstimated: true },
    { contextWindow: 1_000_000, contextWindowSource: 'preset' },
    { contextWindow: 256_000, maxOutputTokens: 8_000, contextWindowEstimated: false },
  ]) {
    const models = Array.from({ length: 20 }, (_, i) => ({ id: i ? `cached-${i}` : 'gpt-6.1-sol', label: 'test', providerId: 'jiucaihezi', capability: 'text', ...cached }))
    const storage = installLocalStorage({ jc_models_cache: JSON.stringify(models) })
    try {
      setActivePinia(createPinia())
      const model = useAgentStore().availableModels.find(item => item.id === 'gpt-6.1-sol')!
      assert.equal(model.contextWindow, cached.contextWindowEstimated === false ? 256_000 : 1_050_000)
      assert.equal(model.contextWindowEstimated, false)
    } finally { storage.restore() }
  }
})

test('manual model capacity is validated, provider scoped, persistent and resettable', () => {
  const storage = installLocalStorage()
  try {
    setActivePinia(createPinia())
    let store = useAgentStore()
    store.setModelCapacity('relay-a', 'gpt-6.1-sol', { contextWindow: 182_000, maxOutputTokens: 8_000 })
    assert.equal(store.modelCapacityFor('gpt-6.1-sol', 'relay-a').contextWindowSource, 'manual')
    assert.equal(store.modelCapacityFor('gpt-6.1-sol', 'relay-a').contextWindow, 182_000)
    assert.equal(store.modelCapacityFor('gpt-6.1-sol', 'relay-b').contextWindow, 1_050_000)
    for (const value of [0, -1, NaN, Infinity, 1.5]) {
      assert.throws(() => store.setModelCapacity('relay-a', 'gpt-6.1-sol', { contextWindow: value, maxOutputTokens: 8_000 }))
    }
    assert.throws(() => store.setModelCapacity('relay-a', 'gpt-6.1-sol', { contextWindow: 100, maxOutputTokens: 100 }))
    setActivePinia(createPinia())
    store = useAgentStore()
    assert.equal(store.modelCapacityFor('gpt-6.1-sol', 'relay-a').contextWindow, 182_000)
    store.setModelCapacity('relay-a', 'gpt-6.1-sol', null)
    assert.equal(store.modelCapacityFor('gpt-6.1-sol', 'relay-a').contextWindow, 1_050_000)
  } finally { storage.restore() }
})

test('a relay catalog without capacities uses presets, refresh keeps manual limits, and offline recovery migrates caches', async () => {
  const storage = installLocalStorage()
  const previousFetch = globalThis.fetch
  __resetApiKeyMemoryCacheForTests('test-only-fake-key')
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [
      { id: 'gpt-6.1-sol' }, { id: 'gemini-3.8-flash' },
      { id: 'claude-opus-4-8', context_window: 256_000, max_output_tokens: 8_000 },
      { id: 'unknown-relay-model' },
    ] }), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch
    setActivePinia(createPinia())
    const store = useAgentStore()
    await store.fetchModels()
    assert.equal(store.modelCapacityFor('gpt-6.1-sol').contextWindow, 1_050_000)
    assert.equal(store.modelCapacityFor('gemini-3.8-flash').contextWindowSource, 'preset')
    assert.equal(store.modelCapacityFor('claude-opus-4-8').contextWindow, 256_000)
    assert.equal(store.modelCapacityFor('unknown-relay-model').contextWindowEstimated, true)
    store.setModelCapacity('jiucaihezi', 'gpt-6.1-sol', { contextWindow: 182_000, maxOutputTokens: 8_000 })
    await store.fetchModels()
    assert.equal(store.modelCapacityFor('gpt-6.1-sol').contextWindow, 182_000)
    const models = Array.from({ length: 20 }, (_, i) => ({ id: i ? `offline-${i}` : 'gpt-6.1-sol', label: 'test', providerId: 'jiucaihezi', capability: 'text', contextWindow: 32_768, contextWindowEstimated: true }))
    globalThis.localStorage.setItem('jc_models_cache', JSON.stringify(models))
    __resetApiKeyMemoryCacheForTests('')
    await store.fetchModels()
    assert.equal(store.availableModels.find(model => model.id === 'gpt-6.1-sol')?.contextWindow, 1_050_000)
    assert.equal(store.modelCapacityFor('gpt-6.1-sol').contextWindow, 182_000)
  } finally {
    __resetApiKeyMemoryCacheForTests('')
    globalThis.fetch = previousFetch
    storage.restore()
  }
})

test('corrupt or invalid persisted overrides cannot override built-in capacity', () => {
  for (const raw of ['null', 'not json', JSON.stringify({ '["relay-a","gpt-6.1-sol"]': { contextWindow: -10, maxOutputTokens: 99 } })]) {
    const storage = installLocalStorage({ jc_model_capacity_overrides: raw })
    try {
      setActivePinia(createPinia())
      assert.equal(useAgentStore().modelCapacityFor('gpt-6.1-sol', 'relay-a').contextWindow, 1_050_000)
    } finally { storage.restore() }
  }
})
test('stores variants separately for each provider model', { concurrency: false }, () => {
  const storage = installLocalStorage()
  try {
    setActivePinia(createPinia())
    const store = useAgentStore()

    store.setModelVariant('jiucaihezi', 'model-a', 'high')
    store.setModelVariant('jiucaihezi', 'model-b', 'low')

    assert.equal(store.modelVariantFor('jiucaihezi', 'model-a', ['high']), 'high')
    assert.equal(store.modelVariantFor('jiucaihezi', 'model-b', ['low']), 'low')
    assert.equal(store.modelVariantFor('jiucaihezi', 'model-b', ['high']), undefined)
  } finally {
    storage.restore()
  }
})
