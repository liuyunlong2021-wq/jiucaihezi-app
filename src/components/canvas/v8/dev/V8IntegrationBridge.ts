/**
 * V8IntegrationBridge.ts
 *
 * Phase 0 收尾 - 真实环境集成桥梁
 *
 * 目标：提供安全、非破坏性的方式把 V8 手感基础设施接入现有 CanvasWorkspace。
 * 当前为开发/验证用途，最终会在后续 Phase 进行完整替换。
 */

import { activateV8Phase0 } from '../activate'
import { useV8NodeBehavior } from '../composables/useV8NodeBehavior'
import NodeFrame from '../NodeFrame.vue'

/**
 * 在开发模式下激活 V8 手感系统
 * 调用此函数后，V8 相关样式和调试工具会生效
 */
export function enableV8HandfeelInDev() {
  if (import.meta.env.DEV) {
    activateV8Phase0()
    console.log('%c[V8 Phase 0] 手感系统已在开发模式激活', 'color: #10b981')
  }
}

/**
 * 工具函数：判断是否应该使用 V8 节点渲染
 * 当前默认返回 false（保护现有代码）
 * 后续可通过 localStorage / feature flag 控制
 */
export function shouldUseV8Node(): boolean {
  if (!import.meta.env.DEV) return false

  // 开发期开关：localStorage.setItem('useV8Nodes', 'true')
  return localStorage.getItem('useV8Nodes') === 'true'
}

/**
 * 导出核心 V8 组件，供实验性集成使用
 */
export {
  NodeFrame,
  useV8NodeBehavior,
}