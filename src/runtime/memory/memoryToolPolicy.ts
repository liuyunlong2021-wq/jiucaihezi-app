import type { DirectToolCall } from '@/runtime/direct/directTypes'
import { isMcpToolReadOnly } from '@/runtime/tools/mcpBridge'
import { resolveCreativeProjectPath } from '@/runtime/direct/creativeToolContract'

function argumentsOf(call: DirectToolCall): Record<string, unknown> {
  try {
    const value = JSON.parse(call.function.arguments || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

function isAbsolutePath(path: string): boolean {
  return !path.startsWith('skill://')
    && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path)
}

function isPathExplicitlyMentioned(text: string, path: string): boolean {
  let index = text.indexOf(path)
  while (index >= 0) {
    const before = text[index - 1]
    const after = text[index + path.length]
    const boundary = (value: string | undefined) => value === undefined || /[\s'"`，。；：、！？（）【】《》]/u.test(value)
    if (boundary(before) && boundary(after)) return true
    index = text.indexOf(path, index + 1)
  }
  return false
}

export function memoryToolNeedsApproval(call: DirectToolCall, currentUserText: string, projectRoot = ''): boolean {
  const name = call.function.name
  const args = argumentsOf(call)
  const paths = [args.path, args.workdir].filter((value): value is string => typeof value === 'string'
    && isAbsolutePath(value)
    && resolveCreativeProjectPath(value, projectRoot, true).external)
  for (const path of paths) {
    if (!isPathExplicitlyMentioned(currentUserText, path)) throw new Error(`项目外路径必须由用户在本轮明确提供: ${path}`)
  }
  if (name === 'terminal' || name === 'delete' || name === 'export_3d_scene_video') return true
  if (name === 'wiki') {
    const action = String(args.action || '')
    if (action === 'apply' && Array.isArray(args.operations)) {
      const operations = args.operations as Array<Record<string, unknown>>
      if (operations.some(operation => operation.kind === 'move' || operation.kind === 'trash')) return true
      if (operations.some(operation => operation.kind === 'replace' && operation.replaceAll === true)) return true
    }
    return action === 'scaffold' || action === 'graph'
      || (args.apply === true && ['replace', 'extend'].includes(action))
  }
  if ((name === 'write' || name === 'edit') && paths.length) return true
  if (name.startsWith('mcp__')) return !isMcpToolReadOnly(name)
  return false
}
