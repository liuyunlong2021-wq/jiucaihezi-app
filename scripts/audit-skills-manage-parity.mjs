import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const OFFICIAL_BASELINE = {
  repo: 'https://github.com/iamzhihuix/skills-manage',
  branch: 'main',
  commit: '467d0423beaf71a31c520d4e3795ec88acae5ab2',
  commitDate: '2026-05-02T14:00:37Z',
  commands: [
    'scan_all_skills',
    'get_agents',
    'detect_agents',
    'add_custom_agent',
    'update_custom_agent',
    'remove_custom_agent',
    'install_skill_to_agent',
    'uninstall_skill_from_agent',
    'batch_install_to_agents',
    'get_skills_by_agent',
    'get_central_skills',
    'get_central_skill_bundles',
    'get_central_skill_bundle_detail',
    'preview_delete_central_skill_bundle',
    'delete_central_skill_bundle',
    'delete_central_skill',
    'get_skill_detail',
    'read_skill_content',
    'read_file_by_path',
    'list_skill_directory',
    'open_in_file_manager',
    'create_collection',
    'get_collections',
    'get_collection_detail',
    'add_skill_to_collection',
    'remove_skill_from_collection',
    'delete_collection',
    'update_collection',
    'batch_install_collection',
    'export_collection',
    'import_collection',
    'get_scan_directories',
    'add_scan_directory',
    'remove_scan_directory',
    'set_scan_directory_active',
    'get_setting',
    'set_setting',
    'discover_scan_roots',
    'get_scan_roots',
    'get_obsidian_vaults',
    'get_obsidian_vault_skills',
    'set_scan_root_enabled',
    'start_project_scan',
    'stop_project_scan',
    'get_discovered_skills',
    'import_discovered_skill_to_central',
    'import_discovered_skill_to_platform',
    'clear_discovered_skills',
    'preview_github_repo_import',
    'import_github_repo_skills',
    'fetch_github_skill_markdown',
    'list_registries',
    'add_registry',
    'remove_registry',
    'sync_registry',
    'sync_registry_with_options',
    'search_marketplace_skills',
    'install_marketplace_skill',
    'explain_skill',
    'get_skill_explanation',
    'explain_skill_stream',
    'refresh_skill_explanation',
  ],
  rustModules: [
    'agents.rs',
    'collections.rs',
    'db.rs',
    'discover.rs',
    'github_import.rs',
    'linker.rs',
    'marketplace.rs',
    'path_utils.rs',
    'scanner.rs',
    'settings.rs',
    'skills.rs',
  ],
  typeFields: {
    AgentWithStatus: [
      'id',
      'display_name',
      'category',
      'global_skills_dir',
      'project_skills_dir',
      'icon_name',
      'is_detected',
      'is_builtin',
      'is_enabled',
    ],
    ScanResult: ['total_skills', 'agents_scanned', 'skills_by_agent'],
    Skill: [
      'id',
      'name',
      'description',
      'file_path',
      'canonical_path',
      'is_central',
      'source',
      'content',
      'scanned_at',
    ],
    SkillForAgent: [
      'id',
      'row_id',
      'name',
      'description',
      'file_path',
      'dir_path',
      'link_type',
      'symlink_target',
      'is_central',
      'source_kind',
      'source_root',
      'is_read_only',
      'conflict_group',
      'conflict_count',
    ],
    SkillInstallation: [
      'skill_id',
      'agent_id',
      'installed_path',
      'link_type',
      'symlink_target',
      'installed_at',
    ],
    SkillDetail: [
      'row_id',
      'dir_path',
      'source_kind',
      'source_root',
      'is_read_only',
      'conflict_group',
      'conflict_count',
      'read_only_agents',
      'installations',
      'collections',
    ],
    SkillDirectoryNode: ['name', 'path', 'relative_path', 'is_dir', 'children'],
    SkillWithLinks: [
      'id',
      'name',
      'description',
      'file_path',
      'canonical_path',
      'is_central',
      'source',
      'scanned_at',
      'created_at',
      'updated_at',
      'linked_agents',
      'read_only_agents',
    ],
    CentralSkillBundle: [
      'name',
      'relativePath',
      'path',
      'isSymlink',
      'skillCount',
      'linkedAgentCount',
      'readOnlyAgentCount',
    ],
    Collection: ['id', 'name', 'description', 'created_at', 'updated_at'],
    CollectionDetail: ['skills'],
    ScanDirectory: ['id', 'path', 'label', 'is_active', 'is_builtin', 'added_at'],
    ScanRoot: ['path', 'label', 'exists', 'enabled'],
    ObsidianVault: ['id', 'name', 'path', 'skill_count'],
    DiscoveredSkill: [
      'id',
      'name',
      'description',
      'file_path',
      'dir_path',
      'platform_id',
      'platform_name',
      'project_path',
      'project_name',
      'is_already_central',
    ],
    DiscoveredProject: ['project_path', 'project_name', 'skills'],
    DiscoverResult: ['total_projects', 'total_skills', 'projects'],
    DiscoverImportResult: ['skill_id', 'target'],
    SkillRegistry: [
      'id',
      'name',
      'source_type',
      'url',
      'is_builtin',
      'is_enabled',
      'last_synced',
      'last_attempted_sync',
      'last_sync_status',
      'last_sync_error',
      'cache_updated_at',
      'cache_expires_at',
      'etag',
      'last_modified',
      'created_at',
    ],
    MarketplaceSkill: [
      'id',
      'registry_id',
      'name',
      'description',
      'download_url',
      'is_installed',
      'synced_at',
      'cache_updated_at',
    ],
    GitHubRepoRef: ['owner', 'repo', 'branch', 'normalizedUrl'],
    GitHubSkillConflict: [
      'existingSkillId',
      'existingName',
      'existingCanonicalPath',
      'proposedSkillId',
      'proposedName',
    ],
    GitHubSkillPreview: [
      'sourcePath',
      'skillId',
      'skillName',
      'description',
      'rootDirectory',
      'skillDirectoryName',
      'downloadUrl',
      'conflict',
    ],
    GitHubRepoPreview: ['repo', 'skills'],
    GitHubSkillImportSelection: ['sourcePath', 'resolution', 'renamedSkillId'],
    ImportedGitHubSkillSummary: [
      'sourcePath',
      'originalSkillId',
      'importedSkillId',
      'skillName',
      'targetDirectory',
      'resolution',
    ],
    GitHubRepoImportResult: ['repo', 'importedSkills', 'skippedSkills'],
  },
  i18nTerms: [
    'Skill',
    'Central Skills',
    'Platform',
    'Marketplace',
    'Registry',
    'Discover',
    'Collections',
    'GitHub',
    'SKILL.md',
    'AI Summary',
    'symlink',
    'copy',
  ],
}

