/**
 * projectStore.ts — 全局项目目录状态
 *
 * ChatPanel 的项目选择器更新此 store，ProjectFileTree 订阅变化自动刷新。
 * 桌面端专属，Web 端始终为空字符串。
 */
import { ref, computed } from 'vue'
import { isTauriRuntime } from '@/utils/tauriEnv'

function loadRecentDirs(): string[] {
  try {
    const raw = localStorage.getItem('jc_project_dirs')
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((d: unknown): d is string => typeof d === 'string') : []
  } catch {
    return []
  }
}

/**
 * 当前窗口的 label。
 *
 * 直接读 `__TAURI_INTERNALS__` 而不是 `getCurrentWindow()`：这个模块在 Web 端也会被加载，
 * 静态 import `@tauri-apps/api/window` 会把它拖进 Web 包。Tauri 自己也是这么实现的。
 */
function currentWindowLabel(): string {
  try {
    const label = (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: unknown } } } })
      .__TAURI_INTERNALS__?.metadata?.currentWindow?.label
    return typeof label === 'string' && label ? label : 'main'
  } catch {
    return 'main'
  }
}

/**
 * 本窗口被绑定到的那个工作区（多开时由 Rust 建窗时注入；主窗口没有）。
 *
 * 走窗口初始化脚本而不是 URL query：query 在生产环境的 App 入口上跨平台不稳；也不是
 * Rust 侧登记表 —— 那样只能启动后异步补，会先闪一下「没有项目」。
 */
function boundWorkspace(): string {
  try {
    const cwd = (window as unknown as { __JC_WORKSPACE__?: unknown }).__JC_WORKSPACE__
    return typeof cwd === 'string' ? cwd : ''
  } catch {
    return ''
  }
}

const WINDOW_LABEL = currentWindowLabel()
const PROJECT_DIR_KEY = `jc_project_dir:${WINDOW_LABEL}`

/**
 * 本窗口的初始工作区。
 *
 * 优先级：窗口绑定 > 分窗口存的 > 旧的全键。分窗口存是必须的 —— 共用一个键的话，
 * A 窗口换个项目会把 B 窗口也换掉。回落旧键是为了老用户升级后不丢当前项目。
 */
function loadProjectDir(): string {
  const bound = boundWorkspace()
  if (bound) return bound
  try {
    return localStorage.getItem(PROJECT_DIR_KEY) ?? localStorage.getItem('jc_project_dir') ?? ''
  } catch {
    return ''
  }
}

const projectDir = ref(loadProjectDir())
const recentProjectDirs = ref<string[]>(loadRecentDirs())
const webProjectId = ref(
  (() => { try { return localStorage.getItem('jc_web_project_id') || '' } catch { return '' } })()
)
const webProjectName = ref(
  (() => { try { return localStorage.getItem('jc_web_project_name') || '' } catch { return '' } })()
)

export function useProjectStore() {
  const projectName = computed(() => {
    if (!isTauriRuntime()) return webProjectName.value
    if (!projectDir.value) return ''
    const parts = projectDir.value.replace(/\/+$/, '').split('/')
    return parts[parts.length - 1] || ''
  })

  const hasProject = computed(() => isTauriRuntime() ? !!projectDir.value : !!webProjectId.value)

  function selectProject(dir: string) {
    projectDir.value = dir
    localStorage.setItem(PROJECT_DIR_KEY, dir)
    if (dir && !recentProjectDirs.value.includes(dir)) {
      recentProjectDirs.value.unshift(dir)
      if (recentProjectDirs.value.length > 10) recentProjectDirs.value.pop()
      localStorage.setItem('jc_project_dirs', JSON.stringify(recentProjectDirs.value))
    }
  }

  function clearProject() {
    projectDir.value = ''
    localStorage.removeItem(PROJECT_DIR_KEY)
  }

  function selectWebProject(project: { id: string; name: string }) {
    webProjectId.value = project.id
    webProjectName.value = project.name
    localStorage.setItem('jc_web_project_id', project.id)
    localStorage.setItem('jc_web_project_name', project.name)
  }

  function clearWebProject() {
    webProjectId.value = ''
    webProjectName.value = ''
    localStorage.removeItem('jc_web_project_id')
    localStorage.removeItem('jc_web_project_name')
  }

  return {
    projectDir,
    webProjectId,
    webProjectName,
    projectName,
    hasProject,
    recentProjectDirs,
    selectProject,
    clearProject,
    selectWebProject,
    clearWebProject,
  }
}
