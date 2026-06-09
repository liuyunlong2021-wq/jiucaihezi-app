<script setup lang="ts">
/**
 * SettingsPanel — 设置面板
 * 改动: 隐藏API地址(自动填), 删除退出登录, 新增充值/邀请/签到/大字,
 *       新增白色主题, API自动适配
 */
import { ref, onMounted } from 'vue'
import { useTheme } from '@/composables/useTheme'
import { safeFetch, openExternal } from '@/utils/httpClient'
import { useAgentStore } from '@/stores/agentStore'
import { useFileStore } from '@/composables/useFileStore'
import { useSessionStore } from '@/stores/sessionStore'
import { useVaultStore } from '@/stores/vaultStore'
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
  rotateProviderKey,
  resolveDefaultProviderFromStorage,
  saveProvidersToStorage,
} from '@/utils/providerConfig'
import { buildProviderNetworkErrorMessage } from '@/utils/api'
import { runAndCacheProviderCapabilityProbe, type ProviderCapabilityProbe } from '@/utils/providerCapabilityProbe'
import { connectLocalOllama } from '@/utils/localOllamaRuntime'
import { gatewayLogin, getApiKey, initApiKey, setApiKey } from '@/services/newApiClient'
import McpSettings from './McpSettings.vue'

const { theme } = useTheme()
const agentStore = useAgentStore()
const fileStore = useFileStore()
const sessionStore = useSessionStore()
const vaultStore = useVaultStore()

const apiKey = ref('')
const showKey = ref(false)
const saved = ref(false)
const bigFont = ref(false)
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
const oneClickLoginBusy = ref(false)
const loginDialogOpen = ref(false)
const loginUsername = ref('')
const loginPassword = ref('')
const gatewayLoggedIn = ref(false)
const advancedApiKeyOpen = ref(false)

// API 地址固定隐藏，不暴露给用户编辑。
const API_BASE = DEFAULT_PROVIDER_HOST
const IMPORT_RUNTIME_KEYS = [
  'jc_vaults_v1',
]

onMounted(async () => {
  apiKey.value = getApiKey() || await initApiKey()
  gatewayLoggedIn.value = Boolean(apiKey.value)
  advancedApiKeyOpen.value = Boolean(apiKey.value)
  // 确保 base 始终正确
  localStorage.setItem('jcApiBase', API_BASE)
  // 大字模式
  bigFont.value = localStorage.getItem('jc_bigfont') === 'true'
  applyBigFont()
  installedLocalModelCount.value = getLocalOllamaModels().length
  if (installedLocalModelCount.value > 0) {
    localModelStatus.value = `已识别 ${installedLocalModelCount.value} 个模型`
  }
})

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

function getKeyLink() { openExternal('https://api.jiucaihezi.studio/keys') }
async function oneClickLogin() {
  if (oneClickLoginBusy.value) return
  loginDialogOpen.value = true
}

async function handleGatewayLogin() {
  oneClickLoginBusy.value = true
  saveStatus.value = '正在登录...'
  try {
    const result = await gatewayLogin({ username: loginUsername.value.trim(), password: loginPassword.value })
    apiKey.value = result.apiKey
    gatewayLoggedIn.value = true
    loginDialogOpen.value = false
    loginPassword.value = ''
    await agentStore.fetchModels().catch(() => {})
    saveStatus.value = '✅ 已登录，可直接使用'
    setTimeout(() => { saveStatus.value = '' }, 5000)
  } catch (err: any) {
    saveStatus.value = `❌ 登录失败: ${err?.message || '账号或密码不正确'}`
  } finally {
    oneClickLoginBusy.value = false
  }
}

function downloadApp() { openExternal('https://api.jiucaihezi.studio/') }
function openRegisterPage() { openExternal('https://api.jiucaihezi.studio/sign-up') }
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

function toggleBigFont() {
  bigFont.value = !bigFont.value
  localStorage.setItem('jc_bigfont', String(bigFont.value))
  applyBigFont()
}

