<script setup lang="ts">
/**
 * SettingsPanel — 设置面板
 * 改动: 隐藏API地址(自动填), 删除退出登录, 新增充值/邀请/签到/大字,
 *       新增白色主题, API自动适配
 */
import { computed, ref, onMounted, watch } from 'vue'
import { useTheme } from '@/composables/useTheme'
import { useLocale } from '@/i18n'
import { safeFetch, openExternal } from '@/utils/httpClient'
import { useAgentStore } from '@/stores/agentStore'
import { useFileStore } from '@/composables/useFileStore'
import { useSessionStore } from '@/stores/sessionStore'
import { emitEvent } from '@/utils/eventBus'
import { getItem } from '@/utils/idb'
import {
  getErrorMessage,
  importBackupPackage,
  parseBackupPackage,
  summarizeBackupPackage,
  type MigrationImportSummary,
} from '@/utils/webDataMigration'
import {
  DEFAULT_PROVIDER_ID,
  DEFAULT_PROVIDER_HOST,
  getLocalOllamaModels,
  resolveWebApiBaseUrl,
  rotateProviderKey,
  resolveDefaultProviderFromStorage,
  saveProvidersToStorage,
} from '@/utils/providerConfig'
import { buildProviderNetworkErrorMessage } from '@/utils/api'
import { runAndCacheProviderCapabilityProbe, type ProviderCapabilityProbe } from '@/utils/providerCapabilityProbe'
import { connectLocalOllama } from '@/utils/localOllamaRuntime'
import { gatewayLogin, getApiKey, initApiKey, setApiKey, clearApiKey, apiKeyReady } from '@/services/newApiClient'
import { isTauriRuntime } from '@/utils/tauriEnv'
import JcCloudLoginBox from '@/components/auth/JcCloudLoginBox.vue'
import type { JcCloudLoginPayload, JcCloudLoginResult } from '@/components/auth/jcCloudAuth'
import { useUpdater } from '@/composables/useUpdater'

const { t: tr } = useLocale()

const { theme } = useTheme()
const agentStore = useAgentStore()
const fileStore = useFileStore()
const sessionStore = useSessionStore()

const apiKey = ref('')
const saved = ref(false)
const communityQrUrl = `${import.meta.env.BASE_URL}community-qr.jpg`
const importInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const importStatus = ref('')
const importSummary = ref<MigrationImportSummary | null>(null)
const localModelStatus = ref('')
const localModelBusy = ref(false)
const installedLocalModelCount = ref(0)
const providerProbeBusy = ref(false)
const providerProbe = ref<ProviderCapabilityProbe | null>(null)
const gatewayLoggedIn = ref(false)
const advancedApiKeyOpen = ref(false)
// OpenCode 交互偏好 — 从 localStorage 读取，toggle 时双向同步
const shellToolPartsExpanded = ref(readBoolPref('jcOpenCodeShellToolPartsExpanded'))
const editToolPartsExpanded = ref(readBoolPrefWithDefault('jcOpenCodeEditToolPartsExpanded', true))
function readBoolPref(key: string): boolean {
  try { return localStorage.getItem(key) === 'true' } catch { return false }
}
function readBoolPrefWithDefault(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? def : v === 'true'
  } catch { return def }
}
function toggleShellExpanded() {
  shellToolPartsExpanded.value = !shellToolPartsExpanded.value
  try { localStorage.setItem('jcOpenCodeShellToolPartsExpanded', String(shellToolPartsExpanded.value)) } catch {}
}
function toggleEditExpanded() {
  editToolPartsExpanded.value = !editToolPartsExpanded.value
  try { localStorage.setItem('jcOpenCodeEditToolPartsExpanded', String(editToolPartsExpanded.value)) } catch {}
}
const isWebRuntime = computed(() => !isTauriRuntime())

// ponytail: 版本号动态读取，桌面端从 Tauri API，Web 端从 import.meta 回退
const appVersion = ref('')
const { updateAvailable, updateVersion, updateNotes, downloading, downloadProgress, checking, checkError, checkUpdate, downloadAndInstall } = useUpdater()
onMounted(async () => {
  try {
    if (!isWebRuntime.value) {
      const { getVersion } = await import('@tauri-apps/api/app')
      appVersion.value = await getVersion()
    }
  } catch { /* Tauri API 不可用 */ }
  if (!appVersion.value) {
    appVersion.value = __APP_VERSION__
  }
  // ponytail: 启动 3s 后后台检查更新，不阻塞 UI
  if (!isWebRuntime.value) {
    setTimeout(() => { checkUpdate() }, 3000)
  }
})

