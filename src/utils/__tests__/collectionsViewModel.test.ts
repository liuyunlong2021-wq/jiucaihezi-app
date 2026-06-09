import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildCollectionExportFilename,
  filterCollectionSkills,
  filterSkillPickerCandidates,
  getCollectionInstallTargets,
} from '../collectionsViewModel'
import type { AgentWithStatus, Skill, SkillWithLinks } from '../../types/skillsManage'

function skill(patch: Partial<Skill> = {}): Skill {
  return {
    id: 'writer',
    name: 'writer',
    description: 'Writes docs',
    file_path: '/Users/by3/.agents/skills/writer/SKILL.md',
    canonical_path: '/Users/by3/.agents/skills/writer',
    is_central: true,
    source: 'central',
    scanned_at: '2026-06-08T00:00:00Z',
    ...patch,
  }
}

function centralSkill(patch: Partial<SkillWithLinks> = {}): SkillWithLinks {
  return {
    ...skill(patch),
    linked_agents: [],
    read_only_agents: [],
    ...patch,
  }
}

function agent(patch: Partial<AgentWithStatus> = {}): AgentWithStatus {
  return {
    id: 'opencode',
    display_name: 'OpenCode',
    category: 'coding',
    global_skills_dir: '/Users/by3/.opencode/skills',
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

test('filterCollectionSkills searches Skill fields', () => {
  const skills = [
    skill({ id: 'writer', name: 'writer', description: 'Writes docs' }),
    skill({
      id: 'frontend-design',
      name: 'frontend-design',
      description: 'Design Vue UI',
      file_path: '/Users/by3/.agents/skills/frontend-design/SKILL.md',
      canonical_path: '/Users/by3/.agents/skills/frontend-design',
    }),
  ]

  assert.deepEqual(filterCollectionSkills(skills, 'vue').map(item => item.id), ['frontend-design'])
  assert.deepEqual(filterCollectionSkills(skills, 'writer').map(item => item.id), ['writer'])
})

test('filterSkillPickerCandidates hides existing skills and supports search', () => {
  const candidates = [
    centralSkill({ id: 'writer', name: 'writer' }),
    centralSkill({ id: 'frontend-design', name: 'frontend-design', description: 'Design UI' }),
  ]

  assert.deepEqual(filterSkillPickerCandidates(candidates, ['writer'], '').map(item => item.id), ['frontend-design'])
  assert.deepEqual(filterSkillPickerCandidates(candidates, [], 'design').map(item => item.id), ['frontend-design'])
})

test('getCollectionInstallTargets follows backend install target semantics', () => {
  const targets = getCollectionInstallTargets([
    agent({ id: 'central', display_name: 'Central Skills', is_install_target: false }),
    agent({ id: 'codex', display_name: 'Codex', is_install_target: false, uses_central_root: true }),
    agent({ id: 'opencode', display_name: 'OpenCode' }),
    agent({ id: 'disabled', display_name: 'Disabled', is_install_target: false }),
    agent({ id: 'missing', display_name: 'Missing', is_install_target: false }),
  ])

  assert.deepEqual(targets.map(item => item.id), ['opencode'])
})

test('buildCollectionExportFilename creates a safe json filename', () => {
  assert.equal(buildCollectionExportFilename('Writing Kit Pro'), 'writing-kit-pro-collection.json')
  assert.equal(buildCollectionExportFilename('  复杂 / Collection  '), 'collection-collection.json')
})
