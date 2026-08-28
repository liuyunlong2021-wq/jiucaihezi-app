import type { DirectToolCall } from './directTypes'
import { getMcpBridgeToolDefinitions, isMcpToolName } from '@/runtime/tools/mcpBridge'
import {
  loadWebSkillByName,
  readWebSkillResource,
  type WebLoadedSkill,
} from '@/utils/skillContentResolver'

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
) {
  return {
    type: 'function' as const,
    function: {
      name,
      description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
    },
  }
}

const pathProperty = {
  type: 'string',
  description:
    'Path relative to the current project, or an absolute path after the user approves this task',
}
const vectorProperty = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }
const wikiQueryProperty = {
  anyOf: [
    { type: 'string' },
    { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
  ],
  description: 'One search term or 1-3 search terms scanned together in the current project Wiki',
}

export const WIKI_SEARCH_TOOL_DEFINITION = tool(
  'wiki_search',
  'Search the current project Wiki read-only. Use it only when the answer depends on project facts.',
  {
    query: wikiQueryProperty,
    scope: {
      type: 'string',
      enum: ['active', 'all'],
      description: 'active excludes archived knowledge; all includes it',
    },
    limit: { type: 'integer', minimum: 1, maximum: 1000 },
  },
  ['query'],
)

export const WIKI_CONTEXT_TOOL_DEFINITION = tool(
  'wiki_context',
  'Read the current project Wiki progressively. Start with entry or tree, then read only explicit paths or run a precise search/link query.',
  {
    action: { type: 'string', enum: ['entry', 'tree', 'read', 'search', 'links'] },
    scope: { type: 'string', enum: ['active', 'all'] },
    entryPath: { type: 'string' },
    paths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 12 },
    query: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
    maxPages: { type: 'integer', minimum: 1, maximum: 12 },
    maxTokens: { type: 'integer', minimum: 1000, maximum: 50000 },
  },
  ['action'],
)

