<script setup lang="ts">
/**
 * SettingsPanel — 设置面板
 * 改动: 隐藏API地址(自动填), 删除退出登录, 新增充值/邀请/签到/大字,
 *       新增白色主题, API自动适配
 */
import { ref, onMounted } from 'vue'
import { useTheme } from '@/composables/useTheme'
import { useOpenClaw } from '@/utils/openclawBridge'
import { syncSkillsToOpenClaw } from '@/utils/openclawSync'
import { useAgentStore } from '@/stores/agentStore'

const { theme, toggle, themeIcon, themeLabel } = useTheme()
const { gateway, connect: connectGateway, disconnect: disconnectGateway, startGatewayProcess, checkGatewayHealth, saveConfig: saveOcConfig, getConfig: getOcConfig } = useOpenClaw()

const isTauri = '__TAURI__' in window

const apiKey = ref('')
const showKey = ref(false)
const saved = ref(false)
const bigFont = ref(false)

// API 地址固定，不可编辑，自动适配
const API_BASE = 'https://api.jiucaihezi.studio'

// ─── OpenClaw ───
const ocPort = ref(18789)
const ocAuth = ref('')
const ocStatus = ref('')
const ocUseLocal = ref(false)

onMounted(() => {
  apiKey.value = localStorage.getItem('jcApiKey') || ''
  // 确保 base 始终正确
  localStorage.setItem('jcApiBase', API_BASE)
  // 大字模式
  bigFont.value = localStorage.getItem('jc_bigfont') === 'true'
  applyBigFont()
  // OpenClaw 配置
  if (isTauri) {
    const cfg = getOcConfig()
    ocPort.value = cfg.port
    ocAuth.value = cfg.authToken
    ocUseLocal.value = localStorage.getItem('jcUseLocalGateway') === 'true'
  }
})

const saveStatus = ref('')

