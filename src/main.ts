import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { initDB } from '@/utils/idb'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { patchFetch } from '@/utils/httpClient'
import { warmDefaultProviderCapabilityProbe } from '@/utils/providerProbeBootstrap'
import { registerMcpStore } from '@/runtime/connection/mcpToolAdapter'
import { useMcpStore } from '@/stores/mcpStore'
import { initApiKey } from '@/services/newApiClient'

// Styles — design tokens first, then base
import './styles/design-tokens.css'
import './styles/highlight-theme.css'
import 'katex/dist/katex.min.css'
import './styles/base.css'

// ─── 环境检测 ───
const isTauri = isTauriRuntime()

// Boot theme from localStorage (flicker-free)
try {
  const theme = String(localStorage.getItem('jcTheme') || '').toLowerCase()
  if (theme === 'dark' || theme === 'green') {
    document.documentElement.setAttribute('data-theme', theme)
  }
} catch (_) {}

// Clean up jcApiBase if it has /api suffix
try {
  const storedApiBase = localStorage.getItem('jcApiBase')
  if (storedApiBase && storedApiBase.endsWith('/api')) {
    localStorage.setItem('jcApiBase', storedApiBase.replace(/\/api$/, ''))
  }
} catch (_) {}

// Set defaults
if (!localStorage.getItem('jcApiBase')) {
  localStorage.setItem('jcApiBase', 'https://api.jiucaihezi.studio')
}
if (!localStorage.getItem('jcModel')) {
  localStorage.setItem('jcModel', 'claude-sonnet-4-6')
}

// 桌面端标记 — CSS 和组件可用 [data-platform="desktop"] 做适配
if (isTauri) {
  document.documentElement.setAttribute('data-platform', 'desktop')
}

// 桌面端：挂载 Tauri HTTP 插件替换 fetch，绕过 CORS
async function boot() {
  if (isTauri) {
    await patchFetch()
  }
  await initApiKey()
}

// Initialize storage engine, then mount app
boot().then(() => initDB()).catch((err) => {
  console.warn('[JC] 初始化失败:', err)
}).finally(async () => {
  const app = createApp(App)
  app.use(createPinia())
  registerMcpStore(useMcpStore)
  app.mount('#app')
  void warmDefaultProviderCapabilityProbe().catch((err) => {
    console.warn('[JC] Provider capability probe failed:', err)
  })
})