export const CREATIVE_PROJECT_TOOL_DEFINITIONS = [
  tool(
    'skill',
    'Load a specialized Skill from the available skills list.',
    {
      name: { type: 'string', description: 'Exact Skill name from the available skills list' },
    },
    ['name'],
  ),
  WIKI_CONTEXT_TOOL_DEFINITION,
  tool(
    'wiki',
    'Run native deterministic project Wiki operations without Python, Node, or Wiki Skill loading. For creating a Wiki from supplied content, call scaffold once with the complete plan; the program validates and writes the whole plan in one batch.',
    {
      action: {
        type: 'string',
        enum: ['apply', 'scaffold', 'status', 'graph', 'validate', 'audit'],
      },
      type: {
        type: 'string',
        enum: [
          'dev_project',
          'novel',
          'manju',
          'short_story',
          'film',
          'tv_series',
          'advertisement',
          'generic',
        ],
      },
      plan: {
        type: 'object',
        description: 'Complete batch plan for action=scaffold. Paths are relative to the Wiki root; use type=generic for a custom structure.',
        properties: {
          directories: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 200,
          },
          files: {
            type: 'array',
            maxItems: 200,
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'Markdown path relative to the Wiki root' },
                content: { type: 'string' },
              },
              required: ['path', 'content'],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      query: wikiQueryProperty,
      scope: { type: 'string', enum: ['active', 'all'] },
      limit: { type: 'integer', minimum: 1, maximum: 1000 },
      depth: {
        type: 'integer',
        minimum: 1,
        maximum: 2,
        description: 'Relationship graph depth from confirmed seed pages',
      },
      evidencePaths: { type: 'array', items: { type: 'string' } },
      path: { type: 'string', description: 'Project-relative Wiki file or evidence path' },
      oldText: { type: 'string' },
      newText: { type: 'string' },
      replaceAll: {
        type: 'boolean',
        description: 'Only after explicit confirmation, replace every match in this one file',
      },
      category: { type: 'string' },
      description: { type: 'string' },
      reason: { type: 'string', description: 'Confirmed problem being repaired' },
      basis: {
        anyOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' }, minItems: 1 },
        ],
        description: 'User decisions, sources, or inspection items supporting the change',
      },
      confirmedPlanId: {
        type: 'string',
        description: 'Required for move or trash after the user confirms the complete preview',
      },
      operations: {
        type: 'array',
        minItems: 1,
        maxItems: 200,
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['mkdir', 'create', 'replace', 'append', 'move', 'trash'] },
            path: { type: 'string' },
            destination: { type: 'string' },
            purpose: { type: 'string' },
            content: { type: 'string' },
            title: { type: 'string' },
            summary: { type: 'string' },
            oldText: { type: 'string' },
            newText: { type: 'string' },
            replaceAll: { type: 'boolean' },
            idempotencyKey: { type: 'string' },
          },
          required: ['kind', 'path'],
          additionalProperties: false,
        },
      },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            wikiPath: { type: 'string' },
            wikiSection: { type: 'string' },
            sourceRole: { type: 'string' },
            sourcePath: { type: 'string' },
            processedScope: { type: 'string' },
          },
          required: ['wikiPath', 'sourceRole', 'sourcePath', 'processedScope'],
          additionalProperties: false,
        },
      },
      apply: {
        type: 'boolean',
        description: 'Omit or false for preview; true only after confirmation',
      },
    },
    ['action'],
  ),
  tool(
    'read',
    'Read a directory, UTF-8 text file, supported image, or a loaded Skill resource. Relative paths use the current project; user-approved absolute paths are also supported.',
    {
      path: pathProperty,
      offset: { type: 'integer', description: 'Optional 1-based line offset', minimum: 1 },
      limit: {
        type: 'integer',
        description: 'Optional maximum lines or entries',
        minimum: 1,
        maximum: 1000,
      },
    },
    ['path'],
  ),
  tool(
    'glob',
    'Find files by glob pattern. Relative paths use the current project; user-approved absolute paths are also supported.',
    {
      pattern: { type: 'string', description: 'Glob pattern such as wiki/**/*.md' },
      path: {
        type: 'string',
        description: 'Optional project subdirectory or approved absolute directory',
      },
      limit: {
        type: 'integer',
        description: 'Optional maximum results',
        minimum: 1,
        maximum: 1000,
      },
    },
    ['pattern'],
  ),
  tool(
    'grep',
    'Search UTF-8 text files by regular expression. Relative paths use the current project; user-approved absolute paths are also supported.',
    {
      pattern: { type: 'string', description: 'Regular expression to search for' },
      path: {
        type: 'string',
        description: 'Optional project path prefix or approved absolute directory',
      },
      include: { type: 'string', description: 'Optional filename glob' },
      limit: {
        type: 'integer',
        description: 'Optional maximum matches',
        minimum: 1,
        maximum: 1000,
      },
    },
    ['pattern'],
  ),
  tool(
    'write',
    'Create or overwrite one UTF-8 file. Relative paths use the current project; user-approved absolute paths are also supported.',
    {
      path: pathProperty,
      content: { type: 'string', description: 'Complete file content' },
    },
    ['path', 'content'],
  ),
  tool(
    'edit',
    'Replace exact text in one file. Relative paths use the current project; user-approved absolute paths are also supported.',
    {
      path: pathProperty,
      oldString: { type: 'string', description: 'Exact text to replace' },
      newString: { type: 'string', description: 'Replacement text' },
      replaceAll: { type: 'boolean', description: 'Replace every exact occurrence when true' },
    },
    ['path', 'oldString', 'newString'],
  ),
  tool(
    'terminal',
    'Run a shell command after the user approves it. Use an attachment token only when this task explicitly lists that exact token; use absolute paths supplied in user text directly. If a command fails, inspect its output and choose an alternative command, the Skill fallback, or install and verify a missing dependency before retrying; do not repeat the same failed command unchanged.',
    {
      command: { type: 'string', description: 'The shell command to run' },
      reason: {
        type: 'string',
        description:
          'Use plain Chinese to explain what this will do and what it may affect; do not use technical jargon',
      },
      workdir: {
        type: 'string',
        description:
          'Optional project-relative working directory, or a user-approved absolute directory',
      },
      timeoutSeconds: {
        type: 'integer',
        description: 'Optional timeout in seconds',
        minimum: 1,
        maximum: 900,
      },
    },
    ['command'],
  ),
]