async function saveSettings() {
  const key = apiKey.value.trim()
  if (!key) { saveStatus.value = '❌ 请填写 API Key'; return }

  localStorage.setItem('jcApiKey', key)
  localStorage.setItem('jcApiBase', API_BASE)
  saveStatus.value = '🔄 验证中...'

  try {
    const resp = await fetch(`${API_BASE}/v1/models`, {
      headers: { 'Authorization': `Bearer ${key}` },
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    const count = data?.data?.length || 0
    saveStatus.value = `✅ 连接成功，识别出 ${count} 个模型`
    saved.value = true
  } catch (e: any) {
    saveStatus.value = `❌ 连接失败: ${e.message}`
  }
  setTimeout(() => { saveStatus.value = ''; saved.value = false }, 5000)
}

function getKeyLink() { window.open('https://api.jiucaihezi.studio/keys', '_blank') }
function goWallet() { window.open('https://api.jiucaihezi.studio/wallet', '_blank') }
function goInvite() { window.open('https://api.jiucaihezi.studio/profile', '_blank') }
function goSignin() { window.open('https://api.jiucaihezi.studio/profile', '_blank') }

function toggleBigFont() {
  bigFont.value = !bigFont.value
  localStorage.setItem('jc_bigfont', String(bigFont.value))
  applyBigFont()
}

function applyBigFont() {
  document.documentElement.style.fontSize = bigFont.value ? '17px' : '14px'
}

// ─── OpenClaw 操作 ───
async function saveOpenClawSettings() {
  saveOcConfig(ocPort.value, ocAuth.value)
  localStorage.setItem('jcUseLocalGateway', String(ocUseLocal.value))
  ocStatus.value = '已保存'
  setTimeout(() => { ocStatus.value = '' }, 3000)
}

async function testOpenClaw() {
  ocStatus.value = '检测中...'
  const ok = await checkGatewayHealth()
  if (ok) {
    ocStatus.value = 'Gateway 已连接'
    await connectGateway()
  } else {
    ocStatus.value = 'Gateway 不可达，请确认 openclaw gateway 已启动'
  }
  setTimeout(() => { ocStatus.value = '' }, 5000)
}

async function syncAgentsToOpenClaw() {
  ocStatus.value = '同步中...'
  try {
    const agentStore = useAgentStore()
    const skills = agentStore.loadSkills()
    const { synced } = await syncSkillsToOpenClaw(skills)
    ocStatus.value = `已同步 ${synced} 个搭子到 OpenClaw workspace`
  } catch (e: any) {
    ocStatus.value = `同步失败: ${e.message}`
  }
  setTimeout(() => { ocStatus.value = '' }, 5000)
}

async function launchOpenClaw() {
  ocStatus.value = '启动中...'
  const ok = await startGatewayProcess()
  if (ok) {
    ocStatus.value = 'Gateway 已启动，正在连接...'
    await connectGateway()
    ocStatus.value = gateway.value.status === 'connected' ? 'Gateway 已连接' : '启动成功，等待就绪...'
  } else {
    ocStatus.value = gateway.value.error || '启动失败'
  }
  setTimeout(() => { ocStatus.value = '' }, 5000)
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

        <label class="sp-label">API Key</label>
        <div class="sp-key-row">
          <input v-model="apiKey" :type="showKey ? 'text' : 'password'"
                 placeholder="sk-..." class="sp-input" />
          <button class="sp-icon-btn" @click="showKey = !showKey" :title="showKey ? '隐藏' : '显示'">
            <span class="mso">{{ showKey ? 'visibility_off' : 'visibility' }}</span>
          </button>
        </div>

        <!-- 按钮行 -->
        <div class="sp-btn-row">
          <button class="sp-link" @click="getKeyLink">
            <span class="mso" style="font-size: 14px;">key</span> 获取 Key
          </button>
          <button class="sp-link sp-link-gold" @click="goWallet">
            <span class="mso" style="font-size: 14px;">account_balance_wallet</span> 充值
          </button>
        </div>
        <div class="sp-btn-row">
          <button class="sp-link" @click="goInvite">
            <span class="mso" style="font-size: 14px;">group_add</span> 邀请赚米
          </button>
          <button class="sp-link" @click="goSignin">
            <span class="mso" style="font-size: 14px;">event_available</span> 白嫖签到
          </button>
        </div>

        <button class="sp-save-btn" @click="saveSettings">
          <span class="mso" style="font-size: 16px;">{{ saved ? 'check' : 'save' }}</span>
          {{ saved ? '已保存' : '保存设置' }}
        </button>
        <div v-if="saveStatus" class="sp-status" :class="{ ok: saveStatus.startsWith('✅'), err: saveStatus.startsWith('❌') }">
          {{ saveStatus }}
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

      <!-- OpenClaw Gateway (仅桌面端) -->
      <div v-if="isTauri" class="sp-section">
        <div class="sp-section-title">OpenClaw Gateway</div>

        <!-- 状态指示 -->
        <div class="oc-status-row">
          <span class="oc-dot" :class="gateway.status"></span>
          <span class="oc-status-text">
            {{ gateway.status === 'connected' ? '已连接' : gateway.status === 'connecting' ? '连接中...' : gateway.status === 'error' ? '错误' : '未连接' }}
          </span>
          <span v-if="gateway.version" class="oc-version">v{{ gateway.version }}</span>
        </div>

        <!-- 启用本地 Gateway -->
        <label class="sp-label" style="margin-top: 12px;">
          <input type="checkbox" v-model="ocUseLocal" style="margin-right: 6px;" />
          使用本地 Gateway 进行 AI 对话
        </label>

        <label class="sp-label" style="margin-top: 12px;">端口</label>
        <input v-model.number="ocPort" type="number" class="sp-input" placeholder="18789" />

        <label class="sp-label" style="margin-top: 8px;">认证 Token (可选)</label>
        <input v-model="ocAuth" type="password" class="sp-input" placeholder="留空则无需认证" />

        <div class="sp-btn-row" style="margin-top: 12px;">
          <button class="sp-save-btn" style="flex: 1;" @click="saveOpenClawSettings">
            <span class="mso" style="font-size: 14px;">save</span> 保存
          </button>
          <button class="sp-save-btn oc-test-btn" style="flex: 1;" @click="testOpenClaw">
            <span class="mso" style="font-size: 14px;">wifi_tethering</span> 检测
          </button>
        </div>

        <button class="sp-bigfont-btn" style="margin-top: 8px;" @click="launchOpenClaw">
          <span class="mso">rocket_launch</span> 启动 Gateway
        </button>

        <button class="sp-bigfont-btn" style="margin-top: 8px;" @click="syncAgentsToOpenClaw">
          <span class="mso">sync</span> 同步搭子到 OpenClaw
        </button>

        <div v-if="ocStatus" class="sp-status" :class="{ ok: ocStatus.includes('连接') || ocStatus.includes('启动'), err: ocStatus.includes('失败') || ocStatus.includes('不可达') }">
          {{ ocStatus }}
        </div>
      </div>

      <!-- 版本 -->
      <div class="sp-version">
        韭菜盒子 V7.0 · 桌面版 (Tauri + OpenClaw)
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
.sp-btn-row { display: flex; gap: 12px; margin-top: 8px; }
.sp-link {
  display: inline-flex; align-items: center; gap: 4px;
  border: none; background: none; font-size: 12px; font-weight: 600;
  color: var(--olive-dark); cursor: pointer; font-family: inherit; padding: 4px 0;
}
.sp-link:hover { text-decoration: underline; }
.sp-link-gold { color: #d4a800; }
.sp-save-btn {
  display: flex; align-items: center; gap: 6px; margin-top: 16px;
  padding: 9px 20px; border: none; border-radius: 10px;
  background: var(--olive); color: #fff; font-size: 13px; font-weight: 700;
  cursor: pointer; font-family: inherit; transition: transform 0.1s;
}
.sp-save-btn:hover { transform: scale(1.03); }
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
.sp-version { text-align: center; font-size: 11px; color: var(--ink3); padding: 24px 0; letter-spacing: 0.03em; }
.sp-status {
  margin-top: 8px; padding: 8px 12px; border-radius: 8px;
  font-size: 12px; font-weight: 600; text-align: center;
  background: var(--olive-pale); color: var(--ink2);
}
.sp-status.ok { background: #e8f5e9; color: #2e7d32; }
.sp-status.err { background: #ffebee; color: #c62828; }

/* OpenClaw */
.oc-status-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-radius: 8px;
  background: var(--surface-alt); border: 1px solid var(--border);
}
.oc-dot {
  width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  background: var(--ink3);
}
.oc-dot.connected { background: #4caf50; box-shadow: 0 0 4px #4caf50; }
.oc-dot.connecting { background: #ff9800; animation: pulse 1s infinite; }
.oc-dot.error { background: #f44336; }
@keyframes pulse { 50% { opacity: 0.4; } }
.oc-status-text { font-size: 13px; font-weight: 600; color: var(--ink); }
.oc-version { font-size: 11px; color: var(--ink3); margin-left: auto; }
.oc-test-btn { background: var(--ink2) !important; }
.oc-test-btn:hover { background: var(--ink) !important; }
</style>
