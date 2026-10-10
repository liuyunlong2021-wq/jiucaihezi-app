<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import JcCloudLoginBox from '@/components/auth/JcCloudLoginBox.vue'
import type { JcCloudLoginPayload, JcCloudLoginResult } from '@/components/auth/jcCloudAuth'
import { useAgentStore } from '@/stores/agentStore'
import { useTheme } from '@/composables/useTheme'
import { connectLocalOllama } from '@/utils/localOllamaRuntime'
import { getLocalOllamaModels } from '@/utils/providerConfig'
import { getCustomProviders, normalizeCustomProviderApiBase, saveCustomProviders, type CustomProviderConfig } from '@/utils/providerConfig'
import { getComfyWorkflowApiKey, probeComfyUi, saveComfyWorkflowApiKey, getComfyUiApiBase, normalizeComfyUiApiBase, saveComfyUiApiBase, getComfyServiceAccessKey, saveComfyServiceAccessKey, type ComfyUiRuntimeStatus } from '@/utils/comfyUiRuntime'
import { openExternal } from '@/utils/httpClient'
import { isTauriMobileRuntime, isTauriRuntime } from '@/utils/tauriEnv'
import {
  gatewayDeleteAccount,
  gatewayLogin,
  gatewayLogout,
  getApiKey,
  initApiKey,
  initGatewaySessionToken,
  setApiKey,
  gatewaySessionAuthenticated,
} from '@/services/newApiClient'
import { projectTextSync, projectTextSyncStatus } from '@/services/projectTextSync'
import { confirmAction } from '@/utils/confirmAction'
import DesktopUpdateSettings from './DesktopUpdateSettings.vue'
import { desktopUpdateStatus } from '@/services/desktopUpdater'

const props = defineProps<{ owner?: string; projectName?: string }>()
type SettingsTab = 'account' | 'models' | 'sync' | 'skills' | 'mcp' | 'remote' | 'theme' | 'screenshot' | 'update'

const tab = ref<SettingsTab>('account')
const apiKey = ref('')
const status = ref('')
const saved = ref(false)
const advancedOpen = ref(false)
const mobileRuntime = isTauriMobileRuntime()
const desktopRuntime = isTauriRuntime() && !mobileRuntime
const screenshotRuntime = desktopRuntime && /Win|Mac/.test(navigator.platform)
const WebSkillPanel = defineAsyncComponent(() => import('@/components/skills/WebSkillPanel.vue'))
const McpManagerPanel = defineAsyncComponent(() => import('@/components/mcp/McpManagerPanel.vue'))
const ScreenshotSettings = defineAsyncComponent(() => import('./ScreenshotSettings.vue'))
const DesktopRemoteSettings = defineAsyncComponent(() => import('./DesktopRemoteSettings.vue'))
const localModelBusy = ref(false)
const localModelStatus = ref('')
const installedLocalModelCount = ref(0)
// 本机模型与服务默认折叠：五块展开后设置页过长，收起后一行也能看到状态。
const localModelsOpen = ref(false)
const customProviders = ref<CustomProviderConfig[]>(getCustomProviders())
const customProviderStatus = ref('')
const customProviderFormOpen = ref(false)
const customProviderDraft = ref({ id: '', name: '', apiBase: '', apiKey: '', modelIds: '' })
const localModelSummary = computed(() => {
  const parts = [installedLocalModelCount.value ? `Ollama ${installedLocalModelCount.value} 个模型` : 'Ollama 未连接']
  parts.push(customProviders.value.length ? `兼容 API ${customProviders.value.length} 个` : '无兼容 API')
  return parts.join(' · ')
})
const comfyServiceName = ref(localStorage.getItem('jcComfyServiceName') || 'ComfyUI')
const comfyServiceBase = ref(getComfyUiApiBase())
const comfyServiceAccessKey = ref('')
const comfyServiceMessage = ref('')
const providerProbeBusy = ref('')
const providerConnectionStatus = ref<Record<string, string>>({})
const comfyUiBusy = ref(false)
const comfyUiStatus = ref<ComfyUiRuntimeStatus | null>(null)
const comfyWorkflowApiKey = ref('')
const comfyWorkflowApiKeySaved = ref(false)
const logoutBusy = ref(false)
const deleteBusy = ref(false)
const deleteError = ref('')
const agentStore = useAgentStore()
const appVersion = __APP_VERSION__
const { theme } = useTheme()
const textModels = computed(() => agentStore.textModels.map(model => ({ id: model.id, label: model.label })))
const themeOptions = [
  { key: 'white', label: '白色' },
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '黑夜' },
  { key: 'green', label: '柔绿' },
  { key: 'nord', label: '冷灰' },
  { key: 'dracula', label: '暗紫' },
] as const
const fontSizes = [
  { value: 14, label: '标准' },
  { value: 16, label: '大字' },
  { value: 18, label: '特大' },
  { value: 30, label: '超级大' },
] as const
const fontSize = ref(Number(localStorage.getItem('jcFontSize')) || 14)

