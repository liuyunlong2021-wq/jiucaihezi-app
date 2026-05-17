/**
 * composables/useTheme.ts — 主题切换
 * 4 个主题: white / light / dark / green
 */
import { ref, watch } from 'vue'

type Theme = 'white' | 'light' | 'dark' | 'green'

function normalizeTheme(value: string | null): Theme {
  const v = String(value || '').toLowerCase()
  if (v === 'white' || v === 'dark' || v === 'green') return v
  return 'light'
}

const theme = ref<Theme>(normalizeTheme(localStorage.getItem('jcTheme')))

function apply(t: Theme) {
  const root = document.documentElement
  if (t === 'light') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
  try { localStorage.setItem('jcTheme', t) } catch {}
}

apply(theme.value)
watch(theme, apply)

window.addEventListener('storage', (event) => {
  if (event?.key === 'jcTheme') {
    theme.value = normalizeTheme(event.newValue)
  }
})

export function useTheme() {
  function toggle() {
    const cycle: Record<string, Theme> = { white: 'light', light: 'dark', dark: 'green', green: 'white' }
    theme.value = cycle[theme.value] || 'dark'
  }

  function setTheme(t: Theme) { theme.value = t }

  const themeIcon = ref('')
  watch(theme, (t) => {
    const iconMap: Record<string, string> = { white: 'dark_mode', light: 'dark_mode', dark: 'eco', green: 'light_mode' }
    themeIcon.value = iconMap[t] || 'dark_mode'
  }, { immediate: true })

  const themeLabel = ref('')
  watch(theme, (t) => {
    const labelMap: Record<string, string> = {
      white: '切换浅色模式', light: '切换黑夜模式', dark: '切换护眼模式', green: '切换白色模式'
    }
    themeLabel.value = labelMap[t] || '切换黑夜模式'
  }, { immediate: true })

  return { theme, toggle, setTheme, themeIcon, themeLabel }
}
