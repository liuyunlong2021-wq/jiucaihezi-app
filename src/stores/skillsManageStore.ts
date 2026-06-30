import { invoke } from '@tauri-apps/api/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type {
  AgentWithStatus,
  AiSettings,
  BatchInstallResult,
  CentralSkillBundle,
  CentralSkillBundleDeletePreview,
  CentralSkillBundleDetail,
  Collection,
  CollectionBatchInstallResult,
  CollectionDetail,
  CustomPlatformConfig,
  DeleteCentralSkillResult,
  DeleteCentralSkillBundleResult,
  DiscoverImportResult,
  DiscoverProgress,
  DiscoverResult,
  DiscoveredProject,
  DiscoveredSkill,
  GitHubRepoImportResult,
  GitHubRepoPreview,
  GitHubSkillImportSelection,
  GitHubSkillMarkdownState,
  MarketplaceSkill,
  ObsidianVault,
  ScanDirectory,
  ScanRoot,
  SaveCentralSkillResult,
  InstallResult,
  ScanResult,
  SkillDirectoryNode,
  SkillDisplayAlias,
  SkillDetail,
  SkillForAgent,
  SkillRegistry,
  SkillsManageTab,
  SkillWithLinks,
} from '@/types/skillsManage'

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error || '未知错误')
}

/** Parse commands field: DB stores JSON string, frontend needs string[] */
function parseCommandsField(raw: unknown): string[] | null {
  if (!raw) return null
  if (Array.isArray(raw)) return raw as string[]
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : null } catch { return null }
  }
  return null
}

function normalizeSkillPath(path: string | null | undefined): string {
  return (path || '').replace(/\/+$/, '')
}

function dirname(path: string | null | undefined): string {
  const normalized = normalizeSkillPath(path)
  if (!normalized) return ''
  const index = normalized.lastIndexOf('/')
  return index > 0 ? normalized.slice(0, index) : normalized
}

function isPathInsideDirectory(path: string, directory: string): boolean {
  const normalizedPath = normalizeSkillPath(path)
  const normalizedDirectory = normalizeSkillPath(directory)
  return Boolean(
    normalizedPath &&
    normalizedDirectory &&
    (normalizedPath === normalizedDirectory || normalizedPath.startsWith(`${normalizedDirectory}/`))
  )
}

export const SKILL_DISPLAY_ALIAS_STORAGE_KEY = 'jc_skill_display_aliases_v1'

