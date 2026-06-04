import type { ToolExecutor } from './types'

export type ToolExecutorRegistry = Record<string, ToolExecutor>

export function normalizeToolName(name: string): string {
  return String(name || '').trim()
}

export function getRegisteredExecutor(
  executors: ToolExecutorRegistry,
  toolName: string,
): ToolExecutor | undefined {
  return executors[normalizeToolName(toolName)]
}