export const MEMORY_FILE_TOOL_DEFINITIONS = [
  tool(
    'mkdir',
    'Create a directory inside the current project, including missing parent directories.',
    {
      path: { type: 'string', description: 'Project-relative directory path' },
    },
    ['path'],
  ),
  tool(
    'move',
    'Move or rename one file or directory inside the current project.',
    {
      path: { type: 'string', description: 'Existing project-relative path' },
      destination: {
        type: 'string',
        description: 'New project-relative path, including the final name',
      },
    },
    ['path', 'destination'],
  ),
  tool(
    'delete',
    'Move one project file or directory to the system trash on Desktop, or delete it from the browser-local project on Web. Always requires user approval.',
    {
      path: { type: 'string', description: 'Existing project-relative path' },
    },
    ['path'],
  ),
]

export const MEMORY_ARTIFACT_TOOL_DEFINITIONS = [
  tool(
    'export_markdown_png',
    'Export existing text or Markdown as a styled PNG. Do not use it to create a new photo, illustration, product image, or other visual.',
    {
      title: { type: 'string', description: 'Output title and filename without extension' },
      content: { type: 'string', description: 'Complete Markdown content to render' },
      width: { type: 'integer', description: 'Optional image width in pixels, from 480 to 1920' },
    },
    ['title', 'content'],
  ),
  tool(
    'create_document',
    'Create a real DOCX, Markdown, or text document in the project document materials folder.',
    {
      title: { type: 'string', description: 'Output title and filename without extension' },
      content: { type: 'string', description: 'Complete document content' },
      format: {
        type: 'string',
        enum: ['docx', 'md', 'txt'],
        description: 'Output document format',
      },
    },
    ['title', 'content', 'format'],
  ),
  tool(
    'create_html',
    'Save a complete standalone HTML document in the project document materials folder. Provide the full HTML including html, head with styles, and body.',
    {
      title: { type: 'string', description: 'Output title and filename without extension' },
      content: {
        type: 'string',
        description:
          'Complete standalone HTML document; plain Markdown is accepted only as a basic fallback',
      },
    },
    ['title', 'content'],
  ),
  tool(
    'export_markdown_slides',
    'Export Markdown slides separated by a line containing only --- as HTML, PDF, or an editable PPTX.',
    {
      title: { type: 'string', description: 'Output title and filename without extension' },
      content: {
        type: 'string',
        description: 'Complete Markdown slides; separate slides with a line containing only ---',
      },
      format: { type: 'string', enum: ['html', 'pdf', 'pptx'], description: 'Output slide format' },
    },
    ['title', 'content', 'format'],
  ),
  tool(
    'create_3d_scene',
    'Create or replace a lightweight local 3D blockout scene for spatial layout, character staging, camera composition, an image-generation reference, or a geometric explainer. For an animated explainer, divide the timeline into sections and add a camera action for every section instead of keeping one wide shot. Do not use it to generate a finished image or detailed 3D model.',
    {
      title: { type: 'string', description: 'Scene title and filename without extension' },
      existingPath: {
        type: 'string',
        description:
          'Optional existing .raw/jc-media/文档/*.jcscene path to replace after reading it; omit when creating',
      },
      objects: {
        type: 'array',
        description: 'Individually editable primitives. Use formations for repeated crowds.',
        maxItems: 500,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'position'],
          properties: {
            id: { type: 'string' },
            type: {
              type: 'string',
              enum: [
                'person',
                'box',
                'plane',
                'wall',
                'entrance',
                'cylinder',
                'sphere',
                'cone',
                'line',
                'arrow',
              ],
            },
            label: { type: 'string' },
            color: { type: 'string' },
            position: vectorProperty,
            rotation: vectorProperty,
            size: vectorProperty,
            end: vectorProperty,
            pose: { type: 'string', enum: ['standing', 'sitting', 'crouching', 'lying'] },
            character: {
              type: 'object',
              additionalProperties: false,
              required: ['model'],
              properties: {
                model: {
                  type: 'string',
                  enum: ['adult-male', 'adult-female', 'teen-male', 'teen-female', 'child'],
                },
                scale: { type: 'number', minimum: 0.1, maximum: 10 },
                bones: {
                  type: 'object',
                  additionalProperties: {
                    type: 'array',
                    minItems: 4,
                    maxItems: 4,
                    items: { type: 'number', minimum: -1, maximum: 1 },
                  },
                  description: '已确认骨骼名到单位四元数 [x,y,z,w] 的映射',
                },
              },
            },
          },
        },
      },
      formations: {
        type: 'array',
        description:
          'Repeated local arrangements; use one formation instead of hundreds of individual objects.',
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'type', 'count', 'position'],
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: ['line', 'grid', 'circle', 'scatter'] },
            shape: {
              type: 'string',
              enum: ['person', 'box', 'plane', 'wall', 'entrance', 'cylinder', 'sphere', 'cone'],
            },
            label: { type: 'string' },
            color: { type: 'string' },
            position: vectorProperty,
            count: { type: 'integer', minimum: 1, maximum: 10000 },
            rows: { type: 'integer', minimum: 1 },
            columns: { type: 'integer', minimum: 1 },
            spacing: { type: 'number', minimum: 0.1 },
            radius: { type: 'number', minimum: 0.1 },
            width: { type: 'number', minimum: 0.1 },
            depth: { type: 'number', minimum: 0.1 },
            facing: { type: 'number' },
            size: vectorProperty,
          },
        },
      },
      groups: {
        type: 'array',
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'memberIds'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            memberIds: { type: 'array', items: { type: 'string' } },
            position: vectorProperty,
          },
        },
      },
      camera: {
        type: 'object',
        description: 'Optional initial camera',
        additionalProperties: true,
      },
      savedCameras: {
        type: 'array',
        description: 'Optional named cameras',
        maxItems: 20,
        items: { type: 'object', additionalProperties: true },
      },
      lighting: {
        type: 'object',
        description:
          'direction(left/right/front/back/top), intensity(low/medium/high), shadows(boolean)',
        additionalProperties: true,
      },
      canvas: {
        type: 'object',
        description: 'aspect(16:9/9:16/1:1/4:3/3:4), grid(boolean), snap(boolean)',
        additionalProperties: true,
      },
      duration: {
        type: 'number',
        description: 'Optional animation duration in seconds, from 0.1 to 600',
        minimum: 0.1,
        maximum: 600,
      },
      timeline: {
        type: 'array',
        description:
          'Optional deterministic animation timeline. For each explainer section add a label and a camera action with target=camera, to=camera position, and lookAt=subject. A camera action without duration is a hard cut; with duration it is a push, pull, pan, or tracking move.',
        maxItems: 1000,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['at', 'target', 'action'],
          properties: {
            at: { type: 'number', minimum: 0 },
            duration: {
              type: 'number',
              minimum: 0,
              description:
                'Omit for an instant action or hard camera cut; set for continuous movement.',
            },
            target: {
              type: 'string',
              description: 'Object ID, group ID, scene, or camera. Camera actions use camera.',
            },
            action: {
              type: 'string',
              enum: ['show', 'hide', 'move', 'rotate', 'scale', 'color', 'camera', 'label'],
            },
            to: vectorProperty,
            lookAt: { ...vectorProperty, description: 'Camera subject or look direction target.' },
            color: { type: 'string' },
            text: { type: 'string' },
            easing: { type: 'string', enum: ['linear', 'ease-in-out'] },
          },
        },
      },
    },
    ['title', 'objects'],
  ),
  tool(
    'edit_3d_scene',
    'Incrementally edit the currently opened 3D blockout scene. Use this for ordinary add, move, remove, or camera requests. Do not recreate or replace the full scene unless the user explicitly asks to rebuild it.',
    {
      path: {
        type: 'string',
        description: 'Current project-relative .raw/jc-media/文档/*.jcscene path',
      },
      operations: {
        type: 'array',
        minItems: 1,
        maxItems: 100,
        items: {
          type: 'object',
          additionalProperties: true,
          required: ['action'],
          properties: {
            action: {
              type: 'string',
              enum: ['add_object', 'add_formation', 'move', 'remove', 'camera'],
            },
            object: {
              type: 'object',
              description: 'Complete new object using the create_3d_scene object contract',
            },
            formation: {
              type: 'object',
              description: 'Complete new formation using the create_3d_scene formation contract',
            },
            target: {
              type: 'string',
              description:
                'Existing object, formation, or group ID; for camera, the new look-at point is supplied in lookAt',
            },
            to: vectorProperty,
            position: vectorProperty,
            lookAt: vectorProperty,
          },
        },
      },
    },
    ['path', 'operations'],
  ),
]

