import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { useAgentStore } from '../agentStore'
import type { SkillConfig } from '../../types/skill'

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
    id: 'custom_skill_create_test',
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

test('createAgent makes a user skill visible in My Skills', async () => {
  const storage = installLocalStorage()
  try {
    setActivePinia(createPinia())
    const agentStore = useAgentStore()

    await agentStore.createAgent(skill())

    assert.equal(storage.get('jc_my_skills'), null)
    assert.equal(agentStore.getMySkills().some(item => item.id === 'custom-skill-create-test'), true)
  } finally {
    storage.restore()
  }
})

test('createAgent can be followed by moveToMy without duplicate My Skill ids', async () => {
  const storage = installLocalStorage()
  try {
    setActivePinia(createPinia())
    const agentStore = useAgentStore()

    await agentStore.createAgent(skill())
    await agentStore.moveToMy('custom_skill_create_test')

    assert.equal(storage.get('jc_my_skills'), null)
    assert.equal(agentStore.getMySkills().filter(item => item.id === 'custom-skill-create-test').length, 1)
  } finally {
    storage.restore()
  }
})

test('official skill creation presets use approved product names', () => {
  const storage = installLocalStorage()
  try {
    setActivePinia(createPinia())
    const agentStore = useAgentStore()

    assert.equal(agentStore.getPresetSkills().find(skill => skill.id === 'preset_skill-creator')?.name, 'Skill缔造')
    assert.equal(agentStore.getPresetSkills().find(skill => skill.id === 'preset_skill-builder')?.name, '素材转Skill')
  } finally {
    storage.restore()
  }
})

test('Obsidian is exposed as a built-in wrapper for the claude-obsidian suite', () => {
  const storage = installLocalStorage()
  try {
    setActivePinia(createPinia())
    const agentStore = useAgentStore()
    const obsidian = agentStore.getPresetSkills().find(skill => skill.id === 'preset_obsidian')

    assert.equal(obsidian?.name, 'Obsidian')
    assert.equal(obsidian?.skillContent, 'skill://obsidian/SKILL.md')
    assert.equal(obsidian?.source, 'preset')
    assert.match(obsidian?.description || '', /claude-obsidian/)
  } finally {
    storage.restore()
  }
})

test('model selector falls back to executable text models until the official OpenCode catalog is adopted', () => {
  const storage = installLocalStorage({
    jc_models_cache: JSON.stringify([
      { id: 'cached-text-model', label: 'Cached', capability: 'text' },
      { id: 'cached-image-model', label: 'Cached Image', capability: 'image' },
      { id: 'gpt-image-2', label: 'Legacy cached image without capability' },
      { id: 'grok-video-3', label: 'Legacy cached video without capability' },
    ]),
  })
  try {
    setActivePinia(createPinia())
    const agentStore = useAgentStore()

    assert.ok((agentStore as any).openCodeTextModels.length >= 12)
    assert.ok((agentStore as any).openCodeTextModels.some((model: any) => model.id === 'claude-sonnet-4-6'))
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
