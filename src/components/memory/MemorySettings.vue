<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import JcCloudLoginBox from '@/components/auth/JcCloudLoginBox.vue'
import type { JcCloudLoginPayload, JcCloudLoginResult } from '@/components/auth/jcCloudAuth'
import { useAgentStore } from '@/stores/agentStore'
import { useTheme } from '@/composables/useTheme'
import { connectLocalOllama } from '@/utils/localOllamaRuntime'
import { ensureJevScorer, jevScorerReady, jevScorerStateLabel } from '@/utils/jevScorerRuntime'
import { getLocalOllamaModels } from '@/utils/providerConfig'
import { getCustomProviders, normalizeCustomProviderApiBase, saveCustomProviders, type CustomProviderConfig } from '@/utils/providerConfig'
import { getComfyWorkflowApiKey, probeComfyUi, saveComfyWorkflowApiKey, type ComfyUiRuntimeStatus } from '@/utils/comfyUiRuntime'
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

const props = defineProps<{ owner?: string; projectName?: string }>()
type SettingsTab = 'account' | 'sync' | 'skills' | 'mcp' | 'theme'

const tab = ref<SettingsTab>('account')
const apiKey = ref('')
const status = ref('')
const saved = ref(false)
const advancedOpen = ref(false)
const mobileRuntime = isTauriMobileRuntime()
const desktopRuntime = isTauriRuntime() && !mobileRuntime
const WebSkillPanel = defineAsyncComponent(() => import('@/components/skills/WebSkillPanel.vue'))
const McpManagerPanel = defineAsyncComponent(() => import('@/components/mcp/McpManagerPanel.vue'))
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
  parts.push(customProviders.value.length ? `自定义端点 ${customProviders.value.length} 个` : '无自定义端点')
  return parts.join(' · ')
})
const comfyUiBusy = ref(false)
const comfyUiStatus = ref<ComfyUiRuntimeStatus | null>(null)
const jevScorerBusy = ref(false)
const jevScorerStatus = ref('')
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
  { key: 'green', label: '护眼' },
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
  if (desktopRuntime) comfyWorkflowApiKey.value = await getComfyWorkflowApiKey()
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

async function saveComfyApiKey() {
  await saveComfyWorkflowApiKey(comfyWorkflowApiKey.value)
  comfyWorkflowApiKeySaved.value = true
}

async function checkJevScorer() {
  if (jevScorerBusy.value) return
  jevScorerBusy.value = true
  jevScorerStatus.value = (await jevScorerReady()) ? '打分器在运行。' : '打分器没在运行。'
  jevScorerBusy.value = false
}

async function startJevScorer() {
  if (jevScorerBusy.value) return
  jevScorerBusy.value = true
  jevScorerStatus.value = '正在启动...'
  // 模型加载有十几秒，这里只报「起了没」，不等它 ready。
  jevScorerStatus.value = jevScorerStateLabel(await ensureJevScorer())
  jevScorerBusy.value = false
}

