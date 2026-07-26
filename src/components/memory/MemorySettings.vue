<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import JcCloudLoginBox from '@/components/auth/JcCloudLoginBox.vue'
import type { JcCloudLoginPayload, JcCloudLoginResult } from '@/components/auth/jcCloudAuth'
import WebSkillPanel from '@/components/skills/WebSkillPanel.vue'
import McpManagerPanel from '@/components/mcp/McpManagerPanel.vue'
import { useAgentStore } from '@/stores/agentStore'
import { useTheme } from '@/composables/useTheme'
import { connectLocalOllama } from '@/utils/localOllamaRuntime'
import { getLocalOllamaModels } from '@/utils/providerConfig'
import { openExternal } from '@/utils/httpClient'
import { isTauriRuntime } from '@/utils/tauriEnv'
import {
  gatewayLogin,
  getApiKey,
  initApiKey,
  setApiKey,
  getGatewaySessionToken,
} from '@/services/newApiClient'
import { projectTextSync, projectTextSyncStatus } from '@/services/projectTextSync'
import type { SyncProject } from '@/services/textSyncClient'

const props = defineProps<{ owner?: string; projectName?: string }>()
const emit = defineEmits<{ (event: 'synced'): void }>()

type SettingsTab = 'account' | 'sync' | 'skills' | 'mcp' | 'theme'

const tab = ref<SettingsTab>('account')
const apiKey = ref('')
const status = ref('')
const saved = ref(false)
const advancedOpen = ref(false)
const desktopRuntime = isTauriRuntime()
const localModelBusy = ref(false)
const localModelStatus = ref('')
const installedLocalModelCount = ref(0)
const syncBusy = ref(false)
const syncError = ref('')
const cloudProjects = ref<SyncProject[]>([])
const selectedCloudProjectId = ref('')
const agentStore = useAgentStore()
const { theme } = useTheme()
const textModels = computed(() => agentStore.textModels.map(model => ({ id: model.id, label: model.label })))
const themeOptions = [
  { key: 'white', label: '白色' },
  { key: 'light', label: '浅色' },
  { key: 'dark', label: '黑夜' },
  { key: 'green', label: '护眼' },
] as const
const fontSizes = [
  { value: 14, label: '标准' },
  { value: 16, label: '大字' },
  { value: 18, label: '特大' },
] as const
const fontSize = ref(Number(localStorage.getItem('jcFontSize')) || 14)

function setFontSize(value: number) {
  fontSize.value = value
  localStorage.setItem('jcFontSize', String(value))
  document.documentElement.style.setProperty('--font-base', `${value}px`)
}

