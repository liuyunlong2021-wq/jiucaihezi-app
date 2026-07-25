<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import JcCloudLoginBox from '@/components/auth/JcCloudLoginBox.vue'
import type { JcCloudLoginPayload, JcCloudLoginResult } from '@/components/auth/jcCloudAuth'
import WebSkillPanel from '@/components/skills/WebSkillPanel.vue'
import McpManagerPanel from '@/components/mcp/McpManagerPanel.vue'
import { useAgentStore } from '@/stores/agentStore'
import { useTheme } from '@/composables/useTheme'
import {
  gatewayLogin,
  getApiKey,
  initApiKey,
  setApiKey,
} from '@/services/newApiClient'

type SettingsTab = 'account' | 'skills' | 'mcp' | 'theme'

const tab = ref<SettingsTab>('account')
const apiKey = ref('')
const status = ref('')
const saved = ref(false)
const advancedOpen = ref(false)
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
  apiKey.value = getApiKey() || await initApiKey()
  if (apiKey.value) await agentStore.fetchModels({ skipOpenCode: true }).catch(() => {})
})

async function login(payload: JcCloudLoginPayload): Promise<JcCloudLoginResult> {
  const result = await gatewayLogin({ username: payload.username, password: payload.password })
  return { apiKey: result.apiKey, user: result.user, baseUrl: result.baseUrl, raw: result }
}

async function handleLogin(result: JcCloudLoginResult) {
  apiKey.value = result.apiKey
  await setApiKey(result.apiKey)
  await agentStore.fetchModels({ skipOpenCode: true }).catch(() => {})
  status.value = '已登录'
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
</script>

<template>
  <div class="memory-settings">
    <nav class="memory-settings-tabs" aria-label="设置分类">
      <button :class="{ active: tab === 'account' }" @click="tab = 'account'">
        <JcIcon name="person" />账号
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
      <JcCloudLoginBox
        v-if="tab === 'account'"
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
.memory-settings-tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; padding: 10px; border-bottom: 1px solid var(--line); }
.memory-settings-tabs button { display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 0; height: 36px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--ink2); cursor: pointer; }
.memory-settings-tabs button.active { border-color: var(--line); background: var(--surface); color: var(--ink1); }
.memory-settings-body { min-height: 0; flex: 1; overflow: auto; padding: 12px; }
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