export function extractRegisteredSkillCommands(source) {
  const commands = new Set()
  const pattern = /skills::[a-zA-Z_][\w]*::([a-zA-Z_][\w]*)/g
  for (const match of source.matchAll(pattern)) commands.add(match[1])
  return [...commands].sort()
}

export function extractInterfaceFields(source, interfaceName) {
  const startPattern = new RegExp(`export\\s+interface\\s+${interfaceName}\\b[^\\{]*\\{`, 'm')
  const match = startPattern.exec(source)
  if (!match) return null
  const start = match.index + match[0].length
  let depth = 1
  let index = start
  while (index < source.length && depth > 0) {
    const ch = source[index]
    if (ch === '{') depth += 1
    if (ch === '}') depth -= 1
    index += 1
  }
  const body = source.slice(start, index - 1)
  const fields = new Set()
  const fieldPattern = /^\s*([A-Za-z_][\w]*)(?:\??)?\s*:/gm
  for (const fieldMatch of body.matchAll(fieldPattern)) fields.add(fieldMatch[1])
  return [...fields].sort()
}

export function listFilesRecursive(root, predicate = () => true) {
  if (!existsSync(root)) return []
  const output = []
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      output.push(...listFilesRecursive(path, predicate))
    } else if (predicate(path)) {
      output.push(path)
    }
  }
  return output
}

