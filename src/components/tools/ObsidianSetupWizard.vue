<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { openExternal } from '@/utils/httpClient'

const emit = defineEmits<{ close: [] }>()

// ─── 内联检测（绕过 Vite HMR 对 .ts 文件的缓存问题）───

function isTauri(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as any
  return !!(w.__TAURI_INTERNALS__ || w.__TAURI__)
}

async function checkObsidianInstalled(): Promise<boolean> {
  if (!isTauri()) return false
  // 方式1: Rust 命令
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const r = await invoke<boolean>('check_obsidian_installed')
    console.log('[obsidian] Rust →', r)
    if (r) return true
  } catch (e) { console.warn('[obsidian] Rust 失败', e) }
  // 方式2: plugin-fs
  try {
    const { exists } = await import('@tauri-apps/plugin-fs')
    const ok = await exists('/Applications/Obsidian.app')
    console.log('[obsidian] plugin-fs →', ok)
    if (ok) return true
  } catch (e) { console.warn('[obsidian] plugin-fs 失败', e) }
  // 方式3: mdfind Spotlight
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const raw: string = await invoke('mdfind_obsidian')
    console.log('[obsidian] mdfind →', raw || '(空)')
    if (raw?.trim()) return true
  } catch (e) { console.warn('[obsidian] mdfind 失败', e) }
  return false
}

async function probeObsidianApi(): Promise<{ reachable: boolean; statusCode?: number; error?: string }> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    const resp = await fetch('https://localhost:27124/', { method: 'GET', signal: ctrl.signal })
    clearTimeout(t)
    return { reachable: true, statusCode: resp.status }
  } catch (e: any) {
    const msg = e?.message || String(e)
    if (msg.includes('abort') || msg.includes('timeout')) return { reachable: false, error: '连接超时 — Obsidian 可能未启动' }
    return { reachable: false, error: '无法连接 localhost:27124 — 请确认 Obsidian 已启动且插件已启用' }
  }
}

async function testObsidianKey(key: string): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    const resp = await fetch('https://localhost:27124/', { headers: { Authorization: `Bearer ${key}` }, signal: ctrl.signal })
    clearTimeout(t)
    return resp.status === 200
  } catch { return false }
}

function saveObsidianKey(k: string) { localStorage.setItem('jc_obsidian_key', k) }
function getSavedObsidianKey() { return localStorage.getItem('jc_obsidian_key') || '' }

// 步骤状态: pending | loading | done | error
const step1 = ref<'pending' | 'loading' | 'done' | 'error'>('pending')
const step2 = ref<'pending' | 'loading' | 'done' | 'error'>('pending')
const step3 = ref<'pending' | 'loading' | 'done' | 'error'>('pending')
const step4 = ref<'pending' | 'loading' | 'done' | 'error'>('pending')

const apiKey = ref(getSavedObsidianKey())
const showKeyInput = ref(false)
const testing = ref(false)
const errorMsg = ref('')

const allDone = computed(() =>
  step1.value === 'done' && step2.value === 'done' && step3.value === 'done' && step4.value === 'done'
)

onMounted(async () => {
  console.log('[obsidian-wizard] 向导已挂载，开始检测...')
  await detectAll()
  console.log('[obsidian-wizard] 检测完成', { step1: step1.value, step2: step2.value, step3: step3.value })
})

async function detectAll() {
  console.log('[obsidian-wizard] detectAll 开始')
  // Step 1: 检测 Obsidian 安装
  step1.value = 'loading'
  const installed = await checkObsidianInstalled()
  console.log('[obsidian-wizard] step1 checkObsidianInstalled →', installed)
  step1.value = installed ? 'done' : 'error'

  if (!installed) return

  // Step 2: 检测插件
  step2.value = 'loading'
  const probe = await probeObsidianApi()
  if (probe.reachable) {
    step2.value = 'done'
    // 如果 200 说明无需 key 或 key 已配置
    if (probe.statusCode === 200) {
      step3.value = 'done'
      step4.value = 'done'
    } else if (probe.statusCode === 401) {
      // 需要配置 key
      if (apiKey.value) {
        await verifyKey()
      }
    }
  } else {
    step2.value = 'error'
    errorMsg.value = probe.error || '无法连接到 Obsidian 插件'
  }
}

