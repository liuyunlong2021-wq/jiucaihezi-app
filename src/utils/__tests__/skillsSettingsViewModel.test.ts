import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  filterCustomPlatforms,
  filterScanDirectories,
  formatSecretStatus,
  normalizeAiSettings,
} from '../skillsSettingsViewModel'
import type { AgentWithStatus, ScanDirectory } from '../../types/skillsManage'

function scanDirectory(patch: Partial<ScanDirectory>): ScanDirectory {
  return {
    id: 1,
    path: '/Users/by3/projects',
    label: 'Projects',
    is_builtin: false,
    is_active: true,
    added_at: '2026-06-08T00:00:00Z',
    ...patch,
  }
}

function agent(patch: Partial<AgentWithStatus>): AgentWithStatus {
  return {
    id: 'platform',
    display_name: 'Platform',
    category: 'coding',
    global_skills_dir: '/Users/by3/.platform/skills',
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

test('settings view model filters scan directories by label, path, and built-in state', () => {
  const directories = [
    scanDirectory({ path: '/Users/by3/projects', label: 'Projects', is_builtin: false }),
    scanDirectory({ id: 2, path: '/Users/by3/.agents/skills', label: 'Central Skills', is_builtin: true }),
    scanDirectory({ id: 3, path: '/Users/by3/labs', label: null, is_builtin: false, is_active: false }),
  ]

  assert.deepEqual(
    filterScanDirectories(directories, { query: 'central', mode: 'all' }).map(item => item.path),
    ['/Users/by3/.agents/skills']
  )
  assert.deepEqual(
    filterScanDirectories(directories, { query: '', mode: 'custom' }).map(item => item.path),
    ['/Users/by3/projects', '/Users/by3/labs']
  )
  assert.deepEqual(
    filterScanDirectories(directories, { query: 'labs', mode: 'disabled' }).map(item => item.path),
    ['/Users/by3/labs']
  )
})

test('settings view model returns only custom Platforms for edit and remove actions', () => {
  const agents = [
    agent({ id: 'central', display_name: 'Central Skills', is_builtin: true }),
    agent({ id: 'claude-code', display_name: 'Claude Code', is_builtin: true }),
    agent({ id: 'custom-lab', display_name: 'Lab Platform', is_builtin: false }),
  ]

  assert.deepEqual(filterCustomPlatforms(agents).map(item => item.id), ['custom-lab'])
})

test('settings view model normalizes AI settings without leaking empty strings', () => {
  assert.deepEqual(
    normalizeAiSettings({
      provider: ' custom ',
      apiKey: ' sk-test ',
      model: ' claude-custom ',
      apiUrl: ' https://ai.example.com/v1 ',
    }),
    {
      provider: 'custom',
      apiKey: 'sk-test',
      model: 'claude-custom',
      apiUrl: 'https://ai.example.com/v1',
    }
  )

  assert.deepEqual(normalizeAiSettings({ provider: '', apiKey: '', model: '', apiUrl: '' }), {
    provider: '',
    apiKey: '',
    model: '',
    apiUrl: '',
  })
})

test('settings view model formats saved secret state without exposing the value', () => {
  assert.equal(formatSecretStatus('github_pat_1234567890'), '已保存，明文不会显示')
  assert.equal(formatSecretStatus(''), '未保存')
})