const MEMORY_DESKTOP_VIDEO_TOOL_DEFINITIONS = [
  tool(
    'export_3d_scene_video',
    'Record an existing animated .jcscene with the local Three.js renderer and export it as H.264 MP4 using the computer system FFmpeg. Use only for local geometric explainers, after create_3d_scene has created a duration and timeline. This starts a local process and requires approval.',
    {
      path: {
        type: 'string',
        description: 'Existing project-relative .raw/jc-media/文档/*.jcscene path',
      },
    },
    ['path'],
  ),
]

const CORE_TOOL_NAMES = CREATIVE_PROJECT_TOOL_DEFINITIONS.map(tool => tool.function.name)
const MEMORY_DESKTOP_TOOL_DEFINITIONS = [
  ...CREATIVE_PROJECT_TOOL_DEFINITIONS.slice(0, -1),
  ...MEMORY_FILE_TOOL_DEFINITIONS,
  ...MEMORY_ARTIFACT_TOOL_DEFINITIONS,
  ...MEMORY_DESKTOP_VIDEO_TOOL_DEFINITIONS,
  CREATIVE_PROJECT_TOOL_DEFINITIONS.at(-1)!,
]

export function buildCreativeToolDefinitions() {
  return [
    ...CREATIVE_PROJECT_TOOL_DEFINITIONS,
    ...getMcpBridgeToolDefinitions({ coreToolNames: CORE_TOOL_NAMES }),
  ]
}

