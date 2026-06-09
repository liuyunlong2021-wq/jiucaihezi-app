import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  countDiscoveredSkills,
  filterDiscoveredProjects,
  flattenDiscoveredSkills,
  getDiscoverImportTargets,
  isSkillSelected,
  toggleDiscoveredSkillSelection,
} from '../discoverViewModel'
import type { AgentWithStatus, DiscoveredProject } from '../../types/skillsManage'

function project(patch: Partial<DiscoveredProject> = {}): DiscoveredProject {
  return {
    project_path: '/Users/by3/projects/demo',
    project_name: 'demo',
    skills: [{
      id: 'claude-code__demo__writer',
      name: 'writer',
      description: 'Writes docs',
      file_path: '/Users/by3/projects/demo/.claude/skills/writer/SKILL.md',
      dir_path: '/Users/by3/projects/demo/.claude/skills/writer',
      platform_id: 'claude-code',
      platform_name: 'Claude Code',
      project_path: '/Users/by3/projects/demo',
      project_name: 'demo',
      is_already_central: false,
    }],
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

test('filterDiscoveredProjects supports project and Skill search', () => {
  const projects = [
    project(),
    project({
      project_path: '/Users/by3/projects/webapp',
      project_name: 'webapp',
      skills: [{
        ...project().skills[0],
        id: 'codex__webapp__frontend',
        name: 'frontend-design',
        description: 'Design Vue UI',
        platform_id: 'codex',
        platform_name: 'Codex CLI',
        project_path: '/Users/by3/projects/webapp',
        project_name: 'webapp',
      }],
    }),
  ]

  assert.deepEqual(filterDiscoveredProjects(projects, { projectQuery: 'web', skillQuery: '' }).map(item => item.project_name), ['webapp'])
  assert.deepEqual(filterDiscoveredProjects(projects, { projectQuery: '', skillQuery: 'vue' }).map(item => item.project_name), ['webapp'])
  assert.deepEqual(filterDiscoveredProjects(projects, { projectQuery: 'demo', skillQuery: 'writer' }).map(item => item.project_name), ['demo'])
})

test('flattenDiscoveredSkills and countDiscoveredSkills keep project context', () => {
  const projects = [project(), project({ project_name: 'docs', project_path: '/docs' })]

  assert.equal(countDiscoveredSkills(projects), 2)
  assert.deepEqual(flattenDiscoveredSkills(projects).map(item => `${item.project.project_name}:${item.skill.name}`), [
    'demo:writer',
    'docs:writer',
  ])
})

test('toggleDiscoveredSkillSelection adds and removes ids predictably', () => {
  let selected = new Set<string>()
  selected = toggleDiscoveredSkillSelection(selected, 'writer')
  assert.equal(isSkillSelected(selected, 'writer'), true)
  selected = toggleDiscoveredSkillSelection(selected, 'writer')
  assert.equal(isSkillSelected(selected, 'writer'), false)
})

test('getDiscoverImportTargets follows backend install target semantics and excludes source platform', () => {
  const targets = getDiscoverImportTargets([
    agent({ id: 'central', display_name: 'Central Skills', is_install_target: false }),
    agent({ id: 'claude-code', display_name: 'Claude Code' }),
    agent({ id: 'opencode', display_name: 'OpenCode' }),
    agent({ id: 'disabled', display_name: 'Disabled', is_install_target: false }),
    agent({ id: 'missing', display_name: 'Missing', is_install_target: false }),
  ], 'claude-code')

  assert.deepEqual(targets.map(item => item.id), ['opencode'])
})
