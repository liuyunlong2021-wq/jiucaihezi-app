import type { DirectToolCall, DirectToolExecutor, DirectToolResult } from './directTypes'
import type { createWebProjectFiles } from '@/utils/webProjectFiles'
import {
  loadWebSkillByName,
  readWebSkillResource,
  type WebLoadedSkill,
} from '@/utils/skillContentResolver'

type WebProjectFiles = ReturnType<typeof createWebProjectFiles>

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return {
    type: 'function' as const,
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
    },
  }
}

const pathProperty = { type: 'string', description: 'Path relative to the current project' }

export const WEB_PROJECT_TOOL_DEFINITIONS = [
  tool('skill', 'Load a specialized Skill from the available skills list.', {
    name: { type: 'string', description: 'Exact Skill name from the available skills list' },
  }, ['name']),
  tool('read', 'Read a directory, UTF-8 text file, supported image, or a loaded Skill resource.', {
    path: pathProperty,
    offset: { type: 'integer', description: 'Optional 1-based line offset', minimum: 1 },
    limit: { type: 'integer', description: 'Optional maximum lines or entries', minimum: 1, maximum: 1000 },
  }, ['path']),
  tool('glob', 'Find current-project files by glob pattern.', {
    pattern: { type: 'string', description: 'Glob pattern such as wiki/**/*.md' },
    path: { type: 'string', description: 'Optional project subdirectory' },
    limit: { type: 'integer', description: 'Optional maximum results', minimum: 1, maximum: 1000 },
  }, ['pattern']),
  tool('grep', 'Search current-project UTF-8 text files by regular expression.', {
    pattern: { type: 'string', description: 'Regular expression to search for' },
    path: { type: 'string', description: 'Optional project path prefix' },
    include: { type: 'string', description: 'Optional filename glob' },
    limit: { type: 'integer', description: 'Optional maximum matches', minimum: 1, maximum: 1000 },
  }, ['pattern']),
  tool('write', 'Create or overwrite one UTF-8 file in the current project.', {
    path: pathProperty,
    content: { type: 'string', description: 'Complete file content' },
  }, ['path', 'content']),
  tool('edit', 'Replace exact text in one current-project file.', {
    path: pathProperty,
    oldString: { type: 'string', description: 'Exact text to replace' },
    newString: { type: 'string', description: 'Replacement text' },
    replaceAll: { type: 'boolean', description: 'Replace every exact occurrence when true' },
  }, ['path', 'oldString', 'newString']),
]

function parseArguments(call: DirectToolCall): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(call.function.arguments || '{}') }
  catch { throw new Error(`工具参数不是合法 JSON: ${call.function.name}`) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('工具参数必须是对象')
  return value as Record<string, unknown>
}

function boundedInteger(value: unknown, fallback: number, maximum = 1000): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(1, Math.min(Math.floor(number), maximum))
}

function linesPage(content: string, offsetValue: unknown, limitValue: unknown): string {
  const lines = content.split(/\r?\n/)
  const offset = boundedInteger(offsetValue, 1)
  const limit = boundedInteger(limitValue, 200)
  return lines.slice(offset - 1, offset - 1 + limit).map((line, index) => `${offset + index}: ${line}`).join('\n')
}

function skillOutput(skill: WebLoadedSkill): string {
  return [
    `<skill_content name="${skill.name}">`,
    `# Skill: ${skill.name}`,
    '',
    skill.content.trim(),
    '',
    `Base directory for this skill: ${skill.baseDirectory}`,
    'Relative paths in this skill are relative to this base directory.',
    '<skill_files>',
    ...skill.files.filter(path => path !== 'SKILL.md').slice(0, 10).map(path => `<file>${path}</file>`),
    '</skill_files>',
    '</skill_content>',
  ].join('\n')
}

export function createWebProjectToolExecutor(input: {
  projectId: string
  files: WebProjectFiles
  fetcher?: typeof fetch
}): DirectToolExecutor {
  const fetcher = input.fetcher || fetch
  const loadedSkills = new Map<string, WebLoadedSkill>()

  function requireProject(): string {
    if (!input.projectId) throw new Error('请先在第二列创建或选择项目')
    return input.projectId
  }

  return async (call): Promise<DirectToolResult> => {
    const args = parseArguments(call)
    const name = call.function.name

    if (name === 'skill') {
      const skill = await loadWebSkillByName(String(args.name || ''), fetcher)
      loadedSkills.set(skill.baseDirectory, skill)
      return { content: skillOutput(skill) }
    }

    if (name === 'read') {
      const rawPath = String(args.path || '')
      const loaded = [...loadedSkills.values()].find(skill => rawPath.startsWith(`${skill.baseDirectory}/`))
      if (loaded) {
        const relative = rawPath.slice(loaded.baseDirectory.length + 1)
        if (!loaded.files.includes(relative)) throw new Error(`Skill 资源不存在: ${relative}`)
        const content = await readWebSkillResource(loaded.baseDirectory, relative, fetcher)
        return { content: linesPage(content, args.offset, args.limit) }
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

    throw new Error(`Unsupported tool: ${name}`)
  }
}
