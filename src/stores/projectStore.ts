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

const projectDir = ref(
  (() => { try { return localStorage.getItem('jc_project_dir') || '' } catch { return '' } })()
)
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
    localStorage.setItem('jc_project_dir', dir)
    if (dir && !recentProjectDirs.value.includes(dir)) {
      recentProjectDirs.value.unshift(dir)
      if (recentProjectDirs.value.length > 10) recentProjectDirs.value.pop()
      localStorage.setItem('jc_project_dirs', JSON.stringify(recentProjectDirs.value))
    }
  }

  function clearProject() {
    projectDir.value = ''
    localStorage.removeItem('jc_project_dir')
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
