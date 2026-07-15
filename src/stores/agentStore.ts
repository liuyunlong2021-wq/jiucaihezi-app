/**
 * stores/agentStore.ts — Skill管理 Store（SKILL.md 标准格式）
 *
 * 对齐标准：
 *   - official Skill SKILL.md frontmatter (name, description, triggers)
 *   - colleague-skill .skill 格式
 *   - PILL_MODELS (行 2754)
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SkillConfig } from '../types/skill'
import { getModelContextWindow } from '@/data/modelContextWindows'
import { parseSkillMd, serializeToSkillMd } from '../types/skill'
import { gatewayModels } from '@/services/newApiClient'
import { invoke } from '@tauri-apps/api/core'
import { isTauriRuntime } from '@/utils/tauriEnv'
import type { SkillWithLinks } from '@/types/skillsManage'
import { ensureOpenCodeServer } from '@/opencodeClient/daemon'
import { createJiucaiOpenCodeClient } from '@/opencodeClient/client'
import { listOpenCodeModels } from '@/opencodeClient/catalog'
import { useSessionStore } from '@/stores/sessionStore'
import { projectStoredNewApiForOpenCode } from '@/opencodeClient/providerProjection'
import {
  LOCAL_OLLAMA_API_BASE,
  LOCAL_OLLAMA_PROVIDER_ID,
  getLocalOllamaModels,
  getCustomProviders,
  resolveModelProviderId,
  updateDefaultProviderModels,
} from '@/utils/providerConfig'
import { chooseModelCatalogForProjection, filterExecutableModels, resolveModelSelection } from '@/utils/modelSelection'
import { loadWebSkillCatalog } from '@/utils/skillContentResolver'

// ─── 向后兼容：旧 Agent 类型（迁移用） ───
export interface Agent {
  id: string
  name: string
  icon: string
  folder?: string
  systemPrompt: string
  openingMessage?: string
  specialMode?: string
  source?: string
  nextAgent?: string
}

// ─── 模型系统 ───

export interface ModelEntry {
  id: string
  label: string
  providerId?: string
  /** 能力分类：text=文本LLM, image=图片生成, video=视频生成, audio=音频生成 */
  capability?: 'text' | 'image' | 'video' | 'audio'
  /** OpenCode 官方 context token 上限（tokens），用于 session.context 使用量换算 */
  contextWindow?: number
}