async function refreshComfyUi() {
  if (comfyUiBusy.value) return
  comfyUiBusy.value = true
  try {
    comfyUiStatus.value = await probeComfyUi()
  } catch {
    comfyUiStatus.value = null
  } finally {
    comfyUiBusy.value = false
  }
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
  <div class="memory-settings">
    <nav class="memory-settings-tabs" aria-label="设置分类">
      <button :class="{ active: tab === 'account' }" @click="tab = 'account'">
        <JcIcon name="person" />账号
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
      <button :class="{ active: tab === 'theme' }" @click="tab = 'theme'">
        <JcIcon name="palette" />主题
      </button>
    </nav>
    <div class="memory-settings-body">
      <div v-if="tab === 'account'" class="memory-account">
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
        <div v-if="desktopRuntime" class="memory-local-head">
          <strong>本机模型与服务</strong>
          <span>{{ localModelSummary }}</span>
          <button @click="localModelsOpen = !localModelsOpen">{{ localModelsOpen ? '收起' : '展开' }}</button>
        </div>
        <template v-if="desktopRuntime && localModelsOpen">
        <section v-if="desktopRuntime" class="memory-local-model">
          <div>
            <strong>Ollama 本地模型</strong>
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
        <section v-if="desktopRuntime" class="memory-local-model">
          <div>
            <strong>自定义端点</strong>
            <span>{{ customProviders.length ? `已配置 ${customProviders.length} 个` : '未配置' }}</span>
          </div>
          <p v-if="customProviderStatus">{{ customProviderStatus }}</p>
          <p v-else-if="customProviders.length === 0">接入 LM Studio、mlx_vlm.server、mlx-optiq、vLLM 等 OpenAI 兼容服务。</p>
          <div v-for="provider in customProviders" :key="provider.id" class="memory-endpoint-row">
            <div>
              <strong>{{ provider.name }}</strong>
              <span>{{ provider.apiBase }} · {{ provider.modelIds.length }} 个模型</span>
            </div>
            <div class="memory-local-actions">
              <button @click="editCustomProvider(provider)">编辑</button>
              <button @click="removeCustomProvider(provider.id)">删除</button>
            </div>
          </div>
          <template v-if="customProviderFormOpen">
            <label class="memory-comfy-key">
              <span>名称</span>
              <input v-model="customProviderDraft.name" type="text" autocomplete="off" placeholder="本机端点" />
            </label>
            <label class="memory-comfy-key">
              <span>端点地址</span>
              <input v-model="customProviderDraft.apiBase" type="url" inputmode="url" autocomplete="off" placeholder="http://127.0.0.1:8081" />
            </label>
            <label class="memory-comfy-key">
              <span>API Key（可留空）</span>
              <input v-model="customProviderDraft.apiKey" type="password" autocomplete="off" />
            </label>
            <label class="memory-comfy-key">
              <span>模型 ID（逗号或换行分隔）</span>
              <input v-model="customProviderDraft.modelIds" type="text" autocomplete="off" placeholder="mlx-community/LensVLM-9B-OptiQ-4bit" />
            </label>
            <div class="memory-local-actions">
              <button @click="saveCustomProviderDraft">保存</button>
              <button @click="closeCustomProviderForm">取消</button>
            </div>
          </template>
          <div v-else class="memory-local-actions">
            <button @click="openCustomProviderForm">添加端点</button>
          </div>
        </section>
        <section v-if="desktopRuntime" class="memory-local-model">
          <div>
            <strong>@Jev 本地打分器</strong>
            <span>{{ agentStore.jevScorerAutostart ? '启动时自动拉起' : '已关闭' }}</span>
          </div>
          <p v-if="jevScorerStatus">{{ jevScorerStatus }}</p>
          <p v-else>装有打分器的机器上，@Jev 会用它语义挑 Skill（准确率从 71% 提到 95%）。没装的机器自动降级，不用管。</p>
          <label class="memory-comfy-key">
            <span>启动时自动拉起</span>
            <input
              type="checkbox"
              :checked="agentStore.jevScorerAutostart"
              @change="agentStore.toggleJevScorerAutostart(($event.target as HTMLInputElement).checked)"
            />
          </label>
          <div class="memory-local-actions">
            <button :disabled="jevScorerBusy" @click="checkJevScorer">
              {{ jevScorerBusy ? '检测中' : '检测状态' }}
            </button>
            <button :disabled="jevScorerBusy" @click="startJevScorer">
              {{ jevScorerBusy ? '启动中' : '立即启动' }}
            </button>
          </div>
        </section>
        <section v-if="desktopRuntime" class="memory-local-model">
          <div>
            <strong>本机 ComfyUI</strong>
            <span>{{ comfyUiStatus ? '已连接' : '未启动' }}</span>
          </div>
          <p v-if="comfyUiStatus">
            {{ comfyUiStatus.version ? `版本 ${comfyUiStatus.version} · ` : '' }}
            {{ comfyUiStatus.mps ? 'MPS 加速已启用' : '未检测到 MPS 加速' }}
          </p>
          <p v-else>请先启动本机 ComfyUI。</p>
          <div class="memory-local-actions">
            <button :disabled="comfyUiBusy" @click="refreshComfyUi">{{ comfyUiBusy ? '检测中' : '刷新状态' }}</button>
          </div>
          <label class="memory-comfy-key">
            <span>API Key</span>
            <input v-model="comfyWorkflowApiKey" type="password" autocomplete="off" placeholder="用于需要上游凭据的本机工作流" @input="comfyWorkflowApiKeySaved = false" />
          </label>
          <div class="memory-local-actions">
            <button @click="saveComfyApiKey">{{ comfyWorkflowApiKeySaved ? '已保存' : '保存 API Key' }}</button>
          </div>
        </section>
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
      <div v-else class="memory-appearance">
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
    <footer class="memory-settings-version">版本 {{ appVersion }}</footer>
  </div>
</template>

<style scoped>
.memory-settings { display: flex; height: 100%; min-height: 0; flex-direction: column; }
.memory-settings-tabs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; padding: 10px; border-bottom: 1px solid var(--line); }
.memory-settings-tabs button { display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 0; height: 36px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--ink2); cursor: pointer; }
.memory-settings-tabs button.active { border-color: var(--line); background: var(--surface); color: var(--ink1); }
.memory-settings-body { min-height: 0; flex: 1; overflow: auto; padding: 12px; }
.memory-settings-version { padding: 8px 12px; border-top: 1px solid var(--line); color: var(--ink3); font-size: 12px; text-align: center; }
.memory-account { display: grid; gap: 16px; }
.memory-mobile-account-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.memory-mobile-logout, .memory-mobile-delete { display: flex; min-height: 40px; align-items: center; justify-content: center; gap: 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink2); font: inherit; }
.memory-mobile-delete { border-color: color-mix(in srgb, var(--danger) 45%, var(--line)); color: var(--danger); }
.memory-mobile-logout:disabled, .memory-mobile-delete:disabled { opacity: .55; }
.memory-account-error { margin: 0; color: var(--danger); font-size: 12px; }
.memory-mobile-legal { display: flex; justify-content: center; gap: 12px; }
.memory-mobile-legal button { padding: 0; border: 0; background: transparent; color: var(--ink3); font: inherit; font-size: 12px; text-decoration: underline; }
.memory-local-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.memory-local-head strong { flex: 1; }
.memory-local-head span { color: var(--ink3); font-size: 12px; }
.memory-local-head button { min-height: 30px; padding: 0 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); font: inherit; cursor: pointer; }
.memory-local-model { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.memory-local-model > div:first-child { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.memory-local-model span, .memory-local-model p { margin: 0; color: var(--ink3); font-size: 12px; }
.memory-local-actions { display: flex; gap: 8px; }
.memory-endpoint-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 10px; border-top: 1px solid var(--line); }
.memory-endpoint-row > div:first-child { display: grid; min-width: 0; gap: 2px; }
.memory-local-actions button { min-height: 34px; padding: 0 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); font: inherit; cursor: pointer; }
.memory-local-actions button:disabled { opacity: .55; cursor: progress; }
.memory-comfy-key { display: grid; gap: 6px; color: var(--ink2); font-size: 12px; }
.memory-comfy-key input { min-width: 0; height: 34px; padding: 0 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); font: inherit; }
.memory-comfy-key input:focus { outline: 2px solid color-mix(in srgb, var(--olive) 35%, transparent); border-color: var(--olive); }
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
.memory-theme-swatch.light { background: #fdf6e3; }
.memory-theme-swatch.dark { background: #201b14; }
.memory-theme-swatch.green { background: #c7edcc; }
.memory-theme-swatch.nord { background: #eceff4; }
.memory-theme-swatch.dracula { background: #282a36; }
.memory-font-setting { display: grid; gap: 8px; }
.memory-font-setting > strong { font-size: var(--font-base); }
.memory-font-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.memory-font-options button { min-width: 0; min-height: 38px; padding: 6px 4px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); font: inherit; cursor: pointer; }
.memory-font-options button.active { border-color: var(--olive); background: var(--olive-pale); }
</style>