export function buildMemoryDesktopToolDefinitions() {
  const coreToolNames = MEMORY_DESKTOP_TOOL_DEFINITIONS.map(tool => tool.function.name)
  return [...MEMORY_DESKTOP_TOOL_DEFINITIONS, ...getMcpBridgeToolDefinitions({ coreToolNames })]
}

type ToolFieldType =
  | 'string'
  | 'boolean'
  | 'integer'
  | 'stringArray'
  | 'stringOrStringArray'
  | 'json'

const fieldTypes: Record<string, Record<string, ToolFieldType>> = {
  wiki_search: { query: 'stringOrStringArray', scope: 'string', limit: 'integer' },
  wiki_context: {
    action: 'string',
    scope: 'string',
    entryPath: 'string',
    paths: 'stringArray',
    query: 'stringArray',
    maxPages: 'integer',
    maxTokens: 'integer',
  },
  skill: { name: 'string' },
  wiki: {
    action: 'string',
    type: 'string',
    plan: 'json',
    query: 'stringOrStringArray',
    scope: 'string',
    limit: 'integer',
    depth: 'integer',
    evidencePaths: 'stringArray',
    path: 'string',
    oldText: 'string',
    newText: 'string',
    replaceAll: 'boolean',
    category: 'string',
    description: 'string',
    reason: 'string',
    basis: 'stringOrStringArray',
    apply: 'boolean',
    confirmedPlanId: 'string',
    operations: 'json',
    sources: 'json',
  },
  read: { path: 'string', offset: 'integer', limit: 'integer' },
  glob: { pattern: 'string', path: 'string', limit: 'integer' },
  grep: { pattern: 'string', path: 'string', include: 'string', limit: 'integer' },
  write: { path: 'string', content: 'string' },
  edit: { path: 'string', oldString: 'string', newString: 'string', replaceAll: 'boolean' },
  mkdir: { path: 'string' },
  move: { path: 'string', destination: 'string' },
  delete: { path: 'string' },
  export_markdown_png: { title: 'string', content: 'string', width: 'integer' },
  create_document: { title: 'string', content: 'string', format: 'string' },
  create_html: { title: 'string', content: 'string' },
  export_markdown_slides: { title: 'string', content: 'string', format: 'string' },
  create_3d_scene: {
    title: 'string',
    existingPath: 'string',
    objects: 'json',
    formations: 'json',
    groups: 'json',
    camera: 'json',
    savedCameras: 'json',
    lighting: 'json',
    canvas: 'json',
    duration: 'json',
    timeline: 'json',
  },
  edit_3d_scene: { path: 'string', operations: 'json' },
  export_3d_scene_video: { path: 'string' },
  terminal: { command: 'string', reason: 'string', workdir: 'string', timeoutSeconds: 'integer' },
}