// API 地址固定隐藏，不暴露给用户编辑。
const API_BASE = resolveWebApiBaseUrl(DEFAULT_PROVIDER_HOST)
const IMPORT_RUNTIME_KEYS: string[] = []

/** 仅远端模型（排除本地 Ollama / MLX），用于一键抄配置 */
const remoteTextModels = computed(() =>
  agentStore.textModels.filter(m => !m.providerId || m.providerId === DEFAULT_PROVIDER_ID)
)

onMounted(async () => {
  const key = getApiKey() || await initApiKey()
  syncKeyState(key)
  // ponytail: 订阅 apiKeyReady，处理 Key 稍后到达的场景（deep link 回调等）
  watch(apiKeyReady, (val) => { if (val) syncKeyState(val) })
  // 确保 base 始终正确
  localStorage.setItem('jcApiBase', API_BASE)
  if (!isWebRuntime.value) {
    installedLocalModelCount.value = getLocalOllamaModels().length
    if (installedLocalModelCount.value > 0) {
      localModelStatus.value = `已识别 ${installedLocalModelCount.value} 个模型`
    }
  }
})

function syncKeyState(key: string) {
  apiKey.value = key
  gatewayLoggedIn.value = Boolean(key)
  advancedApiKeyOpen.value = Boolean(key)
  if (key) agentStore.fetchModels().catch(() => {})
}

const saveStatus = ref('')