onMounted(async () => {
  if (desktopRuntime) installedLocalModelCount.value = getLocalOllamaModels().length
  apiKey.value = getApiKey() || await initApiKey()
  if (apiKey.value) await agentStore.fetchModels({ skipOpenCode: true }).catch(() => {})
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

async function login(payload: JcCloudLoginPayload): Promise<JcCloudLoginResult> {
  const result = await gatewayLogin({ username: payload.username, password: payload.password })
  return { apiKey: result.apiKey, user: result.user, baseUrl: result.baseUrl, raw: result }
}

async function handleLogin(result: JcCloudLoginResult) {
  apiKey.value = result.apiKey
  await setApiKey(result.apiKey)
  await agentStore.fetchModels({ skipOpenCode: true }).catch(() => {})
  status.value = '已登录'
  if (tab.value === 'sync') await refreshCloudProjects()
}

async function saveKey() {
  const key = apiKey.value.trim()
  if (!key) {
    status.value = '请填写 API Key'
    return
  }
  await setApiKey(key)
  await agentStore.fetchModels({ skipOpenCode: true }).catch(() => {})
  saved.value = true
  status.value = '已保存'
}

async function showSync() {
  tab.value = 'sync'
  await refreshCloudProjects()
}

async function refreshCloudProjects() {
  syncError.value = ''
  if (!getGatewaySessionToken()) return
  try {
    cloudProjects.value = await projectTextSync.listCloudProjects()
    selectedCloudProjectId.value ||= cloudProjects.value[0]?.id || ''
  } catch (error) {
    syncError.value = error instanceof Error ? error.message : String(error)
  }
}

async function runSync(action: 'enable' | 'connect' | 'sync') {
  if (syncBusy.value || !props.owner) return
  syncBusy.value = true
  syncError.value = ''
  try {
    if (action === 'enable') await projectTextSync.enable()
    else if (action === 'connect') await projectTextSync.connect(selectedCloudProjectId.value)
    else await projectTextSync.syncNow()
    await refreshCloudProjects()
    emit('synced')
  } catch (error) {
    syncError.value = error instanceof Error ? error.message : String(error)
  } finally {
    syncBusy.value = false
  }
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
      <button :class="{ active: tab === 'skills' }" @click="tab = 'skills'">
        <JcIcon name="extension" />Skill
      </button>
      <button :class="{ active: tab === 'mcp' }" @click="tab = 'mcp'">
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
          :logged-in="Boolean(apiKey)"
          :saved="saved"
          :status="status"
          :model="agentStore.currentModel"
          :chat-models="textModels"
          :login="login"
          @login-success="handleLogin"
          @save-key="saveKey"
        />
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
      </div>
      <div v-else-if="tab === 'sync'" class="memory-sync">
        <template v-if="!getGatewaySessionToken()">
          <p>请先在“账号”中登录。手动填写 API Key 不能识别同步账号。</p>
          <button @click="tab = 'account'">前往登录</button>
        </template>
        <template v-else-if="!owner">
          <p>请先在左侧选择一个本地项目。</p>
        </template>
        <template v-else-if="projectTextSyncStatus.cloudProjectId">
          <div class="memory-sync-summary">
            <strong>{{ projectName || '当前项目' }}</strong>
            <span>{{ projectTextSyncStatus.message || '已连接云项目' }}</span>
            <span v-if="projectTextSyncStatus.pending">待同步 {{ projectTextSyncStatus.pending }} 项</span>
          </div>
          <button :disabled="syncBusy" @click="runSync('sync')">{{ syncBusy ? '同步中' : '立即同步' }}</button>
        </template>
        <template v-else>
          <p>把当前项目作为新的云端文字项目，或者连接同账号下已有项目。</p>
          <button :disabled="syncBusy" @click="runSync('enable')">同步当前项目</button>
          <div v-if="cloudProjects.length" class="memory-sync-connect">
            <select v-model="selectedCloudProjectId" aria-label="已有云项目">
              <option v-for="project in cloudProjects" :key="project.id" :value="project.id">{{ project.name }}</option>
            </select>
            <button :disabled="syncBusy || !selectedCloudProjectId" @click="runSync('connect')">连接</button>
          </div>
          <p v-else>当前账号还没有其他云项目。</p>
        </template>
        <p v-if="syncError" class="memory-sync-error">{{ syncError }}</p>
      </div>
      <WebSkillPanel v-else-if="tab === 'skills'" />
      <McpManagerPanel v-else-if="tab === 'mcp'" />
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
  </div>
</template>

<style scoped>
.memory-settings { display: flex; height: 100%; min-height: 0; flex-direction: column; }
.memory-settings-tabs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; padding: 10px; border-bottom: 1px solid var(--line); }
.memory-settings-tabs button { display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 0; height: 36px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--ink2); cursor: pointer; }
.memory-settings-tabs button.active { border-color: var(--line); background: var(--surface); color: var(--ink1); }
.memory-settings-body { min-height: 0; flex: 1; overflow: auto; padding: 12px; }
.memory-account { display: grid; gap: 16px; }
.memory-local-model { display: grid; gap: 10px; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.memory-local-model > div:first-child { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.memory-local-model span, .memory-local-model p { margin: 0; color: var(--ink3); font-size: 12px; }
.memory-local-actions { display: flex; gap: 8px; }
.memory-local-actions button { min-height: 34px; padding: 0 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); font: inherit; cursor: pointer; }
.memory-local-actions button:disabled { opacity: .55; cursor: progress; }
.memory-sync { display: grid; gap: 12px; }
.memory-sync p { margin: 0; color: var(--ink3); line-height: 1.6; }
.memory-sync > button, .memory-sync-connect button { min-height: 36px; padding: 0 12px; border: 1px solid var(--olive); border-radius: 6px; background: var(--olive); color: white; cursor: pointer; font: inherit; }
.memory-sync button:disabled { opacity: .5; cursor: progress; }
.memory-sync-summary { display: grid; gap: 4px; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.memory-sync-summary span { color: var(--ink3); font-size: 12px; }
.memory-sync-connect { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.memory-sync-connect select { min-width: 0; height: 36px; padding: 0 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); font: inherit; }
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
.memory-font-setting { display: grid; gap: 8px; }
.memory-font-setting > strong { font-size: var(--font-base); }
.memory-font-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.memory-font-options button { min-width: 0; min-height: 38px; padding: 6px 4px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--ink1); font: inherit; cursor: pointer; }
.memory-font-options button.active { border-color: var(--olive); background: var(--olive-pale); }
</style>
