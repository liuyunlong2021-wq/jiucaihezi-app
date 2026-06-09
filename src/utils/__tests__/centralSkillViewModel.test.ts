import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  splitCentralSkillsByTopLevel,
  sortCentralSkills,
} from '../centralSkillViewModel'
import type { SkillWithLinks } from '../../types/skillsManage'

function skill(patch: Partial<SkillWithLinks>): SkillWithLinks {
  return {
    id: 'skill',
    name: 'skill',
    description: null,
    file_path: '/Users/by3/.agents/skills/skill/SKILL.md',
    canonical_path: '/Users/by3/.agents/skills/skill',
    is_central: true,
    source: 'central',
    scanned_at: '2026-06-08T00:00:00Z',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-02T00:00:00Z',
    linked_agents: [],
    read_only_agents: [],
    ...patch,
  }
}

test('splitCentralSkillsByTopLevel separates root skills from nested bundle skills', () => {
  const result = splitCentralSkillsByTopLevel({
    skills: [
      skill({
        id: 'root-skill',
        name: 'root-skill',
        file_path: '/Users/by3/.agents/skills/root-skill/SKILL.md',
        canonical_path: '/Users/by3/.agents/skills/root-skill',
      }),
      skill({
        id: 'using-superpowers',
        name: 'using-superpowers',
        file_path: '/Users/by3/.agents/skills/Superpowers/using-superpowers/SKILL.md',
        canonical_path: '/Users/by3/.agents/skills/Superpowers/using-superpowers',
        linked_agents: ['opencode'],
      }),
    ],
    rootPath: '/Users/by3/.agents/skills',
  })

  assert.deepEqual(result.rootSkills.map(item => item.id), ['root-skill'])
  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0].name, 'Superpowers')
  assert.equal(result.groups[0].relativePath, 'Superpowers')
  assert.deepEqual(result.groups[0].skillIds, ['using-superpowers'])
  assert.deepEqual(result.groups[0].linkedAgentIds, ['opencode'])
})

test('sortCentralSkills supports official Central Skills sort fields and direction', () => {
  const skills = [
    skill({ id: 'b', name: 'beta', created_at: '2026-06-01T00:00:00Z', updated_at: '2026-06-03T00:00:00Z' }),
    skill({ id: 'a', name: 'alpha', created_at: '2026-06-02T00:00:00Z', updated_at: '2026-06-02T00:00:00Z' }),
  ]

  assert.deepEqual(sortCentralSkills(skills, 'name', 'asc').map(item => item.id), ['a', 'b'])
  assert.deepEqual(sortCentralSkills(skills, 'createdAt', 'desc').map(item => item.id), ['a', 'b'])
  assert.deepEqual(sortCentralSkills(skills, 'updatedAt', 'desc').map(item => item.id), ['b', 'a'])
})
