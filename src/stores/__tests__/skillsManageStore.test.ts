import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { useSkillsManageStore } from '../skillsManageStore'
import type { AgentWithStatus, SkillWithLinks } from '../../types/skillsManage'

const aliasStorageKey = 'jc_skill_display_aliases_v1'

function installMemoryLocalStorage() {
  const data = new Map<string, string>()
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

function installTauriInvokeMock(handler: (command: string, args?: Record<string, unknown>) => unknown | Promise<unknown>) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: handler,
      },
    },
  })
}

function agent(patch: Partial<AgentWithStatus>): AgentWithStatus {
  return {
    id: 'platform',
    display_name: 'Platform',
    category: 'coding',
    global_skills_dir: '/tmp/skills',
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

test('skills manager exposes only independent platform skill directories', () => {
  setActivePinia(createPinia())
  const store = useSkillsManageStore()

  store.agents = [
    agent({
      id: 'central',
      display_name: 'Central Skills',
      category: 'central',
      global_skills_dir: '/Users/by3/.agents/skills',
      uses_central_root: true,
      is_install_target: false,
    }),
    agent({
      id: 'codex',
      display_name: 'Codex CLI',
      global_skills_dir: '/Users/by3/.agents/skills/',
      uses_central_root: true,
      is_install_target: false,
    }),
    agent({
      id: 'opencode',
      display_name: 'OpenCode',
      global_skills_dir: '/Users/by3/.opencode/skills',
    }),
    agent({
      id: 'source-only',
      display_name: 'Source Only',
      global_skills_dir: '/Users/by3/.source-only/skills',
      is_install_target: false,
    }),
  ]

  assert.deepEqual(store.platformAgents.map(agent => agent.id), ['opencode'])
  assert.deepEqual(store.installableAgents.map(agent => agent.id), ['opencode'])
})

test('skill display alias is UI-only metadata and preserves official Skill fields', () => {
  installMemoryLocalStorage()
  setActivePinia(createPinia())
  const store = useSkillsManageStore()
  const officialSkill = skill()
  store.selectedSkillContent = '---\nname: file-organizer\n---\n\nOfficial content'

  assert.equal(store.getSkillDisplayName(officialSkill), 'file-organizer')

  store.setSkillDisplayAlias(officialSkill.id, '帮我整理文件')

  assert.equal(store.getSkillDisplayName(officialSkill), '帮我整理文件')
  assert.equal(store.getSkillDisplayAlias(officialSkill.id)?.alias, '帮我整理文件')
  assert.equal(officialSkill.name, 'file-organizer')
  assert.equal(store.selectedSkillContent, '---\nname: file-organizer\n---\n\nOfficial content')
})

test('clearing skill display alias falls back to official Skill name', () => {
  installMemoryLocalStorage()
  setActivePinia(createPinia())
  const store = useSkillsManageStore()
  const officialSkill = skill()

  store.setSkillDisplayAlias(officialSkill.id, '帮我整理文件')
  store.clearSkillDisplayAlias(officialSkill.id)

  assert.equal(store.getSkillDisplayName(officialSkill), 'file-organizer')
  assert.equal(store.getSkillDisplayAlias(officialSkill.id), null)
  assert.equal(localStorage.getItem(aliasStorageKey), '{}')
})

test('skills manager loads Central bundle list and detail through official commands', async () => {
  installMemoryLocalStorage()
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  installTauriInvokeMock((command, args) => {
    calls.push({ command, args })
    if (command === 'get_central_skill_bundles') {
      return [{
        name: 'Superpowers',
        relativePath: 'Superpowers',
        path: '/Users/by3/.agents/skills/Superpowers',
        isSymlink: false,
        skillCount: 2,
        linkedAgentCount: 1,
        readOnlyAgentCount: 0,
      }]
    }
    if (command === 'get_central_skill_bundle_detail') {
      return {
        bundle: {
          name: 'Superpowers',
          relativePath: 'Superpowers',
          path: '/Users/by3/.agents/skills/Superpowers',
          isSymlink: false,
          skillCount: 2,
          linkedAgentCount: 1,
          readOnlyAgentCount: 0,
        },
        skills: [skill({ id: 'using-superpowers', name: 'using-superpowers' })],
      }
    }
    throw new Error(`Unexpected command: ${command}`)
  })
  setActivePinia(createPinia())
  const store = useSkillsManageStore() as unknown as {
    centralBundles: unknown[]
    centralBundleDetails: Record<string, { skills: SkillWithLinks[] }>
    loadCentralBundles: () => Promise<unknown[]>
    loadCentralBundleDetail: (relativePath: string) => Promise<{ skills: SkillWithLinks[] }>
  }

  const bundles = await store.loadCentralBundles()
  const detail = await store.loadCentralBundleDetail('Superpowers')

  assert.equal(bundles.length, 1)
  assert.equal(store.centralBundles.length, 1)
  assert.equal(detail.skills[0].name, 'using-superpowers')
  assert.equal(store.centralBundleDetails.Superpowers.skills[0].id, 'using-superpowers')
  assert.deepEqual(calls.map(call => call.command), [
    'get_central_skill_bundles',
    'get_central_skill_bundle_detail',
  ])
  assert.deepEqual(calls[1].args, { relativePath: 'Superpowers' })
})

test('skills manager previews and deletes Central bundles through official commands', async () => {
  installMemoryLocalStorage()
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  installTauriInvokeMock((command, args) => {
    calls.push({ command, args })
    if (command === 'preview_delete_central_skill_bundle') {
      return {
        bundle: {
          name: 'Superpowers',
          relativePath: 'Superpowers',
          path: '/Users/by3/.agents/skills/Superpowers',
          isSymlink: false,
          skillCount: 1,
          linkedAgentCount: 1,
          readOnlyAgentCount: 0,
        },
        skills: [skill({ id: 'using-superpowers', linked_agents: ['opencode'] })],
        affectedAgents: ['opencode'],
        skippedReadOnlyAgents: [],
      }
    }
    if (command === 'delete_central_skill_bundle') {
      return {
        relativePath: 'Superpowers',
        removedBundlePath: '/Users/by3/.agents/skills/Superpowers',
        removedKind: 'directory',
        removedSkillIds: ['using-superpowers'],
        uninstalledAgents: ['opencode'],
        skippedReadOnlyAgents: [],
      }
    }
    throw new Error(`Unexpected command: ${command}`)
  })
  setActivePinia(createPinia())
  const store = useSkillsManageStore() as unknown as {
    centralBundleDeletePreview: { affectedAgents: string[] } | null
    deletingBundlePath: string | null
    previewDeleteCentralSkillBundle: (relativePath: string) => Promise<{ affectedAgents: string[] }>
    deleteCentralSkillBundle: (relativePath: string, cascadeUninstall?: boolean) => Promise<{ removedSkillIds: string[] }>
  }

  const preview = await store.previewDeleteCentralSkillBundle('Superpowers')

  assert.deepEqual(preview.affectedAgents, ['opencode'])
  assert.deepEqual(store.centralBundleDeletePreview?.affectedAgents, ['opencode'])
  const result = await store.deleteCentralSkillBundle('Superpowers', true)

  assert.deepEqual(result.removedSkillIds, ['using-superpowers'])
  assert.equal(store.centralBundleDeletePreview, null)
  assert.equal(store.deletingBundlePath, null)
  assert.deepEqual(calls.map(call => call.command), [
    'preview_delete_central_skill_bundle',
    'delete_central_skill_bundle',
  ])
  assert.deepEqual(calls[1].args, {
    relativePath: 'Superpowers',
    options: { cascadeUninstall: true },
  })
})

test('skills manager batch installs a Skill to multiple Platform targets without using display alias', async () => {
  installMemoryLocalStorage()
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  installTauriInvokeMock((command, args) => {
    calls.push({ command, args })
    if (command === 'batch_install_to_agents') {
      return { succeeded: ['opencode', 'claude-code'], failed: [] }
    }
    throw new Error(`Unexpected command: ${command}`)
  })
  setActivePinia(createPinia())
  const store = useSkillsManageStore() as unknown as {
    setSkillDisplayAlias: (skillId: string, alias: string) => unknown
    batchInstallSkillToAgents: (skillId: string, agentIds: string[], method: 'symlink' | 'copy') => Promise<{ succeeded: string[] }>
  }

  store.setSkillDisplayAlias('file-organizer', '帮我整理文件')
  const result = await store.batchInstallSkillToAgents('file-organizer', ['opencode', 'claude-code'], 'symlink')

  assert.deepEqual(result.succeeded, ['opencode', 'claude-code'])
  assert.deepEqual(calls[0], {
    command: 'batch_install_to_agents',
    args: {
      skillId: 'file-organizer',
      agentIds: ['opencode', 'claude-code'],
      method: 'symlink',
    },
  })
})

test('skills manager loads directory tree and reads only files under the selected Skill directory', async () => {
  installMemoryLocalStorage()
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  installTauriInvokeMock((command, args) => {
    calls.push({ command, args })
    if (command === 'list_skill_directory') {
      return [{
        name: 'SKILL.md',
        path: '/Users/by3/.agents/skills/file-organizer/SKILL.md',
        relative_path: 'SKILL.md',
        is_dir: false,
        children: [],
      }]
    }
    if (command === 'read_file_by_path') {
      return '# file-organizer'
    }
    throw new Error(`Unexpected command: ${command}`)
  })
  setActivePinia(createPinia())
  const store = useSkillsManageStore() as unknown as {
    selectedSkillDetail: {
      id: string
      name: string
      file_path: string
      dir_path: string
      canonical_path: string
    }
    skillDirectoryTree: unknown[]
    selectedSkillFileContent: string
    loadSelectedSkillDirectory: () => Promise<unknown[]>
    readSelectedSkillFileByPath: (path: string) => Promise<string>
  }
  store.selectedSkillDetail = {
    id: 'file-organizer',
    name: 'file-organizer',
    file_path: '/Users/by3/.agents/skills/file-organizer/SKILL.md',
    dir_path: '/Users/by3/.agents/skills/file-organizer',
    canonical_path: '/Users/by3/.agents/skills/file-organizer',
  }

  const nodes = await store.loadSelectedSkillDirectory()
  const content = await store.readSelectedSkillFileByPath('/Users/by3/.agents/skills/file-organizer/SKILL.md')
  await assert.rejects(
    () => store.readSelectedSkillFileByPath('/Users/by3/.agents/skills/other/SKILL.md'),
    /当前 Skill 目录/
  )

  assert.equal(nodes.length, 1)
  assert.equal(store.skillDirectoryTree.length, 1)
  assert.equal(content, '# file-organizer')
  assert.equal(store.selectedSkillFileContent, '# file-organizer')
  assert.deepEqual(calls.map(call => call.command), ['list_skill_directory', 'read_file_by_path'])
  assert.deepEqual(calls[0].args, {
    dirPath: '/Users/by3/.agents/skills/file-organizer',
    context: {
      skillId: 'file-organizer',
      agentId: null,
      rowId: null,
    },
  })
  assert.deepEqual(calls[1].args, {
    path: '/Users/by3/.agents/skills/file-organizer/SKILL.md',
    context: {
      skillId: 'file-organizer',
      agentId: null,
      rowId: null,
    },
  })
})

test('skills manager opens current Skill directory through official file manager command', async () => {
  installMemoryLocalStorage()
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  installTauriInvokeMock((command, args) => {
    calls.push({ command, args })
    if (command === 'open_in_file_manager') return null
    throw new Error(`Unexpected command: ${command}`)
  })
  setActivePinia(createPinia())
  const store = useSkillsManageStore() as unknown as {
    selectedSkillDetail: {
      id: string
      name: string
      file_path: string
      dir_path: string
      canonical_path: string
    }
    openSelectedSkillInFileManager: () => Promise<void>
  }
  store.selectedSkillDetail = {
    id: 'file-organizer',
    name: 'file-organizer',
    file_path: '/Users/by3/.agents/skills/file-organizer/SKILL.md',
    dir_path: '/Users/by3/.agents/skills/file-organizer',
    canonical_path: '/Users/by3/.agents/skills/file-organizer',
  }

  await store.openSelectedSkillInFileManager()

  assert.deepEqual(calls, [{
    command: 'open_in_file_manager',
    args: {
      path: '/Users/by3/.agents/skills/file-organizer',
      context: {
        skillId: 'file-organizer',
        agentId: null,
        rowId: null,
      },
    },
  }])
})

test('skills manager uses official AI Summary commands with official Skill id and SKILL.md content', async () => {
  installMemoryLocalStorage()
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  installTauriInvokeMock((command, args) => {
    calls.push({ command, args })
    if (command === 'get_skill_explanation') return 'Cached summary'
    if (command === 'explain_skill_stream') return null
    if (command === 'refresh_skill_explanation') return null
    throw new Error(`Unexpected command: ${command}`)
  })
  setActivePinia(createPinia())
  const store = useSkillsManageStore() as unknown as {
    selectedSkillContent: string
    setSkillDisplayAlias: (skillId: string, alias: string) => unknown
    skillExplanations: Record<string, string>
    getSkillExplanation: (skillId: string, lang?: string) => Promise<string>
    explainSkill: (skillId: string, content: string, lang?: string) => Promise<void>
    refreshSkillExplanation: (skillId: string, content: string, lang?: string) => Promise<void>
  }

  store.setSkillDisplayAlias('file-organizer', '帮我整理文件')
  store.selectedSkillContent = '---\nname: file-organizer\n---\n\nOfficial content'

  const cached = await store.getSkillExplanation('file-organizer', 'zh')
  await store.explainSkill('file-organizer', store.selectedSkillContent, 'zh')
  await store.refreshSkillExplanation('file-organizer', store.selectedSkillContent, 'zh')

  assert.equal(cached, 'Cached summary')
  assert.equal(store.skillExplanations['file-organizer:zh'], 'Cached summary')
  assert.deepEqual(calls, [
    {
      command: 'get_skill_explanation',
      args: { skillId: 'file-organizer', lang: 'zh' },
    },
    {
      command: 'explain_skill_stream',
      args: {
        skillId: 'file-organizer',
        content: '---\nname: file-organizer\n---\n\nOfficial content',
        lang: 'zh',
      },
    },
    {
      command: 'refresh_skill_explanation',
      args: {
        skillId: 'file-organizer',
        content: '---\nname: file-organizer\n---\n\nOfficial content',
        lang: 'zh',
      },
    },
  ])
})

test('skills manager loads Platform Skill detail with official agent and row identity', async () => {
  installMemoryLocalStorage()
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  installTauriInvokeMock((command, args) => {
    calls.push({ command, args })
    if (command === 'get_skill_detail') {
      return {
        id: 'plugin-helper',
        row_id: 'claude-code:plugin:plugin-helper',
        name: 'plugin-helper',
        description: 'Plugin helper',
        file_path: '/Users/by3/.claude/plugins/acme/skills/plugin-helper/SKILL.md',
        dir_path: '/Users/by3/.claude/plugins/acme/skills/plugin-helper',
        canonical_path: null,
        is_central: false,
        source: 'plugin',
        scanned_at: '2026-06-08T00:00:00Z',
        source_kind: 'plugin',
        source_root: '/Users/by3/.claude/plugins/acme',
        is_read_only: true,
        conflict_group: 'plugin-helper',
        conflict_count: 2,
        read_only_agents: [],
        installations: [],
        collections: [],
      }
    }
    if (command === 'read_file_by_path') return '# plugin-helper'
    throw new Error(`Unexpected command: ${command}`)
  })
  setActivePinia(createPinia())
  const store = useSkillsManageStore() as unknown as {
    selectedSkillContent: string
    selectedSkillDetail: { row_id?: string | null; source_kind?: string | null; is_read_only?: boolean } | null
    loadPlatformSkillDetail: (skillId: string, agentId: string, rowId: string) => Promise<unknown>
  }

  await store.loadPlatformSkillDetail('plugin-helper', 'claude-code', 'claude-code:plugin:plugin-helper')

  assert.equal(store.selectedSkillContent, '# plugin-helper')
  assert.equal(store.selectedSkillDetail?.row_id, 'claude-code:plugin:plugin-helper')
  assert.equal(store.selectedSkillDetail?.source_kind, 'plugin')
  assert.equal(store.selectedSkillDetail?.is_read_only, true)
  assert.deepEqual(calls, [
    {
      command: 'get_skill_detail',
      args: {
        skillId: 'plugin-helper',
        agentId: 'claude-code',
        rowId: 'claude-code:plugin:plugin-helper',
      },
    },
    {
      command: 'read_file_by_path',
      args: {
        path: '/Users/by3/.claude/plugins/acme/skills/plugin-helper/SKILL.md',
        context: {
          skillId: 'plugin-helper',
          agentId: 'claude-code',
          rowId: 'claude-code:plugin:plugin-helper',
        },
      },
    },
  ])
})

test('skills manager syncs Registry with official force refresh options', async () => {
  installMemoryLocalStorage()
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  installTauriInvokeMock((command, args) => {
    calls.push({ command, args })
    if (command === 'sync_registry_with_options') return []
    if (command === 'list_registries') return []
    if (command === 'search_marketplace_skills') return []
    throw new Error(`Unexpected command: ${command}`)
  })
  setActivePinia(createPinia())
  const store = useSkillsManageStore() as unknown as {
    syncRegistryWithOptions: (registryId: string, options: { forceRefresh: boolean }) => Promise<unknown>
  }

  await store.syncRegistryWithOptions('anthropic', { forceRefresh: true })

  assert.deepEqual(calls[0], {
    command: 'sync_registry_with_options',
    args: {
      registryId: 'anthropic',
      options: { forceRefresh: true },
    },
  })
})

test('skills manager supports GitHub repo preview, markdown preview, import, and AI Summary commands', async () => {
  installMemoryLocalStorage()
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  installTauriInvokeMock((command, args) => {
    calls.push({ command, args })
    if (command === 'preview_github_repo_import') {
      return {
        repo: {
          owner: 'anthropics',
          repo: 'skills',
          branch: 'main',
          normalizedUrl: 'https://github.com/anthropics/skills',
        },
        skills: [{
          sourcePath: 'frontend-design/SKILL.md',
          skillId: 'frontend-design',
          skillName: 'frontend-design',
          description: 'Frontend design',
          rootDirectory: 'frontend-design',
          skillDirectoryName: 'frontend-design',
          downloadUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/frontend-design/SKILL.md',
          conflict: null,
        }],
      }
    }
    if (command === 'fetch_github_skill_markdown') return '# frontend-design'
    if (command === 'import_github_repo_skills') {
      return {
        repo: {
          owner: 'anthropics',
          repo: 'skills',
          branch: 'main',
          normalizedUrl: 'https://github.com/anthropics/skills',
        },
        importedSkills: [{
          sourcePath: 'frontend-design/SKILL.md',
          originalSkillId: 'frontend-design',
          importedSkillId: 'frontend-design',
          skillName: 'frontend-design',
          targetDirectory: '/Users/by3/.agents/skills/frontend-design',
          resolution: 'skip',
        }],
        skippedSkills: [],
      }
    }
    if (command === 'scan_all_skills') return { total_skills: 1, agents_scanned: 1, skills_by_agent: {} }
    if (command === 'get_central_skills') return []
    if (command === 'get_agents') return []
    if (command === 'get_agents') return []
    if (command === 'explain_skill_stream') return null
    throw new Error(`Unexpected command: ${command}`)
  })
  setActivePinia(createPinia())
  const store = useSkillsManageStore() as unknown as {
    githubRepoPreview: { skills: Array<{ skillId: string }> } | null
    githubSkillMarkdown: Record<string, { status: string; content?: string }>
    githubRepoImportResult: { importedSkills: Array<{ importedSkillId: string }> } | null
    previewGitHubRepoImport: (repoUrl: string) => Promise<{ skills: Array<{ skillId: string }> }>
    fetchGitHubSkillMarkdown: (sourcePath: string, downloadUrl: string) => Promise<string>
    importGitHubRepoSkills: (repoUrl: string, selections: Array<{ sourcePath: string; resolution: 'skip' }>) => Promise<unknown>
    generateGitHubImportAiSummary: (sourcePath: string, skillName: string, content: string, lang?: string) => Promise<void>
  }

  const preview = await store.previewGitHubRepoImport('https://github.com/anthropics/skills')
  const markdown = await store.fetchGitHubSkillMarkdown(
    'frontend-design/SKILL.md',
    'https://raw.githubusercontent.com/anthropics/skills/main/frontend-design/SKILL.md'
  )
  await store.importGitHubRepoSkills('https://github.com/anthropics/skills', [{
    sourcePath: 'frontend-design/SKILL.md',
    resolution: 'skip',
  }])
  await store.generateGitHubImportAiSummary('frontend-design/SKILL.md', 'frontend-design', markdown, 'zh')

  assert.equal(preview.skills[0].skillId, 'frontend-design')
  assert.equal(store.githubRepoPreview?.skills[0].skillId, 'frontend-design')
  assert.equal(store.githubSkillMarkdown['frontend-design/SKILL.md'].content, '# frontend-design')
  assert.equal(store.githubRepoImportResult?.importedSkills[0].importedSkillId, 'frontend-design')
  assert.deepEqual(calls.map(call => call.command), [
    'preview_github_repo_import',
    'fetch_github_skill_markdown',
    'import_github_repo_skills',
    'scan_all_skills',
    'get_central_skills',
    'get_agents',
    'explain_skill_stream',
  ])
  assert.deepEqual(calls[6].args, {
    skillId: 'github-import:frontend-design/SKILL.md',
    content: '请基于下面的 SKILL.md 内容，生成适合导入决策的中文摘要。分成 3 个简短部分：1）做什么 2）什么时候值得导入 3）依赖或注意事项。保持简洁。\n\nSkill: frontend-design\n\n# frontend-design',
    lang: 'zh',
  })
})

test('skills manager controls Discover roots, scan lifecycle, platform import, and clearing', async () => {
  installMemoryLocalStorage()
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  installTauriInvokeMock((command, args) => {
    calls.push({ command, args })
    if (command === 'get_scan_roots') {
      return [{
        path: '/Users/by3/projects',
        label: 'Projects',
        exists: true,
        enabled: true,
      }]
    }
    if (command === 'get_discovered_skills') {
      return [{
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
      }]
    }
    if (command === 'set_scan_root_enabled') return null
    if (command === 'start_project_scan') {
      return {
        total_projects: 1,
        total_skills: 1,
        projects: [{
          project_path: '/Users/by3/projects/demo',
          project_name: 'demo',
          skills: [],
        }],
      }
    }
    if (command === 'stop_project_scan') return null
    if (command === 'import_discovered_skill_to_platform') {
      return { skill_id: 'writer', target: 'opencode' }
    }
    if (command === 'get_agents') return []
    if (command === 'get_skills_by_agent') return []
    if (command === 'clear_discovered_skills') return null
    throw new Error(`Unexpected command: ${command}`)
  })
  setActivePinia(createPinia())
  const store = useSkillsManageStore() as unknown as {
    scanRoots: Array<{ path: string; enabled: boolean }>
    discoveredProjects: Array<{ project_path: string; skills: unknown[] }>
    isDiscoverScanning: boolean
    discoverProgress: { percent: number; current_path: string; skills_found: number; projects_found: number } | null
    loadScanRoots: () => Promise<unknown[]>
    setScanRootEnabled: (path: string, enabled: boolean) => Promise<void>
    startProjectScan: (roots: Array<{ path: string; label: string; exists: boolean; enabled: boolean }>) => Promise<unknown>
    stopProjectScan: () => Promise<void>
    importDiscoveredSkillToPlatform: (discoveredSkillId: string, agentId: string, method?: 'symlink' | 'copy') => Promise<unknown>
    clearDiscoveredSkills: () => Promise<void>
  }

  await store.loadScanRoots()
  await store.setScanRootEnabled('/Users/by3/projects', false)
  await store.startProjectScan([{
    path: '/Users/by3/projects',
    label: 'Projects',
    exists: true,
    enabled: true,
  }])
  await store.stopProjectScan()
  await store.importDiscoveredSkillToPlatform('claude-code__demo__writer', 'opencode', 'copy')
  await store.clearDiscoveredSkills()

  assert.equal(store.scanRoots[0].enabled, true)
  assert.equal(store.isDiscoverScanning, false)
  assert.equal(store.discoverProgress, null)
  assert.deepEqual(calls.map(call => call.command), [
    'get_scan_roots',
    'get_discovered_skills',
    'set_scan_root_enabled',
    'get_scan_roots',
    'get_discovered_skills',
    'start_project_scan',
    'stop_project_scan',
    'import_discovered_skill_to_platform',
    'get_agents',
    'get_skills_by_agent',
    'clear_discovered_skills',
  ])
  assert.deepEqual(calls[2].args, {
    path: '/Users/by3/projects',
    enabled: false,
  })
  assert.deepEqual(calls[7].args, {
    discoveredSkillId: 'claude-code__demo__writer',
    agentId: 'opencode',
    method: 'copy',
  })
  assert.deepEqual(store.discoveredProjects, [])
})

test('skills manager supports Collection edit, import, export, and batch install results', async () => {
  installMemoryLocalStorage()
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  installTauriInvokeMock((command, args) => {
    calls.push({ command, args })
    if (command === 'get_collections') {
      return [{
        id: 'collection-1',
        name: 'Writing Kit',
        description: 'Writing skills',
        created_at: '2026-06-08T00:00:00Z',
        updated_at: '2026-06-08T00:00:00Z',
      }]
    }
    if (command === 'get_collection_detail') {
      return {
        id: args?.collectionId,
        name: 'Writing Kit',
        description: 'Updated',
        created_at: '2026-06-08T00:00:00Z',
        updated_at: '2026-06-08T00:00:01Z',
        skills: [skill({ id: 'writer', name: 'writer' })],
      }
    }
    if (command === 'update_collection') {
      return {
        id: args?.collectionId,
        name: args?.name,
        description: args?.description,
        created_at: '2026-06-08T00:00:00Z',
        updated_at: '2026-06-08T00:00:01Z',
      }
    }
    if (command === 'export_collection') return '{"name":"Writing Kit","skills":["writer"]}'
    if (command === 'import_collection') {
      return {
        id: 'collection-imported',
        name: 'Imported Kit',
        description: null,
        created_at: '2026-06-08T00:00:02Z',
        updated_at: '2026-06-08T00:00:02Z',
      }
    }
    if (command === 'batch_install_collection') {
      return {
        succeeded: ['opencode'],
        failed: [{ agent_id: 'claude-code', error: 'Skill already exists' }],
      }
    }
    if (command === 'scan_all_skills') return { total_skills: 1, agents_scanned: 1, skills_by_agent: {} }
    if (command === 'get_central_skills') return []
    if (command === 'get_agents') return []
    throw new Error(`Unexpected command: ${command}`)
  })
  setActivePinia(createPinia())
  const store = useSkillsManageStore() as unknown as {
    collectionDetails: Record<string, { name: string; description?: string | null; skills: Array<{ id: string }> }>
    updateCollection: (collectionId: string, name: string, description?: string) => Promise<{ name: string }>
    exportCollection: (collectionId: string) => Promise<string>
    importCollection: (json: string) => Promise<{ id: string }>
    batchInstallCollection: (collectionId: string, agentIds: string[]) => Promise<{ succeeded: string[]; failed: Array<{ agent_id: string; error: string }> }>
  }

  const updated = await store.updateCollection('collection-1', 'Writing Kit Pro', 'Updated')
  const exported = await store.exportCollection('collection-1')
  const imported = await store.importCollection('{"name":"Imported Kit","skills":["writer"]}')
  const installed = await store.batchInstallCollection('collection-1', ['opencode', 'claude-code'])

  assert.equal(updated.name, 'Writing Kit Pro')
  assert.equal(exported, '{"name":"Writing Kit","skills":["writer"]}')
  assert.equal(imported.id, 'collection-imported')
  assert.deepEqual(installed.failed, [{ agent_id: 'claude-code', error: 'Skill already exists' }])
  assert.deepEqual(calls.map(call => call.command), [
    'update_collection',
    'get_collections',
    'get_collection_detail',
    'export_collection',
    'import_collection',
    'get_collections',
    'get_collection_detail',
    'batch_install_collection',
    'scan_all_skills',
    'get_central_skills',
    'get_agents',
  ])
  assert.deepEqual(calls[0].args, {
    collectionId: 'collection-1',
    name: 'Writing Kit Pro',
    description: 'Updated',
  })
  assert.deepEqual(calls[3].args, { collectionId: 'collection-1' })
  assert.deepEqual(calls[4].args, { json: '{"name":"Imported Kit","skills":["writer"]}' })
})

test('skills manager supports Settings scan directories, GitHub PAT, AI settings, and custom Platform commands', async () => {
  installMemoryLocalStorage()
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  installTauriInvokeMock((command, args) => {
    calls.push({ command, args })
    if (command === 'get_scan_directories') {
      return [
        {
          id: 1,
          path: '/Users/by3/projects',
          label: 'Projects',
          is_builtin: false,
          is_active: true,
          added_at: '2026-06-08T00:00:00Z',
        },
      ]
    }
    if (command === 'add_scan_directory') {
      return {
        id: 2,
        path: '/Users/by3/labs',
        label: 'Labs',
        is_builtin: false,
        is_active: true,
        added_at: '2026-06-08T00:00:00Z',
      }
    }
    if (command === 'remove_scan_directory') return null
    if (command === 'set_scan_directory_active') return null
    if (command === 'get_setting') {
      const key = args?.key
      if (key === 'github_pat') return 'github_pat_saved'
      if (key === 'ai_provider') return 'openrouter'
      if (key === 'ai_api_key') return 'sk_saved'
      if (key === 'ai_model') return 'anthropic/claude-sonnet-4'
      if (key === 'ai_api_url') return 'https://openrouter.ai/api/v1'
      return null
    }
    if (command === 'set_setting') return null
    if (command === 'add_custom_agent') {
      return agent({
        id: 'custom-lab',
        display_name: 'Lab Platform',
        category: 'coding',
        global_skills_dir: '/Users/by3/.lab/skills',
        is_builtin: false,
      })
    }
    if (command === 'update_custom_agent') {
      return agent({
        id: 'custom-lab',
        display_name: 'Lab Platform Pro',
        category: 'coding',
        global_skills_dir: '/Users/by3/.lab-pro/skills',
        is_builtin: false,
      })
    }
    if (command === 'remove_custom_agent') return null
    if (command === 'get_agents') return []
    throw new Error(`Unexpected command: ${command}`)
  })
  setActivePinia(createPinia())
  const store = useSkillsManageStore() as unknown as {
    scanDirectories: unknown[]
    githubPat: string
    aiSettings: { provider: string; apiKey: string; model: string; apiUrl: string }
    loadScanDirectories: () => Promise<unknown[]>
    addScanDirectory: (path: string, label?: string) => Promise<unknown>
    removeScanDirectory: (path: string) => Promise<void>
    setScanDirectoryActive: (path: string, isActive: boolean) => Promise<void>
    loadGitHubPat: () => Promise<string>
    saveGitHubPat: (value: string) => Promise<void>
    clearGitHubPat: () => Promise<void>
    loadAiSettings: () => Promise<unknown>
    saveAiSettings: (settings: { provider: string; apiKey: string; model: string; apiUrl: string }) => Promise<void>
    addCustomPlatform: (config: { display_name: string; global_skills_dir: string; category?: string }) => Promise<AgentWithStatus>
    updateCustomPlatform: (agentId: string, config: { display_name: string; global_skills_dir: string; category?: string }) => Promise<AgentWithStatus>
    removeCustomPlatform: (agentId: string) => Promise<void>
  }

  await store.loadScanDirectories()
  await store.addScanDirectory('/Users/by3/labs', 'Labs')
  await store.setScanDirectoryActive('/Users/by3/labs', false)
  await store.removeScanDirectory('/Users/by3/labs')
  const pat = await store.loadGitHubPat()
  await store.saveGitHubPat(' github_pat_new ')
  await store.clearGitHubPat()
  await store.loadAiSettings()
  await store.saveAiSettings({
    provider: 'custom',
    apiKey: 'sk_new',
    model: 'claude-custom',
    apiUrl: 'https://ai.example.com/v1',
  })
  await store.addCustomPlatform({
    display_name: 'Lab Platform',
    global_skills_dir: '/Users/by3/.lab/skills',
    category: 'coding',
  })
  await store.updateCustomPlatform('custom-lab', {
    display_name: 'Lab Platform Pro',
    global_skills_dir: '/Users/by3/.lab-pro/skills',
    category: 'coding',
  })
  await store.removeCustomPlatform('custom-lab')

  assert.equal(store.scanDirectories.length, 1)
  assert.equal(pat, 'github_pat_saved')
  assert.equal(store.githubPat, '')
  assert.deepEqual(store.aiSettings, {
    provider: 'custom',
    apiKey: 'sk_new',
    model: 'claude-custom',
    apiUrl: 'https://ai.example.com/v1',
  })
  assert.deepEqual(calls.map(call => call.command), [
    'get_scan_directories',
    'add_scan_directory',
    'set_scan_directory_active',
    'get_scan_directories',
    'remove_scan_directory',
    'get_scan_directories',
    'get_setting',
    'set_setting',
    'set_setting',
    'get_setting',
    'get_setting',
    'get_setting',
    'get_setting',
    'set_setting',
    'set_setting',
    'set_setting',
    'set_setting',
    'add_custom_agent',
    'get_agents',
    'update_custom_agent',
    'get_agents',
    'remove_custom_agent',
    'get_agents',
  ])
  assert.deepEqual(calls[1].args, { path: '/Users/by3/labs', label: 'Labs' })
  assert.deepEqual(calls[2].args, { path: '/Users/by3/labs', isActive: false })
  assert.deepEqual(calls[4].args, { path: '/Users/by3/labs' })
  assert.deepEqual(calls[7].args, { key: 'github_pat', value: 'github_pat_new' })
  assert.deepEqual(calls[8].args, { key: 'github_pat', value: '' })
  assert.deepEqual(calls[17].args, {
    config: {
      display_name: 'Lab Platform',
      global_skills_dir: '/Users/by3/.lab/skills',
      category: 'coding',
    },
  })
  assert.deepEqual(calls[19].args, {
    agentId: 'custom-lab',
    config: {
      display_name: 'Lab Platform Pro',
      global_skills_dir: '/Users/by3/.lab-pro/skills',
      category: 'coding',
    },
  })
  assert.deepEqual(calls[21].args, { agentId: 'custom-lab' })
})

test('skills manager exposes Obsidian vaults as read-only Discover source', async () => {
  installMemoryLocalStorage()
  const calls: Array<{ command: string; args?: Record<string, unknown> }> = []
  installTauriInvokeMock((command, args) => {
    calls.push({ command, args })
    if (command === 'get_obsidian_vaults') {
      return [
        {
          id: 'vault-a',
          name: 'Research',
          path: '/Users/by3/Obsidian/Research',
          skill_count: 1,
        },
      ]
    }
    if (command === 'get_obsidian_vault_skills') {
      return [
        {
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
        },
      ]
    }
    throw new Error(`Unexpected command: ${command}`)
  })
  setActivePinia(createPinia())
  const store = useSkillsManageStore() as unknown as {
    obsidianVaults: Array<{ id: string; skill_count: number }>
    obsidianVaultSkills: Record<string, Array<{ id: string; platform_id: string }>>
    loadObsidianVaults: () => Promise<Array<{ id: string; skill_count: number }>>
    loadObsidianVaultSkills: (vaultId: string) => Promise<Array<{ id: string; platform_id: string }>>
  }

  const vaults = await store.loadObsidianVaults()
  const skills = await store.loadObsidianVaultSkills('vault-a')

  assert.equal(vaults[0].skill_count, 1)
  assert.equal(skills[0].platform_id, 'obsidian')
  assert.equal(store.obsidianVaultSkills['vault-a'][0].id, 'obsidian__vault__research-helper')
  assert.deepEqual(calls.map(call => call.command), [
    'get_obsidian_vaults',
    'get_obsidian_vault_skills',
  ])
  assert.deepEqual(calls[1].args, { vaultId: 'vault-a' })
})
