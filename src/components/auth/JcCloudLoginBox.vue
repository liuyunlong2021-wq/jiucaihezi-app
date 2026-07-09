<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { loginToJcCloud, type JcCloudLoginPayload, type JcCloudLoginResult } from './jcCloudAuth'
import { createAutoGroupApiKey } from '@/services/newApiOneClickLogin'

const props = withDefaults(defineProps<{
  apiBase?: string
  apiKey?: string
  loggedIn?: boolean
  advancedOpen?: boolean
  busy?: boolean
  saved?: boolean
  status?: string
  title?: string
  model?: string
  chatModels?: { id: string; label: string }[]
  login?: (payload: JcCloudLoginPayload) => Promise<JcCloudLoginResult>
  browserLogin?: () => Promise<void>
  openUrl?: (url: string) => void
}>(), {
  apiBase: 'https://api.jiucaihezi.studio',
  apiKey: '',
  loggedIn: false,
  advancedOpen: false,
  busy: false,
  saved: false,
  status: '',
  title: 'API 配置',
  model: 'claude-sonnet-4-6',
  chatModels: () => [],
})

const emit = defineEmits<{
  (e: 'update:apiKey', value: string): void
  (e: 'update:advancedOpen', value: boolean): void
  (e: 'login-success', result: JcCloudLoginResult): void
  (e: 'login-error', error: Error): void
  (e: 'save-key'): void
}>()

const showKey = ref(false)
const loginDialogOpen = ref(false)
const loginUsername = ref('')
const loginPassword = ref('')
const loginBusy = ref(false)
const localError = ref('')
const apiKeyDraft = ref(props.apiKey)
const configBusy = ref(false)
const configDialogOpen = ref(false)
const configContent = ref('')
const configCopied = ref(false)

watch(() => props.apiKey, (value) => {
  if (value !== apiKeyDraft.value) apiKeyDraft.value = value
})

watch(apiKeyDraft, (value) => emit('update:apiKey', value))

const normalizedApiBase = computed(() => props.apiBase.replace(/\/+$/, ''))
const currentStatus = computed(() => localError.value || props.status)

function open(url: string) {
  if (props.openUrl) {
    props.openUrl(url)
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function openLoginDialog() {
  if (loginBusy.value) return
  localError.value = ''
  if (props.browserLogin) {
    loginBusy.value = true
    try {
      await props.browserLogin()
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error || '无法打开浏览器登录'))
      localError.value = `登录失败：${err.message}`
      emit('login-error', err)
    } finally {
      loginBusy.value = false
    }
    return
  }
  loginDialogOpen.value = true
}

function closeLoginDialog() {
  if (loginBusy.value) return
  loginDialogOpen.value = false
}

async function submitLogin() {
  if (loginBusy.value || !loginUsername.value.trim() || !loginPassword.value) return
  loginBusy.value = true
  localError.value = ''
  try {
    const login = props.login || ((payload: JcCloudLoginPayload) => loginToJcCloud(normalizedApiBase.value, payload))
    const result = await login({
      username: loginUsername.value.trim(),
      password: loginPassword.value,
    })
    apiKeyDraft.value = result.apiKey
    loginPassword.value = ''
    loginDialogOpen.value = false
    emit('login-success', result)
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error || '账号或密码不正确'))
    localError.value = `登录失败：${err.message}`
    emit('login-error', err)
  } finally {
    loginBusy.value = false
  }
}

function setAdvancedOpen(value: boolean) {
  emit('update:advancedOpen', value)
}

function buildConfigText(apiKey: string, models: { id: string; label: string }[]) {
  // 接口地址始终用生产 URL，dev 模式下 normalizeApiBase 是 /__jc_api 不能给用户
  const base = 'https://api.jiucaihezi.studio'
  const modelLines = models.length > 0
    ? models.map(m => `  - ${m.id}`).join('\n')
    : `  - ${props.model || 'claude-sonnet-4-6'}`
  const count = models.length || 1
  return `韭菜盒子 API 配置

接口地址
${base}

密钥（请妥善保管，勿泄露）
${apiKey}

可用模型（共 ${count} 个）
${modelLines}

怎么用？
  打开任意 AI 客户端（Claude Code、CodeX、
  小龙虾、爱马仕、Cursor Switch、ChatBox、
  Cherry Studio、NextChat 等），填入上面的
  接口地址和密钥，选择模型即可开始使用。

密钥相当于你的账户密码，请勿分享给他人。
如不慎泄露，请到 ${base}/keys
删除该 Key 重新生成。`
}

