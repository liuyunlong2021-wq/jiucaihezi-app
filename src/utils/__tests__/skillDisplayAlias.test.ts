import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { useSkillsManageStore } from '../../stores/skillsManageStore'
import type { SkillWithLinks } from '../../types/skillsManage'

const aliasStorageKey = 'jc_skill_display_aliases_v1'

function installMemoryLocalStorage(seed?: Record<string, string>) {
  const data = new Map<string, string>(Object.entries(seed || {}))
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, String(value)),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })
  return storage
}

function skill(patch: Partial<SkillWithLinks> = {}): SkillWithLinks {
  return {
    id: 'file-organizer',
    name: 'file-organizer',
    description: 'Organize local files',
    file_path: '/Users/by3/.agents/skills/file-organizer/SKILL.md',
    canonical_path: '/Users/by3/.agents/skills/file-organizer',
    is_central: true,
    source: 'central',
    scanned_at: '2026-06-08T00:00:00Z',
    linked_agents: [],
    read_only_agents: [],
    ...patch,
  }
}

test('skill display aliases persist to localStorage as UI metadata', () => {
  installMemoryLocalStorage()
  setActivePinia(createPinia())
  const store = useSkillsManageStore()

  store.setSkillDisplayAlias('file-organizer', '帮我整理文件')

  const persisted = JSON.parse(localStorage.getItem(aliasStorageKey) || '{}')
  assert.equal(persisted['file-organizer'].skillId, 'file-organizer')
  assert.equal(persisted['file-organizer'].alias, '帮我整理文件')
  assert.equal(typeof persisted['file-organizer'].updatedAt, 'number')
})

test('skill search matches display alias and official Skill fields', () => {
  installMemoryLocalStorage()
  setActivePinia(createPinia())
  const store = useSkillsManageStore()
  const officialSkill = skill()

  store.setSkillDisplayAlias(officialSkill.id, '帮我整理文件')

  assert.equal(store.skillMatchesSearch(officialSkill, '整理文件'), true)
  assert.equal(store.skillMatchesSearch(officialSkill, 'file-organizer'), true)
  assert.equal(store.skillMatchesSearch(officialSkill, 'Organize local'), true)
  assert.equal(store.skillMatchesSearch(officialSkill, 'missing keyword'), false)
})

test('skill display aliases load from localStorage in a new store instance', () => {
  installMemoryLocalStorage({
    [aliasStorageKey]: JSON.stringify({
      'file-organizer': {
        skillId: 'file-organizer',
        alias: '帮我整理文件',
        updatedAt: 1780848000000,
      },
    }),
  })
  setActivePinia(createPinia())
  const store = useSkillsManageStore()

  store.loadSkillDisplayAliases()

  assert.equal(store.getSkillDisplayAlias('file-organizer')?.alias, '帮我整理文件')
  assert.equal(store.getSkillDisplayName(skill()), '帮我整理文件')
})

test('skill display aliases do not cross official backend boundaries', () => {
  const root = process.cwd()
  const storeSource = readFileSync(join(root, 'src/stores/skillsManageStore.ts'), 'utf8')
  const skillsBackendSource = readdirSync(join(root, 'src-tauri/src/skills'))
    .filter(file => file.endsWith('.rs'))
    .map(file => readFileSync(join(root, 'src-tauri/src/skills', file), 'utf8'))
    .join('\n')

  assert.doesNotMatch(skillsBackendSource, /skill_display_alias/i)
  assert.doesNotMatch(skillsBackendSource, /jc_skill_display_aliases/i)
  assert.doesNotMatch(skillsBackendSource, /get_skill_display_alias|set_skill_display_alias|clear_skill_display_alias/)

  for (const command of [
    'install_skill_to_agent',
    'batch_install_to_agents',
    'get_skill_detail',
    'save_central_skill',
  ]) {
    const index = storeSource.indexOf(`'${command}'`)
    assert.notEqual(index, -1, `${command} call should exist`)
    const callSource = storeSource.slice(index, index + 500)
    assert.doesNotMatch(callSource, /\balias\b|displayAlias|skillDisplayAlias/)
  }
})
