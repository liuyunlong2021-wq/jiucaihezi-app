/**
 * localCapabilities.ts — 本地能力注册表
 *
 * 统一管理所有需要用户配置的本地工具/权限。
 * 每个能力有 id、名称、描述、状态检测、配置操作。
 */
import { isTauriRuntime } from './tauriEnv'

export interface LocalCapability {
  id: string
  name: string
  description: string
  /** 快速检测该能力是否已就绪 */
  check: () => Promise<boolean>
  /** 配置该能力（可能打开系统设置、弹窗引导等） */
  setup: () => Promise<void>
  /** 是否为必需能力（没配置会严重影响体验） */
  critical: boolean
}

/** localStorage 键：记录用户跳过的能力（不再提示） */
const SKIP_KEY = 'jc_capability_skipped'

function isSkipped(id: string): boolean {
  try {
    const skipped = JSON.parse(localStorage.getItem(SKIP_KEY) || '[]')
    return Array.isArray(skipped) && skipped.includes(id)
  } catch { return false }
}

export function markSkipped(id: string) {
  try {
    const skipped = JSON.parse(localStorage.getItem(SKIP_KEY) || '[]')
    if (!Array.isArray(skipped)) return
    if (!skipped.includes(id)) {
      skipped.push(id)
      localStorage.setItem(SKIP_KEY, JSON.stringify(skipped))
    }
  } catch { /* ignore */ }
}

/** 所有本地能力定义 */
export function getLocalCapabilities(): LocalCapability[] {
  const caps: LocalCapability[] = [
    {
      id: 'browser',
      name: '浏览器操控',
      description: 'AI 可操控 Chrome 搜索网页、打开链接、读取页面',
      critical: false,
      check: async () => {
        // 检测 Chrome 远程调试端口是否可达
        // 简单检测：如果有 Tauri 环境，尝试 invoke 检测
        if (!isTauriRuntime()) return false
        try {
          // 通过检查已知的浏览器配置来间接判断
          const stored = localStorage.getItem('jc_browser_configured')
          return stored === 'true'
        } catch { return false }
      },
      setup: async () => {
        // 触发浏览器设置引导弹窗（由 UI 层处理）
        localStorage.setItem('jc_browser_configured', 'true')
        window.dispatchEvent(new CustomEvent('jc-open-browser-setup'))
      },
    },
    {
      id: 'filesystem',
      name: '本地文件读写',
      description: '读取/保存本地文件，支持拖拽上传',
      critical: true,
      check: async () => {
        // Tauri FS 插件已内建，只需确认在 Tauri 环境中
        return isTauriRuntime()
      },
      setup: async () => {
        // 无需额外设置，标记为已就绪
      },
    },
    {
      id: 'shell',
      name: 'Shell 命令执行',
      description: '运行 npm、git、python 等开发命令',
      critical: false,
      check: async () => {
        if (!isTauriRuntime()) return false
        const stored = localStorage.getItem('jc_shell_acknowledged')
        return stored === 'true'
      },
      setup: async () => {
        localStorage.setItem('jc_shell_acknowledged', 'true')
      },
    },
    {
      id: 'devproject',
      name: '源码项目',
      description: '读写项目文件、搜索代码、运行构建命令',
      critical: false,
      check: async () => {
        const stored = localStorage.getItem('jc_dev_project_root')
        return !!stored
      },
      setup: async () => {
        // 触发项目选择（由 UI 层处理）
        window.dispatchEvent(new CustomEvent('jc-open-dev-project-setup'))
      },
    },
    {
      id: 'ffmpeg',
      name: 'ffmpeg 媒体处理',
      description: '视频/音频转码、压缩、提取音频',
      critical: false,
      check: async () => {
        const stored = localStorage.getItem('jc_ffmpeg_checked')
        return stored === 'true'
      },
      setup: async () => {
        localStorage.setItem('jc_ffmpeg_checked', 'true')
        window.dispatchEvent(new CustomEvent('jc-open-ffmpeg-setup'))
      },
    },
  ]
  return caps
}

/** 获取未就绪的必需能力列表 */
export async function getUnreadyCapabilities(): Promise<LocalCapability[]> {
  const caps = getLocalCapabilities()
  const unready: LocalCapability[] = []
  for (const c of caps) {
    if (isSkipped(c.id)) continue
    const ready = await c.check().catch(() => false)
    if (!ready) unready.push(c)
  }
  return unready
}

/** 是否应该显示首次设置引导 */
export async function shouldShowSetupWizard(): Promise<boolean> {
  const done = localStorage.getItem('jc_setup_wizard_done')
  if (done === 'true') return false
  const unready = await getUnreadyCapabilities()
  return unready.length > 0
}

export function markSetupWizardDone() {
  localStorage.setItem('jc_setup_wizard_done', 'true')
}
