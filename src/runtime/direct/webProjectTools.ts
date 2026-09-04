import type { DirectToolExecutor, DirectToolResult } from './directTypes'
import type { createWebProjectFiles } from '@/utils/webProjectFiles'
import {
  boundedInteger,
  createCreativeSkillSession,
  linesPage,
  parseCreativeToolArguments,
  CREATIVE_PROJECT_TOOL_DEFINITIONS,
  MEMORY_ARTIFACT_TOOL_DEFINITIONS,
  MEMORY_FILE_TOOL_DEFINITIONS,
} from './creativeToolContract'
import { executeMcpBridgeToolCall, getMcpServerBridgeToolDefinitions } from '@/runtime/tools/mcpBridge'
import {
  artifactFilename,
  createArtifactHtml,
  createDocumentArtifact,
  createMarkdownSlidesArtifact,
  renderMemoryArtifactImage,
  type MemoryImageRenderer,
} from '@/runtime/memory/memoryArtifactTools'
import {
  isAuthorizedMemoryConversationPath,
  isMemoryConversationPath,
} from '@/utils/memoryProjectPaths'

type WebProjectFiles = ReturnType<typeof createWebProjectFiles>

// `terminal` is Desktop-only; never advertise an unavailable tool to Web models.
export const WEB_PROJECT_TOOL_DEFINITIONS = CREATIVE_PROJECT_TOOL_DEFINITIONS.filter(
  tool => !['terminal', 'skill'].includes(tool.function.name),
)

export function buildWebProjectToolDefinitions() {
  return [...WEB_PROJECT_TOOL_DEFINITIONS]
}

export function buildMemoryWebProjectToolDefinitions() {
  const coreTools = [
    ...WEB_PROJECT_TOOL_DEFINITIONS,
    ...MEMORY_FILE_TOOL_DEFINITIONS,
    ...MEMORY_ARTIFACT_TOOL_DEFINITIONS,
  ].filter(tool => !['create_3d_scene', 'edit_3d_scene'].includes(tool.function.name))
  const coreToolNames = coreTools.map(tool => tool.function.name)
  return [...coreTools, ...getMcpServerBridgeToolDefinitions({ coreToolNames })]
}

