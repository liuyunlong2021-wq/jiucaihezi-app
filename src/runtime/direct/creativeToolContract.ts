import type { DirectToolCall } from './directTypes'
import {
  loadWebSkillByName,
  readWebSkillResource,
  type WebLoadedSkill,
} from '@/utils/skillContentResolver'

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

export const CREATIVE_PROJECT_TOOL_DEFINITIONS = [
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

const fieldTypes: Record<string, Record<string, 'string' | 'boolean' | 'integer'>> = {
  skill: { name: 'string' },
  read: { path: 'string', offset: 'integer', limit: 'integer' },
  glob: { pattern: 'string', path: 'string', limit: 'integer' },
  grep: { pattern: 'string', path: 'string', include: 'string', limit: 'integer' },
  write: { path: 'string', content: 'string' },
  edit: { path: 'string', oldString: 'string', newString: 'string', replaceAll: 'boolean' },
}

export function parseCreativeToolArguments(call: DirectToolCall): Record<string, unknown> {
  let value: unknown
  try { value = JSON.parse(call.function.arguments || '{}') }
  catch { throw new Error(`工具参数不是合法 JSON: ${call.function.name}`) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('工具参数必须是对象')
  const args = value as Record<string, unknown>
  const types = fieldTypes[call.function.name]
  if (!types) throw new Error(`Unsupported tool: ${call.function.name}`)
  for (const [key, item] of Object.entries(args)) {
    const expected = types[key]
    if (!expected) throw new Error(`工具参数不支持: ${key}`)
    if (expected === 'integer' ? !Number.isInteger(item) : typeof item !== expected) {
      throw new Error(`工具参数类型无效: ${key}`)
    }
  }
  for (const field of CREATIVE_PROJECT_TOOL_DEFINITIONS.find(tool => tool.function.name === call.function.name)!.function.parameters.required) {
    if (!(field in args)) throw new Error(`缺少工具参数: ${field}`)
  }
  return args
}

export function boundedInteger(value: unknown, fallback: number, maximum = 1000): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(1, Math.min(Math.floor(number), maximum))
}

export function linesPage(content: string, offsetValue: unknown, limitValue: unknown): string {
  const lines = content.split(/\r?\n/)
  const offset = boundedInteger(offsetValue, 1)
  const limit = boundedInteger(limitValue, 200)
  return lines.slice(offset - 1, offset - 1 + limit).map((line, index) => `${offset + index}: ${line}`).join('\n')
}

export function normalizeCreativeProjectPath(input: string, allowRoot = false): string {
  const raw = String(input || '').replace(/\\/g, '/')
  if (raw.startsWith('/') || raw.includes('\0')) throw new Error('项目路径无效')
  const parts = raw.split('/').filter(part => part && part !== '.')
  if (parts.some(part => part === '..')) throw new Error('项目路径不能越过项目根目录')
  const path = parts.join('/')
  if (!path && !allowRoot) throw new Error('项目路径不能为空')
  return path
}

export function globMatcher(pattern: string): RegExp {
  const value = normalizeCreativeProjectPath(pattern)
  let source = '^'
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === '*' && value[index + 1] === '*') {
      if (value[index + 2] === '/') {
        source += '(?:.*/)?'
        index += 2
      } else {
        source += '.*'
        index += 1
      }
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
  }
  return new RegExp(`${source}$`, 'u')
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

export function createCreativeSkillSession(fetcher: typeof fetch = fetch) {
  const loadedSkills = new Map<string, WebLoadedSkill>()

  return {
    async load(name: string): Promise<string> {
      const skill = await loadWebSkillByName(name, fetcher)
      loadedSkills.set(skill.baseDirectory, skill)
      return skillOutput(skill)
    },
    async read(path: string): Promise<string | null> {
      const skill = [...loadedSkills.values()].find(item => path.startsWith(`${item.baseDirectory}/`))
      if (!skill) return null
      const relative = path.slice(skill.baseDirectory.length + 1)
      if (!skill.files.includes(relative)) throw new Error(`Skill 资源不存在: ${relative}`)
      return await readWebSkillResource(skill.baseDirectory, relative, fetcher)
    },
  }
}
