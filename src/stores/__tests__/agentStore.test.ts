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

test('Web does not create a third user Skill source', async () => {
  const storage = installLocalStorage()
  try {
    setActivePinia(createPinia())
    const agentStore = useAgentStore()

    await assert.rejects(() => agentStore.createAgent(skill()), /Web 端只使用内置 Skill/)

    assert.equal(agentStore.getMySkills().some(item => item.id === 'custom-skill-create-test'), false)
  } finally {
    storage.restore()
  }
})

test('Web Skill actions cannot turn a rejected custom Skill into a selectable entry', async () => {
  const storage = installLocalStorage()
  try {
    setActivePinia(createPinia())
    const agentStore = useAgentStore()

    await assert.rejects(() => agentStore.createAgent(skill()), /Web 端只使用内置 Skill/)
    await agentStore.moveToMy('custom_skill_create_test')

    assert.equal(agentStore.getMySkills().filter(item => item.id === 'custom-skill-create-test').length, 0)
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

test('Web Skill warehouse follows the generated public Skill catalog without preloading packages', { concurrency: false }, async () => {
  const storage = installLocalStorage()
  const calls: string[] = []
  const fetcher = async (url: string | URL | Request) => {
    const path = String(url)
    calls.push(path)
    if (path === '/skills/index.json') {
      return Response.json([
        {
          id: 'writer', name: 'writer', description: '写作', triggers: ['写作'], commands: [], files: ['SKILL.md'],
        },
        {
          id: 'nested/composer', name: 'composer', description: '合成', triggers: [], commands: [], files: ['SKILL.md'],
        },
      ])
    }
    throw new Error(`unexpected fetch: ${path}`)
  }

  try {
    setActivePinia(createPinia())
    const agentStore = useAgentStore()

    await agentStore.bootstrapWebSkills(fetcher as typeof fetch)

    assert.deepEqual(agentStore.inMemorySkills.map(item => item.id), ['nested/composer', 'writer'])
    assert.deepEqual(agentStore.inMemorySkills.map(item => item.skillContent), [
      'skill://nested/composer/SKILL.md',
      'skill://writer/SKILL.md',
    ])
    assert.deepEqual(calls, ['/skills/index.json'])
  } finally {
    storage.restore()
  }
})
