<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { loginToJcCloud, type JcCloudLoginPayload, type JcCloudLoginResult } from './jcCloudAuth'

const props = withDefaults(defineProps<{
  apiBase?: string
  apiKey?: string
  loggedIn?: boolean
  advancedOpen?: boolean
  busy?: boolean
  saved?: boolean
  status?: string
  title?: string
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
</script>

<template>
  <section class="jc-login-box">
    <div class="jc-login-title">{{ title }}</div>

    <div class="jc-login-actions primary">
      <button class="jc-login-link jc-login-primary" :disabled="loginBusy" @click="openLoginDialog">
        <span class="mso">login</span>
        {{ loggedIn ? '已登录' : '一键登录' }}
      </button>
      <button class="jc-login-link" @click="open('https://pan.quark.cn/s/79f3b5813f0c')">
        <span class="mso">download</span>
        下载APP
      </button>
      <button class="jc-login-link jc-login-gold" @click="open(`${normalizedApiBase}/wallet`)">
        <span class="mso">account_balance_wallet</span>
        充值
      </button>
      <button class="jc-login-link" @click="open(`${normalizedApiBase}/usage-logs/common`)">
        <span class="mso">receipt_long</span>
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
          <span class="mso">{{ showKey ? 'visibility_off' : 'visibility' }}</span>
        </button>
      </div>
      <button v-if="loggedIn && !apiKeyDraft" class="jc-login-inline subtle" @click="setAdvancedOpen(false)">
        收起高级设置
      </button>
    </div>

    <div class="jc-login-actions secondary">
      <button class="jc-login-link" @click="open(`${normalizedApiBase}/keys`)">
        <span class="mso">key</span>
        获取 Key
      </button>
      <button class="jc-login-link" @click="open(`${normalizedApiBase}/wallet`)">
        <span class="mso">group_add</span>
        邀请赚米
      </button>
      <button class="jc-login-link" @click="open(`${normalizedApiBase}/profile`)">
        <span class="mso">event_available</span>
        白嫖签到
      </button>
    </div>

    <button class="jc-login-save" :disabled="busy" @click="emit('save-key')">
      <span class="mso">{{ busy ? 'hourglass_top' : saved ? 'check' : 'save' }}</span>
      {{ busy ? '诊断中' : saved ? '已保存' : '保存设置' }}
    </button>

    <div v-if="currentStatus" class="jc-login-status" :class="{ err: currentStatus.startsWith('登录失败') || currentStatus.startsWith('❌'), ok: currentStatus.startsWith('✅') }">
      {{ currentStatus }}
    </div>

    <div v-if="loginDialogOpen" class="jc-login-overlay" @click.self="closeLoginDialog">
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
  </section>
</template>

<style scoped>
.jc-login-box { display: flex; flex-direction: column; gap: 10px; }
.jc-login-title { font-size: 13px; font-weight: 800; color: var(--ink, #26251c); margin-bottom: 2px; }
.jc-login-actions { display: grid; gap: 8px; }
.jc-login-actions.primary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.jc-login-actions.secondary { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 2px; }
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
@media (max-width: 520px) {
  .jc-login-actions.primary,
  .jc-login-actions.secondary { grid-template-columns: 1fr; }
}
</style>
