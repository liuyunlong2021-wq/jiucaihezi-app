import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { useAgentStore } from '../agentStore'
import type { SkillConfig } from '../../types/skill'

const DEFAULT_CHAT_MODEL_IDS = [
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'gpt-5.5',
  'gpt-5.4',
  'qwen3.6-plus',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'openai/gpt-oss-120b:free',
  'google/gemma-4-31b-it:free',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-pro-preview',
]

test(
  'chat model list excludes registered media models mislabeled as text and replaces a cached media selection',
  { concurrency: false },
  () => {
    const mediaModelIds = [
      'ld-2.5特价-1-720',
      'minimax_h3_zm_u24',
      'MiniMaxH3-720p-sec',
      'omni-fast',
      'omni-v2v',
      'mj_fast_imagine',
      'MiniMax-H3-Context-IR',
      'gpt-image-99',
      'gemini-next-image-preview',
      'new-video-model',
      'sora-99',
      'wan-99',
      'nano-banana-new',
      'midjourney-new',
    ]
    const cachedModels = [
      ...DEFAULT_CHAT_MODEL_IDS.map(id => ({
        id,
        label: id,
        providerId: 'jiucaihezi',
        capability: 'text',
      })),
      ...mediaModelIds.map(id => ({ id, label: id, providerId: 'jiucaihezi', capability: 'text' })),
    ]
    const storage = installLocalStorage({
      jcModel: 'ld-2.5特价-1-720',
      jc_models_cache: JSON.stringify(cachedModels),
    })

    try {
      setActivePinia(createPinia())
      const agentStore = useAgentStore()

      assert.deepEqual(agentStore.textModels.map(model => model.id), DEFAULT_CHAT_MODEL_IDS)
      assert.equal(mediaModelIds.every(id => agentStore.availableModels.some(model => model.id === id)), true)
      assert.equal(agentStore.currentModel, DEFAULT_CHAT_MODEL_IDS[0])
      agentStore.availableModels.push(
        { id: 'custom-image-generator', label: 'custom image', providerId: 'custom:test', capability: 'text' },
        { id: 'local-video-generator', label: 'local video', providerId: 'ollama', capability: 'text' },
        { id: 'qwen2.5-vl', label: 'vision chat', capability: 'text', inputModalities: ['text', 'image'] },
      )
      assert.equal(agentStore.textModels.some(model => model.id === 'custom-image-generator' || model.id === 'local-video-generator'), false)
      assert.equal(agentStore.textModels.some(model => model.id === 'qwen2.5-vl'), true)
    } finally {
      storage.restore()
    }
  },
)

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

test('custom OpenAI-compatible endpoints surface as selectable models with image input', { concurrency: false }, () => {
  const storage = installLocalStorage({
    jcCustomProviders: JSON.stringify([{
      id: 'custom-mlx',
      name: '本机 MLX',
      apiBase: 'http://127.0.0.1:8080',
      modelIds: ['mlx-community/LensVLM-9B-OptiQ-4bit'],
    }]),
  })
  try {
    setActivePinia(createPinia())
    const agentStore = useAgentStore()

    const entry = agentStore.availableModels.find(model => model.id === 'mlx-community/LensVLM-9B-OptiQ-4bit')

    assert.equal(entry?.providerId, 'custom-mlx')
    assert.equal(entry?.label, '本机 MLX: mlx-community/LensVLM-9B-OptiQ-4bit')
    // 声明图片输入，否则本地 VLM 永远收不到图。
    assert.deepEqual(entry?.inputModalities, ['text', 'image'])
    // 未声明能力的自定义端点与官方 DSH 的未知模型预算对齐。
    assert.equal(entry?.contextWindow, 262_144)
    assert.equal(entry?.maxOutputTokens, 32_768)
  } finally {
    storage.restore()
  }
})

test('Strata capabilities survive storage and reach the selected model', { concurrency: false }, () => {
  const storage = installLocalStorage({ jcCustomProviders: JSON.stringify([{
    id: 'strata', name: 'Strata', apiBase: 'http://localhost:8080', modelIds: ['strata'],
    modelCapabilities: { strata: { contextWindow: 262144, maxOutputTokens: 131072, inputModalities: ['text'] } },
  }]) })
  try {
    setActivePinia(createPinia())
    const entry = useAgentStore().availableModels.find(model => model.providerId === 'strata')
    assert.equal(entry?.contextWindow, 262144)
    assert.equal(entry?.maxOutputTokens, 131072)
    assert.deepEqual(entry?.inputModalities, ['text'])
  } finally { storage.restore() }
})

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


test('a small valid gateway catalog is not discarded as corrupt', () => {
  const storage = installLocalStorage({ jc_models_cache: JSON.stringify([
    { id: 'minimax/minimax-m3.1-flash:free', label: 'MiniMax', providerId: 'jiucaihezi', capability: 'text', contextWindow: 1000000, maxOutputTokens: 524288 },
  ]) })
  try {
    setActivePinia(createPinia())
    const store = useAgentStore()
    assert.equal(store.textModels.length, 1)
    assert.equal(store.textModels[0]?.contextWindow, 1000000)
    assert.equal(store.textModels[0]?.maxOutputTokens, 524288)
  } finally { storage.restore() }
})
