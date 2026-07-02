/**
 * plugin/config.ts — 插件配置持久化 + 启动加载
 *
 * 对齐 OpenCode external.ts + index.ts：
 *   1. 从本地 JSON 配置读取 plugin 列表
 *   2. 启动时遍历加载
 *   3. 安装/卸载时更新配置
 */

import { isTauriRuntime } from '@/utils/tauriEnv'

// ─── 类型 ───

export interface PluginConfigEntry {
  /** npm 包名（对齐 opencode.json "plugin" 条目） */
  package: string
  /** 安装版本 */
  version?: string
  /** 安装时间 */
  installedAt: number
  /** 是否启用 */
  enabled: boolean
}

export interface PluginConfig {
  version: 1
  plugins: PluginConfigEntry[]
}

// ─── 配置路径 ───

function getConfigPath(): string {
  const home = typeof window !== 'undefined'
    ? (window as any).__JC_HOME__ || ''
    : ''
  return home ? `${home}/plugins.json` : '.jiucaihezi/plugins.json'
}

// ─── 读写 ───

/** 读插件配置 */
export async function readPluginConfig(): Promise<PluginConfig> {
  if (!isTauriRuntime()) {
    // Web 端从 localStorage 读
    try {
      const raw = localStorage.getItem('jc_plugin_config')
      if (raw) return JSON.parse(raw) as PluginConfig
    } catch { /* ignore */ }
    return { version: 1, plugins: [] }
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const raw = await invoke<string>('plugin_read_config')
    return JSON.parse(raw) as PluginConfig
  } catch {
    return { version: 1, plugins: [] }
  }
}

/** 写插件配置 */
export async function writePluginConfig(config: PluginConfig): Promise<void> {
  if (!isTauriRuntime()) {
    localStorage.setItem('jc_plugin_config', JSON.stringify(config))
    return
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('plugin_write_config', { content: JSON.stringify(config, null, 2) })
  } catch (error) {
    console.error('[Plugin] 写入配置失败:', error)
    // 降级到 localStorage
    localStorage.setItem('jc_plugin_config', JSON.stringify(config))
  }
}

/** 读取插件列表（对齐 external.ts 从 opencode.json 读取） */
export async function getPluginEntryList(): Promise<PluginConfigEntry[]> {
  const config = await readPluginConfig()
  return config.plugins
}

/** 添加插件到配置（对齐 install.ts patchPluginConfig） */
export async function addPluginToConfig(entry: PluginConfigEntry): Promise<void> {
  const config = await readPluginConfig()

  // 去重：已存在则更新
  const existing = config.plugins.findIndex(p => p.package === entry.package)
  if (existing >= 0) {
    config.plugins[existing] = entry
  } else {
    config.plugins.push(entry)
  }

  await writePluginConfig(config)
}

/** 从配置移除插件 */
export async function removePluginFromConfig(packageName: string): Promise<void> {
  const config = await readPluginConfig()
  config.plugins = config.plugins.filter(p => p.package !== packageName)
  await writePluginConfig(config)
}

/** 切换插件启用状态 */
export async function setPluginEnabled(packageName: string, enabled: boolean): Promise<void> {
  const config = await readPluginConfig()
  const entry = config.plugins.find(p => p.package === packageName)
  if (entry) {
    entry.enabled = enabled
    await writePluginConfig(config)
  }
}

/** 获取已启用的插件列表（对齐 index.ts 启动时加载） */
export async function getEnabledPlugins(): Promise<PluginConfigEntry[]> {
  const config = await readPluginConfig()
  return config.plugins.filter(p => p.enabled)
}
