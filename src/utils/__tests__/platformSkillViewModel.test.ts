import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  canUninstallPlatformSkill,
  filterPlatformAgents,
  filterPlatformSkills,
  splitPlatformSkillsByFolder,
} from '../platformSkillViewModel'
import type { AgentWithStatus, SkillForAgent } from '../../types/skillsManage'

function agent(patch: Partial<AgentWithStatus> = {}): AgentWithStatus {
  return {
    id: 'claude-code',
    display_name: 'Claude Code',
    category: 'coding',
    global_skills_dir: '/Users/by3/.claude/skills',
    project_skills_dir: null,
    icon_name: null,
    is_detected: true,
    is_builtin: true,
    is_enabled: true,
    uses_central_root: false,
    is_install_target: true,
    ...patch,
  }
}

function skill(patch: Partial<SkillForAgent> = {}): SkillForAgent {
  return {
    id: 'file-organizer',
    row_id: 'claude-code:file-organizer',
    name: 'file-organizer',
    description: 'Organize local files',
    file_path: '/Users/by3/.claude/skills/file-organizer/SKILL.md',
    dir_path: '/Users/by3/.claude/skills/file-organizer',
    link_type: 'symlink',
    symlink_target: '/Users/by3/.agents/skills/file-organizer',
    is_central: true,
    source_kind: null,
    source_root: null,
    is_read_only: false,
    conflict_group: null,
    conflict_count: 0,
    ...patch,
  }
}

test('filterPlatformAgents searches official Platform fields without changing terminology', () => {
  const agents = [
    agent({ id: 'claude-code', display_name: 'Claude Code', category: 'coding' }),
    agent({ id: 'obsidian', display_name: 'Obsidian', category: 'lobster', global_skills_dir: '/Vault/.obsidian/skills' }),
    agent({ id: 'custom-tools', display_name: 'Team Tools', category: 'custom', global_skills_dir: '/Users/by3/tools/skills' }),
  ]

  assert.deepEqual(filterPlatformAgents(agents, 'claude').map(item => item.id), ['claude-code'])
  assert.deepEqual(filterPlatformAgents(agents, 'lobster').map(item => item.id), ['obsidian'])
  assert.deepEqual(filterPlatformAgents(agents, '/tools').map(item => item.id), ['custom-tools'])
})

test('filterPlatformSkills supports Skill search and Claude source filter', () => {
  const skills = [
    skill({ id: 'central-installed', name: 'central-installed', source_kind: null }),
    skill({ id: 'claude-user', name: 'claude-user', source_kind: 'user', dir_path: '/Users/by3/.claude/skills/claude-user' }),
    skill({ id: 'plugin-helper', name: 'plugin-helper', source_kind: 'plugin', is_read_only: true, dir_path: '/Users/by3/.claude/plugins/acme/skills/plugin-helper' }),
    skill({ id: 'compat-helper', name: 'compat-helper', source_kind: 'compatibility', is_read_only: true }),
  ]

  assert.deepEqual(filterPlatformSkills(skills, { query: 'helper', source: 'all' }).map(item => item.id), [
    'plugin-helper',
    'compat-helper',
  ])
  assert.deepEqual(filterPlatformSkills(skills, { query: '', source: 'user' }).map(item => item.id), [
    'central-installed',
    'claude-user',
  ])
  assert.deepEqual(filterPlatformSkills(skills, { query: '', source: 'plugin' }).map(item => item.id), [
    'plugin-helper',
  ])
})

test('splitPlatformSkillsByFolder separates root Platform Skills from nested folders', () => {
  const result = splitPlatformSkillsByFolder({
    skills: [
      skill({ id: 'root-skill', name: 'root-skill', dir_path: '/Users/by3/.claude/skills/root-skill' }),
      skill({ id: 'nested-skill', name: 'nested-skill', dir_path: '/Users/by3/.claude/skills/team/nested-skill' }),
    ],
    rootPath: '/Users/by3/.claude/skills',
  })

  assert.deepEqual(result.rootSkills.map(item => item.id), ['root-skill'])
  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0].name, 'team')
  assert.deepEqual(result.groups[0].skills.map(item => item.id), ['nested-skill'])
})

test('canUninstallPlatformSkill blocks read-only and shared Central Skills Platform rows', () => {
  const normalAgent = agent({ id: 'opencode', global_skills_dir: '/Users/by3/.opencode/skills' })
  const sharedAgent = agent({ id: 'codex', uses_central_root: true, is_install_target: false })

  assert.equal(canUninstallPlatformSkill(skill(), normalAgent, '/Users/by3/.agents/skills'), true)
  assert.equal(canUninstallPlatformSkill(skill({ is_read_only: true }), normalAgent, '/Users/by3/.agents/skills'), false)
  assert.equal(canUninstallPlatformSkill(skill(), sharedAgent, '/Users/by3/.agents/skills'), false)
})
