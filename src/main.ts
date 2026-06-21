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
import JcIcon from '@/components/icons/JcIcon.vue'

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

// ─── P1-3: 启动日志缓冲区（用于排查 Intel/Windows 启动挂死） ───
;(window as any).__JC_BOOT_LOG__ = [] as Array<{ ts: number; level: string; msg: string }>
function bootLog(level: string, msg: string) {
  const entry = { ts: Date.now(), level, msg }
  ;(window as any).__JC_BOOT_LOG__.push(entry)
  if (level === 'error') console.error(`[JC-boot] ${msg}`)
  else console.warn(`[JC-boot] ${msg}`)
}

// ─── P1-5: patchFetch 状态追踪 ───
;(window as any).__JC_FETCH_PATCHED__ = false

// 桌面端：挂载 Tauri HTTP 插件替换 fetch，绕过 CORS
async function boot() {
  if (isTauri) {
    try {
      await patchFetch()
      ;(window as any).__JC_FETCH_PATCHED__ = true
    } catch (err) {
      bootLog('error', `patchFetch 失败: ${err}`)
    }
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
    // ⚠️ getCurrent() 在 Windows 上可能永久挂起 → 加 3s 超时保护
    const pending = await Promise.race([
      deepLink.getCurrent(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ])
    if (pending) await handleDeepLinkUrls(pending)
    await deepLink.onOpenUrl((urls) => {
      void handleDeepLinkUrls(urls)
    })
  } catch (err) {
    console.warn('[JC] Deep link 初始化失败:', err)
  }
}

// ─── 关键修复：UI 优先挂载，存储异步初始化 ───
// 对标 OpenCode 懒初始化策略：先让用户看到界面，后台慢慢初始化。
// 避免 Intel Mac / Windows 上因 SQLite/路径/deep-link 等平台差异卡死 splash。

function hideSplashScreen() {
  const splash = document.getElementById('jc-boot-screen')
  if (splash) {
    splash.classList.add('jc-boot-fade-out')
    splash.addEventListener('transitionend', () => splash.remove(), { once: true })
    // 安全网：400ms 后强制移除（防止 transitionend 不触发）
    setTimeout(() => splash.remove(), 400)
  }
}

// 1️⃣ 立即挂载 Vue（不等任何后端初始化）
function mountApp() {
  try {
    const app = createApp(App)
    app.use(createPinia())
    registerMcpStore(useMcpStore)
    app.component('JcIcon', JcIcon)
    app.mount('#app')
    ;(window as any).__JC_APP_MOUNTED__ = true
    hideSplashScreen()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error && err.stack ? `\n\n${err.stack}` : ''
    ;(window as any).__JC_BOOT_STATUS__?.(`启动失败：${message}${stack}`)
    console.error('[JC] Vue mount failed:', err)
    // 即使 Vue 挂了也要隐藏 splash，至少让用户看到错误
    hideSplashScreen()
  }
}

mountApp()

// 2️⃣ 后台异步初始化存储 + 其他（不阻塞 UI）
let _backendInitPromise: Promise<void> | null = null

async function initBackend() {
  // 防重入：Promise 缓存，出错清空允许重试
  if (_backendInitPromise) return _backendInitPromise

  _backendInitPromise = (async () => {
  const t0 = Date.now()
  bootLog('info', 'initBackend 开始')

  try {
    // boot()：patchFetch + API key + deep link，带 8s 总超时
    let bootTimer: ReturnType<typeof setTimeout> | undefined
    const bootTimeout = new Promise<void>((resolve) => {
      bootTimer = setTimeout(() => {
        bootLog('warn', 'boot() 超时（8s），跳过等待继续启动')
        resolve()
      }, 8000)
    })
    await Promise.race([boot(), bootTimeout])
    clearTimeout(bootTimer)  // 清除超时计时器，避免假警报日志
    bootLog('info', `boot() 完成 (${Date.now() - t0}ms)`)
  } catch (err) {
    bootLog('error', `boot() 异常: ${err}`)
  }

  // P0-2: 默认标记为降级，initDB 成功后再清除
  ;(window as any).__JC_STORAGE_DEGRADED__ = true
  try {
    // initDB()：SQLite 初始化，带 10s 超时
    let dbTimer: ReturnType<typeof setTimeout> | undefined
    const dbTimeout = new Promise<void>((resolve) => {
      dbTimer = setTimeout(() => {
        bootLog('warn', 'initDB() 超时（10s），将以降级模式运行（localStorage 兜底）')
        resolve()
      }, 10000)
    })
    await Promise.race([initDB(), dbTimeout])
    clearTimeout(dbTimer)  // 清除超时计时器，避免假警报日志
    ;(window as any).__JC_STORAGE_READY__ = true
    ;(window as any).__JC_STORAGE_DEGRADED__ = false
    bootLog('info', `initDB() 完成 (${Date.now() - t0}ms)`)
  } catch (err) {
    bootLog('error', `initDB() 失败: ${err}`)
    // 降级模式：__JC_STORAGE_DEGRADED__ 保持 true
  } finally {
    ;(window as any).__JC_APP_READY__ = true
    window.dispatchEvent(new CustomEvent('jc-app-ready'))
    bootLog('info', `initBackend 结束 (${Date.now() - t0}ms), storageDegraded=${(window as any).__JC_STORAGE_DEGRADED__}`)
  }

  // 以下全部后台静默执行，不影响用户体验
  void warmDefaultProviderCapabilityProbe().catch((err) => {
    console.warn('[JC] Provider capability probe failed:', err)
  })

  // WAL checkpoint — 启动 5s 后回收 WAL 空间
  setTimeout(() => {
    import('./utils/idb').then(m => m.walCheckpoint()).catch(() => {})
  }, 5000)

  // APP 切后台时再跑一次 checkpoint
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      import('./utils/idb').then(m => m.walCheckpoint()).catch(() => {})
    }
  })
  })()  // end of _backendInitPromise wrapper

  // 出错清空 Promise，允许下次重试
  _backendInitPromise.catch(() => {
    _backendInitPromise = null
  })

  return _backendInitPromise
}

initBackend()
