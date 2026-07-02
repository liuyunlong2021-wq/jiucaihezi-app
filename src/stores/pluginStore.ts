/**
 * stores/pluginStore.ts — 插件管理 Store
 *
 * 管理：插件列表（工具仓库推荐 + 本地安装 + npm 安装）、安装/卸载/激活/停用。
 * v2: 集成 npm 安装引擎 + 配置持久化 + 沙箱校验
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getPluginHost,
  definePlugin,
  installPlugin as installPluginFromNpm,
  addPluginToConfig,
  removePluginFromConfig,
  getEnabledPlugins,
  validatePluginForLoading,
  type PluginDefinition,
} from '@/plugin'

export interface PluginMeta {
  id: string
  name: string
  description: string
  packageName?: string
  version?: string
  repo?: string
  homepage?: string
  stars?: number
  category?: string
  tags?: string[]
  /** 来源：builtin（内置）| github（工具仓库推荐）| npm（npm 安装）| local（本地定义） */
  source: 'builtin' | 'github' | 'npm' | 'local'
  /** 安装状态 */
  installed: boolean
  /** 激活状态 */
  active: boolean
  /** 安装提示词（给 AI 的安装指令） */
  installPrompt?: string
}

const APP_VERSION = '1.1.3'

export const usePluginStore = defineStore('plugins', () => {
  const plugins = ref<PluginMeta[]>([])
  const isLoading = ref(false)
  const error = ref('')

  const installedPlugins = computed(() => plugins.value.filter(p => p.installed))
  const activePlugins = computed(() => plugins.value.filter(p => p.active))
  const githubPlugins = computed(() => plugins.value.filter(p => p.source === 'github'))

  /** 从 githubTools.json 加载推荐列表 */
  async function loadRecommended(): Promise<void> {
    try {
      const data = await import('@/data/githubTools.json')
      const tools = (data as any).default?.tools || (data as any).tools
      if (!Array.isArray(tools)) return

      const host = getPluginHost()
      for (const tool of tools) {
        const existing = plugins.value.find(p => p.id === tool.id)
        if (existing) continue

        plugins.value.push({
          id: tool.id,
          name: tool.name || tool.id,
          description: tool.description || '',
          repo: tool.repo,
          homepage: tool.homepage,
          stars: tool.stars,
          category: tool.category,
          tags: tool.tags,
          source: 'github',
          installed: host.isActive(tool.id),
          active: host.isActive(tool.id),
          installPrompt: tool.installPrompt,
        })
      }
    } catch {
      // 静默失败
    }
  }

  /** 从本地配置加载已启用的 npm 插件（对齐 index.ts 启动加载） */
  async function loadFromConfig(): Promise<void> {
    try {
      const entries = await getEnabledPlugins()
      const host = getPluginHost()

      for (const entry of entries) {
        const existing = plugins.value.find(p => p.packageName === entry.package)
        if (existing) {
          existing.installed = true
          existing.active = entry.enabled
          continue
        }

        plugins.value.push({
          id: entry.package.replace('/', '_'),
          name: entry.package,
          description: `npm 插件: ${entry.package}`,
          packageName: entry.package,
          version: entry.version,
          source: 'npm',
          installed: true,
          active: entry.enabled,
        })
      }
    } catch {
      // 静默失败
    }
  }

  /** npm 安装插件（对齐 install.ts installPlugin 完整流程） */
  async function installFromNpm(packageSpec: string): Promise<{
    success: boolean
    error?: string
    webOnlyHint?: string
  }> {
    isLoading.value = true
    error.value = ''

    try {
      // 1. npm install + read manifest + 兼容性检查
      const result = await installPluginFromNpm(packageSpec, APP_VERSION)
      if (!result.success) {
        error.value = result.error || '安装失败'
        return { success: false, error: result.error, webOnlyHint: (result as any).webOnlyHint }
      }

      // 2. 沙箱校验
      if (result.manifest) {
        const validation = validatePluginForLoading(result.manifest, APP_VERSION)
        if (!validation.allowed) {
          error.value = validation.reason || '插件校验未通过'
          return { success: false, error: validation.reason }
        }
      }

      const manifest = result.manifest!
      const pluginId = manifest.name.replace('/', '_')

      // 3. 注册到 PluginHost
      const def = definePlugin({
        id: pluginId,
        name: manifest.name,
        description: manifest.description,
        async setup(ctx) {
          // 尝试加载插件 entry module
          if (result.installDir) {
            try {
              const entryModule = await import(/* @vite-ignore */ `${result.installDir}/index.js`)
              if (typeof entryModule?.default?.setup === 'function') {
                await entryModule.default.setup(ctx)
              } else if (typeof entryModule?.setup === 'function') {
                await entryModule.setup(ctx)
              }
            } catch (loadErr) {
              console.warn(`[Plugin] 加载 "${manifest.name}" entry 失败:`, loadErr)
            }
          }
        },
      })

      const host = getPluginHost()
      await host.activate(def)

      // 4. 写入配置
      await addPluginToConfig({
        package: parsePackageName(packageSpec),
        version: manifest.version,
        installedAt: Date.now(),
        enabled: true,
      })

      // 5. 更新 UI 状态
      const existing = plugins.value.find(p => p.packageName === parsePackageName(packageSpec))
      if (existing) {
        existing.installed = true
        existing.active = true
        existing.version = manifest.version
      } else {
        plugins.value.push({
          id: pluginId,
          name: manifest.name,
          description: manifest.description || `npm 插件: ${packageSpec}`,
          packageName: parsePackageName(packageSpec),
          version: manifest.version,
          source: 'npm',
          installed: true,
          active: true,
        })
      }

      return { success: true }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      error.value = message
      return { success: false, error: message }
    } finally {
      isLoading.value = false
    }
  }

  /** 安装插件（本地定义，注册到 PluginHost） */
  async function installPlugin(definition: PluginDefinition): Promise<void> {
    const host = getPluginHost()
    await host.activate(definition)

    const existing = plugins.value.find(p => p.id === definition.id)
    if (existing) {
      existing.installed = true
      existing.active = true
      existing.source = 'local'
    } else {
      plugins.value.push({
        id: definition.id,
        name: definition.name || definition.id,
        description: definition.description || '',
        source: 'local',
        installed: true,
        active: true,
      })
    }
  }

  /** 卸载插件 */
  async function uninstallPlugin(pluginId: string): Promise<void> {
    const entry = plugins.value.find(p => p.id === pluginId)
    if (!entry) return

    const host = getPluginHost()
    await host.uninstall(pluginId)

    // 从配置移除（npm 插件）
    if (entry.packageName) {
      await removePluginFromConfig(entry.packageName)
    }

    entry.installed = false
    entry.active = false
  }

  /** 激活插件 */
  async function activatePlugin(pluginId: string, definition: PluginDefinition): Promise<void> {
    const host = getPluginHost()
    await host.activate(definition)

    const entry = plugins.value.find(p => p.id === pluginId)
    if (entry) {
      entry.active = true
      if (entry.packageName) {
        await import('@/plugin/config').then(m => m.setPluginEnabled(entry.packageName!, true))
      }
    }
  }

  /** 停用插件 */
  async function deactivatePlugin(pluginId: string): Promise<void> {
    const host = getPluginHost()
    await host.deactivate(pluginId)

    const entry = plugins.value.find(p => p.id === pluginId)
    if (entry) {
      entry.active = false
      if (entry.packageName) {
        await import('@/plugin/config').then(m => m.setPluginEnabled(entry.packageName!, false))
      }
    }
  }

  /** 初始化 */
  async function init(): Promise<void> {
    if (isLoading.value) return
    isLoading.value = true
    error.value = ''

    try {
      await loadRecommended()
      await loadFromConfig()
    } catch (e) {
      error.value = e instanceof Error ? e.message : '插件列表加载失败'
    } finally {
      isLoading.value = false
    }
  }

  return {
    plugins,
    installedPlugins,
    activePlugins,
    githubPlugins,
    isLoading,
    error,
    init,
    installPlugin,
    installFromNpm,
    uninstallPlugin,
    activatePlugin,
    deactivatePlugin,
    loadRecommended,
  }
})

/** 从 "pkg@version" 提取包名 */
function parsePackageName(spec: string): string {
  const trimmed = spec.trim()
  const atIndex = trimmed.startsWith('@')
    ? trimmed.indexOf('@', 1)
    : trimmed.lastIndexOf('@')
  return atIndex > 0 ? trimmed.slice(0, atIndex) : trimmed
}
    githubPlugins,
    isLoading,
    error,
    init,
    installPlugin,
    uninstallPlugin,
    activatePlugin,
    deactivatePlugin,
    loadRecommended,
  }
})