async function handleCopyConfig() {
  if (configBusy.value) return
  configBusy.value = true
  localError.value = ''
  configCopied.value = false

  const existingKey = (apiKeyDraft.value || props.apiKey || '').trim()

  try {
    // 策略 1：无已有 Key 时，尝试创建 auto-group Key（需要 NewAPI Web Session）
    if (!existingKey) {
      const result = await createAutoGroupApiKey()
      if (result.status === 'ok') {
        configContent.value = buildConfigText(result.apiKey, props.chatModels || [])
        configDialogOpen.value = true
        return
      }
      if (result.status === 'needs-login') {
        localError.value = '请先点击「一键登录」，登录后即可一键抄配置'
        return
      }
      // result.status === 'error'：兜底往下走
    }

    // 策略 2：使用已有 Key（一键登录后已填充，或手动填的）
    if (existingKey) {
      configContent.value = buildConfigText(existingKey, props.chatModels || [])
      configDialogOpen.value = true
      return
    }

    // 策略 3：既没有已有 Key，auto-group 也失败
    localError.value = '请先点击「一键登录」，登录后即可一键抄配置'
  } catch (err: any) {
    localError.value = err?.message || '获取配置失败，请稍后重试'
  } finally {
    configBusy.value = false
  }
}

async function copyConfigToClipboard() {
  try {
    await navigator.clipboard.writeText(configContent.value)
    configCopied.value = true
    setTimeout(() => { configCopied.value = false }, 3000)
  } catch {
    // 降级：选中文本提示用户手动复制
    localError.value = '自动复制失败，请手动选中文本后 Cmd+C 复制'
    setTimeout(() => { localError.value = '' }, 4000)
  }
}

function closeConfigDialog() {
  configDialogOpen.value = false
  configCopied.value = false
}
</script>