/** 本地兜底默认模型（当 Gateway 模型列表拉取失败时使用） */
const DEFAULT_MODELS: ModelEntry[] = [
  { id: 'claude-opus-4-7', label: 'Opus-4.7', capability: 'text' },
  { id: 'claude-opus-4-6', label: 'Opus', capability: 'text' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet', capability: 'text' },
  { id: 'gpt-5.5', label: 'GPT-5.5', capability: 'text' },
  { id: 'gpt-5.4', label: 'GPT-5.4', capability: 'text' },
  { id: 'qwen3.6-plus', label: 'Qwen-3.6', capability: 'text' },
  { id: 'deepseek-v4-flash', label: 'DS-V4-Flash', capability: 'text' },
  { id: 'deepseek-v4-pro', label: 'DS-V4-Pro', capability: 'text' },
  { id: 'openai/gpt-oss-120b:free', label: 'GPT-OSS', capability: 'text' },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma-31B', capability: 'text' },
  { id: 'gemini-3.1-flash-lite-preview', label: 'G-Flash-Lite', capability: 'text' },
  { id: 'gemini-3.1-pro-preview', label: 'G-3.1-Pro', capability: 'text' },
  // ─── 媒体生成模型 ───
  { id: 'gpt-image-2', label: '🎨 GPT Image', capability: 'image' },
  { id: 'nano-banana-4k', label: '🎨 Nano Banana 4K', capability: 'image' },
  { id: 'grok-video-3', label: '🎬 Grok Video', capability: 'video' },
  { id: 'suno-custom-song', label: '🎵 Suno 自定义歌曲', capability: 'audio' },
]

function loadLocalModelEntries(): ModelEntry[] {
  return getLocalOllamaModels().map(model => ({
    id: model.id,
    label: model.label || model.id,
    providerId: LOCAL_OLLAMA_PROVIDER_ID,
    capability: 'text' as const,
  }))
}

function loadCustomProviderEntries(): ModelEntry[] {
  return getCustomProviders().flatMap(provider =>
    provider.modelIds.map(modelId => ({
      id: modelId,
      label: `${provider.name}: ${modelId}`,
      providerId: provider.id,
      capability: 'text' as const,
    }))
  )
}

function mergeLocalModels(models: ModelEntry[]): ModelEntry[] {
  const localModels = loadLocalModelEntries()
  const customModels = loadCustomProviderEntries()
  const allLocal = [...localModels, ...customModels]
  const localProviderIds = new Set([LOCAL_OLLAMA_PROVIDER_ID])
  // 也排除自定义 provider 的旧条目
  const customProviderIds = new Set(customModels.map(m => m.providerId!))
  if (allLocal.length === 0) {
    return models.filter(model => !localProviderIds.has(model.providerId || '') && !customProviderIds.has(model.providerId || ''))
  }

  const next = models.filter(model => !localProviderIds.has(model.providerId || '') && !customProviderIds.has(model.providerId || ''))
  const seen = new Set(next.map(model => model.id))
  for (const model of allLocal) {
    if (!seen.has(model.id)) next.push(model)
  }
  return next
}

/** 初始模型列表：有缓存用缓存，无认证无缓存时仅本地模型（不暴露 DEFAULT_MODELS） */
function getInitialModels(): ModelEntry[] {
  const cached = loadCachedModelEntries()
  if (cached) return cached
  return [] // 无认证 → 不显示任何云端兜底模型，待登录后 fetchModels 拉取
}

function loadCachedModelEntries(): ModelEntry[] | null {
  try {
    const cached = localStorage.getItem('jc_models_cache')
    if (!cached) return null
    const parsed = JSON.parse(cached)
    const normalized = Array.isArray(parsed)
      ? parsed.map((model: ModelEntry) => ({
          ...model,
          capability: model.capability || inferCapability(model.id),
        }))
      : []
    const filtered = filterExecutableModels(normalized)
    if (filtered.length === 0) return null
    // 检查来源：至少有一个 gateway/jiucaihezi 模型 → 非纯 OpenCode 缓存
    // 老缓存无 source 字段，用 providerId === 'jiucaihezi' 兜底
    const hasGatewayModels = filtered.some(
      m => (m as any).source === 'gateway' || m.providerId === 'jiucaihezi'
    )
    if (!hasGatewayModels) return null
    // 缓存中的文本模型数少于兜底默认值 → 缓存已损坏，丢弃
    const defaultTextCount = DEFAULT_MODELS.filter(m => (m.capability || inferCapability(m.id)) === 'text').length
    const cachedTextCount = filtered.filter(m => (m.capability || inferCapability(m.id)) === 'text').length
    if (cachedTextCount < defaultTextCount) return null
    return filtered
  } catch {
    return null
  }
}

/** 根据模型 ID 推断能力分类 */
function inferCapability(id: string): ModelEntry['capability'] {
  const lower = id.toLowerCase()
  if (/image|dall|midjourney|sd-|stable.?diff|flux/.test(lower)) return 'image'
  if (/video|veo|grok-video|rh-mimic|kling|runway|pika|luma/.test(lower)) return 'video'
  if (/suno|audio|music|tts|whisper/.test(lower)) return 'audio'
  return 'text'
}

/** 模型能力层级：复杂 Skill 生成和长文推理需要 strong 级别模型 */
export type ModelTier = 'strong' | 'medium' | 'light'

export function inferModelTier(id: string): ModelTier {
  const lower = id.toLowerCase()
  // 强力模型：适合复杂推理和长上下文整理
  if (/opus|gpt-5\.4|gpt-5\.5|o[1-9]|o3|deepseek.*pro|qwen.*plus|gemini.*pro/.test(lower)) return 'strong'
  // 轻量模型：快速但不适合复杂整理
  if (/haiku|flash.*lite|gemma|free|mini|nano|tiny/.test(lower)) return 'light'
  // 中等模型：sonnet 等
  return 'medium'
}

/** 复杂整理操作推荐的最低模型 tier */
export const ORGANIZATION_RECOMMENDED_TIER: ModelTier = 'medium'

// 兼容旧代码：导出 PILL_MODELS 作为 DEFAULT_MODELS 的别名
/** @deprecated 请使用 agentStore.availableModels 代替 */
export const PILL_MODELS = DEFAULT_MODELS


export const useAgentStore = defineStore('agents', () => {
  const currentAgent = ref<SkillConfig | null>(null)
  const currentModel = ref(localStorage.getItem('jcModel') || 'claude-sonnet-4-6')
  const centralSkillCache = ref<SkillConfig[]>([])
  const centralSkillLoadPromise = ref<Promise<SkillConfig[]> | null>(null)
  const inMemorySkills = ref<SkillConfig[]>([])

  // ─── 动态模型系统 ───
  /** 模型列表初始值：有缓存 → 用缓存；无缓存 → 仅本地模型（不暴露 DEFAULT_MODELS 云端兜底） */
  const availableModels = ref<ModelEntry[]>(mergeLocalModels(getInitialModels()))
  const modelsFetched = ref(false)
  const modelsFetchError = ref('')
  const modelCatalogSource = ref<'initial' | 'opencode' | 'gateway' | 'cache'>('initial')
  const officialOpenCodeModelIds = ref<string[]>([])

  function syncModelProviderStorage(modelId = currentModel.value, explicitProviderId?: string) {
    const model = availableModels.value.find(x => x.id === modelId) || modelId
    const providerId = explicitProviderId || resolveModelProviderId(model)
    localStorage.setItem('jcModelProviderId', providerId)
    if (providerId === LOCAL_OLLAMA_PROVIDER_ID) {
      localStorage.setItem('jcLocalOllamaApiBase', LOCAL_OLLAMA_API_BASE)
    } else {
      localStorage.setItem('jcApiBase', 'https://api.jiucaihezi.studio')
    }
    return providerId
  }

  /** 按能力分类的视图 */
  const textModels = computed(() => availableModels.value.filter(m => (m.capability || inferCapability(m.id)) === 'text'))
  const openCodeTextModels = computed(() => {
    if (modelCatalogSource.value !== 'opencode') return textModels.value
    const officialIds = new Set(officialOpenCodeModelIds.value)
    return textModels.value.filter(model => officialIds.has(model.id))
  })
  const imageModels = computed(() => availableModels.value.filter(m => m.capability === 'image'))
  const videoModels = computed(() => availableModels.value.filter(m => m.capability === 'video'))
  const audioModels = computed(() => availableModels.value.filter(m => m.capability === 'audio'))

  function adoptFetchedModels(models: ModelEntry[], source: 'opencode' | 'gateway' | 'cache') {
    const merged = filterExecutableModels(models)
    if (merged.length === 0) return false
    availableModels.value = mergeLocalModels(merged)
    modelCatalogSource.value = source
    officialOpenCodeModelIds.value = source === 'opencode' ? merged.map(model => model.id) : []
    const resolvedModel = resolveModelSelection(currentModel.value, availableModels.value)
    if (resolvedModel !== currentModel.value) {
      setModel(resolvedModel)
    } else {
      syncModelProviderStorage()
    }
    modelsFetched.value = true
    modelsFetchError.value = ''
    try {
      // 仅缓存 gateway 来源的模型。OpenCode 模型不持久化，避免污染后续启动。
      if (source === 'gateway') {
        localStorage.setItem('jc_models_cache', JSON.stringify(merged))
      }
      updateDefaultProviderModels(merged)
    } catch { /* quota exceeded, ignore */ }
    return true
  }

  function normalizeGatewayModelEntries(data: any[]): ModelEntry[] {
    const defaultMap = new Map(DEFAULT_MODELS.map(m => [m.id, m]))
    return data.map((item: any) => {
      const id = item.id || item.model || ''
      if (!id) return null
      const existing = defaultMap.get(id)
      const providerId = item.providerId || 'jiucaihezi'
      return {
        id,
        label: existing?.label || item.label || item.name || id.split('/').pop() || id,
        providerId,
        capability: existing?.capability || item.capability || inferCapability(id),
        contextWindow: getModelContextWindow(id, providerId),
      }
    }).filter(Boolean) as ModelEntry[]
  }

  /**
   * 静默拉取模型列表。OpenCode 官方 model.list 是优先数据源；
   * Gateway /api/models 只作为桌面内核未连接或官方列表失败时的兜底。
   */
  async function fetchModels() {
    // 网关请求带一次重试（缓解偶发 ERR_CONNECTION_CLOSED）
    async function gatewayWithRetry(): Promise<ModelEntry[] | null> {
      try {
        const data = await gatewayModels()
        if (Array.isArray(data) && data.length > 0) return normalizeGatewayModelEntries(data)
        return null
      } catch {
        // 2s 后重试一次
        await new Promise(r => setTimeout(r, 2000))
        try {
          const data = await gatewayModels()
          if (Array.isArray(data) && data.length > 0) return normalizeGatewayModelEntries(data)
        } catch { /* 两次都失败，走缓存降级 */ }
        return null
      }
    }

    let gatewayCatalog: ModelEntry[] | null = null
    try {
      gatewayCatalog = await gatewayWithRetry()
    } catch {
      gatewayCatalog = null
    }

    try {
      const projectionModels = chooseModelCatalogForProjection(availableModels.value, gatewayCatalog)
      const projectedConfig = await projectStoredNewApiForOpenCode({
        currentModel: currentModel.value,
        models: projectionModels,
      })
      const handle = await ensureOpenCodeServer({ config: projectedConfig })
      // ponytail: 照抄 OpenCode home.tsx L304-308 — server 就绪后同步会话列表
      const client = createJiucaiOpenCodeClient(handle)
      const officialModels = await listOpenCodeModels(client, {
        directory: handle.directory,
      })
      // ─── 同步 OpenCode 会话到本地列表 · 照抄 OpenCode home.tsx ───
      if (isTauriRuntime() && handle.directory) {
        try {
          const sessionStore = useSessionStore()
          sessionStore.loadAllSessions(client)
        } catch {
          // 会话同步失败不阻塞启动
        }
      }
      // 对齐官方 OpenCode：模型列表来自已配置的 provider（gateway）。
      // OpenCode 内置模型 ≠ NewAPI 云端模型，禁止进入选择器。
      // OpenCode model.list 仅用于 provider 投影，不替代 gateway 模型列表。
      // gatewayCatalog 为空时跳过，后续走缓存或 gateway 重试。
    } catch (e: any) {
      modelsFetchError.value = e.message || 'OpenCode model.list failed'
    }

    try {
      const merged = gatewayCatalog || await gatewayWithRetry()
      if (merged && merged.length > 0) {
        adoptFetchedModels(merged, 'gateway')
      } else {
        throw new Error('empty gateway catalog')
      }
    } catch (e: any) {
      modelsFetchError.value = e.message || 'fetch failed'
      // 尝试从缓存恢复，但只有缓存比兜底模型更多时才采用（防止坏缓存覆盖）
      try {
        const cached = localStorage.getItem('jc_models_cache')
        if (cached) {
          const parsed = JSON.parse(cached)
          const normalized = Array.isArray(parsed)
            ? parsed.map((model: ModelEntry) => ({
                ...model,
                capability: model.capability || inferCapability(model.id),
              }))
            : []
          const filtered = filterExecutableModels(normalized)
          const defaultTextCount = DEFAULT_MODELS.filter(m => (m.capability || inferCapability(m.id)) === 'text').length
          const cachedTextCount = filtered.filter(m => (m.capability || inferCapability(m.id)) === 'text').length
          if (filtered.length > 0 && cachedTextCount >= defaultTextCount) {
            availableModels.value = mergeLocalModels(filtered)
            modelCatalogSource.value = 'cache'
            officialOpenCodeModelIds.value = []
            const resolvedModel = resolveModelSelection(currentModel.value, availableModels.value)
            if (resolvedModel !== currentModel.value) setModel(resolvedModel)
            else syncModelProviderStorage()
            modelsFetched.value = true
          }
        }
      } catch { /* noop */ }
    }
  }

  const initialResolvedModel = resolveModelSelection(currentModel.value, availableModels.value)
  if (initialResolvedModel !== currentModel.value) {
    setModel(initialResolvedModel)
  } else {
    syncModelProviderStorage()
  }

  function refreshLocalModels() {
    availableModels.value = mergeLocalModels(availableModels.value)
    const model = availableModels.value.find(x => x.id === currentModel.value)
    if (!model) {
      setModel(resolveModelSelection(currentModel.value, availableModels.value))
      return
    }
    syncModelProviderStorage()
  }

  // ─── 粘贴即导入 — 纯文本系统提示词 → SkillConfig ───
  function importFromText(text: string, name?: string): SkillConfig | null {
    const trimmed = text.trim()
    if (!trimmed) return null

    // 尝试判断是否是 SKILL.md 格式
    if (trimmed.startsWith('---\n')) {
      const parsed = parseSkillMd(trimmed)
      const skill: SkillConfig = {
        id: parsed.id || 'paste_' + Date.now().toString(36),
        name: parsed.name || name || '粘贴Skill',
        description: parsed.description || trimmed.slice(0, 80),
        triggers: parsed.triggers || [],
        skillContent: parsed.skillContent || trimmed,
        references: [],
        examples: [],
        version: 1,
        source: 'user',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        evolutionLog: [],
      }
      createAgent(skill)
      moveToMy(skill.id)
      return skill
    }

    // 纯文本 → 直接当 systemPrompt
    const autoName = name || extractNameFromPrompt(trimmed)
    const skill: SkillConfig = {
      id: 'paste_' + Date.now().toString(36),
      name: autoName,
      description: trimmed.slice(0, 100).replace(/\n/g, ' '),
      triggers: [autoName],
      skillContent: trimmed,
      references: [],
      examples: [],
      version: 1,
      source: 'user',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      evolutionLog: [],
    }
    createAgent(skill)
    moveToMy(skill.id)
    return skill
  }

  // ─── L3: JSON 批量导入 ───
  function importFromJSON(jsonStr: string): number {
    try {
      const arr = JSON.parse(jsonStr)
      if (!Array.isArray(arr)) return 0
      let count = 0
      for (const item of arr) {
        const name = item.name || item.label || '导入Skill'
        const prompt = item.systemPrompt || item.system_prompt || item.prompt || item.content || ''
        if (!prompt && !name) continue
        const skill: SkillConfig = {
          id: 'import_' + Date.now().toString(36) + '_' + count,
          name,
          description: (item.description || prompt.slice(0, 80)).replace(/\n/g, ' '),
          triggers: item.triggers || [name],
          skillContent: prompt,
          references: [],
          examples: [],
          version: 1,
          source: 'user',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          evolutionLog: [],
        }
        createAgent(skill)
        moveToMy(skill.id)
        count++
      }
      return count
    } catch { return 0 }
  }

  // 从提示词自动提取名字
  function extractNameFromPrompt(prompt: string): string {
    // 尝试匹配 "你是XXX" / "你扮演XXX" / "## 角色: XXX"
    const patterns = [
      /你是[「『""]?(.{2,12})[」』""]?/,
      /角色[:：]\s*(.{2,12})/,
      /扮演[「『""]?(.{2,12})[」』""]?/,
      /^#\s+(.{2,15})/m,
    ]
    for (const p of patterns) {
      const m = prompt.match(p)
      if (m) return m[1].replace(/[，。、！？]/g, '').trim()
    }
    return '导入Skill ' + new Date().toLocaleDateString('zh-CN')
  }

  // ─── BUG-9 修复: 用版本号 ref 驱动 computed，避免每次访问都解析 localStorage ───
  const _skillsVersion = ref(0)
  const callCounts = ref<Record<string, number>>({})
  const legacySkillIdAliases: Record<string, string> = {
    'preset_skill-creator': 'skill-creator',
    'preset_skill-builder': 'skill-builder',
  }

  function normalizeSkillId(id: string): string {
    return legacySkillIdAliases[id] || id
  }

  function sourceFromCentralSkill(skill: SkillWithLinks): SkillConfig['source'] {
    const source = String(skill.source || '').toLowerCase()
    if (source.includes('marketplace') || source.includes('github')) return 'github'
    const path = `${skill.file_path} ${skill.canonical_path || ''}`
    if (path.includes('/jiucaihezi-builtin/')) return 'preset'
    return 'user'
  }

  function skillMdForSave(skill: SkillConfig): string {
    const content = String(skill.skillContent || '').trim()
    if (content.startsWith('---\n') || content.startsWith('---\r\n')) return content
    return serializeToSkillMd({ ...skill, skillContent: content })
  }

  function centralSkillToConfig(skill: SkillWithLinks, skillMd: string): SkillConfig {
    const parsed = parseSkillMd(skillMd)
    const createdAt = Date.parse(skill.created_at || skill.scanned_at || '') || Date.now()
    const updatedAt = Date.parse(skill.updated_at || skill.scanned_at || '') || createdAt
    return {
      id: skill.id,
      name: parsed.name || skill.name,
      description: parsed.description || skill.description || '',
      triggers: parsed.triggers || [],
      skillContent: parsed.skillContent || skillMd,
      references: [],
      examples: [],
      version: 1,
      source: sourceFromCentralSkill(skill),
      createdAt,
      updatedAt,
      evolutionLog: [],
      packagePath: skill.canonical_path || undefined,
      packageManifestPath: skill.file_path,
      enabled: true,
    }
  }

  function sortSkillConfigs(skills: SkillConfig[]): SkillConfig[] {
    return [...skills].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  // ─── loadSkills ───
  function loadSkills(): SkillConfig[] {
    void _skillsVersion.value
    if (isTauriRuntime()) {
      if (centralSkillCache.value.length === 0 && !centralSkillLoadPromise.value) {
        void refreshSkills()
      }
      return centralSkillCache.value
    }
    return inMemorySkills.value
  }

  // ─── getCustomSkills ───
  function getCustomSkills(): SkillConfig[] {
    return loadSkills().filter(skill => skill.source === 'user' || skill.source === 'github' || skill.source === 'evolved')
  }

  // ─── saveCustomSkills ───
  function saveCustomSkills(list: SkillConfig[]) {
    if (!isTauriRuntime()) {
      inMemorySkills.value = sortSkillConfigs(list)
      _skillsVersion.value++
    }
  }

  async function refreshSkills() {
    if (!isTauriRuntime()) {
      _skillsVersion.value++
      return inMemorySkills.value
    }
    if (centralSkillLoadPromise.value) return centralSkillLoadPromise.value
    centralSkillLoadPromise.value = (async () => {
      await invoke('scan_all_skills')
      const skills = await invoke<SkillWithLinks[]>('get_central_skills')
      const configs = await Promise.all((skills || []).map(async skill => {
        const skillMd = await invoke<string>('read_skill_content', { skillId: skill.id })
        return centralSkillToConfig(skill, skillMd)
      }))
      centralSkillCache.value = sortSkillConfigs(configs)
      if (currentAgent.value) {
        currentAgent.value = centralSkillCache.value.find(skill => skill.id === currentAgent.value?.id) || currentAgent.value
      }
      _skillsVersion.value++
      return centralSkillCache.value
    })().finally(() => {
      centralSkillLoadPromise.value = null
    })
    return centralSkillLoadPromise.value
  }

  // ─── 向后兼容 loadAgents / getCustomAgents / saveCustomAgents ───
  function loadAgents(): SkillConfig[] { return loadSkills() }
  function getCustomAgents(): SkillConfig[] { return getCustomSkills() }
  function saveCustomAgents(list: SkillConfig[]) { saveCustomSkills(list) }

  // BUG-9 修复: computed 依赖 _skillsVersion ref，只在版本变化时重新计算
  const agents = computed(() => { void _skillsVersion.value; return loadSkills() })

  function selectAgent(id: string | null) {
    if (!id) {
      currentAgent.value = null
      localStorage.removeItem('jc_last_agent_id')
      return
    }
    const normalizedId = normalizeSkillId(id)
    if (currentAgent.value?.id === normalizedId) {
      return
    }
    const found = loadSkills().find(s => s.id === normalizedId) || null
    currentAgent.value = found
    if (found) localStorage.setItem('jc_last_agent_id', found.id)
  }

  function setModel(modelId: string, providerId?: string) {
    currentModel.value = modelId
    localStorage.setItem('jcModel', modelId)
    syncModelProviderStorage(modelId, providerId)
  }

  const modelLabel = computed(() => {
    return currentModel.value
  })

  function restoreLastAgent() {
    const lastId = localStorage.getItem('jc_last_agent_id')
    if (lastId) {
      const found = loadSkills().find(s => s.id === normalizeSkillId(lastId))
      if (found) currentAgent.value = found
    }
  }

  async function createAgent(skill: SkillConfig) {
    const normalized = { ...skill, id: normalizeSkillId(skill.id.replace(/^preset_/, '').replace(/_/g, '-')) }
    if (!isTauriRuntime()) {
      const existing = inMemorySkills.value.filter(item => item.id !== normalized.id)
      inMemorySkills.value = sortSkillConfigs([...existing, normalized])
      _skillsVersion.value++
      return
    }
    const result = await invoke<{ skillId: string; filePath: string }>('save_central_skill', {
      input: {
        skillId: normalized.id,
        skillMd: skillMdForSave(normalized),
      },
    })
    await refreshSkills()
    const saved = centralSkillCache.value.find(item => item.id === result.skillId)
    if (saved) currentAgent.value = saved
  }

  function updateSkill(id: string, patch: Partial<SkillConfig>) {
    id = normalizeSkillId(id)
    const all = loadSkills()
    const idx = all.findIndex(s => s.id === id)
    if (idx === -1) return
    const updated = { ...all[idx], ...patch, updatedAt: Date.now() }
    if (!isTauriRuntime()) {
      inMemorySkills.value = sortSkillConfigs(all.map(skill => skill.id === id ? updated : skill))
      _skillsVersion.value++
      return
    }
    centralSkillCache.value = sortSkillConfigs(all.map(skill => skill.id === id ? updated : skill))
    _skillsVersion.value++
    void invoke('save_central_skill', {
      input: {
        skillId: id,
        skillMd: skillMdForSave(updated),
      },
    }).then(() => refreshSkills()).catch(error => {
      console.error('Failed to update Central Skill', error)
      void refreshSkills()
    })
  }

  async function deleteAgent(id: string) {
    id = normalizeSkillId(id)
    if (!isTauriRuntime()) {
      inMemorySkills.value = inMemorySkills.value.filter(skill => skill.id !== id)
      if (currentAgent.value?.id === id) currentAgent.value = null
      _skillsVersion.value++
      return
    }
    await invoke('delete_central_skill', {
      skillId: id,
      options: { cascadeUninstall: true },
    })
    centralSkillCache.value = centralSkillCache.value.filter(skill => skill.id !== id)
    if (currentAgent.value?.id === id) currentAgent.value = null
    _skillsVersion.value++
    await refreshSkills()
  }

  // ─── 仓库整体开关 ───
  const warehouseEnabled = ref(localStorage.getItem('jc_warehouse_enabled') !== '0')
  const presetEnabled = ref(localStorage.getItem('jc_preset_enabled') !== '0')

  function toggleWarehouse(enabled?: boolean) {
    warehouseEnabled.value = enabled !== undefined ? enabled : !warehouseEnabled.value
    localStorage.setItem('jc_warehouse_enabled', warehouseEnabled.value ? '1' : '0')
  }

  function togglePresetEnabled(enabled?: boolean) {
    presetEnabled.value = enabled !== undefined ? enabled : !presetEnabled.value
    localStorage.setItem('jc_preset_enabled', presetEnabled.value ? '1' : '0')
  }

  // ─── 我的Skill：用户主动添加的Skill列表 ───
  function getMySkills(): SkillConfig[] {
    return loadSkills()
  }

  async function moveToMy(id: string) {
    id = normalizeSkillId(id)
    if (!loadSkills().some(skill => skill.id === id)) await refreshSkills()
  }

  async function moveToPreset(id: string) {
    id = normalizeSkillId(id)
    if (currentAgent.value?.id === id) currentAgent.value = null
    await refreshSkills()
  }

  function isInMySkills(id: string): boolean {
    id = normalizeSkillId(id)
    return loadSkills().some(skill => skill.id === id)
  }

  // ─── 内置Skill判断：source 非 user 即为内置（不可查看 SKILL.md 内容） ───
  function isBuiltinSkill(id: string): boolean {
    id = normalizeSkillId(id)
    const all = loadSkills()
    const skill = all.find(s => s.id === id)
    if (!skill) return false
    return skill.source !== 'user'
  }

  function getSkillById(id: string): SkillConfig | undefined {
    id = normalizeSkillId(id)
    return loadSkills().find(s => s.id === id)
  }

  // ─── 获取内置Skill（从扫描结果中过滤，不再硬编码） ───
  function getPresetSkills(): SkillConfig[] {
    return loadSkills().filter(skill => skill.source === 'builtin' || skill.source === 'superpower')
  }

  // ─── 统一 skill:// URI 解析（兼容旧数据） ───

  async function resolveSkillUriContent(rawContent: string): Promise<string> {
    const content = String(rawContent || '').trim()
    // If content is already loaded (not a skill:// URI), return as-is
    if (!content.startsWith('skill://')) return content

    // Legacy skill:// URIs - look up from scanned skills
    const skillId = content.replace(/^skill:\/\//, '').replace(/\/SKILL\.md$/i, '').replace(/^\/+/, '')
    if (!skillId) return ''

    const allSkills = loadSkills()
    const found = allSkills.find(s => s.id === skillId || s.id.endsWith('/' + skillId))
    return found?.skillContent?.trim() || ''
  }

  // ─── Phase 0 (webhuabu): 从 SKILL.md frontmatter 提取 applicability ───
  function extractApplicability(skillContent: string): string[] {
    const text = String(skillContent || '').trim()
    if (!text) return []
    // 匹配 YAML frontmatter 中的 applicability 字段
    // 格式: applicability: [tag1, tag2] 或 applicability:\n  - tag1\n  - tag2
    const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---/)
    if (!fmMatch) return []
    const fm = fmMatch[1]
    // 尝试 YAML 数组格式: applicability: [a, b, c]
    let m = fm.match(/applicability:\s*\[([^\]]+)\]/)
    if (m) {
      return m[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean)
    }
    // 尝试 YAML 列表格式: applicability:\n  - a\n  - b
    m = fm.match(/applicability:\s*\n((?:\s+-\s+.+\n?)*)/)
    if (m) {
      return (m[1].match(/-\s*(.+)/g) || []).map(s => s.replace(/^-\s*/, '').trim().replace(/['"]/g, '')).filter(Boolean)
    }
    return []
  }

  // ─── 启用/禁用仓库Skill（保留向后兼容） ───
  function enableWarehouseSkill(id: string) { moveToMy(id) }
  function disableWarehouseSkill(id: string) { moveToPreset(id) }
  function isWarehouseSkillEnabled(id: string): boolean { return isInMySkills(id) }

  // ─── 调用计数 ───
  function incrementCallCount(id: string) {
    id = normalizeSkillId(id)
    callCounts.value = { ...callCounts.value, [id]: (callCounts.value[id] || 0) + 1 }
  }

  function getCallCount(id: string): number {
    id = normalizeSkillId(id)
    return callCounts.value[id] || 0
  }

  // ─── 获取第二列显示的Skill（向后兼容，现在等同 getMySkills） ───
  function getUserSkills(): SkillConfig[] {
    return getMySkills()
  }

  // ─── 排序 ───
  type SortMode = 'name' | 'callCount'
  const sortMode = ref<SortMode>((localStorage.getItem('jc_sort_mode') as SortMode) || 'callCount')

  function setSortMode(mode: SortMode) {
    sortMode.value = mode
    localStorage.setItem('jc_sort_mode', mode)
  }

  function sortSkills(skills: SkillConfig[]): SkillConfig[] {
    if (sortMode.value === 'name') {
      return [...skills].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    }
    return [...skills].sort((a, b) => getCallCount(b.id) - getCallCount(a.id))
  }

  void refreshSkills()

  // ═══ Web 端 Skill 系统 ═══
  const WEB_SKILLS_KEY = 'jc_web_skills_v1'
  const skillsBootstrapped = ref(isTauriRuntime())  // 桌面端永远 true，Web 端 bootstrap 完成后设 true

  function loadWebSkillsFromStorage(): SkillConfig[] {
    try {
      const raw = localStorage.getItem(WEB_SKILLS_KEY)
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  }

  function persistWebSkills() {
    const userSkills = inMemorySkills.value.filter(s => s.source !== 'builtin')
    localStorage.setItem(WEB_SKILLS_KEY, JSON.stringify(userSkills))
  }

  async function bootstrapWebSkills(fetcher: typeof fetch = fetch) {
    if (isTauriRuntime()) return
    try {
      const skills: SkillConfig[] = (await loadWebSkillCatalog(fetcher)).map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description || '',
        triggers: skill.triggers,
        references: [],
        examples: [],
        version: 1,
        source: 'builtin',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        evolutionLog: [],
        skillContent: `skill://${skill.id}/SKILL.md`,
      }))
      inMemorySkills.value = sortSkillConfigs([...skills, ...loadWebSkillsFromStorage()])
      _skillsVersion.value++
    } catch (e) {
      console.warn('[JC] Web Skill 目录加载失败:', e)
      inMemorySkills.value = sortSkillConfigs(loadWebSkillsFromStorage())
    } finally {
      skillsBootstrapped.value = true
    }
  }

  return {
    currentAgent,
    currentModel,
    warehouseEnabled,
    presetEnabled,
    sortMode,
    agents,
    modelLabel,
    // ─── 动态模型系统 ───
    availableModels,
    modelsFetched,
    modelsFetchError,
    modelCatalogSource,
    textModels,
    openCodeTextModels,
    imageModels,
    videoModels,
    audioModels,
    fetchModels,
    refreshLocalModels,
    // ─── Skill管理 ───
    loadAgents,
    loadSkills,
    getCustomAgents,
    getCustomSkills,
    saveCustomAgents,
    saveCustomSkills,
    refreshSkills,
    selectAgent,
    setModel,
    restoreLastAgent,
    createAgent,
    updateSkill,
    deleteAgent,
    toggleWarehouse,
    togglePresetEnabled,
    enableWarehouseSkill,
    disableWarehouseSkill,
    isWarehouseSkillEnabled,
    getMySkills,
    getPresetSkills,
    resolveSkillUriContent,
    extractApplicability,
    moveToMy,
    moveToPreset,
    isInMySkills,
    isBuiltinSkill,
    getSkillById,
    incrementCallCount,
    getCallCount,
    getUserSkills,
    sortSkills,
    setSortMode,
    importFromText,
    importFromJSON,
    // Web Skill 系统
    bootstrapWebSkills,
    persistWebSkills,
    skillsBootstrapped,
    inMemorySkills,
  }
})