export function parseCreativeToolArguments(call: DirectToolCall): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(call.function.arguments || '{}')
  } catch {
    throw new Error(`工具参数不是合法 JSON: ${call.function.name}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('工具参数必须是对象')
  const args = value as Record<string, unknown>
  if (isMcpToolName(call.function.name)) return args
  const types = fieldTypes[call.function.name]
  if (!types) throw new Error(`Unsupported tool: ${call.function.name}`)
  for (const [key, item] of Object.entries(args)) {
    const expected = types[key]
    if (!expected) throw new Error(`工具参数不支持: ${key}`)
    const invalid =
      expected === 'json'
        ? false
        : expected === 'stringOrStringArray'
          ? typeof item !== 'string' &&
            (!Array.isArray(item) || item.some(value => typeof value !== 'string'))
          : expected === 'integer'
            ? !Number.isInteger(item)
            : expected === 'stringArray'
              ? !Array.isArray(item) || item.some(value => typeof value !== 'string')
              : typeof item !== expected
    if (invalid) {
      throw new Error(`工具参数类型无效: ${key}`)
    }
  }
  const definition = [
    WIKI_SEARCH_TOOL_DEFINITION,
    ...CREATIVE_PROJECT_TOOL_DEFINITIONS,
    ...MEMORY_FILE_TOOL_DEFINITIONS,
    ...MEMORY_ARTIFACT_TOOL_DEFINITIONS,
    ...MEMORY_DESKTOP_VIDEO_TOOL_DEFINITIONS,
  ].find(tool => tool.function.name === call.function.name)!
  for (const field of definition.function.parameters.required) {
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
  const page = lines.slice(offset - 1, offset - 1 + limit)
  const end = page.length ? offset + page.length - 1 : Math.min(offset - 1, lines.length)
  return [
    `[lines ${page.length ? offset : 0}-${end} of ${lines.length}; eof=${end >= lines.length}]`,
    ...page.map((line, index) => `${offset + index}: ${line}`),
  ].join('\n')
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

export function resolveCreativeProjectPath(
  input: string,
  projectRoot: string,
  allowRoot = false,
): { path: string; external: boolean } {
  const raw = String(input || '').replace(/\\/g, '/')
  if (!/^(?:\/|[A-Za-z]:\/|\/\/)/.test(raw))
    return { path: normalizeCreativeProjectPath(raw, allowRoot), external: false }
  const root = String(projectRoot || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
  if (!root) return { path: raw, external: true }
  const insensitive = /^[A-Za-z]:\//.test(root)
  const comparableRaw = insensitive ? raw.toLowerCase() : raw
  const comparableRoot = insensitive ? root.toLowerCase() : root
  if (comparableRaw === comparableRoot)
    return { path: normalizeCreativeProjectPath('', allowRoot), external: false }
  if (comparableRaw.startsWith(`${comparableRoot}/`)) {
    return {
      path: normalizeCreativeProjectPath(raw.slice(root.length + 1), allowRoot),
      external: false,
    }
  }
  return { path: raw, external: true }
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
    ...skill.files
      .filter(path => path !== 'SKILL.md')
      .slice(0, 10)
      .map(path => `<file>${path}</file>`),
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
      const skill = [...loadedSkills.values()].find(item =>
        path.startsWith(`${item.baseDirectory}/`),
      )
      if (!skill) return null
      const relative = path.slice(skill.baseDirectory.length + 1)
      if (!skill.files.includes(relative)) throw new Error(`Skill 资源不存在: ${relative}`)
      return await readWebSkillResource(skill.baseDirectory, relative, fetcher)
    },
  }
}
