/**
 * plugin/pluginHost.ts — 插件宿主
 *
 * 负责：加载/激活/停用/卸载插件，管理注册生命周期。
 * 对齐 OpenCode PluginHost.make()，用 async/await 替代 Effect。
 */

import type {
  PluginDefinition,
  PluginRegistration,
  PluginContext,
  TransformDomain,
  HookDomain,
  CatalogDraft,
  CommandDraft,
  SkillDraft,
} from './types'
import { emitEvent, onEvent } from '@/utils/eventBus'

// ─── 简单实现 ───

function createTransformDomain<Draft>(): TransformDomain<Draft> {
  const transforms: Array<(draft: Draft) => void | Promise<void>> = []
  const disposables: Array<() => void> = []
  let nextId = 0

  function disposeAll() {
    for (const d of disposables) d()
    transforms.length = 0
    disposables.length = 0
  }

  return {
    transform(callback: (draft: Draft) => void | Promise<void>): PluginRegistration {
      const id = nextId++
      transforms.push(callback)
      return {
        dispose() {
          const idx = transforms.indexOf(callback)
          if (idx >= 0) transforms.splice(idx, 1)
        },
      }
    },
    async rebuild() {
      // ponytail: 复制数组再迭代，避免 transform 中修改注册列表
      for (const t of [...transforms]) await t({} as Draft)
    },
  }
}

function createHookDomain<EventPayload>(): HookDomain<EventPayload> & { trigger(payload: EventPayload): void } {
  const hooks: Array<(payload: EventPayload) => void | Promise<void>> = []

  return {
    hook(callback: (payload: EventPayload) => void | Promise<void>): PluginRegistration {
      hooks.push(callback)
      return {
        dispose() {
          const idx = hooks.indexOf(callback)
          if (idx >= 0) hooks.splice(idx, 1)
        },
      }
    },
    trigger(payload: EventPayload) {
      // ponytail: 复制数组再迭代，避免 hook 回调中 dispose/register 导致索引偏移
      for (const h of [...hooks]) {
        void Promise.resolve(h(payload)).catch(e =>
          console.warn('[Plugin] hook error:', e),
        )
      }
    },
  }
}

// ─── PluginHost ───

export interface PluginHostState {
  plugins: Map<string, { definition: PluginDefinition; registrations: PluginRegistration[]; active: boolean }>
}