async function saveSettings() {
  const key = apiKey.value.trim()
  if (!key && gatewayLoggedIn.value) {
    saveStatus.value = '✅ 已登录，可直接使用'
    saved.value = true
    setTimeout(() => { saveStatus.value = ''; saved.value = false }, 3000)
    return
  }
  if (!key) { saveStatus.value = '❌ 请填写 API Key'; return }

  await setApiKey(key)
  localStorage.setItem('jcApiBase', API_BASE)
  const provider = resolveDefaultProviderFromStorage()
  provider.apiKey = ''
  saveProvidersToStorage([provider])
  saveStatus.value = '🔄 验证中...'

  try {
    const rotatedKey = rotateProviderKey(DEFAULT_PROVIDER_ID, key)
    const resp = await safeFetch(`${API_BASE}/v1/models`, {
      headers: { 'Authorization': `Bearer ${rotatedKey}` },
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    await agentStore.fetchModels()
    providerProbeBusy.value = true
    providerProbe.value = await runAndCacheProviderCapabilityProbe({
      providerId: DEFAULT_PROVIDER_ID,
      apiHost: API_BASE,
      apiKey: rotatedKey,
      testModel: localStorage.getItem('jcModel') || 'gpt-5.5',
      timeoutMs: 8000,
    })
    const count = agentStore.availableModels.length || data?.data?.length || 0
    saveStatus.value = buildProbeStatus(providerProbe.value, count)
    saved.value = true
  } catch (e: any) {
    saveStatus.value = `❌ 连接失败: ${buildProviderNetworkErrorMessage(e)}`
  } finally {
    providerProbeBusy.value = false
  }
  setTimeout(() => { saveStatus.value = ''; saved.value = false }, 5000)
}

function buildProbeStatus(probe: ProviderCapabilityProbe | null, modelCount: number): string {
  if (!probe) return `✅ 连接成功，识别出 ${modelCount} 个模型`
  const parts = [
    probe.supportsModelsEndpoint ? `模型 ${probe.modelCount || modelCount}` : '模型异常',
    probe.supportsChatCompletionsStream ? '流式对话可用' : '流式对话异常',
    probe.supportsResponses ? 'Responses 可用' : 'Responses 未启用',
  ]
  const prefix = probe.supportsModelsEndpoint && probe.supportsChatCompletionsStream ? '✅' : '⚠️'
  return `${prefix} 诊断完成：${parts.join(' · ')}`
}

async function loginWithGateway(payload: JcCloudLoginPayload): Promise<JcCloudLoginResult> {
  const result = await gatewayLogin({
    username: payload.username,
    password: payload.password,
  })
  return {
    apiKey: result.apiKey,
    user: result.user,
    baseUrl: result.baseUrl,
    raw: result,
  }
}

async function handleCloudLoginSuccess(result: JcCloudLoginResult, rememberMe: boolean) {
  apiKey.value = result.apiKey
  gatewayLoggedIn.value = true
  if (rememberMe) {
    // gatewayLogin 已经写入了 Keychain，这里幂等再写一次无害
    await setApiKey(result.apiKey)
  } else {
    // ponytail: gatewayLogin 无条件写入了 Keychain，不保持登录时撤销
    await clearApiKey()
  }
  await agentStore.fetchModels().catch(() => {})
  saveStatus.value = rememberMe ? '✅ 已登录，重启后自动保持' : '✅ 已登录（本次会话有效）'
  setTimeout(() => { saveStatus.value = '' }, 5000)
}

function downloadApp() { openExternal('https://api.jiucaihezi.studio/download/') }
function goWallet() { openExternal('https://api.jiucaihezi.studio/wallet') }
function goInvite() { openExternal('https://api.jiucaihezi.studio/wallet') }
function goSignin() { openExternal('https://api.jiucaihezi.studio/profile') }
function goUsageLogs() { openExternal('https://api.jiucaihezi.studio/usage-logs/common') }
async function connectOllama() {
  if (localModelBusy.value) return
  localModelBusy.value = true
  localModelStatus.value = '正在连接 Ollama...'
  try {
    const result = await connectLocalOllama()
    installedLocalModelCount.value = result.models.length
    agentStore.refreshLocalModels()
    localModelStatus.value = result.message
  } catch (err) {
    localModelStatus.value = `未连接到 Ollama。请先安装并启动 Ollama，然后再点连接。`
    console.warn('[Ollama] 连接失败:', err)
  } finally {
    localModelBusy.value = false
  }
}

function downloadOllama() {
  openExternal('https://ollama.com/download/mac')
}

function triggerImport() {
  if (importing.value) return
  importStatus.value = ''
  importSummary.value = null
  if (importInput.value) importInput.value.value = ''
  importInput.value?.click()
}

async function syncImportedRuntimeState() {
  for (const key of IMPORT_RUNTIME_KEYS) {
    const value = await getItem(key)
    if (value == null) continue
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  }

  localStorage.setItem('jcApiBase', API_BASE)
  agentStore.refreshSkills()

  await Promise.all([
    sessionStore.loadAllSessions(),
    fileStore.loadAll(),
  ])
  emitEvent('refresh-file-list', { source: 'web-data-import' })
}

async function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || importing.value) return

  importing.value = true
  importStatus.value = '正在读取备份文件...'
  importSummary.value = null
  try {
    const text = await file.text()
    const pkg = parseBackupPackage(text)
    importSummary.value = summarizeBackupPackage(pkg)
    importStatus.value = '正在合并导入...'
    const result = await importBackupPackage(pkg, { mode: 'merge' })
    importSummary.value = result
    try {
      importStatus.value = '正在刷新会话和文件列表...'
      await syncImportedRuntimeState()
      importStatus.value = `导入完成：${result.conversations} 个会话、${result.documents} 个文件、${result.skills} 个 Skill。1秒后自动刷新页面...`
      setTimeout(() => { window.location.reload() }, 1000)
    } catch (refreshErr) {
      importStatus.value = `导入完成，但列表刷新失败：${getErrorMessage(refreshErr)}。请点击会话栏刷新按钮。`
      emitEvent('show-history-list', { source: 'web-data-import-refresh-failed' })
    }
  } catch (err) {
    importStatus.value = `导入失败：${getErrorMessage(err)}`
  } finally {
    importing.value = false
    input.value = ''
  }
}

// 主题选项
const themeOptions = [
  { key: 'white', label: '⬜ 白色' },
  { key: 'light', label: '☀ 浅色' },
  { key: 'dark',  label: '🌙 黑夜' },
  { key: 'green', label: '🍃 护眼' },
]
</script>

