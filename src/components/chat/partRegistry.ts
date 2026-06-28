/**
 * partRegistry.ts — Part 和 Tool 插件注册系统（对齐 OpenCode 官方 PART_MAPPING + ToolRegistry）
 *
 * 官方源码: message-part.tsx PART_MAPPING / ToolRegistry / registerPartComponent / registerTool
 *
 * 设计：
 *   PART_MAPPING: Record<partType, VueComponent> — 按 part.type 分发渲染器
 *   ToolRegistry:  { register, render } — 按 tool name 分发工具渲染器
 */
import type { Component } from 'vue'

// ── Part Registry ──

type PartComponentProps = {
  part: Record<string, any>
  message: Record<string, any>
  hideDetails?: boolean
  defaultOpen?: boolean
}

export type PartComponent = Component<PartComponentProps>

const PART_MAPPING: Record<string, PartComponent | undefined> = {}

export function registerPartComponent(type: string, component: PartComponent): void {
  PART_MAPPING[type] = component
}

export function getPartComponent(type: string): PartComponent | undefined {
  return PART_MAPPING[type]
}

// ── Tool Registry ──

type ToolComponentProps = {
  input: Record<string, any>
  metadata: Record<string, any>
  tool: string
  sessionID?: string
  output?: string
  status?: string
  hideDetails?: boolean
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  deferContent?: boolean
  virtualizeDiff?: boolean
  onContentRendered?: () => void
  forceOpen?: boolean
  locked?: boolean
}

export type ToolComponent = Component<ToolComponentProps>

const toolState: Record<string, { name: string; render?: ToolComponent }> = {}

export function registerTool(input: { name: string; render?: ToolComponent }): { name: string; render?: ToolComponent } {
  toolState[input.name] = input
  return input
}

export function getToolRenderer(name: string): ToolComponent | undefined {
  return toolState[name]?.render
}

export const ToolRegistry = {
  register: registerTool,
  render: getToolRenderer,
}