export function createPluginHost() {
  const state: PluginHostState = {
    plugins: new Map(),
  }

  // 共享的域实例
  const chatSendBeforeDomain = createHookDomain<Parameters<PluginContext['chat']['onSendBefore']['hook']>[0]>()
  const chatReceiveAfterDomain = createHookDomain<Parameters<PluginContext['chat']['onReceiveAfter']['hook']>[0]>()
  const toolExecuteBeforeDomain = createHookDomain<Parameters<PluginContext['tool']['onExecuteBefore']['hook']>[0]>()
  const toolExecuteAfterDomain = createHookDomain<Parameters<PluginContext['tool']['onExecuteAfter']['hook']>[0]>()
  const catalogDomain = createTransformDomain<CatalogDraft>()
  const commandDomain = createTransformDomain<CommandDraft>()
  const skillDomain = createTransformDomain<SkillDraft>()

  function buildContext(pluginId: string): PluginContext {
    return {
      pluginId,

      chat: {
        onSendBefore: chatSendBeforeDomain,
        onReceiveAfter: chatReceiveAfterDomain,
      },

      tool: {
        onExecuteBefore: toolExecuteBeforeDomain,
        onExecuteAfter: toolExecuteAfterDomain,
      },

      event: {
        subscribe(eventName: string, callback: (...args: unknown[]) => void): PluginRegistration {
          const off = onEvent(eventName, callback)
          return { dispose: off }
        },
      },

      catalog: catalogDomain,
      command: commandDomain,
      skill: skillDomain,

      config: {
        async get(key: string): Promise<string | null> {
          return localStorage.getItem(`jc_plugin_${pluginId}_${key}`)
        },
        async set(key: string, value: string): Promise<void> {
          localStorage.setItem(`jc_plugin_${pluginId}_${key}`, value)
        },
      },

      fs: {
        async readText(_path: string): Promise<string> {
          throw new Error('fs.readText 仅在 Tauri 环境可用，Web 端请使用其他方式。')
        },
        async writeText(_path: string, _content: string): Promise<void> {
          throw new Error('fs.writeText 仅在 Tauri 环境可用，Web 端请使用其他方式。')
        },
        async exists(_path: string): Promise<boolean> {
          return false
        },
      },
    }
  }

  // ─── 公开 API ───

  /** 加载并激活一个插件 */
  async function activate(definition: PluginDefinition): Promise<void> {
    if (state.plugins.has(definition.id)) {
      console.warn(`[Plugin] 插件 "${definition.id}" 已加载，跳过`)
      return
    }

    const registrations: PluginRegistration[] = []
    const ctx = buildContext(definition.id)

    try {
      await Promise.resolve(definition.setup(ctx))
    } catch (error) {
      console.error(`[Plugin] 插件 "${definition.id}" setup 失败:`, error)
      throw error
    }

    state.plugins.set(definition.id, {
      definition,
      registrations,
      active: true,
    })

    emitEvent('plugin:activated', { pluginId: definition.id })
    console.log(`[Plugin] ✅ "${definition.id}" 已激活`)
  }

  /** 停用一个插件 */
  async function deactivate(pluginId: string): Promise<void> {
    const entry = state.plugins.get(pluginId)
    if (!entry) return

    for (const reg of entry.registrations) {
      try {
        reg.dispose()
      } catch (error) {
        console.warn(`[Plugin] 插件 "${pluginId}" dispose 失败:`, error)
      }
    }
    entry.registrations.length = 0
    entry.active = false

    emitEvent('plugin:deactivated', { pluginId })
    console.log(`[Plugin] ⏸ "${pluginId}" 已停用`)
  }

  /** 卸载一个插件（停用 + 移除） */
  async function uninstall(pluginId: string): Promise<void> {
    await deactivate(pluginId)
    state.plugins.delete(pluginId)

    // 清理 localStorage 配置
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(`jc_plugin_${pluginId}_`)) {
        keysToRemove.push(key)
      }
    }
    for (const key of keysToRemove) localStorage.removeItem(key)

    emitEvent('plugin:uninstalled', { pluginId })
    console.log(`[Plugin] 🗑 "${pluginId}" 已卸载`)
  }

  /** 获取已加载的插件列表 */
  function listPlugins(): Array<{ id: string; name?: string; active: boolean }> {
    return Array.from(state.plugins.entries()).map(([id, entry]) => ({
      id,
      name: entry.definition.name,
      active: entry.active,
    }))
  }

  /** 检查插件是否激活 */
  function isActive(pluginId: string): boolean {
    return state.plugins.get(pluginId)?.active ?? false
  }

  // ─── 内部触发（供宿主调用） ───

  /** 触发 chat.send.before */
  function triggerChatSendBefore(
    payload: Parameters<PluginContext['chat']['onSendBefore']['hook']>[0],
  ) {
    ;(chatSendBeforeDomain as ReturnType<typeof createHookDomain>).trigger(payload)
  }

  /** 触发 chat.receive.after */
  function triggerChatReceiveAfter(
    payload: Parameters<PluginContext['chat']['onReceiveAfter']['hook']>[0],
  ) {
    ;(chatReceiveAfterDomain as ReturnType<typeof createHookDomain>).trigger(payload)
  }

  /** 触发 tool.execute.before */
  function triggerToolExecuteBefore(
    payload: Parameters<PluginContext['tool']['onExecuteBefore']['hook']>[0],
  ) {
    ;(toolExecuteBeforeDomain as ReturnType<typeof createHookDomain>).trigger(payload)
  }

  /** 触发 tool.execute.after */
  function triggerToolExecuteAfter(
    payload: Parameters<PluginContext['tool']['onExecuteAfter']['hook']>[0],
  ) {
    ;(toolExecuteAfterDomain as ReturnType<typeof createHookDomain>).trigger(payload)
  }

  /** 触发 catalog rebuild */
  async function rebuildCatalog(): Promise<void> {
    await catalogDomain.rebuild()
  }

  return {
    activate,
    deactivate,
    uninstall,
    listPlugins,
    isActive,
    // 内部触发
    triggerChatSendBefore,
    triggerChatReceiveAfter,
    triggerToolExecuteBefore,
    triggerToolExecuteAfter,
    rebuildCatalog,
  }
}

// ─── 全局单例 ───

let _host: ReturnType<typeof createPluginHost> | null = null

export function getPluginHost() {
  if (!_host) _host = createPluginHost()
  return _host
}

/** 重置（仅测试用） */
export function __resetPluginHost() {
  _host = null
}

export type PluginHost = ReturnType<typeof createPluginHost>