function setFontSize(value: number) {
  fontSize.value = value
  localStorage.setItem('jcFontSize', String(value))
  document.documentElement.style.setProperty('--font-base', `${value}px`)
}

onMounted(async () => {
  if (desktopRuntime) {
    installedLocalModelCount.value = getLocalOllamaModels().length
  }
  if (desktopRuntime) void refreshComfyUi()
  if (desktopRuntime) {
    comfyWorkflowApiKey.value = await getComfyWorkflowApiKey()
    comfyServiceAccessKey.value = await getComfyServiceAccessKey()
  }
  apiKey.value = getApiKey() || await initApiKey()
  await initGatewaySessionToken()
  if (apiKey.value) await agentStore.fetchModels().catch(() => {})
})

async function connectOllama() {
  if (localModelBusy.value) return
  localModelBusy.value = true
  localModelStatus.value = '正在连接 Ollama...'
  try {
    const result = await connectLocalOllama()
    installedLocalModelCount.value = result.models.length
    agentStore.refreshLocalModels()
    localModelStatus.value = result.message
  } catch {
    localModelStatus.value = '未连接到 Ollama，请先安装并启动 Ollama。'
  } finally {
    localModelBusy.value = false
  }
}

function resetCustomProviderDraft() {
  customProviderDraft.value = { id: '', name: '', apiBase: '', apiKey: '', modelIds: '' }
}

function openCustomProviderForm() {
  resetCustomProviderDraft()
  customProviderStatus.value = ''
  customProviderFormOpen.value = true
}

function closeCustomProviderForm() {
  resetCustomProviderDraft()
  customProviderFormOpen.value = false
}

function editCustomProvider(provider: CustomProviderConfig) {
  customProviderDraft.value = {
    id: provider.id,
    name: provider.name,
    apiBase: provider.apiBase,
    apiKey: provider.apiKey || '',
    modelIds: provider.modelIds.join(', '),
  }
  customProviderStatus.value = ''
  customProviderFormOpen.value = true
}

function saveCustomProviderDraft() {
  const draft = customProviderDraft.value
  const name = draft.name.trim()
  const id = (draft.id || name).trim().toLowerCase().replace(/\s+/g, '-')
  if (!id) {
    customProviderStatus.value = '请先填写端点名称。'
    return
  }
  let apiBase = ''
  try {
    apiBase = normalizeCustomProviderApiBase(draft.apiBase)
  } catch (error) {
    customProviderStatus.value = error instanceof Error ? error.message : '端点地址无效。'
    return
  }
  const modelIds = draft.modelIds.split(/[\n,]/).map(value => value.trim()).filter(Boolean)
  if (modelIds.length === 0) {
    customProviderStatus.value = '请至少填写一个模型 ID。'
    return
  }
  saveCustomProviders([
    ...customProviders.value.filter(provider => provider.id !== id),
    { id, name: name || id, apiBase, apiKey: draft.apiKey.trim() || undefined, modelIds },
  ])
  customProviders.value = getCustomProviders()
  agentStore.refreshLocalModels()
  resetCustomProviderDraft()
  customProviderFormOpen.value = false
  customProviderStatus.value = `已保存 ${name || id}，可在顶部模型菜单选择。`
}

function removeCustomProvider(id: string) {
  saveCustomProviders(customProviders.value.filter(provider => provider.id !== id))
  customProviders.value = getCustomProviders()
  agentStore.refreshLocalModels()
  if (customProviderDraft.value.id === id) closeCustomProviderForm()
  customProviderStatus.value = '已删除该端点。'
}