function getLocalStorage(): Storage | null {
  if (typeof globalThis === 'undefined') return null
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

function aliasDisplayLength(alias: string): number {
  return [...alias].reduce((total, char) => total + (char.charCodeAt(0) <= 0x7f ? 1 : 2), 0)
}

function normalizeSkillDisplayAlias(alias: string): string {
  const normalized = alias.trim()
  if (!normalized) return ''
  if (/[\r\n]/.test(normalized)) {
    throw new Error('显示别名不能包含换行')
  }
  if (aliasDisplayLength(normalized) > 80) {
    throw new Error('显示别名不能超过 40 个中文字符或 80 个 ASCII 字符')
  }
  return normalized
}

function readStoredSkillDisplayAliases(): Record<string, SkillDisplayAlias> {
  const storage = getLocalStorage()
  if (!storage) return {}
  try {
    const raw = storage.getItem(SKILL_DISPLAY_ALIAS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Partial<SkillDisplayAlias>>
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.entries(parsed).reduce<Record<string, SkillDisplayAlias>>((acc, [skillId, value]) => {
      if (
        value &&
        typeof value.alias === 'string' &&
        typeof value.updatedAt === 'number'
      ) {
        const normalized = normalizeSkillDisplayAlias(value.alias)
        if (normalized) {
          acc[skillId] = {
            skillId: typeof value.skillId === 'string' ? value.skillId : skillId,
            alias: normalized,
            updatedAt: value.updatedAt,
          }
        }
      }
      return acc
    }, {})
  } catch {
    return {}
  }
}

export const useSkillsManageStore = defineStore('skillsManage', () => {
  const activeTab = ref<SkillsManageTab>('central')
  const centralSkills = ref<SkillWithLinks[]>([])
  const centralBundles = ref<CentralSkillBundle[]>([])
  const centralBundleDetails = ref<Record<string, CentralSkillBundleDetail>>({})
  const centralBundleDeletePreview = ref<CentralSkillBundleDeletePreview | null>(null)
  const skillDisplayAliases = ref<Record<string, SkillDisplayAlias>>(readStoredSkillDisplayAliases())
  const agents = ref<AgentWithStatus[]>([])
  const platformSkills = ref<Record<string, SkillForAgent[]>>({})
  const selectedSkillDetail = ref<SkillDetail | null>(null)
  const selectedSkillContent = ref('')
  const selectedSkillId = ref<string | null>(null)
  const selectedSkillAgentId = ref<string | null>(null)
  const skillDirectoryTree = ref<SkillDirectoryNode[]>([])
  const selectedSkillFilePath = ref('')
  const selectedSkillFileContent = ref('')
  const skillExplanations = ref<Record<string, string>>({})
  const githubRepoPreview = ref<GitHubRepoPreview | null>(null)
  const githubRepoImportResult = ref<GitHubRepoImportResult | null>(null)
  const githubSkillMarkdown = ref<Record<string, GitHubSkillMarkdownState>>({})
  const registries = ref<SkillRegistry[]>([])
  const marketplaceSkills = ref<MarketplaceSkill[]>([])
  const collections = ref<Collection[]>([])
  const collectionDetails = ref<Record<string, CollectionDetail>>({})
  const scanDirectories = ref<ScanDirectory[]>([])
  const githubPat = ref('')
  const aiSettings = ref<AiSettings>({ provider: '', apiKey: '', model: '', apiUrl: '' })
  const databasePath = ref('')
  const obsidianVaults = ref<ObsidianVault[]>([])
  const obsidianVaultSkills = ref<Record<string, DiscoveredSkill[]>>({})
  const scanRoots = ref<ScanRoot[]>([])
  const discoveredProjects = ref<DiscoveredProject[]>([])
  const discoverProgress = ref<DiscoverProgress | null>(null)
  const lastScan = ref<ScanResult | null>(null)
  const isLoadingCentral = ref(false)
  const isLoadingPlatforms = ref(false)
  const loadingPlatformAgentId = ref<string | null>(null)
  const isLoadingMarketplace = ref(false)
  const isPreviewingGitHubRepo = ref(false)
  const isImportingGitHubRepo = ref(false)
  const syncingRegistryId = ref<string | null>(null)
  const installingMarketplaceSkillId = ref<string | null>(null)
  const isLoadingCollections = ref(false)
  const isLoadingSettings = ref(false)
  const isSavingSettings = ref(false)
  const isLoadingObsidian = ref(false)
  const isLoadingDiscover = ref(false)
  const isDiscoverScanning = ref(false)
  const isScanning = ref(false)
  const isLoadingDetail = ref(false)
  const isLoadingSkillDirectory = ref(false)
  const isLoadingSkillFile = ref(false)
  const isLoadingSkillExplanation = ref(false)
  const installingSkillId = ref<string | null>(null)
  const deletingSkillId = ref<string | null>(null)
  const deletingBundlePath = ref<string | null>(null)
  const error = ref<string | null>(null)
  let skillDetailRequestId = 0

  const centralRoot = computed(() =>
    agents.value.find((agent) => agent.id === 'central')?.global_skills_dir || '~/.agents/skills'
  )

  const platformAgents = computed(() =>
    agents.value.filter((agent) => agent.is_install_target)
  )
  const installableAgents = computed(() => platformAgents.value)

  // ── 我的Skill（localStorage 持久化） ──
  const MINE_KEY = 'jc_mine_skills'
  const mineSkillIds = ref<Set<string>>(new Set(
    (() => { try { return JSON.parse(localStorage.getItem(MINE_KEY) || '[]') } catch { return [] } })()
  ))
  function persistMine() { localStorage.setItem(MINE_KEY, JSON.stringify([...mineSkillIds.value])) }

  function isMineSkill(id: string) { return mineSkillIds.value.has(id) }

  function toggleMineSkill(id: string) {
    const next = new Set(mineSkillIds.value)
    next.has(id) ? next.delete(id) : next.add(id)
    mineSkillIds.value = next
    persistMine()
  }

  /** 首次加载时自动将内置+GitHub导入+中心目录的 skill 加入"我的" */
  function seedMineSkills(skills: SkillWithLinks[]) {
    let changed = false
    for (const s of skills) {
      if ((s.source === 'builtin' || s.source === 'github' || s.source === 'native') && !mineSkillIds.value.has(s.id)) {
        mineSkillIds.value.add(s.id)
        changed = true
      }
    }
    if (changed) persistMine()
  }

  /** 同步主 API Key 到 skills DB，供摘要等功能使用 */
  async function syncMainApiKey() {
    try {
      const { resolveApiConfig } = await import('@/utils/api')
      const config = await resolveApiConfig()
      if (!config.apiKey) return
      const existing = await invoke<string | null>('get_setting', { key: 'ai_api_key' })
      if (!existing) {
        await invoke('set_setting', { key: 'ai_api_key', value: config.apiKey })
      }
      const existingModel = await invoke<string | null>('get_setting', { key: 'ai_model' })
      if (!existingModel) {
        const savedModel = config.model || localStorage.getItem('jcModel') || 'claude-sonnet-4-6'
        await invoke('set_setting', { key: 'ai_model', value: savedModel })
      }
    } catch { /* best-effort */ }
  }

  const mineSkills = computed(() => centralSkills.value.filter(s => isMineSkill(s.id)))
  const otherSkills = computed(() => centralSkills.value.filter(s => !isMineSkill(s.id)))

  const selectedSkillDirectory = computed(() => {
    const detail = selectedSkillDetail.value
    if (!detail) return ''
    return normalizeSkillPath(detail.dir_path || detail.canonical_path || dirname(detail.file_path))
  })

  function selectedSkillFileAccessContext() {
    const detail = selectedSkillDetail.value
    if (!detail) throw new Error('当前 Skill 详情不可用')
    return {
      skillId: detail.id,
      agentId: selectedSkillAgentId.value,
      rowId: detail.row_id ?? null,
    }
  }

  function persistSkillDisplayAliases() {
    const storage = getLocalStorage()
    if (!storage) return
    storage.setItem(SKILL_DISPLAY_ALIAS_STORAGE_KEY, JSON.stringify(skillDisplayAliases.value))
  }

  function loadSkillDisplayAliases() {
    skillDisplayAliases.value = readStoredSkillDisplayAliases()
    return skillDisplayAliases.value
  }

  function getSkillDisplayAlias(skillId: string): SkillDisplayAlias | null {
    return skillDisplayAliases.value[skillId] || null
  }

  function setSkillDisplayAlias(skillId: string, alias: string): SkillDisplayAlias | null {
    const normalizedSkillId = skillId.trim()
    if (!normalizedSkillId) {
      throw new Error('Skill id 不能为空')
    }
    const normalizedAlias = normalizeSkillDisplayAlias(alias)
    if (!normalizedAlias) {
      return clearSkillDisplayAlias(normalizedSkillId)
    }
    const nextAlias: SkillDisplayAlias = {
      skillId: normalizedSkillId,
      alias: normalizedAlias,
      updatedAt: Date.now(),
    }
    skillDisplayAliases.value = {
      ...skillDisplayAliases.value,
      [normalizedSkillId]: nextAlias,
    }
    persistSkillDisplayAliases()
    return nextAlias
  }

  function clearSkillDisplayAlias(skillId: string): null {
    const normalizedSkillId = skillId.trim()
    if (!normalizedSkillId) return null
    const nextAliases = { ...skillDisplayAliases.value }
    delete nextAliases[normalizedSkillId]
    skillDisplayAliases.value = nextAliases
    persistSkillDisplayAliases()
    return null
  }

  function getSkillDisplayName(skill: Pick<SkillWithLinks, 'id' | 'name'>): string {
    return getSkillDisplayAlias(skill.id)?.alias || skill.name
  }

  function skillMatchesSearch(
    skill: Pick<SkillWithLinks, 'id' | 'name' | 'description' | 'file_path' | 'canonical_path' | 'source'>,
    query: string
  ): boolean {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return true
    return [
      getSkillDisplayAlias(skill.id)?.alias,
      skill.name,
      skill.description,
      skill.file_path,
      skill.canonical_path,
      skill.source,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(normalized))
  }

  async function scanAllSkills() {
    isScanning.value = true
    error.value = null
    try {
      lastScan.value = await invoke<ScanResult>('scan_all_skills')
      return lastScan.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isScanning.value = false
    }
  }

  async function loadAgents() {
    agents.value = await invoke<AgentWithStatus[]>('get_agents')
    return agents.value
  }

  async function detectAgents() {
    isLoadingPlatforms.value = true
    error.value = null
    try {
      agents.value = await invoke<AgentWithStatus[]>('detect_agents')
      await scanAllSkills()
      return agents.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingPlatforms.value = false
    }
  }

  async function loadSkillsByAgent(agentId: string) {
    loadingPlatformAgentId.value = agentId
    error.value = null
    try {
      const skills = await invoke<SkillForAgent[]>('get_skills_by_agent', { agentId })
      platformSkills.value = { ...platformSkills.value, [agentId]: skills || [] }
      return skills || []
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      loadingPlatformAgentId.value = null
    }
  }

  async function loadCentralSkills(options: { scan?: boolean } = { scan: true }) {
    isLoadingCentral.value = true
    error.value = null
    try {
      if (options.scan !== false) {
        await scanAllSkills()
      }
      const [skills] = await Promise.all([
        invoke<SkillWithLinks[]>('get_central_skills'),
        loadAgents(),
      ])
      // Sync main API key to skills DB for AI summary
      await syncMainApiKey()
      // Parse commands JSON (stored as JSON string in SQLite) into string[]
      const parsed = (skills || []).map(s => ({
        ...s,
        commands: parseCommandsField(s.commands)
      }))
      centralSkills.value = parsed
      // 首次加载时自动将内置+GitHub导入的 skill 标记为"我的"
      seedMineSkills(parsed)
      return centralSkills.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingCentral.value = false
    }
  }

  async function loadCentralBundles() {
    error.value = null
    try {
      centralBundles.value = await invoke<CentralSkillBundle[]>('get_central_skill_bundles')
      return centralBundles.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    }
  }

  async function loadCentralBundleDetail(relativePath: string) {
    error.value = null
    try {
      const detail = await invoke<CentralSkillBundleDetail>('get_central_skill_bundle_detail', {
        relativePath,
      })
      centralBundleDetails.value = {
        ...centralBundleDetails.value,
        [relativePath]: detail,
      }
      return detail
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    }
  }

  function clearCentralBundleDetail(relativePath?: string) {
    if (!relativePath) {
      centralBundleDetails.value = {}
      return
    }
    const nextDetails = { ...centralBundleDetails.value }
    delete nextDetails[relativePath]
    centralBundleDetails.value = nextDetails
  }

  async function previewDeleteCentralSkillBundle(relativePath: string) {
    error.value = null
    try {
      const preview = await invoke<CentralSkillBundleDeletePreview>('preview_delete_central_skill_bundle', {
        relativePath,
      })
      centralBundleDeletePreview.value = preview
      return preview
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    }
  }

  function clearCentralBundleDeletePreview() {
    centralBundleDeletePreview.value = null
  }

  async function loadSkillDetail(skillId: string) {
    const requestId = ++skillDetailRequestId
    selectedSkillId.value = skillId
    selectedSkillAgentId.value = null
    isLoadingDetail.value = true
    error.value = null
    try {
      const [detail, content] = await Promise.all([
        invoke<SkillDetail>('get_skill_detail', { skillId }),
        invoke<string>('read_skill_content', { skillId }),
      ])
      if (requestId !== skillDetailRequestId || selectedSkillId.value !== skillId) return detail
      selectedSkillDetail.value = detail
      selectedSkillContent.value = content
      skillDirectoryTree.value = []
      selectedSkillFilePath.value = detail.file_path
      selectedSkillFileContent.value = content
      return detail
    } catch (err) {
      if (requestId === skillDetailRequestId) error.value = errorMessage(err)
      throw err
    } finally {
      if (requestId === skillDetailRequestId) isLoadingDetail.value = false
    }
  }

  async function loadPlatformSkillDetail(skillId: string, agentId: string, rowId: string) {
    const requestId = ++skillDetailRequestId
    selectedSkillId.value = skillId
    selectedSkillAgentId.value = agentId
    isLoadingDetail.value = true
    error.value = null
    try {
      const detail = await invoke<SkillDetail>('get_skill_detail', { skillId, agentId, rowId })
      const context = { skillId: detail.id, agentId, rowId: detail.row_id ?? rowId }
      const content = await invoke<string>('read_file_by_path', { path: detail.file_path, context })
      if (requestId !== skillDetailRequestId || selectedSkillId.value !== skillId) return detail
      selectedSkillDetail.value = detail
      selectedSkillContent.value = content
      skillDirectoryTree.value = []
      selectedSkillFilePath.value = detail.file_path
      selectedSkillFileContent.value = content
      return detail
    } catch (err) {
      if (requestId === skillDetailRequestId) error.value = errorMessage(err)
      throw err
    } finally {
      if (requestId === skillDetailRequestId) isLoadingDetail.value = false
    }
  }

  async function loadSelectedSkillDirectory() {
    const dirPath = selectedSkillDirectory.value
    if (!dirPath) throw new Error('当前 Skill 目录不可用')
    const context = selectedSkillFileAccessContext()
    isLoadingSkillDirectory.value = true
    error.value = null
    try {
      skillDirectoryTree.value = await invoke<SkillDirectoryNode[]>('list_skill_directory', { dirPath, context })
      return skillDirectoryTree.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingSkillDirectory.value = false
    }
  }

  async function readSelectedSkillFileByPath(path: string) {
    const dirPath = selectedSkillDirectory.value
    if (!dirPath || !isPathInsideDirectory(path, dirPath)) {
      throw new Error('只能读取当前 Skill 目录内的文件')
    }
    isLoadingSkillFile.value = true
    error.value = null
    try {
      selectedSkillFilePath.value = path
      selectedSkillFileContent.value = await invoke<string>('read_file_by_path', {
        path,
        context: selectedSkillFileAccessContext(),
      })
      return selectedSkillFileContent.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingSkillFile.value = false
    }
  }

  async function openSelectedSkillInFileManager() {
    const path = selectedSkillDirectory.value
    if (!path) throw new Error('当前 Skill 目录不可用')
    error.value = null
    try {
      await invoke('open_in_file_manager', { path, context: selectedSkillFileAccessContext() })
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    }
  }

  function skillExplanationKey(skillId: string, lang: string) {
    return `${skillId}:${lang}`
  }

  async function getSkillExplanation(skillId: string, lang = 'zh') {
    isLoadingSkillExplanation.value = true
    error.value = null
    try {
      const explanation = await invoke<string | null>('get_skill_explanation', { skillId, lang })
      const normalized = explanation || ''
      if (normalized) {
        skillExplanations.value = {
          ...skillExplanations.value,
          [skillExplanationKey(skillId, lang)]: normalized,
        }
      }
      return normalized
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingSkillExplanation.value = false
    }
  }

  async function explainSkill(skillId: string, content: string, lang = 'zh') {
    isLoadingSkillExplanation.value = true
    error.value = null
    try {
      await invoke('explain_skill_stream', { skillId, content, lang })
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingSkillExplanation.value = false
    }
  }

  async function refreshSkillExplanation(skillId: string, content: string, lang = 'zh') {
    isLoadingSkillExplanation.value = true
    error.value = null
    try {
      await invoke('refresh_skill_explanation', { skillId, content, lang })
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingSkillExplanation.value = false
    }
  }

  async function uninstallSkillFromAgent(skillId: string, agentId: string) {
    error.value = null
    try {
      await invoke('uninstall_skill_from_agent', { skillId, agentId })
      await Promise.all([
        loadCentralSkills({ scan: true }),
        loadSkillsByAgent(agentId),
      ])
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    }
  }

  async function installSkillToAgent(skillId: string, agentId: string, method: 'auto' | 'symlink' | 'copy' = 'auto') {
    installingSkillId.value = skillId
    error.value = null
    try {
      const result = await invoke<InstallResult>('install_skill_to_agent', {
        skillId,
        agentId,
        method,
      })
      await loadCentralSkills({ scan: true })
      return result
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      installingSkillId.value = null
    }
  }

  async function batchInstallSkillToAgents(skillId: string, agentIds: string[], method: 'auto' | 'symlink' | 'copy' = 'auto') {
    installingSkillId.value = skillId
    error.value = null
    try {
      const result = await invoke<BatchInstallResult>('batch_install_to_agents', {
        skillId,
        agentIds,
        method,
      })
      return result
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      installingSkillId.value = null
    }
  }

  async function deleteCentralSkill(skillId: string, cascadeUninstall = false) {
    deletingSkillId.value = skillId
    error.value = null
    try {
      const result = await invoke<DeleteCentralSkillResult>('delete_central_skill', {
        skillId,
        options: { cascadeUninstall },
      })
      if (selectedSkillId.value === skillId) {
        selectedSkillId.value = null
        selectedSkillDetail.value = null
      }
      await loadCentralSkills({ scan: true })
      return result
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      deletingSkillId.value = null
    }
  }

  async function deleteCentralSkillBundle(relativePath: string, cascadeUninstall = false) {
    deletingBundlePath.value = relativePath
    error.value = null
    try {
      const result = await invoke<DeleteCentralSkillBundleResult>('delete_central_skill_bundle', {
        relativePath,
        options: { cascadeUninstall },
      })
      delete centralBundleDetails.value[relativePath]
      centralBundleDeletePreview.value = null
      centralBundles.value = centralBundles.value.filter((bundle) => bundle.relativePath !== relativePath)
      centralSkills.value = centralSkills.value.filter((skill) => !result.removedSkillIds.includes(skill.id))
      return result
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      deletingBundlePath.value = null
    }
  }

  async function saveCentralSkill(skillId: string | null, skillMd: string) {
    error.value = null
    try {
      const result = await invoke<SaveCentralSkillResult>('save_central_skill', {
        input: {
          skillId,
          skillMd,
        },
      })
      await loadCentralSkills({ scan: true })
      return result
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    }
  }

  async function loadRegistries() {
    isLoadingMarketplace.value = true
    error.value = null
    try {
      registries.value = await invoke<SkillRegistry[]>('list_registries')
      marketplaceSkills.value = await invoke<MarketplaceSkill[]>('search_marketplace_skills', {
        registryId: null,
        query: null,
      })
      return registries.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingMarketplace.value = false
    }
  }

  async function syncRegistry(registryId: string) {
    syncingRegistryId.value = registryId
    error.value = null
    try {
      await invoke<MarketplaceSkill[]>('sync_registry', { registryId })
      await loadRegistries()
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      syncingRegistryId.value = null
    }
  }

  async function syncRegistryWithOptions(registryId: string, options: { forceRefresh?: boolean } = {}) {
    syncingRegistryId.value = registryId
    error.value = null
    try {
      await invoke<MarketplaceSkill[]>('sync_registry_with_options', {
        registryId,
        options: { forceRefresh: Boolean(options.forceRefresh) },
      })
      await loadRegistries()
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      syncingRegistryId.value = null
    }
  }

  async function searchMarketplaceSkills(query = '', registryId: string | null = null) {
    isLoadingMarketplace.value = true
    error.value = null
    try {
      marketplaceSkills.value = await invoke<MarketplaceSkill[]>('search_marketplace_skills', {
        registryId,
        query: query || null,
      })
      return marketplaceSkills.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingMarketplace.value = false
    }
  }

  async function installMarketplaceSkill(skillId: string) {
    installingMarketplaceSkillId.value = skillId
    error.value = null
    try {
      await invoke('install_marketplace_skill', { skillId })
      marketplaceSkills.value = marketplaceSkills.value.map((skill) =>
        skill.id === skillId ? { ...skill, is_installed: true } : skill
      )
      await loadCentralSkills({ scan: true })
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      installingMarketplaceSkillId.value = null
    }
  }

  async function previewGitHubRepoImport(repoUrl: string) {
    isPreviewingGitHubRepo.value = true
    error.value = null
    githubRepoPreview.value = null
    githubRepoImportResult.value = null
    try {
      githubRepoPreview.value = await invoke<GitHubRepoPreview>('preview_github_repo_import', { repoUrl })
      return githubRepoPreview.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isPreviewingGitHubRepo.value = false
    }
  }

  async function fetchGitHubSkillMarkdown(sourcePath: string, downloadUrl: string) {
    githubSkillMarkdown.value = {
      ...githubSkillMarkdown.value,
      [sourcePath]: { status: 'loading' },
    }
    error.value = null
    try {
      const content = await invoke<string>('fetch_github_skill_markdown', { downloadUrl })
      githubSkillMarkdown.value = {
        ...githubSkillMarkdown.value,
        [sourcePath]: { status: 'ready', content },
      }
      return content
    } catch (err) {
      const message = errorMessage(err)
      githubSkillMarkdown.value = {
        ...githubSkillMarkdown.value,
        [sourcePath]: { status: 'error', error: message },
      }
      error.value = message
      throw err
    }
  }

  async function importGitHubRepoSkills(repoUrl: string, selections: GitHubSkillImportSelection[]) {
    isImportingGitHubRepo.value = true
    error.value = null
    try {
      githubRepoImportResult.value = await invoke<GitHubRepoImportResult>('import_github_repo_skills', {
        repoUrl,
        selections,
      })
      await loadCentralSkills({ scan: true })
      return githubRepoImportResult.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isImportingGitHubRepo.value = false
    }
  }

  async function generateGitHubImportAiSummary(
    sourcePath: string,
    skillName: string,
    content: string,
    lang = 'zh'
  ) {
    const prompt = lang === 'en'
      ? `Summarize this SKILL.md for import decisions in English. Use 3 short parts: 1) What it does 2) When to import it 3) Dependencies or cautions. Keep it concise.\n\nSkill: ${skillName}\n\n${content}`
      : `请基于下面的 SKILL.md 内容，生成适合导入决策的中文摘要。分成 3 个简短部分：1）做什么 2）什么时候值得导入 3）依赖或注意事项。保持简洁。\n\nSkill: ${skillName}\n\n${content}`
    await explainSkill(`github-import:${sourcePath}`, prompt, lang)
  }

  async function loadCollections() {
    isLoadingCollections.value = true
    error.value = null
    try {
      collections.value = await invoke<Collection[]>('get_collections')
      return collections.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingCollections.value = false
    }
  }

  async function createCollection(name: string, description?: string) {
    const collection = await invoke<Collection>('create_collection', {
      name,
      description: description || null,
    })
    await loadCollections()
    return collection
  }

  async function updateCollection(collectionId: string, name: string, description?: string) {
    const collection = await invoke<Collection>('update_collection', {
      collectionId,
      name,
      description: description || null,
    })
    await loadCollections()
    await loadCollectionDetail(collectionId)
    return collection
  }

  async function deleteCollection(collectionId: string) {
    await invoke('delete_collection', { collectionId })
    delete collectionDetails.value[collectionId]
    await loadCollections()
  }

  async function loadCollectionDetail(collectionId: string) {
    const detail = await invoke<CollectionDetail>('get_collection_detail', { collectionId })
    collectionDetails.value = { ...collectionDetails.value, [collectionId]: detail }
    return detail
  }

  async function addSkillToCollection(collectionId: string, skillId: string) {
    await invoke('add_skill_to_collection', { collectionId, skillId })
    await loadCollectionDetail(collectionId)
  }

  async function removeSkillFromCollection(collectionId: string, skillId: string) {
    await invoke('remove_skill_from_collection', { collectionId, skillId })
    await loadCollectionDetail(collectionId)
  }

  async function batchInstallCollection(collectionId: string, agentIds: string[]) {
    const result = await invoke<CollectionBatchInstallResult>('batch_install_collection', {
      collectionId,
      agentIds,
    })
    await loadCentralSkills({ scan: true })
    return result
  }

  async function exportCollection(collectionId: string) {
    return await invoke<string>('export_collection', { collectionId })
  }

  async function importCollection(json: string) {
    const collection = await invoke<Collection>('import_collection', { json })
    await loadCollections()
    await loadCollectionDetail(collection.id)
    return collection
  }

  async function loadScanDirectories() {
    isLoadingSettings.value = true
    error.value = null
    try {
      scanDirectories.value = await invoke<ScanDirectory[]>('get_scan_directories')
      return scanDirectories.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingSettings.value = false
    }
  }

  async function addScanDirectory(path: string, label?: string) {
    error.value = null
    const directory = await invoke<ScanDirectory>('add_scan_directory', {
      path,
      label: label || null,
    })
    scanDirectories.value = [...scanDirectories.value.filter((item) => item.path !== directory.path), directory]
    return directory
  }

  async function removeScanDirectory(path: string) {
    error.value = null
    await invoke('remove_scan_directory', { path })
    await loadScanDirectories()
  }

  async function setScanDirectoryActive(path: string, isActive: boolean) {
    error.value = null
    await invoke('set_scan_directory_active', { path, isActive })
    await loadScanDirectories()
  }

  async function loadGitHubPat() {
    isLoadingSettings.value = true
    error.value = null
    try {
      githubPat.value = (await invoke<string | null>('get_setting', { key: 'github_pat' })) || ''
      return githubPat.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingSettings.value = false
    }
  }

  async function saveGitHubPat(value: string) {
    isSavingSettings.value = true
    error.value = null
    try {
      const normalized = value.trim()
      await invoke('set_setting', { key: 'github_pat', value: normalized })
      githubPat.value = normalized
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isSavingSettings.value = false
    }
  }

  async function clearGitHubPat() {
    isSavingSettings.value = true
    error.value = null
    try {
      await invoke('set_setting', { key: 'github_pat', value: '' })
      githubPat.value = ''
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isSavingSettings.value = false
    }
  }

  async function loadAiSettings() {
    isLoadingSettings.value = true
    error.value = null
    try {
      const [provider, apiKey, model, apiUrl] = await Promise.all([
        invoke<string | null>('get_setting', { key: 'ai_provider' }),
        invoke<string | null>('get_setting', { key: 'ai_api_key' }),
        invoke<string | null>('get_setting', { key: 'ai_model' }),
        invoke<string | null>('get_setting', { key: 'ai_api_url' }),
      ])
      aiSettings.value = {
        provider: provider || '',
        apiKey: apiKey || '',
        model: model || '',
        apiUrl: apiUrl || '',
      }
      return aiSettings.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingSettings.value = false
    }
  }

  async function loadDatabasePath() {
    error.value = null
    databasePath.value = await invoke<string>('get_skills_database_path')
    return databasePath.value
  }

  async function saveAiSettings(settings: AiSettings) {
    const normalized: AiSettings = {
      provider: settings.provider.trim(),
      apiKey: settings.apiKey.trim(),
      model: settings.model.trim(),
      apiUrl: settings.apiUrl.trim(),
    }
    isSavingSettings.value = true
    error.value = null
    try {
      await Promise.all([
        invoke('set_setting', { key: 'ai_provider', value: normalized.provider }),
        invoke('set_setting', { key: 'ai_api_key', value: normalized.apiKey }),
        invoke('set_setting', { key: 'ai_model', value: normalized.model }),
        invoke('set_setting', { key: 'ai_api_url', value: normalized.apiUrl }),
      ])
      aiSettings.value = normalized
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isSavingSettings.value = false
    }
  }

  async function addCustomPlatform(config: CustomPlatformConfig) {
    error.value = null
    const agent = await invoke<AgentWithStatus>('add_custom_agent', { config })
    await loadAgents()
    return agent
  }

  async function updateCustomPlatform(agentId: string, config: CustomPlatformConfig) {
    error.value = null
    const agent = await invoke<AgentWithStatus>('update_custom_agent', { agentId, config })
    await loadAgents()
    return agent
  }

  async function removeCustomPlatform(agentId: string) {
    error.value = null
    await invoke('remove_custom_agent', { agentId })
    await loadAgents()
  }

  async function loadObsidianVaults() {
    isLoadingObsidian.value = true
    error.value = null
    try {
      obsidianVaults.value = await invoke<ObsidianVault[]>('get_obsidian_vaults')
      return obsidianVaults.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingObsidian.value = false
    }
  }

  async function loadObsidianVaultSkills(vaultId: string) {
    isLoadingObsidian.value = true
    error.value = null
    try {
      const skills = await invoke<DiscoveredSkill[]>('get_obsidian_vault_skills', { vaultId })
      obsidianVaultSkills.value = { ...obsidianVaultSkills.value, [vaultId]: skills || [] }
      return skills || []
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingObsidian.value = false
    }
  }

  async function loadScanRoots() {
    isLoadingDiscover.value = true
    error.value = null
    try {
      scanRoots.value = await invoke<ScanRoot[]>('get_scan_roots')
      discoveredProjects.value = await invoke<DiscoveredProject[]>('get_discovered_skills')
      return scanRoots.value
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isLoadingDiscover.value = false
    }
  }

  async function startProjectScan(roots: ScanRoot[]) {
    isDiscoverScanning.value = true
    discoverProgress.value = null
    error.value = null
    try {
      const result = await invoke<DiscoverResult>('start_project_scan', { roots })
      discoveredProjects.value = result.projects || []
      return result
    } catch (err) {
      error.value = errorMessage(err)
      throw err
    } finally {
      isDiscoverScanning.value = false
      discoverProgress.value = null
    }
  }

  async function stopProjectScan() {
    await invoke('stop_project_scan')
    isDiscoverScanning.value = false
  }

  function upsertDiscoveredProject(project: DiscoveredProject) {
    const existingIndex = discoveredProjects.value.findIndex((item) => item.project_path === project.project_path)
    if (existingIndex >= 0) {
      discoveredProjects.value.splice(existingIndex, 1, project)
    } else {
      discoveredProjects.value = [...discoveredProjects.value, project]
    }
  }

  function setDiscoverProgress(progress: DiscoverProgress | null) {
    discoverProgress.value = progress
  }

  async function setScanRootEnabled(path: string, enabled: boolean) {
    await invoke('set_scan_root_enabled', { path, enabled })
    await loadScanRoots()
  }

  async function importDiscoveredSkillToCentral(discoveredSkillId: string) {
    const result = await invoke<DiscoverImportResult>('import_discovered_skill_to_central', {
      discoveredSkillId,
    })
    await Promise.all([loadCentralSkills({ scan: true }), loadScanRoots()])
    return result
  }

  async function importDiscoveredSkillToPlatform(
    discoveredSkillId: string,
    agentId: string,
    method: 'symlink' | 'copy' = 'symlink',
  ) {
    const result = await invoke<DiscoverImportResult>('import_discovered_skill_to_platform', {
      discoveredSkillId,
      agentId,
      method,
    })
    await Promise.all([loadAgents(), loadSkillsByAgent(agentId)])
    return result
  }

  async function clearDiscoveredSkills() {
    await invoke('clear_discovered_skills')
    discoveredProjects.value = []
  }

  function setActiveTab(tab: SkillsManageTab) {
    activeTab.value = tab
  }

  return {
    activeTab,
    centralSkills,
    centralBundles,
    centralBundleDetails,
    centralBundleDeletePreview,
    skillDisplayAliases,
    agents,
    platformSkills,
    selectedSkillDetail,
    selectedSkillContent,
    selectedSkillId,
    skillDirectoryTree,
    selectedSkillDirectory,
    selectedSkillFilePath,
    selectedSkillFileContent,
    skillExplanations,
    githubRepoPreview,
    githubRepoImportResult,
    githubSkillMarkdown,
    registries,
    marketplaceSkills,
    collections,
    collectionDetails,
    scanDirectories,
    githubPat,
    aiSettings,
    databasePath,
    scanRoots,
    discoveredProjects,
    discoverProgress,
    lastScan,
    isLoadingCentral,
    isLoadingPlatforms,
    loadingPlatformAgentId,
    isLoadingMarketplace,
    isPreviewingGitHubRepo,
    isImportingGitHubRepo,
    syncingRegistryId,
    installingMarketplaceSkillId,
    isLoadingCollections,
    isLoadingSettings,
    isSavingSettings,
    isLoadingDiscover,
    isDiscoverScanning,
    isScanning,
    isLoadingDetail,
    isLoadingSkillDirectory,
    isLoadingSkillFile,
    isLoadingSkillExplanation,
    installingSkillId,
    deletingSkillId,
    deletingBundlePath,
    error,
    centralRoot,
    platformAgents,
    installableAgents,
    mineSkillIds,
    mineSkills,
    otherSkills,
    isMineSkill,
    toggleMineSkill,
    loadSkillDisplayAliases,
    getSkillDisplayAlias,
    setSkillDisplayAlias,
    clearSkillDisplayAlias,
    getSkillDisplayName,
    skillMatchesSearch,
    setActiveTab,
    scanAllSkills,
    loadAgents,
    detectAgents,
    loadSkillsByAgent,
    loadCentralSkills,
    loadCentralBundles,
    loadCentralBundleDetail,
    clearCentralBundleDetail,
    loadSkillDetail,
    loadPlatformSkillDetail,
    loadSelectedSkillDirectory,
    readSelectedSkillFileByPath,
    openSelectedSkillInFileManager,
    getSkillExplanation,
    explainSkill,
    refreshSkillExplanation,
    installSkillToAgent,
    batchInstallSkillToAgents,
    uninstallSkillFromAgent,
    deleteCentralSkill,
    previewDeleteCentralSkillBundle,
    clearCentralBundleDeletePreview,
    deleteCentralSkillBundle,
    saveCentralSkill,
    loadRegistries,
    syncRegistry,
    syncRegistryWithOptions,
    searchMarketplaceSkills,
    installMarketplaceSkill,
    previewGitHubRepoImport,
    fetchGitHubSkillMarkdown,
    importGitHubRepoSkills,
    generateGitHubImportAiSummary,
    loadCollections,
    createCollection,
    updateCollection,
    deleteCollection,
    loadCollectionDetail,
    addSkillToCollection,
    removeSkillFromCollection,
    batchInstallCollection,
    exportCollection,
    importCollection,
    loadScanDirectories,
    addScanDirectory,
    removeScanDirectory,
    setScanDirectoryActive,
    loadGitHubPat,
    saveGitHubPat,
    clearGitHubPat,
    loadAiSettings,
    saveAiSettings,
    loadDatabasePath,
    addCustomPlatform,
    updateCustomPlatform,
    removeCustomPlatform,
    loadScanRoots,
    setScanRootEnabled,
    startProjectScan,
    stopProjectScan,
    upsertDiscoveredProject,
    setDiscoverProgress,
  }
})