<template>
  <div class="sp">
    <div class="sp-header">
      <JcIcon name="settings" style="font-size: 20px; color: var(--olive);" />
      <h3>设置</h3>
    </div>

    <div class="sp-body">
      <!-- API Key -->
      <div class="sp-section">
        <JcCloudLoginBox
          v-model:api-key="apiKey"
          v-model:advanced-open="advancedApiKeyOpen"
          :logged-in="gatewayLoggedIn"
          :busy="providerProbeBusy"
          :saved="saved"
          :status="saveStatus"
          :model="agentStore.currentModel"
          :chat-models="remoteTextModels"
          :login="loginWithGateway"
          :open-url="openExternal"
          @login-success="handleCloudLoginSuccess"
          @save-key="saveSettings"
        />
      </div>

      <!-- 本地模型 -->
      <div v-if="!isWebRuntime" class="sp-section">
        <div class="sp-section-title">{{ tr('settings.localModel') }}</div>
        <div class="sp-local-card">
          <div class="sp-local-top">
            <div class="sp-local-icon">
              <JcIcon name="offline_bolt" />
            </div>
            <div class="sp-local-main">
              <div class="sp-local-title">Ollama 本地模型</div>
            </div>
          </div>

          <div class="sp-local-meta">
            <div>
              <span>当前状态</span>
              <strong>{{ installedLocalModelCount > 0 ? `已识别 ${installedLocalModelCount} 个模型` : '未连接' }}</strong>
            </div>
          </div>

          <div v-if="localModelStatus" class="sp-local-status">{{ localModelStatus }}</div>
          <div class="sp-local-actions">
            <button class="sp-local-primary compact" :disabled="localModelBusy" @click="connectOllama">
              <JcIcon :name="localModelBusy ? 'hourglass_top' : 'sync'" />
              {{ localModelBusy ? '连接中' : '连接 Ollama' }}
            </button>
            <button class="sp-local-secondary" @click="downloadOllama">
              <JcIcon name="download" />
              下载安装 Ollama
            </button>
          </div>
        </div>
      </div>

      <!-- 外观 -->
      <div class="sp-section">
        <div class="sp-section-title">{{ tr('settings.appearance') }}</div>
        <div class="sp-theme-chips">
          <button v-for="t in themeOptions" :key="t.key" class="sp-chip"
                  :class="{ active: theme === t.key }"
                  @click="theme = t.key as any">
            {{ t.label }}
          </button>
        </div>
      </div>

      <!-- 数据迁移 -->
      <div v-if="isWebRuntime" class="sp-section">
        <div class="sp-section-title">{{ tr('settings.dataMigration') }}</div>
        <div class="sp-import-card">
          <button class="sp-import-btn" :disabled="importing" @click="triggerImport">
            <JcIcon :name="importing ? 'hourglass_top' : 'upload_file'" />
            {{ importing ? '正在导入' : '导入网页版备份' }}
          </button>
          <div class="sp-import-note">只迁移会话、文件和 Skill，不包含 API Key。</div>
          <input
            ref="importInput"
            class="sp-file-input"
            type="file"
            accept=".jcbackup,.json,application/json"
            @change="handleImportFile"
          />
          <div v-if="importSummary" class="sp-import-summary">
            会话 {{ importSummary.conversations }} · 文件 {{ importSummary.documents }} · Skill {{ importSummary.skills }}
          </div>
          <div v-if="importStatus" class="sp-import-status" :class="{ err: importStatus.startsWith('导入失败') }">
            {{ importStatus }}
          </div>
        </div>
      </div>

      <!-- OpenCode 交互 -->
      <div v-if="!isWebRuntime" class="sp-section">
        <div class="sp-section-title">{{ tr('settings.aiPrefs') }}</div>
        <div class="sp-runtime-card">
          <div class="sp-toggle-row">
            <span class="sp-toggle-label">终端命令结果自动展开</span>
            <button
              type="button"
              class="sp-toggle"
              :class="{ active: shellToolPartsExpanded }"
              @click="toggleShellExpanded()"
            >
              <span class="sp-toggle-knob" />
            </button>
          </div>
          <div class="sp-toggle-row">
            <span class="sp-toggle-label">文件修改内容自动展开</span>
            <button
              type="button"
              class="sp-toggle"
              :class="{ active: editToolPartsExpanded }"
              @click="toggleEditExpanded()"
            >
              <span class="sp-toggle-knob" />
            </button>
          </div>
          <div class="sp-runtime-note">AI 执行命令或修改文件后，结果卡片默认展开还是收起。可随时手动切换。</div>
        </div>
      </div>
      <div class="sp-section">
        <div class="sp-section-title">{{ tr('settings.community') }}</div>
        <div class="sp-community-card">
          <img class="sp-community-qr" :src="communityQrUrl" alt="韭菜盒子交流群二维码" />
          <div class="sp-community-text">欢迎加群互相学习交流</div>
        </div>
      </div>

      <!-- 版本 -->
      <div class="sp-version">
        韭菜盒子 v{{ appVersion || '...' }} · {{ isWebRuntime ? '网页版' : '桌面版' }}
        <template v-if="updateAvailable">
          <br />
          <span class="sp-update-available">🟢 v{{ updateVersion }} 可用</span>
          <button v-if="!downloading" class="sp-update-btn" @click="downloadAndInstall()">立即更新</button>
          <span v-else class="sp-update-progress">下载中 {{ downloadProgress }}%</span>
        </template>
        <br />
        <button v-if="!updateAvailable" class="sp-update-check" :disabled="checking" @click="checkUpdate()">
          {{ checking ? '检查中...' : '检查更新' }}
        </button>
        <span v-if="checkError && !updateAvailable" class="sp-update-status">{{ checkError }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sp { display: flex; flex-direction: column; height: 100%; background: var(--surface); width: 100%; }
.sp-header {
  min-height: 48px; display: flex; align-items: center; gap: 10px;
  padding: 0 16px; border-bottom: 1px solid var(--border2); background: var(--surface-alt); flex-shrink: 0;
}
.sp-header h3 { font-size: 14px; font-weight: 700; color: var(--ink); margin: 0; }
.sp-body { flex: 1; overflow-y: auto; padding: 20px 16px 60px; }
.sp-section { margin-bottom: 28px; }
.sp-section-title { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink3); margin-bottom: 12px; }
.sp-label { display: block; font-size: 12px; font-weight: 600; color: var(--ink2); margin-bottom: 6px; }
.sp-input {
  width: 100%; padding: 9px 12px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface-alt); font-size: 13px; font-family: inherit; color: var(--ink);
  outline: none; transition: border-color 0.15s; box-sizing: border-box;
}
.sp-input:focus { border-color: var(--olive); }
.sp-key-row { display: flex; gap: 6px; align-items: center; }
.sp-key-row .sp-input { flex: 1; }
.sp-icon-btn {
  width: 36px; height: 36px; border: 1px solid var(--border); background: var(--surface-alt);
  border-radius: 10px; color: var(--ink3); cursor: pointer;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.sp-icon-btn:hover { color: var(--olive-dark); border-color: var(--olive); }
.sp-api-actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
}
.sp-link {
  display: inline-flex; align-items: center; gap: 4px;
  justify-content: center;
  min-width: 0;
  min-height: 30px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-alt);
  font-size: 11px; font-weight: 700;
  color: var(--olive-dark); cursor: pointer; font-family: inherit; padding: 5px 4px;
  white-space: nowrap;
}
.sp-link:hover { border-color: var(--olive); background: var(--olive-pale); }
.sp-link-primary { background: var(--olive); border-color: var(--olive); color: #fff; }
.sp-link-primary:hover { background: var(--olive-dark); color: #fff; }
.sp-link:disabled { opacity: 0.65; cursor: wait; }
.sp-link-gold { color: #d4a800; }
.sp-save-btn {
  display: flex; align-items: center; gap: 6px; margin-top: 16px;
  padding: 9px 20px; border: none; border-radius: 10px;
  background: var(--olive); color: #fff; font-size: 13px; font-weight: 700;
  cursor: pointer; font-family: inherit; transition: transform 0.1s;
}
.sp-save-btn:hover { transform: scale(1.03); }
.sp-save-btn:disabled { opacity: 0.65; cursor: progress; transform: none; }
.sp-theme-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.sp-chip {
  flex: 1; min-width: 60px; padding: 8px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--surface-alt); color: var(--ink2); font-size: 12px; font-weight: 600;
  cursor: pointer; font-family: inherit; text-align: center; transition: all 0.15s;
}
.sp-chip:hover { background: var(--olive-pale); color: var(--olive-dark); }
.sp-chip.active { background: rgba(213, 199, 135, 0.18); border-color: var(--olive); color: var(--olive-dark); }
.sp-import-card {
  display: flex; flex-direction: column; gap: 8px;
}
.sp-import-btn {
  width: 100%; min-height: 38px; display: flex; align-items: center; justify-content: center; gap: 8px;
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--surface-alt); color: var(--ink); font-size: 13px; font-weight: 700;
  cursor: pointer; font-family: inherit;
}
.sp-import-btn:hover:not(:disabled) { border-color: var(--olive); background: var(--olive-pale); color: var(--olive-dark); }
.sp-import-btn:disabled { opacity: 0.65; cursor: wait; }
.sp-import-note {
  font-size: 12px; color: var(--ink3); line-height: 1.45;
}
.sp-file-input { display: none; }
.sp-import-summary {
  font-size: 12px; color: var(--ink2); line-height: 1.55;
}
.sp-import-status {
  padding: 8px 10px; border-radius: 8px;
  background: #e8f5e9; color: #2e7d32;
  font-size: 12px; font-weight: 700; line-height: 1.45;
}
.sp-import-status.err { background: #ffebee; color: #c62828; }
.sp-runtime-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-alt);
}
.sp-runtime-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  min-height: 30px;
  padding: 8px 10px;
  border: 1px solid var(--border2);
  border-radius: 8px;
  background: var(--surface);
}
.sp-runtime-row span {
  font-size: 12px;
  color: var(--ink3);
  white-space: nowrap;
}
.sp-runtime-row strong {
  min-width: 0;
  color: var(--ink);
  font-size: 12px;
  font-weight: 800;
  text-align: right;
  overflow-wrap: anywhere;
}
.sp-runtime-btn {
  width: 100%;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  font-size: 12px;
  font-weight: 800;
  font-family: inherit;
  cursor: pointer;
}
.sp-runtime-btn:hover {
  border-color: var(--olive);
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.sp-runtime-note {
  color: var(--ink3);
  font-size: 12px;
  line-height: 1.45;
}
.sp-runtime-status {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--olive-pale);
  color: var(--ink2);
  font-size: 12px;
  font-weight: 700;
}
/* Phase C: toggle switches inside settings cards */
.sp-toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  min-height: 30px;
  padding: 8px 10px;
  border: 1px solid var(--border2);
  border-radius: 8px;
  background: var(--surface);
}
.sp-toggle-label {
  font-size: 12px;
  color: var(--ink);
}
.sp-toggle {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: none;
  background: var(--border);
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
}
.sp-toggle.active {
  background: var(--olive);
}
.sp-toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
  transition: transform 0.2s;
}
.sp-toggle.active .sp-toggle-knob {
  transform: translateX(18px);
}
.sp-community-card {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 16px 14px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--surface-alt); box-shadow: 0 10px 28px rgba(38, 38, 18, 0.06);
}
.sp-community-qr {
  width: min(190px, 100%); height: auto; display: block;
  padding: 8px; border: 1px solid var(--border2); border-radius: 8px;
  background: #fff;
}
.sp-community-text { font-size: 13px; font-weight: 700; color: var(--ink); text-align: center; }
.sp-version { text-align: center; font-size: 11px; color: var(--ink3); padding: 24px 0; letter-spacing: 0.03em; }
.sp-update-available { color: var(--olive-dark); font-weight: 600; font-size: 12px; }
.sp-update-btn { margin: 6px 0 0; padding: 5px 16px; border: none; border-radius: 6px; background: var(--olive); color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; }
.sp-update-btn:hover { background: var(--olive-dark); }
.sp-update-progress { color: var(--ink2); font-size: 12px; }
.sp-update-check { margin-top: 6px; border: none; background: transparent; color: var(--ink3); font-size: 11px; cursor: pointer; text-decoration: underline; }
.sp-update-check:disabled { opacity: 0.5; cursor: default; }
.sp-update-status { display: inline-block; margin-left: 8px; color: var(--ink3); font-size: 11px; }
.sp-status {
  margin-top: 8px; padding: 8px 12px; border-radius: 8px;
  font-size: 12px; font-weight: 600; text-align: center;
  background: var(--olive-pale); color: var(--ink2);
}
.sp-status.ok { background: #e8f5e9; color: #2e7d32; }
.sp-status.err { background: #ffebee; color: #c62828; }
.sp-login-state {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  min-height: 38px; padding: 9px 10px; margin-top: 10px;
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--surface-alt); color: var(--ink);
}
.sp-login-state strong { font-size: 13px; font-weight: 800; }
.sp-inline-link {
  border: none; background: transparent; color: var(--olive-dark);
  font-size: 12px; font-weight: 800; cursor: pointer; font-family: inherit;
}
.sp-inline-link.subtle { margin-top: 6px; padding: 0; color: var(--ink3); }
.sp-login-overlay {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.28);
}
.sp-login-dialog {
  width: min(320px, calc(100vw - 32px));
  display: flex; flex-direction: column; gap: 10px;
  padding: 16px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--surface); box-shadow: 0 18px 48px rgba(0,0,0,.22);
}
.sp-login-title { font-size: 14px; font-weight: 900; color: var(--ink); }
.sp-login-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
.sp-local-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-alt);
}
.sp-local-top {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.sp-local-icon {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  border-radius: 8px;
  background: rgba(213, 199, 135, 0.18);
  color: var(--olive-dark);
}
.sp-local-title {
  font-size: 14px;
  font-weight: 800;
  color: var(--ink);
  line-height: 1.2;
}
.sp-local-desc,
.sp-local-note {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink3);
}
.sp-local-meta {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}
.sp-local-meta div,
.sp-local-preview {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  min-height: 32px;
  padding: 8px 10px;
  border: 1px solid var(--border2);
  border-radius: 8px;
  background: var(--surface);
}
.sp-local-meta span,
.sp-local-preview span {
  font-size: 12px;
  color: var(--ink3);
  flex: 0 0 auto;
}
.sp-local-meta strong,
.sp-local-preview strong {
  min-width: 0;
  color: var(--ink);
  font-size: 12px;
  font-weight: 800;
  text-align: right;
  overflow-wrap: anywhere;
}
.sp-local-primary {
  width: 100%;
  min-height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  border-radius: 8px;
  background: var(--olive);
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  font-family: inherit;
  cursor: pointer;
}
.sp-local-primary.compact {
  width: auto;
  min-width: 84px;
  min-height: 34px;
  padding: 0 12px;
  font-size: 12px;
}
.sp-local-primary:hover { filter: brightness(0.96); }
.sp-local-primary:disabled { opacity: 0.65; cursor: wait; }
.sp-local-model-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sp-local-model-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 11px;
  border: 1px solid var(--border2);
  border-radius: 8px;
  background: var(--surface);
}
.sp-local-model-item.installed {
  border-color: rgba(213, 199, 135, 0.75);
}
.sp-local-model-item.active {
  box-shadow: 0 0 0 2px rgba(213, 199, 135, 0.22);
}
.sp-local-model-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: flex-start;
}
.sp-local-model-name {
  color: var(--ink);
  font-size: 13px;
  font-weight: 900;
  line-height: 1.3;
}
.sp-local-model-desc {
  margin-top: 3px;
  color: var(--ink3);
  font-size: 12px;
  line-height: 1.45;
}
.sp-local-model-state {
  flex: 0 0 auto;
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--olive-pale);
  color: var(--olive-dark);
  font-size: 11px;
  font-weight: 800;
  white-space: nowrap;
}
.sp-local-model-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.sp-local-progress {
  display: grid;
  gap: 5px;
}
.sp-local-progress-track {
  height: 7px;
  border-radius: 999px;
  background: var(--surface2);
  border: 1px solid var(--border2);
  overflow: hidden;
}
.sp-local-progress-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--olive);
  transition: width 180ms ease;
}
.sp-local-progress-text {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  color: var(--ink3);
  font-size: 11px;
  font-weight: 800;
}
.sp-local-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.sp-local-waiting {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  color: var(--ink3);
  font-size: 12px;
  font-weight: 800;
}
.sp-local-toggle {
  width: 100%;
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  font-size: 12px;
  font-weight: 800;
  font-family: inherit;
  cursor: pointer;
}
.sp-local-toggle.on {
  border-color: rgba(213, 199, 135, 0.85);
  background: rgba(213, 199, 135, 0.18);
  color: var(--olive-dark);
}
.sp-local-secondary {
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--ink);
  font-size: 12px;
  font-weight: 800;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.sp-local-secondary:hover {
  border-color: var(--olive);
  background: var(--olive-pale);
  color: var(--olive-dark);
}
.sp-local-secondary.danger {
  color: var(--jc-error);
}
.sp-local-secondary.full {
  width: 100%;
}
.sp-local-status {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--olive-pale);
  color: var(--ink2);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.5;
}

</style>
