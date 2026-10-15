import route from '../../../public/skills/manju-route.json'

const MANJU_ROUTER = route.router
const MANJU_SKILLS = route.skills

export const CREATION_ROUTES = [
  { name: MANJU_ROUTER, label: '漫剧制作' },
  { name: 'jc-duanju', label: '短剧写作' },
  { name: 'jc-novel', label: '小说创作' },
] as const

export function selectCreationRoute(names: string[], name: string): string[] {
  if (!CREATION_ROUTES.some(route => route.name === name)) throw new Error('未知创作路线')
  return [...names.filter(item => !CREATION_ROUTES.some(route => route.name === item)), ...(names.includes(name) ? [] : [name])]
}

export function creationSkillNames(names: string[]): string[] {
  return [...new Set([...names, ...(names.some(name => MANJU_SKILLS.includes(name)) ? MANJU_SKILLS : []), 'wiki-memory'])]
}

export function creationRoutePrompt(names: string[]): string {
  if (names.filter(name => CREATION_ROUTES.some(route => route.name === name)).length > 1) throw new Error('一次只能选择一条创作路线')
  const resources = creationSkillNames(names)
  return [
    names.some(name => CREATION_ROUTES.some(route => route.name === name)) ? '创作入口的正式产物按 Skill 合同保存到当前项目 Wiki；讨论、未选候选或明确不要保存时不调用保存工具。小说章节先草稿，用户明确确认同一已保存版本后才追加原文。不要自动进入下一阶段或生成媒体。' : '',
    '包内规则按任务使用 read 按需读取，不创建其他 Agent。资源使用 skill://<包名>/<相对路径>；相对路径歧义时用完整 URI。',
    ...resources.map(name => `- ${name}: skill://${name}/SKILL.md；包内参考 skill://${name}/references/...`),
  ].filter(Boolean).join('\n')
}

export function resolveCreationSkillPath(value: string, names: string[]): { name: string; path: string } | null {
  const raw = value.replace(/^(?:skill:\/\/|\/skills\/|\.\.\/)/, '')
  const [name, ...parts] = raw.split('/')
  if (!name || !names.includes(name) || !parts.length || parts.some(part => !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0'))) return null
  return { name, path: parts.join('/') }
}