async function detectProviderModels(provider?: CustomProviderConfig) {
  if (providerProbeBusy.value) return
  const candidate = provider || customProviderDraft.value
  const probeId = provider?.id || 'draft'
  providerProbeBusy.value = probeId
  try {
    const base = normalizeCustomProviderApiBase(candidate.apiBase)
    const headers = candidate.apiKey?.trim() ? { Authorization: `Bearer ${candidate.apiKey.trim()}` } : undefined
    const response = await fetch(`${base}/v1/models`, { headers, signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = await response.json()
    if (!Array.isArray(data?.data)) throw new Error('服务未返回 OpenAI 兼容模型列表，请手动填写模型 ID')
    const ids = [...new Set<string>(data.data.map((model: { id?: string }) => model.id).filter((id: unknown): id is string => typeof id === 'string' && Boolean(id.trim())))]
    if (provider) providerConnectionStatus.value[probeId] = `已连接 · 服务返回 ${ids.length} 个模型`
    else {
      customProviderDraft.value.modelIds = ids.join(', ')
      customProviderStatus.value = `已连接 · 获取 ${ids.length} 个模型；保存后生效`
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '检测失败'
    if (provider) providerConnectionStatus.value[probeId] = `检测失败 · ${message}`
    else customProviderStatus.value = message
  } finally { providerProbeBusy.value = '' }
}

async function saveComfyApiKey() {
  try {
    await saveComfyWorkflowApiKey(comfyWorkflowApiKey.value)
    comfyWorkflowApiKeySaved.value = true
    comfyServiceMessage.value = '上游模型 Key 已保存'
  } catch (error) { comfyServiceMessage.value = error instanceof Error ? error.message : '保存失败' }
}

async function saveWorkflowConnection() {
  if (comfyUiBusy.value) return
  comfyUiBusy.value = true
  try {
    const base = normalizeComfyUiApiBase(comfyServiceBase.value)
    if (!comfyServiceName.value.trim()) throw new Error('请填写连接名称')
    await saveComfyServiceAccessKey(base, comfyServiceAccessKey.value)
    comfyServiceBase.value = saveComfyUiApiBase(base)
    localStorage.setItem('jcComfyServiceName', comfyServiceName.value.trim())
    comfyUiStatus.value = null
    comfyServiceMessage.value = '连接已保存，创作工作流将使用此地址'
  } catch (error) { comfyServiceMessage.value = error instanceof Error ? error.message : '保存失败' }
  finally { comfyUiBusy.value = false }
}

async function refreshComfyUi() {
  if (comfyUiBusy.value) return
  comfyUiBusy.value = true
  try {
    if (normalizeComfyUiApiBase(comfyServiceBase.value) !== getComfyUiApiBase() || comfyServiceAccessKey.value.trim() !== await getComfyServiceAccessKey()) throw new Error('连接已修改，请先保存，再检测')
    comfyUiStatus.value = await probeComfyUi()
    comfyServiceMessage.value = '服务已连接'
  } catch (error) {
    comfyUiStatus.value = null
    comfyServiceMessage.value = error instanceof Error ? error.message : '连接检测失败'
  } finally { comfyUiBusy.value = false }
}

async function login(payload: JcCloudLoginPayload): Promise<JcCloudLoginResult> {
  const result = await gatewayLogin({ username: payload.username, password: payload.password })
  // 登录只建立云端身份与同步会话；模型调用 Key 由用户手动填写。
  return { user: result.user, baseUrl: result.baseUrl, raw: result }
}

async function handleLogin() {
  await agentStore.fetchModels().catch(() => {})
  status.value = '已登录，云端同步已启用'
}

async function logout() {
  if (logoutBusy.value) return
  logoutBusy.value = true
  try {
    await gatewayLogout()
    status.value = '已退出登录'
  } finally {
    logoutBusy.value = false
  }
}

async function deleteAccount() {
  if (deleteBusy.value) return
  const confirmed = await confirmAction('注销后，账号和云端文字同步数据将永久删除，无法恢复。手机里的本地项目、文件和媒体不会删除。', {
    title: '注销账号',
    kind: 'error',
    okLabel: '永久注销',
  })
  if (!confirmed) return
  deleteBusy.value = true
  deleteError.value = ''
  try {
    await gatewayDeleteAccount()
    apiKey.value = ''
    await projectTextSync.disconnect().catch(() => {})
    status.value = '账号已注销'
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : String(error)
  } finally {
    deleteBusy.value = false
  }
}

async function saveKey() {
  const key = apiKey.value.trim()
  if (!key) {
    status.value = '请填写 API Key'
    return
  }
  await setApiKey(key)
  await agentStore.fetchModels().catch(() => {})
  saved.value = true
  status.value = '已保存'
}

function showSync() {
  tab.value = 'sync'
}
</script>

<template>
  <div class="memory-settings" :class="{ 'memory-settings-desktop': desktopRuntime }">
    <nav class="memory-settings-tabs" aria-label="设置分类">
      <button :class="{ active: tab === 'account' }" @click="tab = 'account'">
        <JcIcon name="person" />账号
      </button>
      <button v-if="desktopRuntime" :class="{ active: tab === 'models' }" @click="tab = 'models'">
        <JcIcon name="settings" />模型与服务
      </button>
      <button :class="{ active: tab === 'sync' }" @click="showSync">
        <JcIcon name="sync" />同步
      </button>
      <button v-if="desktopRuntime" :class="{ active: tab === 'skills' }" @click="tab = 'skills'">
        <JcIcon name="extension" />Skill
      </button>
      <button v-if="desktopRuntime" :class="{ active: tab === 'mcp' }" @click="tab = 'mcp'">
        <JcIcon name="hub" />MCP
      </button>
      <button v-if="desktopRuntime" :class="{ active: tab === 'remote' }" @click="tab = 'remote'">
        <JcIcon name="smartphone_outline" />手机
      </button>
      <button v-if="screenshotRuntime" :class="{ active: tab === 'screenshot' }" @click="tab = 'screenshot'"><JcIcon name="photo_camera" />截图</button>
      <button :class="{ active: tab === 'theme' }" @click="tab = 'theme'">
        <JcIcon name="palette" />主题
      </button>
      <button v-if="desktopRuntime" :class="{ active: tab === 'update' }" @click="tab = 'update'">更新<span v-if="desktopUpdateStatus.version"> ●</span></button>
    </nav>
    <div class="memory-settings-body">
      <DesktopUpdateSettings v-if="desktopRuntime && tab === 'update'" />
      <ScreenshotSettings v-if="screenshotRuntime && tab === 'screenshot'" />
      <div v-if="tab === 'account' || tab === 'models'" class="memory-account">
        <div v-if="tab === 'account'" class="memory-account-identity">
        <JcCloudLoginBox
          v-model:api-key="apiKey"
          v-model:advanced-open="advancedOpen"
          :logged-in="gatewaySessionAuthenticated"
          :saved="saved"
          :status="status"
          :model="agentStore.currentModel"
          :chat-models="textModels"
          :login="login"
          :account-only="mobileRuntime"
          :open-url="openExternal"
          @login-success="handleLogin"
          @save-key="saveKey"
        />
        <div v-if="mobileRuntime && gatewaySessionAuthenticated" class="memory-mobile-account-actions">
          <button class="memory-mobile-logout" :disabled="logoutBusy || deleteBusy" @click="logout">
            <JcIcon name="logout" />{{ logoutBusy ? '正在退出' : '退出登录' }}
          </button>
          <button class="memory-mobile-delete" :disabled="logoutBusy || deleteBusy" @click="deleteAccount">
            <JcIcon name="delete" />{{ deleteBusy ? '正在注销' : '注销账号' }}
          </button>
        </div>
        <p v-if="deleteError" class="memory-account-error">{{ deleteError }}</p>
        <nav v-if="mobileRuntime" class="memory-mobile-legal" aria-label="账号与隐私">
          <button @click="openExternal('https://jiucaihezi.studio/privacy/')">隐私政策</button>
          <button @click="openExternal('https://jiucaihezi.studio/support/')">用户支持</button>
          <button @click="openExternal('https://jiucaihezi.studio/terms/')">服务条款</button>
        </nav>
        </div>
        <template v-if="desktopRuntime && tab === 'models'">
        <div class="memory-local-head">
          <strong>模型与服务</strong>
          <span>{{ localModelSummary }}</span>
          <button type="button" :aria-expanded="localModelsOpen" @click="localModelsOpen = !localModelsOpen">{{ localModelsOpen ? '收起' : '展开' }}</button>
        </div>
        <template v-if="localModelsOpen">
        <section class="memory-local-model">
          <div>
            <strong>本地模型 · Ollama</strong>
            <span>{{ installedLocalModelCount ? `已识别 ${installedLocalModelCount} 个模型` : '未连接' }}</span>
          </div>
          <p v-if="localModelStatus">{{ localModelStatus }}</p>
          <div class="memory-local-actions">
            <button :disabled="localModelBusy" @click="connectOllama">
              {{ localModelBusy ? '连接中' : '连接 Ollama' }}
            </button>
            <button @click="openExternal('https://ollama.com/download/mac')">下载安装</button>
          </div>
        </section>
        <section class="memory-local-model">
          <div>
            <strong>兼容 API</strong>
            <span>{{ customProviders.length ? `已配置 ${customProviders.length} 个` : '未配置' }}</span>
          </div>
          <p v-if="customProviderStatus">{{ customProviderStatus }}</p>
          <p v-else-if="customProviders.length === 0">连接本机、局域网或云端的 OpenAI 兼容模型服务。</p>
          <div v-for="provider in customProviders" :key="provider.id" class="memory-endpoint-row">
            <div>
              <strong>{{ provider.name }}</strong>
              <span>{{ provider.apiBase }} · {{ provider.modelIds.length }} 个模型</span>
            </div>
            <div class="memory-local-actions">
              <button :disabled="Boolean(providerProbeBusy)" @click="detectProviderModels(provider)">{{ providerProbeBusy === provider.id ? '检测中' : '检测连接' }}</button>
              <button @click="editCustomProvider(provider)">编辑</button>
              <details class="memory-provider-more"><summary>更多</summary><button @click="removeCustomProvider(provider.id)">删除连接</button></details>
            </div>
            <p v-if="providerConnectionStatus[provider.id]" class="memory-connection-status" role="status">{{ providerConnectionStatus[provider.id] }}</p>
          </div>
          <template v-if="customProviderFormOpen">
            <p>接口协议：OpenAI 兼容</p>
            <label class="memory-comfy-key">
              <span>名称</span>
              <input v-model="customProviderDraft.name" type="text" autocomplete="off" placeholder="例如：本机 MLX、公司模型服务" />
            </label>
            <label class="memory-comfy-key">
              <span>服务地址</span>
              <input v-model="customProviderDraft.apiBase" type="url" inputmode="url" autocomplete="off" placeholder="http://127.0.0.1:8081" />
            </label>
            <label class="memory-comfy-key">
              <span>访问密钥（可选）</span>
              <input v-model="customProviderDraft.apiKey" type="password" autocomplete="off" />
            </label>
            <label class="memory-comfy-key">
              <span>模型 ID（逗号或换行分隔）</span>
              <input v-model="customProviderDraft.modelIds" type="text" autocomplete="off" placeholder="mlx-community/LensVLM-9B-OptiQ-4bit" />
            </label>
            <div class="memory-local-actions">
              <button :disabled="Boolean(providerProbeBusy)" @click="detectProviderModels()">{{ providerProbeBusy === 'draft' ? '获取中' : '获取模型列表' }}</button>
              <button @click="saveCustomProviderDraft">保存</button>
              <button @click="closeCustomProviderForm">取消</button>
            </div>
          </template>
          <div v-else class="memory-local-actions">
            <button @click="openCustomProviderForm">添加连接</button>
          </div>
        </section>
        <section class="memory-local-model">
          <div>
            <strong>桌面操作</strong>
            <span>{{ agentStore.computerUseEnabled ? '已开启' : '已关闭' }}</span>
          </div>
          <p>让模型在本机桌面上截图、点击、输入（官方 Cua Driver，实验性）。关掉后模型的工具表里不会出现这些工具，下一轮对话生效。</p>
          <label class="memory-service-switch">
            <span>允许操作本机桌面</span>
            <input
              type="checkbox"
              role="switch"
              :checked="agentStore.computerUseEnabled"
              @change="agentStore.toggleComputerUse(($event.target as HTMLInputElement).checked)"
            />
          </label>
        </section>
        <section class="memory-local-model">
          <div>
            <strong>工作流服务</strong>
            <span>{{ comfyUiStatus ? '已连接' : '未检测 / 未连接' }}</span>
          </div>
          <p v-if="comfyUiStatus">
            {{ comfyUiStatus.version ? `版本 ${comfyUiStatus.version} · ` : '' }}
            {{ comfyUiStatus.device || '服务设备信息未提供' }}
          </p>
          <p>服务类型：ComfyUI · 支持本机、局域网和 HTTPS 远程服务</p>
          <label class="memory-comfy-key"><span>连接名称</span><input v-model="comfyServiceName" autocomplete="off" placeholder="例如：本机 ComfyUI、工作室工作流" /></label>
          <label class="memory-comfy-key"><span>服务地址</span><input v-model="comfyServiceBase" type="url" autocomplete="off" @input="comfyUiStatus = null" placeholder="http://127.0.0.1:8188" /></label>
          <label class="memory-comfy-key"><span>服务访问密钥（可选，Bearer）</span><input v-model="comfyServiceAccessKey" type="password" autocomplete="off" @input="comfyUiStatus = null" placeholder="仅用于服务访问鉴权" /></label>
          <p v-if="comfyServiceMessage" role="status">{{ comfyServiceMessage }}</p>
          <div class="memory-local-actions">
            <button :disabled="comfyUiBusy" @click="saveWorkflowConnection">保存连接</button>
            <button :disabled="comfyUiBusy" @click="refreshComfyUi">{{ comfyUiBusy ? '处理中' : '检测连接' }}</button>
          </div>
          <label class="memory-comfy-key">
            <span>工作流凭据 · 上游模型 Key</span>
            <input v-model="comfyWorkflowApiKey" type="password" autocomplete="off" placeholder="仅用于工作流中的上游模型调用" @input="comfyWorkflowApiKeySaved = false" />
          </label>
          <div class="memory-local-actions">
            <button @click="saveComfyApiKey">{{ comfyWorkflowApiKeySaved ? '已保存' : '保存上游模型 Key' }}</button>
          </div>
        </section>
        </template>
        </template>
      </div>
      <div v-else-if="tab === 'sync'" class="memory-sync">
        <template v-if="!gatewaySessionAuthenticated">
          <p>{{ apiKey ? '当前 API Key 可用于模型，但云同步需要重新登录一次账号。' : '请先在“账号”中登录。手动填写 API Key 不能识别同步账号。' }}</p>
          <button @click="tab = 'account'">{{ apiKey ? '重新登录以启用同步' : '前往登录' }}</button>
        </template>
        <template v-else-if="!owner">
          <p>请先在左侧选择一个本地项目。</p>
        </template>
        <template v-else-if="projectTextSyncStatus.cloudProjectId">
          <div class="memory-sync-summary">
            <strong>{{ projectName || '当前项目' }}</strong>
            <span>{{ projectTextSyncStatus.message || '已连接云项目' }}</span>
            <span v-if="projectTextSyncStatus.pending">待同步 {{ projectTextSyncStatus.pending }} 项</span>
            <progress
              v-if="projectTextSyncStatus.phase === 'syncing' && projectTextSyncStatus.progressTotal"
              :value="projectTextSyncStatus.progressCurrent"
              :max="projectTextSyncStatus.progressTotal"
            ></progress>
            <span>只处理文字，媒体和空目录不处理</span>
          </div>
          <p>请在项目中心选择上传或下载。</p>
        </template>
        <template v-else>
          <p>当前项目尚未上传。请点击左上角项目名，在项目中心上传当前项目或下载云项目。</p>
        </template>
      </div>
      <WebSkillPanel v-else-if="desktopRuntime && tab === 'skills'" />
      <McpManagerPanel v-else-if="desktopRuntime && tab === 'mcp'" />
      <DesktopRemoteSettings v-else-if="desktopRuntime && tab === 'remote'" />
      <div v-else-if="tab === 'theme'" class="memory-appearance">
        <div class="memory-theme-options" aria-label="主题">
          <button
            v-for="option in themeOptions"
            :key="option.key"
            :class="{ active: theme === option.key }"
            @click="theme = option.key"
          >
            <span class="memory-theme-swatch" :class="option.key"></span>
            {{ option.label }}
          </button>
        </div>
        <section class="memory-font-setting">
          <strong>全局字号</strong>
          <div class="memory-font-options" aria-label="全局字号">
            <button
              v-for="option in fontSizes"
              :key="option.value"
              :class="{ active: fontSize === option.value }"
              @click="setFontSize(option.value)"
            >
              {{ option.label }} {{ option.value }}
            </button>
          </div>
        </section>
      </div>
    </div>
    <footer class="memory-settings-version">版本 {{ desktopRuntime ? desktopUpdateStatus.currentVersion || appVersion : appVersion }}<button v-if="desktopRuntime" @click="tab = 'update'">{{ desktopUpdateStatus.version ? '有新版本' : '检查更新' }}</button></footer>
  </div>
</template>

<style scoped>
.memory-settings { display: flex; height: 100%; min-height: 0; flex-direction: column; }
.memory-settings-tabs { display: flex; overflow-x: auto; gap: 4px; padding: 10px; border-bottom: 1px solid var(--line); }
.memory-settings-tabs button { display: flex; align-items: center; justify-content: center; flex: 1 0 auto; gap: 5px; min-width: 50px; height: 36px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--ink2); cursor: pointer; }
.memory-settings-tabs button.active { border-color: var(--line); background: var(--surface); color: var(--ink1); }
.memory-settings-tabs button:focus-visible { outline: 2px solid var(--jc-focus-ring); outline-offset: 2px; }
.memory-settings-desktop { display: grid; grid-template-columns: minmax(0, 1fr) 122px; grid-template-rows: minmax(0, 1fr) auto; }
.memory-settings-desktop .memory-settings-tabs { grid-column: 2; grid-row: 1; display: flex; flex-direction: column; align-items: stretch; gap: 3px; overflow-x: hidden; overflow-y: auto; padding: 12px 8px; border-left: 1px solid var(--line); border-bottom: 0; }
.memory-settings-desktop .memory-settings-tabs button { flex: 0 0 auto; justify-content: flex-start; min-width: 0; height: 36px; padding: 0 8px; border-color: transparent; border-radius: 7px; white-space: nowrap; }
.memory-settings-desktop .memory-settings-tabs button.active { border-color: transparent; background: var(--olive-pale); color: var(--olive); font-weight: 600; }
.memory-settings-body { min-height: 0; flex: 1; overflow: auto; padding: 12px; }
.memory-settings-desktop .memory-settings-body { grid-column: 1; grid-row: 1; min-width: 0; padding: 16px; }
.memory-settings-version { padding: 8px 12px; border-top: 1px solid var(--line); color: var(--ink3); font-size: 12px; text-align: center; }
.memory-settings-desktop .memory-settings-version { grid-column: 1 / -1; grid-row: 2; }
.memory-settings-version button { margin-left: 4px; padding: 2px 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink1); font: inherit; cursor: pointer; }
.memory-settings-version button:hover { border-color: var(--olive); background: var(--surface-alt); }
.memory-settings-version button:focus-visible { outline: 2px solid var(--olive); outline-offset: 2px; }
.memory-account { display: grid; min-width: 0; gap: 12px; }
.memory-mobile-account-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.memory-mobile-logout, .memory-mobile-delete { display: flex; min-height: 40px; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink2); font: inherit; }
.memory-mobile-delete { border-color: color-mix(in srgb, var(--danger) 45%, var(--line)); color: var(--danger); }
.memory-mobile-logout:disabled, .memory-mobile-delete:disabled { opacity: .55; }
.memory-account-error { margin: 0; color: var(--danger); font-size: 12px; }
.memory-mobile-legal { display: flex; justify-content: center; gap: 12px; }
.memory-mobile-legal button { padding: 0; border: 0; background: transparent; color: var(--ink3); font: inherit; font-size: 12px; text-decoration: underline; }
.memory-local-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 12px; padding: 4px 0 8px; }
.memory-local-head strong { grid-column: 1; min-width: 0; font-size: 15px; font-weight: 600; line-height: 1.5; }
.memory-local-head span { grid-column: 1; color: var(--ink3); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.memory-local-head button { grid-column: 2; grid-row: 1 / 3; min-height: 30px; padding: 0 10px; border: 0; border-radius: 7px; background: transparent; color: var(--ink2); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.memory-local-head button:hover { background: var(--surface-alt); }
.memory-local-model { display: grid; min-width: 0; gap: 12px; padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); }
.memory-local-model > div:first-child { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; }
.memory-local-model strong { min-width: 0; font-size: 13px; font-weight: 600; line-height: 1.5; }
.memory-local-model span, .memory-local-model p { margin: 0; color: var(--ink2); font-size: 12px; line-height: 1.6; }
.memory-local-model > div:first-child > span { color: var(--ink3); white-space: nowrap; }
.memory-local-actions { display: flex; flex-wrap: wrap; flex-shrink: 0; gap: 8px; }
.memory-endpoint-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; padding-top: 12px; border-top: 1px solid var(--line); }
.memory-connection-status { flex: 1 1 100%; }
.memory-endpoint-row > div:first-child { display: grid; min-width: 0; flex: 1 1 130px; gap: 2px; }
.memory-endpoint-row > div:first-child span { overflow-wrap: anywhere; }
.memory-local-actions button { min-height: 30px; flex: 0 0 auto; padding: 0 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); color: var(--ink1); font: inherit; font-size: 12px; white-space: nowrap; cursor: pointer; }
.memory-local-actions button:hover:not(:disabled) { background: var(--surface-alt); }
.memory-provider-more { position: relative; }
.memory-provider-more summary { display: flex; min-height: 30px; box-sizing: border-box; align-items: center; padding: 0 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); color: var(--ink2); font-size: 12px; white-space: nowrap; cursor: pointer; list-style: none; }
.memory-provider-more summary::-webkit-details-marker { display: none; }
.memory-provider-more > button { position: absolute; z-index: 2; top: calc(100% + 4px); right: 0; background: var(--paper); color: var(--jc-error); box-shadow: var(--jc-shadow-sm); }
.memory-provider-more summary:focus-visible { outline: 2px solid var(--jc-focus-ring); outline-offset: 2px; }
.memory-local-actions button:disabled { opacity: .55; cursor: progress; }
.memory-local-actions button:focus-visible, .memory-local-head button:focus-visible { outline: 2px solid var(--jc-focus-ring); outline-offset: 2px; }
.memory-comfy-key { display: grid; min-width: 0; gap: 6px; color: var(--ink2); font-size: 12px; }
.memory-comfy-key input { min-width: 0; width: 100%; box-sizing: border-box; height: 34px; padding: 0 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--paper); color: var(--ink1); font: inherit; }
.memory-comfy-key input:focus { outline: 2px solid color-mix(in srgb, var(--olive) 35%, transparent); border-color: var(--olive); }
.memory-service-switch { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; }
.memory-service-switch input { appearance: none; position: relative; box-sizing: border-box; width: 34px; height: 20px; flex: 0 0 34px; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 999px; background: var(--jc-surface-container-high); cursor: pointer; transition: background var(--jc-transition-fast); }
.memory-service-switch input::before { content: ''; position: absolute; top: 1px; left: 1px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 15%); transition: left var(--jc-transition-fast); }
.memory-service-switch input:checked { border-color: var(--olive); background: var(--olive); }
.memory-service-switch input:checked::before { left: 15px; }
.memory-service-switch input:focus-visible { outline: 2px solid var(--jc-focus-ring); outline-offset: 3px; }
@media (prefers-reduced-motion: reduce) { .memory-service-switch input, .memory-service-switch input::before { transition: none; } }
.memory-sync { display: grid; gap: 12px; }
.memory-sync p { margin: 0; color: var(--ink3); line-height: 1.6; }
.memory-sync > button { min-height: 36px; padding: 0 12px; border: 1px solid var(--olive); border-radius: 6px; background: var(--olive); color: white; cursor: pointer; font: inherit; }
.memory-sync button:disabled { opacity: .5; cursor: progress; }
.memory-sync-summary { display: grid; gap: 4px; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.memory-sync-summary span { color: var(--ink3); font-size: 12px; }
.memory-sync-summary progress { width: 100%; height: 6px; accent-color: var(--olive); }
.memory-sync .memory-sync-error { color: var(--danger); }
.memory-appearance { display: grid; gap: 20px; }
.memory-theme-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.memory-theme-options button { display: flex; align-items: center; gap: 9px; min-height: 42px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); cursor: pointer; }
.memory-theme-options button.active { border-color: var(--olive); box-shadow: inset 0 0 0 1px var(--olive); }
.memory-theme-swatch { width: 18px; height: 18px; flex: 0 0 18px; border: 1px solid rgb(0 0 0 / 16%); border-radius: 50%; }
.memory-theme-swatch.white { background: #fff; }
.memory-theme-swatch.light { background: #f7f8f5; }
.memory-theme-swatch.dark { background: #201b14; }
.memory-theme-swatch.green { background: #eaf0e8; }
.memory-theme-swatch.nord { background: #eceff4; }
.memory-theme-swatch.dracula { background: #282a36; }
.memory-font-setting { display: grid; gap: 8px; }
.memory-font-setting > strong { font-size: var(--font-base); }
.memory-font-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.memory-font-options button { min-width: 0; min-height: 38px; padding: 6px 4px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); font: inherit; cursor: pointer; }
.memory-font-options button.active { border-color: var(--olive); background: var(--olive-pale); }
@media (max-width: 560px) {
  .memory-settings-desktop { grid-template-columns: minmax(0, 1fr) 112px; }
  .memory-settings-desktop .memory-settings-tabs { padding: 8px 6px; }
  .memory-settings-desktop .memory-settings-body { padding: 12px; }
}
</style>
