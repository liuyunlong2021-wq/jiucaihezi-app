import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { initDB } from '@/utils/idb'

// Styles — design tokens first, then base
import './styles/design-tokens.css'
import './styles/base.css'

// ─── 环境检测 ───
const isTauri = '__TAURI__' in window

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

// Initialize storage engine, then mount app
initDB().catch((err) => {
  console.warn('[JC] 存储引擎初始化失败:', err)
}).finally(() => {
  const app = createApp(App)
  app.use(createPinia())
  app.mount('#app')
})
