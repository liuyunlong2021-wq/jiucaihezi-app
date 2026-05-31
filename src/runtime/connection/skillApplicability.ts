export type SkillApplicabilityMode = 'apply' | 'reference-only' | 'off'
export type SkillApplicabilityReason =
  | 'no-skill'
  | 'explicit-skill-request'
  | 'current-skill-question'
  | 'skill-match'
  | 'current-context-transform'
  | 'general-support-request'
  | 'weak-match'

export interface SkillApplicabilityCandidate {
  id: string
  name?: string
  description?: string
  triggers?: string[]
  skillContent?: string | null
}

export interface ResolveSkillApplicabilityInput {
  userInput: string
  selectedSkill?: SkillApplicabilityCandidate | null
}

export interface SkillApplicabilityResult {
  mode: SkillApplicabilityMode
  reason: SkillApplicabilityReason
  matchedTerms: string[]
}

export function resolveSkillApplicability(input: ResolveSkillApplicabilityInput): SkillApplicabilityResult {
  const skill = input.selectedSkill
  if (!skill) return { mode: 'off', reason: 'no-skill', matchedTerms: [] }

  const userInput = normalizeText(input.userInput)
  if (isCurrentSkillQuestion(userInput)) {
    return { mode: 'apply', reason: 'current-skill-question', matchedTerms: [] }
  }
  if (isExplicitSkillRequest(userInput)) {
    return { mode: 'apply', reason: 'explicit-skill-request', matchedTerms: [] }
  }
  if (isCurrentContextTransform(userInput)) {
    return { mode: 'reference-only', reason: 'current-context-transform', matchedTerms: [] }
  }
  if (isGeneralSupportRequest(userInput)) {
    return { mode: 'reference-only', reason: 'general-support-request', matchedTerms: [] }
  }

  const matchedTerms = matchSkillTerms(userInput, skill)
  if (matchedTerms.length > 0) {
    return { mode: 'apply', reason: 'skill-match', matchedTerms }
  }

  return { mode: 'apply', reason: 'weak-match', matchedTerms: [] }
}

function normalizeText(value: string): string {
  return String(value || '').trim().toLowerCase()
}

function isCurrentSkillQuestion(value: string): boolean {
  return /(当前|现在|选中|我选).*skill|你是什么skill|什么skill|这个skill/.test(value)
}

function isExplicitSkillRequest(value: string): boolean {
  return /(按|用|使用|根据).{0,8}(当前|这个|选中).{0,4}skill/.test(value)
}

function isCurrentContextTransform(value: string): boolean {
  const refersToCurrentContext = /(上面|上述|刚才|前面|上一条|以上|当前对话|这段|这些内容|上面的内容)/.test(value)
  const asksForArtifact = /(转成|转换成|生成|导出|保存为|整理成|做成).{0,12}(word|docx|文档|markdown|md|pdf|ppt|表格|excel|文件)/.test(value)
    || /(word|docx|文档|markdown|md|pdf|ppt|表格|excel).{0,12}(转成|转换|生成|导出|保存)/.test(value)
  return refersToCurrentContext && asksForArtifact
}

function isGeneralSupportRequest(value: string): boolean {
  return /(报错|错误|日志|什么意思|为什么|怎么配置|如何配置|怎么刷新|怎么打开|卡住|不生效|没成功)/.test(value)
}

function matchSkillTerms(userInput: string, skill: SkillApplicabilityCandidate): string[] {
  const terms = collectSkillTerms(skill)
  const matched: string[] = []
  for (const term of terms) {
    if (term.length < 2) continue
    if (userInput.includes(term.toLowerCase())) matched.push(term)
  }
  if (hasWritingIntent(userInput) && hasWritingSkillSignal(skill)) {
    matched.push('writing-intent')
  }
  return [...new Set(matched)].slice(0, 12)
}

function collectSkillTerms(skill: SkillApplicabilityCandidate): string[] {
  const values = [
    skill.name,
    skill.description,
    ...(skill.triggers || []),
    extractHeadings(String(skill.skillContent || '')),
  ].flatMap(value => tokenize(String(value || '')))
  return [...new Set(values)]
}

function extractHeadings(markdown: string): string {
  return markdown
    .split('\n')
    .filter(line => /^#{1,4}\s+/.test(line))
    .join('\n')
}

function tokenize(value: string): string[] {
  return String(value || '')
    .split(/[\s,，。；;、：:（）()【】\[\]《》"'“”‘’/\\|]+/)
    .map(term => term.trim())
    .filter(Boolean)
}

function hasWritingIntent(value: string): boolean {
  return /(写|撰写|改写|润色|介绍|文案|脚本|剧本|文章|标题|大纲|总结|摘要|copy|write|writing)/.test(value)
}

function hasWritingSkillSignal(skill: SkillApplicabilityCandidate): boolean {
  const text = [
    skill.name,
    skill.description,
    ...(skill.triggers || []),
    skill.skillContent,
  ].join('\n').toLowerCase()
  return /(write|writer|writing|copy|content|draft|polished|文案|写作|剧本|脚本|文章|创作)/.test(text)
}