<template>
  <section class="jc-login-box">
    <div class="jc-login-title">{{ title }}</div>

    <div class="jc-login-actions primary">
      <button class="jc-login-link jc-login-primary" :disabled="loginBusy" @click="openLoginDialog">
        <JcIcon name="login" />
        {{ loggedIn ? '已登录' : '一键登录' }}
      </button>
      <button class="jc-login-link" @click="open('https://jiucaihezi.studio')">
        <JcIcon name="download" />
        下载APP
      </button>
      <button class="jc-login-link jc-login-gold" @click="open(`${normalizedApiBase}/wallet`)">
        <JcIcon name="account_balance_wallet" />
        充值
      </button>
      <button class="jc-login-link" @click="open(`${normalizedApiBase}/usage-logs/common`)">
        <JcIcon name="receipt_long" />
        使用日志
      </button>
    </div>

    <div v-if="loggedIn && !advancedOpen && !apiKeyDraft" class="jc-login-state">
      <strong>已登录，可直接使用</strong>
      <button class="jc-login-inline" @click="setAdvancedOpen(true)">高级：使用自己的 API Key</button>
    </div>

    <div v-else>
      <label class="jc-login-label">API Key</label>
      <div class="jc-login-key-row">
        <input
          v-model="apiKeyDraft"
          :type="showKey ? 'text' : 'password'"
          placeholder="sk-..."
          class="jc-login-input"
        />
        <button class="jc-login-icon-btn" @click="showKey = !showKey" :title="showKey ? '隐藏' : '显示'">
          <JcIcon :name="showKey ? 'visibility_off' : 'visibility'" />
        </button>
      </div>
      <button v-if="loggedIn && !apiKeyDraft" class="jc-login-inline subtle" @click="setAdvancedOpen(false)">
        收起高级设置
      </button>
    </div>

    <div class="jc-login-actions secondary">
      <button class="jc-login-link jc-login-copy-config" :disabled="configBusy" @click="handleCopyConfig">
        <JcIcon name="auto_awesome" />
        {{ configBusy ? '获取中...' : '一键抄配置' }}
      </button>
      <button class="jc-login-link" @click="open(`${normalizedApiBase}/keys`)">
        <JcIcon name="key" />
        管理密钥
      </button>
      <button class="jc-login-link" @click="open(`${normalizedApiBase}/wallet`)">
        <JcIcon name="group_add" />
        邀请赚米
      </button>
      <button class="jc-login-link" @click="open(`${normalizedApiBase}/profile`)">
        <JcIcon name="event_available" />
        白嫖签到
      </button>
    </div>

    <button class="jc-login-save" :disabled="busy" @click="emit('save-key')">
      <JcIcon :name="busy ? 'hourglass_top' : saved ? 'check' : 'save'" />
      {{ busy ? '诊断中' : saved ? '已保存' : '保存设置' }}
    </button>

    <div v-if="currentStatus" class="jc-login-status" :class="{ err: currentStatus.startsWith('登录失败') || currentStatus.startsWith('❌'), ok: currentStatus.startsWith('✅') }">
      {{ currentStatus }}
    </div>

    <div v-if="loginDialogOpen" class="jc-login-overlay" @mousedown.self="closeLoginDialog">
      <div class="jc-login-dialog">
        <div class="jc-login-dialog-title">登录韭菜盒子账号</div>
        <input v-model="loginUsername" class="jc-login-input" autocomplete="username" placeholder="账号 / 邮箱" />
        <input
          v-model="loginPassword"
          class="jc-login-input"
          autocomplete="current-password"
          type="password"
          placeholder="密码"
          @keyup.enter="submitLogin"
        />
        <div class="jc-login-dialog-actions">
          <button class="jc-login-secondary" :disabled="loginBusy" @click="open(`${normalizedApiBase}/sign-up`)">注册账号</button>
          <button class="jc-login-secondary" :disabled="loginBusy" @click="closeLoginDialog">取消</button>
          <button class="jc-login-submit" :disabled="loginBusy || !loginUsername || !loginPassword" @click="submitLogin">
            {{ loginBusy ? '登录中' : '登录' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 一键抄配置 预览弹窗 -->
    <div v-if="configDialogOpen" class="jc-login-overlay" @mousedown.self="closeConfigDialog">
      <div class="jc-config-dialog">
        <div class="jc-config-dialog-title">API 配置信息</div>
        <pre class="jc-config-text">{{ configContent }}</pre>
        <div class="jc-config-dialog-actions">
          <button class="jc-login-secondary" @click="closeConfigDialog">关闭</button>
          <button class="jc-login-submit" @click="copyConfigToClipboard">
            {{ configCopied ? '已复制' : '复制全部' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.jc-login-box { display: flex; flex-direction: column; gap: 10px; }
.jc-login-title { font-size: 13px; font-weight: 800; color: var(--ink, #26251c); margin-bottom: 2px; }
.jc-login-actions { display: grid; gap: 8px; }
.jc-login-actions.primary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.jc-login-actions.secondary { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 2px; }
.jc-login-link {
  min-height: 34px; display: flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid var(--border, #ded8bf); border-radius: 8px;
  background: var(--surface-alt, #faf8ef); color: var(--ink2, #4f4a36);
  font-size: 12px; font-weight: 800; font-family: inherit; cursor: pointer;
}
.jc-login-link:hover { border-color: var(--olive, #9d925f); background: var(--olive-pale, #f1ecd2); }
.jc-login-link:disabled { opacity: 0.65; cursor: wait; }
.jc-login-primary { background: var(--olive, #9d925f); border-color: var(--olive, #9d925f); color: #fff; }
.jc-login-primary:hover { background: var(--olive-dark, #70673e); color: #fff; }
.jc-login-gold { color: #b68c00; }
.jc-login-label { display: block; margin: 6px 0 6px; font-size: 12px; font-weight: 800; color: var(--ink2, #4f4a36); }
.jc-login-key-row { display: flex; gap: 8px; }
.jc-login-input {
  width: 100%; min-width: 0; min-height: 36px; padding: 8px 10px;
  border: 1px solid var(--border, #ded8bf); border-radius: 8px;
  background: var(--surface-alt, #faf8ef); color: var(--ink, #26251c);
  font: inherit; font-size: 13px; box-sizing: border-box;
}
.jc-login-input:focus { outline: none; border-color: var(--olive, #9d925f); }
.jc-login-icon-btn {
  width: 38px; border: 1px solid var(--border, #ded8bf); border-radius: 8px;
  background: var(--surface-alt, #faf8ef); color: var(--ink3, #77705b); cursor: pointer;
}
.jc-login-state {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  min-height: 38px; padding: 9px 10px;
  border: 1px solid var(--border, #ded8bf); border-radius: 8px;
  background: var(--surface-alt, #faf8ef); color: var(--ink, #26251c);
}
.jc-login-state strong { font-size: 13px; font-weight: 800; }
.jc-login-inline {
  border: none; background: transparent; color: var(--olive-dark, #70673e);
  font-size: 12px; font-weight: 800; cursor: pointer; font-family: inherit;
}
.jc-login-inline.subtle { margin-top: 6px; padding: 0; color: var(--ink3, #77705b); }
.jc-login-save {
  width: 100%; min-height: 38px; display: flex; align-items: center; justify-content: center; gap: 8px;
  border: none; border-radius: 8px; background: var(--olive, #9d925f); color: #fff;
  font-size: 13px; font-weight: 900; font-family: inherit; cursor: pointer;
}
.jc-login-save:disabled { opacity: 0.65; cursor: progress; }
.jc-login-status {
  padding: 8px 12px; border-radius: 8px;
  font-size: 12px; font-weight: 700; text-align: center;
  background: var(--olive-pale, #f1ecd2); color: var(--ink2, #4f4a36);
}
.jc-login-status.ok { background: #e8f5e9; color: #2e7d32; }
.jc-login-status.err { background: #ffebee; color: #c62828; }
.jc-login-overlay {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0, 0, 0, 0.28);
}
.jc-login-dialog {
  width: min(320px, calc(100vw - 32px));
  display: flex; flex-direction: column; gap: 10px;
  padding: 16px; border: 1px solid var(--border, #ded8bf); border-radius: 8px;
  background: var(--surface, #fffdf6); box-shadow: 0 18px 48px rgba(0,0,0,.22);
}
.jc-login-dialog-title { font-size: 14px; font-weight: 900; color: var(--ink, #26251c); }
.jc-login-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
.jc-login-secondary,
.jc-login-submit {
  min-height: 34px; padding: 0 12px; border-radius: 8px; font-size: 12px; font-weight: 800;
  font-family: inherit; cursor: pointer;
}
.jc-login-secondary { border: 1px solid var(--border, #ded8bf); background: var(--surface-alt, #faf8ef); color: var(--ink2, #4f4a36); }
.jc-login-submit { border: none; background: var(--olive, #9d925f); color: #fff; }
.jc-login-secondary:disabled,
.jc-login-submit:disabled { opacity: 0.65; cursor: wait; }

/* ── 配置预览弹窗 ── */
.jc-config-dialog {
  width: min(420px, calc(100vw - 32px)); max-height: 80vh;
  display: flex; flex-direction: column; gap: 10px;
  padding: 16px; border: 1px solid var(--border, #ded8bf); border-radius: 8px;
  background: var(--surface, #fffdf6); box-shadow: 0 18px 48px rgba(0,0,0,.22);
}
.jc-config-dialog-title { font-size: 14px; font-weight: 900; color: var(--ink, #26251c); }
.jc-config-text {
  margin: 0; padding: 12px; border-radius: 8px;
  background: var(--surface-alt, #faf8ef); color: var(--ink, #26251c);
  font-size: 12px; line-height: 1.6; font-family: 'SF Mono', 'Cascadia Code', 'Menlo', monospace;
  white-space: pre-wrap; word-break: break-all;
  max-height: 50vh; overflow-y: auto;
  border: 1px solid var(--border, #ded8bf);
}
.jc-config-dialog-actions {
  display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px;
}

@media (max-width: 520px) {
  .jc-login-actions.primary,
  .jc-login-actions.secondary { grid-template-columns: 1fr; }
}
</style>
