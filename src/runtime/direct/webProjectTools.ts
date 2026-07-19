import type { DirectToolCall, DirectToolExecutor, DirectToolResult } from './directTypes'
import type { createWebProjectFiles } from '@/utils/webProjectFiles'
import {
  boundedInteger,
  createCreativeSkillSession,
  linesPage,
  parseCreativeToolArguments,
  CREATIVE_PROJECT_TOOL_DEFINITIONS,
} from './creativeToolContract'
import { executeMcpBridgeToolCall, getMcpBridgeToolDefinitions, isMcpToolName } from '@/runtime/tools/mcpBridge'

type WebProjectFiles = ReturnType<typeof createWebProjectFiles>

// `terminal` is Desktop-only; never advertise an unavailable tool to Web models.
export const WEB_PROJECT_TOOL_DEFINITIONS = CREATIVE_PROJECT_TOOL_DEFINITIONS
  .filter(tool => tool.function.name !== 'terminal')

const WEB_CORE_TOOL_NAMES = WEB_PROJECT_TOOL_DEFINITIONS.map(tool => tool.function.name)

export function buildWebProjectToolDefinitions() {
  return [
    ...WEB_PROJECT_TOOL_DEFINITIONS,
    ...getMcpBridgeToolDefinitions({ coreToolNames: WEB_CORE_TOOL_NAMES }),
  ]
}

export function createWebProjectToolExecutor(input: {
  projectId: string
  files: WebProjectFiles
  fetcher?: typeof fetch
}): DirectToolExecutor {
  const fetcher = input.fetcher || fetch
  const skills = createCreativeSkillSession(fetcher)

  function requireProject(): string {
    if (!input.projectId) throw new Error('请先在第二列创建或选择项目')
    return input.projectId
  }

  return async (call): Promise<DirectToolResult> => {
    const args = parseCreativeToolArguments(call)
    const name = call.function.name

    if (name === 'skill') {
      return { content: await skills.load(String(args.name)) }
    }

    if (name === 'read') {
      const rawPath = String(args.path || '')
      const resource = await skills.read(rawPath)
      if (resource !== null) return { content: linesPage(resource, args.offset, args.limit) }

      if (rawPath === '.' || rawPath === '') {
        const offset = boundedInteger(args.offset, 1)
        const limit = boundedInteger(args.limit, 200)
        const children = (await input.files.list(requireProject()))
          .filter(item => !item.path.includes('/'))
          .slice(offset - 1, offset - 1 + limit)
        return { content: children.map(item => `${item.isDir ? 'dir' : 'file'}\t${item.path}`).join('\n') || 'Directory is empty' }
      }

      const entry = await input.files.read(requireProject(), rawPath)
      if (entry.mimeType === 'folder') {
        const prefix = String(entry.metadata?.relativePath || '')
        const offset = boundedInteger(args.offset, 1)
        const limit = boundedInteger(args.limit, 200)
        const children = (await input.files.list(input.projectId))
          .filter(item => item.path.startsWith(`${prefix}/`) && !item.path.slice(prefix.length + 1).includes('/'))
          .slice(offset - 1, offset - 1 + limit)
        return { content: children.map(item => `${item.isDir ? 'dir' : 'file'}\t${item.path}`).join('\n') || 'Directory is empty' }
      }
      if (entry.metadata?.binaryStorage === 'opfs') {
        if (entry.mimeType.startsWith('image/')) {
          const url = await input.files.readBinaryDataUrl(requireProject(), rawPath)
          return {
            content: `Image read successfully: ${rawPath}`,
            followupMessages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }],
          }
        }
        return {
          content: [
            `Binary ${entry.category} file: ${rawPath}`,
            `MIME: ${entry.mimeType}`,
            `Size: ${entry.size} bytes`,
            `Path: ${rawPath}`,
          ].join('\n'),
        }
      }
      if (entry.mimeType.startsWith('image/')) {
        const url = String(entry.metadata?.sourceUrl || entry.content || '')
        if (!url) throw new Error(`图片内容为空: ${rawPath}`)
        return {
          content: `Image read successfully: ${rawPath}`,
          followupMessages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url } }] }],
        }
      }
      return { content: linesPage(entry.content, args.offset, args.limit) }
    }

    if (name === 'glob') {
      const prefix = String(args.path || '').replace(/^\/+|\/+$/g, '')
      const pattern = prefix ? `${prefix}/${String(args.pattern || '')}` : String(args.pattern || '')
      const result = (await input.files.glob(requireProject(), pattern)).slice(0, boundedInteger(args.limit, 200))
      return { content: result.map(item => item.path).join('\n') || 'No files found' }
    }

    if (name === 'grep') {
      const prefix = String(args.path || '').replace(/^\/+|\/+$/g, '')
      const include = String(args.include || '').replace(/^\*+/, '')
      const result = (await input.files.grep(requireProject(), String(args.pattern || ''), boundedInteger(args.limit, 1000)))
        .filter(item => (!prefix || item.path === prefix || item.path.startsWith(`${prefix}/`)) && (!include || item.path.endsWith(include)))
      if (!result.length) return { content: 'No files found' }
      return { content: ['Found ' + result.length + ' matches', ...result.map(item => `${item.path}: Line ${item.line}: ${item.text}`)].join('\n') }
    }

    if (name === 'write') {
      const file = await input.files.write(requireProject(), String(args.path || ''), String(args.content ?? ''))
      return { content: `Wrote file successfully: ${file.metadata?.relativePath}` }
    }

    if (name === 'edit') {
      const replacements = await input.files.edit(
        requireProject(),
        String(args.path || ''),
        String(args.oldString ?? ''),
        String(args.newString ?? ''),
        args.replaceAll === true,
      )
      return { content: `Edited file successfully: ${args.path}\nReplacements: ${replacements}` }
    }

    if (isMcpToolName(name)) {
      return { content: await executeMcpBridgeToolCall(name, args) }
    }

    throw new Error(`Unsupported tool: ${name}`)
  }
}