export function auditSkillsManageParity(root = process.cwd(), baseline = OFFICIAL_BASELINE) {
  const results = []
  const libPath = join(root, 'src-tauri/src/lib.rs')
  const typesPath = join(root, 'src/types/skillsManage.ts')
  const skillsModuleDir = join(root, 'src-tauri/src/skills')
  const i18nSources = [
    join(root, 'src/i18n/index.ts'),
    ...listFilesRecursive(join(root, 'src/components/skills'), (path) => /\.(vue|ts)$/.test(path)),
  ]

  const libSource = existsSync(libPath) ? readFileSync(libPath, 'utf8') : ''
  const localCommands = extractRegisteredSkillCommands(libSource)
  const localCommandSet = new Set(localCommands)
  const missingCommands = baseline.commands.filter((command) => !localCommandSet.has(command))
  results.push({
    name: 'Tauri command names',
    status: missingCommands.length ? 'fail' : 'pass',
    expected: baseline.commands.length,
    actual: localCommands.length,
    missing: missingCommands,
  })

  const localModules = existsSync(skillsModuleDir)
    ? readdirSync(skillsModuleDir).filter((file) => file.endsWith('.rs')).sort()
    : []
  const localModuleSet = new Set(localModules)
  const missingModules = baseline.rustModules.filter((file) => !localModuleSet.has(file))
  results.push({
    name: 'Rust module files',
    status: missingModules.length ? 'fail' : 'pass',
    expected: baseline.rustModules.length,
    actual: localModules.length,
    missing: missingModules,
  })

  const typeSource = existsSync(typesPath) ? readFileSync(typesPath, 'utf8') : ''
  const typeIssues = []
  for (const [interfaceName, fields] of Object.entries(baseline.typeFields)) {
    const localFields = extractInterfaceFields(typeSource, interfaceName)
    if (!localFields) {
      typeIssues.push({ interfaceName, missingInterface: true, missingFields: fields })
      continue
    }
    const localFieldSet = new Set(localFields)
    const missingFields = fields.filter((field) => !localFieldSet.has(field))
    if (missingFields.length) typeIssues.push({ interfaceName, missingFields })
  }
  results.push({
    name: 'TypeScript type fields',
    status: typeIssues.length ? 'fail' : 'pass',
    checked: Object.keys(baseline.typeFields).length,
    issues: typeIssues,
  })

  const i18nCorpus = i18nSources
    .filter((path) => existsSync(path))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')
  const missingTerms = baseline.i18nTerms.filter((term) => !i18nCorpus.includes(term))
  results.push({
    name: 'i18n/product terms',
    status: missingTerms.length ? 'warn' : 'pass',
    checked: baseline.i18nTerms.length,
    missing: missingTerms,
  })

  return {
    baseline: {
      repo: baseline.repo,
      branch: baseline.branch,
      commit: baseline.commit,
      commitDate: baseline.commitDate,
    },
    results,
    ok: results.every((result) => result.status !== 'fail'),
  }
}

export function formatAuditReport(report) {
  const lines = [
    `Skills Manage parity audit`,
    `Official baseline: ${report.baseline.repo}@${report.baseline.commit}`,
    '',
  ]
  for (const result of report.results) {
    const icon = result.status === 'pass' ? 'PASS' : result.status === 'warn' ? 'WARN' : 'FAIL'
    lines.push(`${icon} ${result.name}`)
    if (result.expected !== undefined) lines.push(`  expected: ${result.expected}, actual: ${result.actual}`)
    if (result.checked !== undefined) lines.push(`  checked: ${result.checked}`)
    if (result.missing?.length) lines.push(`  missing: ${result.missing.join(', ')}`)
    if (result.issues?.length) {
      for (const issue of result.issues) {
        if (issue.missingInterface) {
          lines.push(`  missing interface ${issue.interfaceName}`)
        }
        if (issue.missingFields?.length) {
          lines.push(`  ${issue.interfaceName}: missing ${issue.missingFields.join(', ')}`)
        }
      }
    }
  }
  return `${lines.join('\n')}\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || process.cwd())
  const report = auditSkillsManageParity(root)
  process.stdout.write(formatAuditReport(report))
  if (!report.ok) process.exitCode = 1
  else {
    const warnings = report.results.filter((result) => result.status === 'warn')
    if (warnings.length) process.stdout.write('Audit completed with warnings.\n')
  }
}
