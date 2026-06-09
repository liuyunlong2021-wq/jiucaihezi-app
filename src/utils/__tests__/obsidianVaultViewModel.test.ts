import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  filterObsidianVaultSkills,
  filterObsidianVaults,
  getObsidianReadonlyNotice,
  groupObsidianSkillsByPlatformPath,
} from '../obsidianVaultViewModel'
import type { DiscoveredSkill, ObsidianVault } from '../../types/skillsManage'

function vault(patch: Partial<ObsidianVault>): ObsidianVault {
  return {
    id: 'vault-a',
    name: 'Research',
    path: '/Users/by3/Obsidian/Research',
    skill_count: 2,
    ...patch,
  }
}

function skill(patch: Partial<DiscoveredSkill>): DiscoveredSkill {
  return {
    id: 'obsidian__vault__research-helper',
    name: 'research-helper',
    description: 'Read-only vault Skill',
    file_path: '/Users/by3/Obsidian/Research/.agents/skills/research-helper/SKILL.md',
    dir_path: '/Users/by3/Obsidian/Research/.agents/skills/research-helper',
    platform_id: 'obsidian',
    platform_name: 'Obsidian',
    project_path: '/Users/by3/Obsidian/Research',
    project_name: 'Research',
    is_already_central: false,
    ...patch,
  }
}

test('obsidian view model filters vaults by name and path', () => {
  const vaults = [
    vault({ id: 'vault-a', name: 'Research', path: '/Users/by3/Obsidian/Research' }),
    vault({ id: 'vault-b', name: 'Writing', path: '/Users/by3/Obsidian/Writing' }),
  ]

  assert.deepEqual(filterObsidianVaults(vaults, 'writing').map(item => item.id), ['vault-b'])
  assert.deepEqual(filterObsidianVaults(vaults, 'obsidian/research').map(item => item.id), ['vault-a'])
})

test('obsidian view model filters vault Skills and keeps them read-only', () => {
  const skills = [
    skill({ id: 'obsidian__a__research-helper', name: 'research-helper' }),
    skill({ id: 'obsidian__a__draft-helper', name: 'draft-helper', description: 'Write drafts' }),
  ]

  assert.deepEqual(filterObsidianVaultSkills(skills, 'draft').map(item => item.id), ['obsidian__a__draft-helper'])
  assert.equal(getObsidianReadonlyNotice(), 'Obsidian Vault Skill 是只读来源，不创建可卸载安装记录。')
})

test('obsidian view model groups vault Skills by source directory family', () => {
  const groups = groupObsidianSkillsByPlatformPath([
    skill({
      id: 'obsidian__a__research-helper',
      dir_path: '/Users/by3/Obsidian/Research/.agents/skills/research-helper',
    }),
    skill({
      id: 'obsidian__a__claude-helper',
      dir_path: '/Users/by3/Obsidian/Research/.claude/skills/claude-helper',
    }),
  ])

  assert.deepEqual(groups.map(group => group.label), ['.agents/skills', '.claude/skills'])
  assert.deepEqual(groups.map(group => group.skills.length), [1, 1])
})
