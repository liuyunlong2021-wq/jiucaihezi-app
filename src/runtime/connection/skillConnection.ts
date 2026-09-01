import type {
  ParsedSkillMd,
  SkillConnection,
  SkillConnectionResource,
  SkillSelectedBy,
} from './types'
import { parseSkillMd } from '@/types/skill'

export interface BuildSkillConnectionInput {
  id: string
  selectedBy: SkillSelectedBy
  skillMd: string
  resources?: SkillConnectionResource[]
}

export function parseSkillFrontmatter(skillMd: string): ParsedSkillMd {
  const fullSkillMd = String(skillMd || '')
  const match = fullSkillMd.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) {
    return {
      name: '',
      description: '',
      body: fullSkillMd.trim(),
      fullSkillMd,
      frontmatter: {},
    }
  }

  const frontmatter = parseFlatYaml(match[1])
  return {
    name: typeof frontmatter.name === 'string' ? frontmatter.name : '',
    description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
    body: fullSkillMd.slice(match[0].length).trim(),
    fullSkillMd,
    frontmatter,
  }
}

export function buildSkillConnection(input: BuildSkillConnectionInput): SkillConnection {
  const parsed = parseSkillFrontmatter(input.skillMd)
  return {
    id: input.id,
    name: parsed.name || input.id,
    description: parsed.description,
    selectedBy: input.selectedBy,
    fullSkillMd: parsed.fullSkillMd,
    body: parsed.body,
    resources: [...(input.resources || [])],
    allowedTools: parseSkillMd(parsed.fullSkillMd).allowedTools || [],
  }
}

function parseFlatYaml(text: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}
  let listKey = ''
  for (const line of text.split(/\r?\n/)) {
    const listItem = line.match(/^\s+-\s+(.+)$/)
    if (listItem && listKey) {
      const current = Array.isArray(result[listKey]) ? result[listKey] as string[] : []
      current.push(unquoteYamlScalar(listItem[1]!.trim()))
      result[listKey] = current
      continue
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    listKey = match[2].trim() ? '' : match[1]
    result[match[1]] = match[2].trim() ? unquoteYamlScalar(match[2].trim()) : []
  }
  return result
}

function unquoteYamlScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}