function applyBigFont() {
  document.documentElement.style.fontSize = bigFont.value ? '17px' : '14px'
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
    vaultStore.loadAll(),
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
      importStatus.value = '正在刷新会话和知识库列表...'
      await syncImportedRuntimeState()
      importStatus.value = `导入完成：${result.conversations} 个会话、${result.documents} 个知识文件、${result.vaults} 个知识库。1秒后自动刷新页面...`
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
      <span class="mso" style="font-size: 20px; color: var(--olive);">settings</span>
      <h3>设置</h3>
    </div>

    <div class="sp-body">
      <!-- API Key -->
      <div class="sp-section">
        <div class="sp-section-title">API 配置</div>

        <div class="sp-api-actions primary">
          <button class="sp-link sp-link-primary" :disabled="oneClickLoginBusy" @click="oneClickLogin">
            <span class="mso" style="font-size: 14px;">login</span> {{ gatewayLoggedIn ? '已登录' : '一键登录' }}
          </button>
          <button class="sp-link" @click="downloadApp">
            <span class="mso" style="font-size: 14px;">download</span> 下载APP
          </button>
          <button class="sp-link sp-link-gold" @click="goWallet">
            <span class="mso" style="font-size: 14px;">account_balance_wallet</span> 充值
          </button>
          <button class="sp-link" @click="goUsageLogs">
            <span class="mso" style="font-size: 14px;">receipt_long</span> 使用日志
          </button>
        </div>

        <div v-if="gatewayLoggedIn && !advancedApiKeyOpen && !apiKey" class="sp-login-state">
          <div>
            <strong>已登录，可直接使用</strong>
          </div>
          <button class="sp-inline-link" @click="advancedApiKeyOpen = true">高级：使用自己的 API Key</button>
        </div>

        <div v-else>
          <label class="sp-label">API Key</label>
          <div class="sp-key-row">
            <input v-model="apiKey" :type="showKey ? 'text' : 'password'"
                   placeholder="sk-..." class="sp-input" />
            <button class="sp-icon-btn" @click="showKey = !showKey" :title="showKey ? '隐藏' : '显示'">
              <span class="mso">{{ showKey ? 'visibility_off' : 'visibility' }}</span>
            </button>
          </div>
          <button v-if="gatewayLoggedIn && !apiKey" class="sp-inline-link subtle" @click="advancedApiKeyOpen = false">
            收起高级设置
          </button>
        </div>

        <div class="sp-api-actions secondary">
          <button class="sp-link" @click="getKeyLink">
            <span class="mso" style="font-size: 14px;">key</span> 获取 Key
          </button>
          <button class="sp-link" @click="goInvite">
            <span class="mso" style="font-size: 14px;">group_add</span> 邀请赚米
          </button>
          <button class="sp-link" @click="goSignin">
            <span class="mso" style="font-size: 14px;">event_available</span> 白嫖签到
          </button>
        </div>

        <button class="sp-save-btn" :disabled="providerProbeBusy" @click="saveSettings">
          <span class="mso" style="font-size: 16px;">{{ providerProbeBusy ? 'hourglass_top' : saved ? 'check' : 'save' }}</span>
          {{ providerProbeBusy ? '诊断中' : saved ? '已保存' : '保存设置' }}
        </button>

        <div v-if="saveStatus" class="sp-status" :class="{ ok: saveStatus.startsWith('✅'), err: saveStatus.startsWith('❌') }">
          {{ saveStatus }}
        </div>

        <div v-if="loginDialogOpen" class="sp-login-overlay" @click.self="loginDialogOpen = false">
          <div class="sp-login-dialog">
            <div class="sp-login-title">登录韭菜盒子账号</div>
            <input v-model="loginUsername" class="sp-input" autocomplete="username" placeholder="账号 / 邮箱" />
            <input v-model="loginPassword" class="sp-input" autocomplete="current-password" type="password" placeholder="密码" @keyup.enter="handleGatewayLogin" />
            <div class="sp-login-actions">
              <button class="sp-local-secondary" :disabled="oneClickLoginBusy" @click="openRegisterPage">注册账号</button>
              <button class="sp-local-secondary" :disabled="oneClickLoginBusy" @click="loginDialogOpen = false">取消</button>
              <button class="sp-local-primary compact" :disabled="oneClickLoginBusy || !loginUsername || !loginPassword" @click="handleGatewayLogin">
                {{ oneClickLoginBusy ? '登录中' : '登录' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 本地模型 -->
      <div class="sp-section">
        <div class="sp-section-title">本地模型</div>
        <div class="sp-local-card">
          <div class="sp-local-top">
            <div class="sp-local-icon">
              <span class="mso">offline_bolt</span>
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
              <span class="mso">{{ localModelBusy ? 'hourglass_top' : 'sync' }}</span>
              {{ localModelBusy ? '连接中' : '连接 Ollama' }}
            </button>
            <button class="sp-local-secondary" @click="downloadOllama">
              <span class="mso">download</span>
              下载安装 Ollama
            </button>
          </div>
        </div>
      </div>

      <!-- 外观 -->
      <div class="sp-section">
        <div class="sp-section-title">外观</div>
        <div class="sp-theme-chips">
          <button v-for="t in themeOptions" :key="t.key" class="sp-chip"
                  :class="{ active: theme === t.key }"
                  @click="theme = t.key as any">
            {{ t.label }}
          </button>
        </div>
      </div>

      <!-- 字号 -->
      <div class="sp-section">
        <div class="sp-section-title">字号</div>
        <button class="sp-bigfont-btn" :class="{ on: bigFont }" @click="toggleBigFont">
          <span class="mso">text_increase</span>
          {{ bigFont ? '大字模式 ✓' : '大字模式' }}
        </button>
      </div>

      <!-- 数据迁移 -->
      <div class="sp-section">
        <div class="sp-section-title">数据迁移</div>
        <div class="sp-import-card">
          <button class="sp-import-btn" :disabled="importing" @click="triggerImport">
            <span class="mso">{{ importing ? 'hourglass_top' : 'upload_file' }}</span>
            {{ importing ? '正在导入' : '导入网页版备份' }}
          </button>
          <div class="sp-import-note">只迁移会话、知识库和Skill，不包含 API Key。</div>
          <input
            ref="importInput"
            class="sp-file-input"
            type="file"
            accept=".jcbackup,.json,application/json"
            @change="handleImportFile"
          />
          <div v-if="importSummary" class="sp-import-summary">
            会话 {{ importSummary.conversations }} · 知识文件 {{ importSummary.documents }} · 知识库 {{ importSummary.vaults }} · Skill {{ importSummary.skills }}
          </div>
          <div v-if="importStatus" class="sp-import-status" :class="{ err: importStatus.startsWith('导入失败') }">
            {{ importStatus }}
          </div>
        </div>
      </div>

      <!-- MCP Server -->
      <div class="sp-section">
        <McpSettings />
      </div>

      <!-- 社群交流 -->
      <div class="sp-section">
        <div class="sp-section-title">社群交流</div>
        <div class="sp-community-card">
          <img class="sp-community-qr" :src="communityQrUrl" alt="韭菜盒子交流群二维码" />
          <div class="sp-community-text">欢迎加群互相学习交流</div>
        </div>
      </div>

      <!-- 版本 -->
      <div class="sp-version">
        韭菜盒子 V7.0 · 桌面版
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
.sp-bigfont-btn {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--surface-alt); color: var(--ink); font-size: 13px; font-weight: 600;
  cursor: pointer; font-family: inherit; width: 100%; transition: all 0.15s;
}
.sp-bigfont-btn:hover { border-color: var(--olive); background: var(--olive-pale); }
.sp-bigfont-btn.on { background: rgba(213, 199, 135, 0.18); border-color: var(--olive); color: var(--olive-dark); }
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
