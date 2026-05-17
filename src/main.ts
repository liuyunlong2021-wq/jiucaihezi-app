import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { initDB } from '@/utils/idb'

// Styles — design tokens first, then base
import './styles/design-tokens.css'
import './styles/base.css'

// Boot theme from localStorage (flicker-free) — from code.html bootstrap
try {
  const theme = String(localStorage.getItem('jcTheme') || '').toLowerCase()
  if (theme === 'dark' || theme === 'green') {
    document.documentElement.setAttribute('data-theme', theme)
  }
} catch (_) {}

// Clean up jcApiBase if it has /api suffix (from code.html line 1978-1981)
try {
  const storedApiBase = localStorage.getItem('jcApiBase')
  if (storedApiBase && storedApiBase.endsWith('/api')) {
    localStorage.setItem('jcApiBase', storedApiBase.replace(/\/api$/, ''))
  }
} catch (_) {}

// Set default API base if not set (from code.html line 1984)
if (!localStorage.getItem('jcApiBase')) {
  localStorage.setItem('jcApiBase', 'https://api.jiucaihezi.studio')
}
if (!localStorage.getItem('jcModel')) {
  localStorage.setItem('jcModel', 'claude-sonnet-4-6')
}

// Initialize IndexedDB, then mount app
initDB().catch((err) => {
  console.warn('[JC] IndexedDB 初始化失败，数据可能无法持久化:', err)
}).finally(() => {
  const app = createApp(App)
  app.use(createPinia())
  app.mount('#app')
})
