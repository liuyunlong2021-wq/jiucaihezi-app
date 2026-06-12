import type { BrainWikiPage, SkillConfig } from '@/types/skill'

export interface BrainSuggestionDraft {
  id: string
  skillId: string
  skillName: string
  type: 'rule' | 'reference' | 'example' | 'trigger'
  content: string
  status: 'pending' | 'accepted' | 'ignored'
}

interface BuildBrainSuggestionsInput {
  skills: Array<Pick<SkillConfig, 'id' | 'name'>>
  pages: Array<Pick<BrainWikiPage, 'id' | 'skillId' | 'title' | 'content'>>
  maxPerPage?: number
}

const SECTION_PATTERNS: Array<{ type: BrainSuggestionDraft['type']; pattern: RegExp }> = [
  { type: 'trigger', pattern: /触发|适用场景|什么时候|路由|调用|使用时机/ },
  { type: 'rule', pattern: /规则|原则|要求|流程|边界|注意|必须|不要|应该|优先/ },
  { type: 'example', pattern: /示例|案例|例子|标准答案|参考输出|样例/ },
  { type: 'reference', pattern: /参考|引用|资料|来源|依据/ },
]

function cleanMarkdown(text: string): string {
  return String(text || '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

function splitSections(markdown: string): Array<{ heading: string; body: string }> {
  const sections: Array<{ heading: string; body: string }> = []
  let heading = ''
  let body: string[] = []

  for (const line of cleanMarkdown(markdown).split('\n')) {
    const match = line.match(/^#{1,4}\s+(.+)$/)
    if (match) {
      if (heading || body.join('\n').trim()) sections.push({ heading, body: body.join('\n').trim() })
      heading = match[1].trim()
      body = []
    } else {
      body.push(line)
    }
  }
  if (heading || body.join('\n').trim()) sections.push({ heading, body: body.join('\n').trim() })
  return sections
}

function compactSuggestion(text: string): string {
  return cleanMarkdown(text)
    .split('\n')
    .map(line => line.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, 500)
}

function fallbackRule(content: string): string {
  const lines = cleanMarkdown(content)
    .split('\n')
    .map(line => line.trim())
    .filter(line => /必须|不要|应该|应当|优先|保持|避免/.test(line))
  return lines.slice(0, 3).join('\n')
}

export function buildBrainSuggestionsFromWikiPages(input: BuildBrainSuggestionsInput): BrainSuggestionDraft[] {
  const skills = new Map(input.skills.map(skill => [skill.id, skill.name]))
  const maxPerPage = input.maxPerPage || 3
  const suggestions: BrainSuggestionDraft[] = []
  const seen = new Set<string>()

  for (const page of input.pages) {
    const skillName = skills.get(page.skillId)
    if (!skillName) continue

    const sections = splitSections(page.content)
    const pageSuggestions: BrainSuggestionDraft[] = []

    for (const section of sections) {
      const text = compactSuggestion(section.body)
      if (!text) continue
      const match = SECTION_PATTERNS.find(item => item.pattern.test(section.heading))
      if (!match) continue
      const key = `${page.id}:${match.type}:${text}`
      if (seen.has(key)) continue
      seen.add(key)
      pageSuggestions.push({
        id: `brain_${page.id}_${match.type}_${pageSuggestions.length}`,
        skillId: page.skillId,
        skillName,
        type: match.type,
        content: text,
        status: 'pending',
      })
    }

    if (!pageSuggestions.some(item => item.type === 'rule')) {
      const rule = compactSuggestion(fallbackRule(page.content))
      if (rule) {
        const key = `${page.id}:rule:${rule}`
        if (!seen.has(key)) {
          seen.add(key)
          pageSuggestions.push({
            id: `brain_${page.id}_rule_${pageSuggestions.length}`,
            skillId: page.skillId,
            skillName,
            type: 'rule',
            content: rule,
            status: 'pending',
          })
        }
      }
    }

    suggestions.push(...pageSuggestions.slice(0, maxPerPage))
  }

  return suggestions
}