export function createWebProjectToolExecutor(input: {
  projectId: string
  files: WebProjectFiles
  fetcher?: typeof fetch
  renderImage?: MemoryImageRenderer
  authorizedRawPaths?: string[]
  preloadSkills?: string[]
}): DirectToolExecutor {
  const fetcher = input.fetcher || fetch
  const skills = createCreativeSkillSession(fetcher)
  let preloadPromise: Promise<void> | null = null
  const ensurePreloadedSkills = () => {
    preloadPromise ||= Promise.all((input.preloadSkills || []).map(name => skills.load(name))).then(
      () => undefined,
    )
    return preloadPromise
  }

  function requireProject(): string {
    if (!input.projectId) throw new Error('请先在第二列创建或选择项目')
    return input.projectId
  }

  return async (call, signal): Promise<DirectToolResult> => {
    signal?.throwIfAborted()
    const args = parseCreativeToolArguments(call)
    const name = call.function.name

    if (name === 'read') await ensurePreloadedSkills()

    if (name === 'skill') {
      throw new Error('Web 端不支持动态 Skill 工具，请在本轮直接选择具体 Skill')
    }

    if (name === 'read') {
      const rawPath = String(args.path || '')
      const resource = await skills.read(rawPath)
      if (resource !== null) return { content: linesPage(resource, args.offset, args.limit) }
      if (rawPath === '.' || rawPath === '') {
        const offset = boundedInteger(args.offset, 1)
        const limit = boundedInteger(args.limit, 200)
        const children = (await input.files.list(requireProject()))
          .filter(item => !item.path.includes('/') && !isMemoryConversationPath(item.path))
          .slice(offset - 1, offset - 1 + limit)
        return {
          content:
            children.map(item => `${item.isDir ? 'dir' : 'file'}\t${item.path}`).join('\n') ||
            'Directory is empty',
        }
      }

      if (
        isMemoryConversationPath(rawPath) &&
        !isAuthorizedMemoryConversationPath(rawPath, input.authorizedRawPaths)
      )
        throw new Error('模型不能读取 Raw 对话记录')
      const entry = await input.files.read(requireProject(), rawPath)
      if (entry.mimeType === 'folder') {
        const prefix = String(entry.metadata?.relativePath || '')
        const offset = boundedInteger(args.offset, 1)
        const limit = boundedInteger(args.limit, 200)
        const children = (await input.files.list(input.projectId))
          .filter(
            item =>
              !isMemoryConversationPath(item.path) &&
              item.path.startsWith(`${prefix}/`) &&
              !item.path.slice(prefix.length + 1).includes('/'),
          )
          .slice(offset - 1, offset - 1 + limit)
        return {
          content:
            children.map(item => `${item.isDir ? 'dir' : 'file'}\t${item.path}`).join('\n') ||
            'Directory is empty',
        }
      }
      if (entry.metadata?.binaryStorage === 'opfs') {
        if (entry.mimeType.startsWith('image/')) {
          const url = await input.files.readBinaryDataUrl(requireProject(), rawPath)
          return {
            content: `Image read successfully: ${rawPath}`,
            followupMessages: [
              { role: 'user', content: [{ type: 'image_url', image_url: { url } }] },
            ],
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
          followupMessages: [
            { role: 'user', content: [{ type: 'image_url', image_url: { url } }] },
          ],
        }
      }
      return { content: linesPage(entry.content, args.offset, args.limit) }
    }

    if (name === 'glob') {
      const prefix = String(args.path || '').replace(/^\/+|\/+$/g, '')
      if (isMemoryConversationPath(prefix)) throw new Error('模型不能搜索 Raw 对话记录')
      const pattern = prefix
        ? `${prefix}/${String(args.pattern || '')}`
        : String(args.pattern || '')
      const result = (await input.files.glob(requireProject(), pattern))
        .filter(item => !isMemoryConversationPath(item.path))
        .slice(0, boundedInteger(args.limit, 200))
      return { content: result.map(item => item.path).join('\n') || 'No files found' }
    }

    if (name === 'grep') {
      const prefix = String(args.path || '').replace(/^\/+|\/+$/g, '')
      if (isMemoryConversationPath(prefix)) throw new Error('模型不能搜索 Raw 对话记录')
      const include = String(args.include || '').replace(/^\*+/, '')
      const result = (
        await input.files.grep(
          requireProject(),
          String(args.pattern || ''),
          boundedInteger(args.limit, 1000),
        )
      ).filter(
        item =>
          !isMemoryConversationPath(item.path) &&
          (!prefix || item.path === prefix || item.path.startsWith(`${prefix}/`)) &&
          (!include || item.path.endsWith(include)),
      )
      if (!result.length) return { content: 'No files found' }
      return {
        content: [
          'Found ' + result.length + ' matches',
          ...result.map(item => `${item.path}: Line ${item.line}: ${item.text}`),
        ].join('\n'),
      }
    }

    if (name === 'write') {
      const file = await input.files.write(
        requireProject(),
        String(args.path || ''),
        String(args.content ?? ''),
      )
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

    if (name === 'mkdir') {
      const entry = await input.files.createFolder(requireProject(), String(args.path || ''))
      return { content: `已创建文件夹: ${entry.metadata?.relativePath}` }
    }

    if (name === 'move') {
      const entry = await input.files.rename(
        requireProject(),
        String(args.path || ''),
        String(args.destination || ''),
      )
      return { content: `已移动: ${args.path} -> ${entry.metadata?.relativePath}` }
    }

    if (name === 'delete') {
      await input.files.remove(requireProject(), String(args.path || ''))
      return { content: `已删除浏览器本地项目资源: ${args.path}` }
    }

    if (name.startsWith('mcp__')) {
      return { content: await executeMcpBridgeToolCall(name, args) }
    }

    if (name === 'export_markdown_png') {
      const blob = await (input.renderImage || renderMemoryArtifactImage)({
        title: String(args.title),
        content: String(args.content),
        width: args.width as number | undefined,
      })
      signal?.throwIfAborted()
      const entry = await input.files.writeBinary(
        requireProject(),
        `.raw/jc-media/图片/${artifactFilename(String(args.title), 'png')}`,
        blob,
        { category: 'image', mimeType: 'image/png', collision: 'keep-both' },
      )
      return { content: `已导出 Markdown 图片: ${entry.metadata?.relativePath}` }
    }

    if (name === 'create_document') {
      const artifact = createDocumentArtifact(
        String(args.title),
        String(args.content),
        String(args.format) as 'docx' | 'md' | 'txt',
      )
      const requestedPath = `.raw/jc-media/文档/${artifact.filename}`
      const entry =
        typeof artifact.data === 'string'
          ? await input.files.write(requireProject(), requestedPath, artifact.data, {
              collision: 'keep-both',
            })
          : await input.files.writeBinary(
              requireProject(),
              requestedPath,
              new Blob([artifact.data as BlobPart], { type: artifact.mimeType }),
              {
                category: 'binary',
                mimeType: artifact.mimeType,
                collision: 'keep-both',
              },
            )
      return { content: `已生成文档: ${entry.metadata?.relativePath}` }
    }

    if (name === 'create_html') {
      const entry = await input.files.write(
        requireProject(),
        `.raw/jc-media/文档/${artifactFilename(String(args.title), 'html')}`,
        createArtifactHtml(String(args.title), String(args.content)),
        { collision: 'keep-both' },
      )
      return { content: `已生成 HTML: ${entry.metadata?.relativePath}` }
    }

    if (name === 'export_markdown_slides') {
      const artifact = await createMarkdownSlidesArtifact(
        String(args.title),
        String(args.content),
        String(args.format) as 'html' | 'pdf' | 'pptx',
      )
      signal?.throwIfAborted()
      const requestedPath = `.raw/jc-media/文档/${artifact.filename}`
      const entry =
        typeof artifact.data === 'string'
          ? await input.files.write(requireProject(), requestedPath, artifact.data, {
              collision: 'keep-both',
            })
          : await input.files.writeBinary(
              requireProject(),
              requestedPath,
              new Blob([artifact.data as BlobPart], { type: artifact.mimeType }),
              {
                category: 'binary',
                mimeType: artifact.mimeType,
                collision: 'keep-both',
              },
            )
      return { content: `已生成 Markdown 幻灯片: ${entry.metadata?.relativePath}` }
    }

    throw new Error(`Unsupported tool: ${name}`)
  }
}
