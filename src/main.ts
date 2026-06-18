import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { initDB } from '@/utils/idb'
import { isTauriRuntime } from '@/utils/tauriEnv'
import { patchFetch } from '@/utils/httpClient'
import { warmDefaultProviderCapabilityProbe } from '@/utils/providerProbeBootstrap'
import { registerMcpStore } from '@/runtime/tools/mcpBridge'
import { useMcpStore } from '@/stores/mcpStore'
import { initApiKey, setApiKey } from '@/services/newApiClient'
import { consumeApiKeyCallbackUrl } from '@/services/apiKeyCallback'

// Styles — design tokens first, then base
import './styles/design-tokens.css'
import './styles/highlight-theme.css'
import 'katex/dist/katex.min.css'
import './styles/base.css'

// ─── 环境检测 ───
const isTauri = isTauriRuntime()
;(window as any).__JC_APP_BUILD_ID__ = 'web-direct-20260615-boot-guard'

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
  const callbackKey = consumeApiKeyCallbackUrl()
  if (callbackKey) await setApiKey(callbackKey)
  if (isTauri) await registerDeepLinkCallbackHandler()
  // 对标 OpenCode 懒鉴权：不在启动时阻塞等待 Keychain
  initApiKey().catch(() => {})
}

async function handleDeepLinkUrls(urls: string[] | null | undefined) {
  for (const url of urls || []) {
    const callbackKey = consumeApiKeyCallbackUrl({ href: url })
    if (!callbackKey) continue
    await setApiKey(callbackKey)
    window.dispatchEvent(new CustomEvent('jc-api-key-callback', {
      detail: { apiKey: callbackKey },
    }))
  }
}

async function registerDeepLinkCallbackHandler() {
  try {
    const deepLink = await import('@tauri-apps/plugin-deep-link')
    await handleDeepLinkUrls(await deepLink.getCurrent())
    await deepLink.onOpenUrl((urls) => {
      void handleDeepLinkUrls(urls)
    })
  } catch (err) {
    console.warn('[JC] Deep link 初始化失败:', err)
  }
}

// Initialize storage engine, then mount app
boot().then(() => initDB()).catch((err) => {
  console.warn('[JC] 初始化失败:', err)
}).finally(async () => {
  try {
    const app = createApp(App)
    app.use(createPinia())
    registerMcpStore(useMcpStore)
    app.mount('#app')
    ;(window as any).__JC_APP_MOUNTED__ = true
    // 品牌 splash 淡出
    const splash = document.getElementById('jc-boot-screen')
    if (splash) {
      splash.classList.add('jc-boot-fade-out')
      splash.addEventListener('transitionend', () => splash.remove(), { once: true })
      // 安全网：400ms 后强制移除（防止 transitionend 不触发）
      setTimeout(() => splash.remove(), 400)
    }
    void warmDefaultProviderCapabilityProbe().catch((err) => {
      console.warn('[JC] Provider capability probe failed:', err)
    })
    // P3.5: WAL checkpoint — 启动 5s 后回收 WAL 空间
    setTimeout(() => {
      import('./utils/idb').then(m => m.walCheckpoint()).catch(() => {})
    }, 5000)
    // P3.5: APP 切后台时再跑一次 checkpoint
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        import('./utils/idb').then(m => m.walCheckpoint()).catch(() => {})
      }
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error && err.stack ? `\n\n${err.stack}` : ''
    ;(window as any).__JC_BOOT_STATUS__?.(`启动失败：${message}${stack}`)
    console.error('[JC] Vue mount failed:', err)
  }
})