async function verifyKey() {
  if (!apiKey.value.trim()) return
  step3.value = 'loading'
  testing.value = true
  const ok = await testObsidianKey(apiKey.value.trim())
  if (ok) {
    step3.value = 'done'
    step4.value = 'done'
    saveObsidianKey(apiKey.value.trim())
  } else {
    step3.value = 'error'
    errorMsg.value = 'API Key 无效，请在 Obsidian 插件设置中重新生成'
  }
  testing.value = false
}

function saveAndVerify() {
  if (!apiKey.value.trim()) return
  saveObsidianKey(apiKey.value.trim())
  verifyKey()
}

function retryStep2() {
  step2.value = 'pending'
  errorMsg.value = ''
  detectAll()
}

function openPluginMarket() {
  // 用 obsidian:// 协议打开社区插件市场
  openExternal('obsidian://show-plugin?id=obsidian-local-rest-api')
}
</script>

<template>
  <div class="osw">
    <div class="osw-head">
      <h3><JcIcon name="hub" /> Obsidian 知识库设置</h3>
      <p>3 步配置，让 AI 直接读写你的本地 Obsidian 笔记</p>
    </div>

    <div class="osw-steps">
      <!-- Step 1: 安装 Obsidian -->
      <div class="osw-step" :class="step1">
        <div class="osw-step-num">
          <span v-if="step1 === 'done'" class="osw-check">✅</span>
          <span v-else-if="step1 === 'loading'" class="osw-spin">⏳</span>
          <span v-else-if="step1 === 'error'" class="osw-warn">⚠️</span>
          <span v-else>①</span>
        </div>
        <div class="osw-step-body">
          <div class="osw-step-title">安装 Obsidian</div>
          <div class="osw-step-desc">
            <template v-if="step1 === 'done'">已检测到 Obsidian.app ✅</template>
            <template v-else-if="step1 === 'error'">未检测到 Obsidian，请先下载安装</template>
            <template v-else-if="step1 === 'loading'">检测中...</template>
            <template v-else>免费开源笔记软件，本地存储，完全离线</template>
          </div>
        </div>
        <div class="osw-step-action">
          <button v-if="step1 === 'error'" class="osw-btn" @click="openExternal('https://obsidian.md/download')">
            下载 Obsidian
          </button>
        </div>
      </div>

      <!-- Step 2: 安装插件 -->
      <div class="osw-step" :class="step2" v-if="step1 === 'done' || step1 === 'error'">
        <div class="osw-step-num">
          <span v-if="step2 === 'done'" class="osw-check">✅</span>
          <span v-else-if="step2 === 'loading'" class="osw-spin">⏳</span>
          <span v-else-if="step2 === 'error'" class="osw-warn">⚠️</span>
          <span v-else>②</span>
        </div>
        <div class="osw-step-body">
          <div class="osw-step-title">安装 Local REST API 插件</div>
          <div class="osw-step-desc">
            <template v-if="step2 === 'done'">插件已运行 ✅</template>
            <template v-else-if="step2 === 'error'">
              {{ errorMsg || '插件未检测到。请在 Obsidian 中安装并启用' }}
            </template>
            <template v-else-if="step2 === 'loading'">检测插件状态...</template>
            <template v-else>在 Obsidian 社区插件市场搜索安装</template>
          </div>
        </div>
        <div class="osw-step-action">
          <button v-if="step2 === 'error'" class="osw-btn" @click="openPluginMarket">
            一键打开插件页
          </button>
          <button v-if="step2 === 'error'" class="osw-btn osw-btn-ghost" @click="retryStep2">
            重新检测
          </button>
        </div>
      </div>

      <!-- Step 3: 配置 API Key -->
      <div class="osw-step" :class="step3" v-if="step2 === 'done'">
        <div class="osw-step-num">
          <span v-if="step3 === 'done'" class="osw-check">✅</span>
          <span v-else-if="step3 === 'loading'" class="osw-spin">⏳</span>
          <span v-else-if="step3 === 'error'" class="osw-warn">⚠️</span>
          <span v-else>③</span>
        </div>
        <div class="osw-step-body">
          <div class="osw-step-title">配置 API Key</div>
          <div class="osw-step-desc">
            <template v-if="step3 === 'done'">API Key 有效 ✅</template>
            <template v-else>
              在 Obsidian 插件设置 → Local REST API → 点击「Generate API Key」→ 复制后粘贴到下方
            </template>
          </div>
          <div v-if="step3 !== 'done'" class="osw-key-row">
            <input
              v-model="apiKey"
              type="password"
              placeholder="粘贴 API Key..."
              class="osw-key-input"
              @keyup.enter="saveAndVerify"
            />
            <button class="osw-btn" :disabled="testing || !apiKey.trim()" @click="saveAndVerify">
              {{ testing ? '验证中...' : '保存并验证' }}
            </button>
          </div>
          <div v-if="step3 === 'error'" class="osw-err">{{ errorMsg }}</div>
        </div>
      </div>

      <!-- Step 4: 完成 -->
      <div class="osw-step done" v-if="allDone">
        <div class="osw-step-num"><span class="osw-check">🎉</span></div>
        <div class="osw-step-body">
          <div class="osw-step-title">全部就绪！</div>
          <div class="osw-step-desc">
            OpenCode 现在可以直接读写你的 Obsidian vault。<br />
            建议在 Skill 仓库安装 <strong>Obsidian Skills</strong> 让 AI 更好理解笔记格式。
          </div>
        </div>
      </div>
    </div>

    <div class="osw-foot">
      <button class="osw-btn osw-btn-ghost" @click="emit('close')">关闭</button>
    </div>
  </div>
