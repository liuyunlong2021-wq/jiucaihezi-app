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
