/**
 * plugin/sandbox.ts — 插件沙箱 & 能力校验
 *
 * 对齐 OpenCode 的"能力声明 + 加载时校验"沙箱模式：
 *   1. 插件 package.json exports 声明需要的能力
 *   2. 加载时校验：能力不匹配 → 跳过
 *   3. 插件 setup() 只接收 ctx（不暴露内部 Service）
 */

import type { PluginManifest, PluginTarget } from './install'
import type { PluginContext } from './types'

// ─── 能力定义 ───

/** 插件可声明的能力 */
export type PluginCapability =
  | 'chat:hook:send-before'     // 拦截发送前
  | 'chat:hook:receive-after'   // 拦截接收后
  | 'chat:transform'            // 修改消息
  | 'tool:hook:execute'         // 工具执行钩子
  | 'tool:register'             // 注册新工具
  | 'catalog:transform'         // 修改模型目录
  | 'command:transform'         // 修改命令
  | 'skill:transform'           // 修改 skill
  | 'event:subscribe'           // 订阅事件
  | 'config:read'               // 读配置
  | 'config:write'              // 写配置
  | 'fs:read'                   // 读文件
  | 'fs:write'                  // 写文件

/** 从 manifest.targets 映射到实际能力 */
export function targetsToCapabilities(targets: PluginTarget[]): PluginCapability[] {
  const caps = new Set<PluginCapability>()

  for (const target of targets) {
    switch (target) {
      case 'server':
        // server 插件可以访问所有能力
        caps.add('chat:hook:send-before')
        caps.add('chat:hook:receive-after')
        caps.add('tool:hook:execute')
        caps.add('tool:register')
        caps.add('catalog:transform')
        caps.add('command:transform')
        caps.add('skill:transform')
        caps.add('event:subscribe')
        caps.add('config:read')
        caps.add('config:write')
        break
      case 'tui':
        // TUI 插件只读，不能写配置或文件
        caps.add('chat:hook:send-before')
        caps.add('chat:hook:receive-after')
        caps.add('event:subscribe')
        caps.add('config:read')
        break
      case 'chat':
        caps.add('chat:hook:send-before')
        caps.add('chat:hook:receive-after')
        caps.add('event:subscribe')
        break
      case 'tool':
        caps.add('tool:hook:execute')
        caps.add('tool:register')
        caps.add('event:subscribe')
        break
      case 'unknown':
        // 未声明 → 不给能力
        break
    }
  }

  return Array.from(caps)
}

// ─── 沙箱上下文 ───

/**
 * 创建受限的 PluginContext（沙箱模式）。
 * 根据插件声明的能力，裁剪 ctx 暴露的 API。
 */
export function createSandboxedContext(
  fullCtx: PluginContext,
  capabilities: PluginCapability[],
): PluginContext {
  const capSet = new Set(capabilities)

  return {
    pluginId: fullCtx.pluginId,

    chat: {
      onSendBefore: capSet.has('chat:hook:send-before')
        ? { hook: fullCtx.chat.onSendBefore.hook.bind(fullCtx.chat.onSendBefore) }
        : { hook: () => ({ dispose: () => {} }) },
      onReceiveAfter: capSet.has('chat:hook:receive-after')
        ? { hook: fullCtx.chat.onReceiveAfter.hook.bind(fullCtx.chat.onReceiveAfter) }
        : { hook: () => ({ dispose: () => {} }) },
    },

    tool: {
      onExecuteBefore: capSet.has('tool:hook:execute')
        ? { hook: fullCtx.tool.onExecuteBefore.hook.bind(fullCtx.tool.onExecuteBefore) }
        : { hook: () => ({ dispose: () => {} }) },
      onExecuteAfter: capSet.has('tool:hook:execute')
        ? { hook: fullCtx.tool.onExecuteAfter.hook.bind(fullCtx.tool.onExecuteAfter) }
        : { hook: () => ({ dispose: () => {} }) },
    },

    event: {
      subscribe: capSet.has('event:subscribe')
        ? fullCtx.event.subscribe
        : () => ({ dispose: () => {} }),
    },

    catalog: capSet.has('catalog:transform')
      ? fullCtx.catalog
      : {
          transform: () => ({ dispose: () => {} }),
          rebuild: async () => {},
        },

    command: capSet.has('command:transform')
      ? fullCtx.command
      : {
          transform: () => ({ dispose: () => {} }),
          rebuild: async () => {},
        },

    skill: capSet.has('skill:transform')
      ? fullCtx.skill
      : {
          transform: () => ({ dispose: () => {} }),
          rebuild: async () => {},
        },

    config: {
      get: capSet.has('config:read') ? fullCtx.config.get : async () => null,
      set: capSet.has('config:write') ? fullCtx.config.set : async () => {},
    },

    fs: {
      readText: capSet.has('fs:read') ? fullCtx.fs.readText : async () => { throw new Error('fs.readText: 权限不足') },
      writeText: capSet.has('fs:write') ? fullCtx.fs.writeText : async () => {},
      exists: capSet.has('fs:read') ? fullCtx.fs.exists : async () => false,
    },
  }
}

// ─── 加载校验 ───

export interface SandboxValidation {
  allowed: boolean
  reason?: string
  capabilities?: PluginCapability[]
}

/**
 * 校验插件是否可以加载（对齐 OpenCode 加载时校验链）
 */
export function validatePluginForLoading(
  manifest: PluginManifest,
  appVersion: string,
  /** 当前环境允许的能力 */
  _allowedTargets: PluginTarget[] = ['chat', 'tool'],
): SandboxValidation {
  // 1. 检测 target
  const targets = manifest.targets.filter(t => t !== 'unknown')
  if (targets.length === 0) {
    return { allowed: false, reason: '插件未声明可用能力，拒绝加载' }
  }

  // 2. 版本兼容性
  const required = manifest.engines?.jiucaihezi
  if (required) {
    if (!simpleVersionCheck(appVersion, required)) {
      return {
        allowed: false,
        reason: `插件要求 jiucaihezi ${required}，当前 ${appVersion}`,
      }
    }
  }

  // 3. 映射能力
  const capabilities = targetsToCapabilities(targets)
  if (capabilities.length === 0) {
    return { allowed: false, reason: '插件声明的 target 在当前环境不可用' }
  }

  return { allowed: true, capabilities }
}

function simpleVersionCheck(current: string, range: string): boolean {
  const minMatch = range.match(/>=\s*(\d+\.\d+\.\d+)/)
  if (minMatch) {
    const [cMaj, cMin, cPatch] = current.split('.').map(Number)
    const [rMaj, rMin, rPatch] = minMatch[1].split('.').map(Number)
    if (cMaj !== rMaj) return cMaj > rMaj
    if (cMin !== rMin) return cMin > rMin
    return cPatch >= rPatch
  }
  return true
}