</template>

<style scoped>
.osw { display: flex; flex-direction: column; height: 100%; background: var(--surface); }
.osw-head { padding: 16px 18px 12px; border-bottom: 1px solid var(--line); }
.osw-head h3 { margin: 0 0 4px; font-size: 16px; color: var(--ink1); display: flex; align-items: center; gap: 8px; }
.osw-head p { margin: 0; font-size: 12px; color: var(--ink3); }

.osw-steps { flex: 1; overflow-y: auto; padding: 12px 18px; display: flex; flex-direction: column; gap: 4px; }

.osw-step { display: flex; align-items: flex-start; gap: 12px; padding: 12px; border-radius: 10px; background: var(--bg); border: 1px solid var(--line); }
.osw-step.done { border-color: color-mix(in srgb, var(--olive) 40%, transparent); background: color-mix(in srgb, var(--olive) 6%, var(--bg)); }

.osw-step-num { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 14px; }
.osw-check { font-size: 16px; }
.osw-warn { font-size: 16px; }
.osw-spin { font-size: 16px; animation: osw-pulse 1.2s ease-in-out infinite; }
@keyframes osw-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }

.osw-step-body { flex: 1; min-width: 0; }
.osw-step-title { font-size: 14px; font-weight: 600; color: var(--ink1); margin-bottom: 3px; }
.osw-step-desc { font-size: 12px; color: var(--ink3); line-height: 1.5; }

.osw-step-action { display: flex; gap: 6px; flex-shrink: 0; align-items: center; }

.osw-key-row { display: flex; gap: 8px; margin-top: 8px; }
.osw-key-input { flex: 1; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; font-size: 12px; background: var(--surface); color: var(--ink1); outline: none; }
.osw-key-input:focus { border-color: var(--olive); }

.osw-btn { padding: 6px 14px; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; background: var(--olive); color: #fff; white-space: nowrap; }
.osw-btn:hover { opacity: .85; }
.osw-btn:disabled { opacity: .5; cursor: not-allowed; }
.osw-btn-ghost { background: transparent; color: var(--ink2); border: 1px solid var(--line); }
.osw-btn-ghost:hover { background: var(--bg); }

.osw-err { margin-top: 6px; font-size: 11px; color: #c62828; }

.osw-foot { padding: 10px 18px; border-top: 1px solid var(--line); display: flex; justify-content: flex-end; }
</style>
