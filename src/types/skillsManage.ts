export interface AgentWithStatus {
  id: string
  display_name: string
  category: string
  global_skills_dir: string
  project_skills_dir?: string | null
  icon_name?: string | null
  is_detected: boolean
  is_builtin: boolean
  is_enabled: boolean
  uses_central_root: boolean
  is_install_target: boolean
}

export interface ScanResult {
  total_skills: number
  agents_scanned: number
  skills_by_agent: Record<string, number>
}

export type ClaudeSourceKind = 'user' | 'plugin' | 'compatibility'

export interface SkillWithLinks {
  id: string
  name: string
  description?: string | null
  file_path: string
  canonical_path?: string | null
  is_central: boolean
  source?: string | null
  scanned_at: string
  created_at?: string | null
  updated_at?: string | null
  linked_agents: string[]
  read_only_agents?: string[]
  commands?: string[] | null
}

export interface SkillDisplayAlias {
  skillId: string
  alias: string
  updatedAt: number
}

export interface SkillDirectoryNode {
  name: string
  path: string
  relative_path: string
  is_dir: boolean
  children: SkillDirectoryNode[]
}

export interface CentralSkillBundle {
  name: string
  relativePath: string
  path: string
  isSymlink: boolean
  skillCount: number
  linkedAgentCount: number
  readOnlyAgentCount: number
}

export interface CentralSkillBundleDetail {
  bundle: CentralSkillBundle
  skills: SkillWithLinks[]
}

export interface CentralSkillBundleDeletePreview {
  bundle: CentralSkillBundle
  skills: SkillWithLinks[]
  affectedAgents: string[]
  skippedReadOnlyAgents: string[]
}

export interface DeleteCentralSkillBundleResult {
  relativePath: string
  removedBundlePath: string
  removedKind: string
  removedSkillIds: string[]
  uninstalledAgents: string[]
  skippedReadOnlyAgents: string[]
}

export interface Skill {
  id: string
  name: string
  description?: string | null
  file_path: string
  canonical_path?: string | null
  is_central: boolean
  source?: string | null
  content?: string | null
  scanned_at: string
}

export interface SkillForAgent {
  id: string
  row_id: string
  name: string
  description?: string | null
  file_path: string
  dir_path: string
  link_type: 'symlink' | 'copy' | 'native' | string
  symlink_target?: string | null
  is_central: boolean
  source_kind?: string | null
  source_root?: string | null
  is_read_only: boolean
  conflict_group?: string | null
  conflict_count: number
}

export interface SkillInstallation {
  skill_id: string
  agent_id: string
  installed_path: string
  link_type: string
  symlink_target?: string | null
  installed_at?: string | null
}

export interface Collection {
  id: string
  name: string
  description?: string | null
  created_at: string
  updated_at: string
}

export interface CollectionDetail extends Collection {
  skills: Skill[]
}

export interface CollectionBatchInstallResult {
  succeeded: string[]
  failed: Array<{ agent_id: string; error: string }>
}

export interface ScanRoot {
  path: string
  label: string
  exists: boolean
  enabled: boolean
}

export interface ScanDirectory {
  id: number
  path: string
  label?: string | null
  is_active: boolean
  is_builtin: boolean
  added_at: string
}

export interface DiscoveredSkill {
  id: string
  name: string
  description?: string | null
  file_path: string
  dir_path: string
  platform_id: string
  platform_name: string
  project_path: string
  project_name: string
  is_already_central: boolean
}

export interface DiscoveredProject {
  project_path: string
  project_name: string
  skills: DiscoveredSkill[]
}

export interface DiscoverResult {
  total_projects: number
  total_skills: number
  projects: DiscoveredProject[]
}

export interface DiscoverImportResult {
  skill_id: string
  target: string
}

export interface ObsidianVault {
  id: string
  name: string
  path: string
  skill_count: number
}

export interface DiscoverProgress {
  percent: number
  current_path: string
  skills_found: number
  projects_found: number
}

export interface DiscoverComplete {
  total_projects: number
  total_skills: number
}

export interface SkillRegistry {
  id: string
  name: string
  source_type: 'github' | 'http_json' | string
  url: string
  is_builtin: boolean
  is_enabled: boolean
  last_synced?: string | null
  last_attempted_sync?: string | null
  last_sync_status: 'never' | 'success' | 'error' | string
  last_sync_error?: string | null
  cache_updated_at?: string | null
  cache_expires_at?: string | null
  etag?: string | null
  last_modified?: string | null
  created_at: string
}

export interface MarketplaceSkill {
  id: string
  registry_id: string
  name: string
  description?: string | null
  download_url: string
  is_installed: boolean
  synced_at: string
  cache_updated_at?: string | null
}

export type DuplicateResolution = 'overwrite' | 'skip' | 'rename'

export interface GitHubRepoRef {
  owner: string
  repo: string
  branch: string
  normalizedUrl: string
}

export interface GitHubSkillConflict {
  existingSkillId: string
  existingName: string
  existingCanonicalPath?: string | null
  proposedSkillId: string
  proposedName: string
}

export interface GitHubSkillPreview {
  sourcePath: string
  skillId: string
  skillName: string
  description?: string | null
  rootDirectory: string
  skillDirectoryName: string
  downloadUrl: string
  conflict?: GitHubSkillConflict | null
}

export interface GitHubRepoPreview {
  repo: GitHubRepoRef
  skills: GitHubSkillPreview[]
}

export interface GitHubSkillImportSelection {
  sourcePath: string
  resolution: DuplicateResolution
  renamedSkillId?: string | null
}

export interface ImportedGitHubSkillSummary {
  sourcePath: string
  originalSkillId: string
  importedSkillId: string
  skillName: string
  targetDirectory: string
  resolution: DuplicateResolution
}

export interface GitHubRepoImportResult {
  repo: GitHubRepoRef
  importedSkills: ImportedGitHubSkillSummary[]
  skippedSkills: string[]
}

export interface GitHubSkillMarkdownState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  content?: string
  error?: string
}

export interface SkillDetail extends Omit<SkillWithLinks, 'linked_agents'> {
  row_id?: string | null
  dir_path?: string | null
  source_kind?: ClaudeSourceKind | null
  source_root?: string | null
  is_read_only?: boolean
  conflict_group?: string | null
  conflict_count?: number
  read_only_agents?: string[]
  installations: SkillInstallation[]
  collections?: Collection[]
}

export interface BatchInstallResult {
  succeeded: string[]
  failed: Array<{ agent_id: string; error: string }>
}

export interface InstallResult {
  symlink_path: string
}

export interface AiSettings {
  provider: string
  apiKey: string
  model: string
  apiUrl: string
}

export interface CustomPlatformConfig {
  display_name: string
  global_skills_dir: string
  category?: string
}

export interface DeleteCentralSkillResult {
  skillId: string
  removedCanonicalPath: string
  uninstalledAgents: string[]
  skippedReadOnlyAgents: string[]
}

export interface SaveCentralSkillResult {
  skillId: string
  filePath: string
}

export type SkillsManageTab = 'central' | 'platforms' | 'discover' | 'marketplace' | 'collections' | 'settings'
