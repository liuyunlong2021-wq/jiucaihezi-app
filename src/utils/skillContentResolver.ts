/**
 * Shared skill:// URI content resolver.
 * Used by both Web cloud chat (chatCloud.ts) and desktop direct chat (useChat.ts).
 * 
 * For the rare case where a legacy skill:// URI needs to be resolved,
 * fetches the SKILL.md from public/skills/ over HTTP.
 */
export async function resolveSkillUriContent(skillContent: string): Promise<string> {
  const clean = String(skillContent || '').trim()
  if (!clean.startsWith('skill://')) return clean
  const relativePath = clean
    .replace(/^skill:\/\//, '')
    .replace(/^\/+/, '')
    .replace(/\\/g, '/')
  if (!relativePath || relativePath.includes('..') || relativePath.includes('\0')) return ''
  const response = await fetch(`/skills/${relativePath}`)
  if (!response.ok) return ''
  return (await response.text()).slice(0, 80_000)
}

export interface WebSkillCatalogEntry {
  id: string
  name: string
  description: string | null
  triggers: string[]
  commands: string[]
  files: string[]
}

export interface WebLoadedSkill extends WebSkillCatalogEntry {
  content: string
  baseDirectory: string
}

let catalogPromise: Promise<WebSkillCatalogEntry[]> | null = null

async function fetchWebSkillCatalog(fetcher: typeof fetch): Promise<WebSkillCatalogEntry[]> {
  const response = await fetcher('/skills/index.json')
  if (!response.ok) throw new Error(`Skill 目录加载失败: HTTP ${response.status}`)
  const value = await response.json()
  if (!Array.isArray(value)) throw new Error('Skill 目录格式无效')
  return value
    .filter(item => item && typeof item.id === 'string' && typeof item.name === 'string')
    .map(item => ({
      id: item.id,
      name: item.name,
      description: typeof item.description === 'string' ? item.description : null,
      triggers: Array.isArray(item.triggers) ? item.triggers.map(String) : [],
      commands: Array.isArray(item.commands) ? item.commands.map(String) : [],
      files: Array.isArray(item.files) ? item.files.map(String) : ['SKILL.md'],
    }))
}

export async function loadWebSkillCatalog(
  fetcher: typeof fetch = fetch,
  options: { refresh?: boolean } = {},
): Promise<WebSkillCatalogEntry[]> {
  if (fetcher !== fetch || options.refresh) return await fetchWebSkillCatalog(fetcher)
  catalogPromise ||= fetchWebSkillCatalog(fetcher).catch(error => {
    catalogPromise = null
    throw error
  })
  return await catalogPromise
}

export function buildWebSkillCatalogPrompt(entries: WebSkillCatalogEntry[]): string {
  if (!entries.length) return ''
  return [
    'Available Skills:',
    ...entries.map(skill => `- ${skill.name}: ${(skill.description || '').slice(0, 300)}`),
    'When a task matches a Skill description, call the skill tool with its exact name to load its instructions before proceeding.',
    'If no Skill description matches the task, do not load a Skill.',
  ].join('\n')
}

export async function loadWebSkillByName(
  name: string,
  fetcher: typeof fetch = fetch,
): Promise<WebLoadedSkill> {
  const cleanName = String(name || '').trim()
  const catalog = await loadWebSkillCatalog(fetcher)
  const skill = catalog.find(item => item.name === cleanName || item.id === cleanName)
  if (!skill) throw new Error(`Skill 不存在: ${cleanName}`)
  const encodedId = skill.id.split('/').map(encodeURIComponent).join('/')
  const response = await fetcher(`/skills/${encodedId}/SKILL.md`)
  if (!response.ok) throw new Error(`Skill 加载失败: ${skill.name}`)
  return {
    ...skill,
    content: await response.text(),
    baseDirectory: `/skills/${encodedId}`,
  }
}

export async function readWebSkillResource(
  baseDirectory: string,
  relativePath: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const base = String(baseDirectory || '').replace(/\/+$/, '')
  const rawPath = String(relativePath || '').replace(/\\/g, '/')
  const path = rawPath.replace(/^\/+/, '')
  if (
    !base.startsWith('/skills/') ||
    !path ||
    rawPath.startsWith('/') ||
    /^[A-Za-z]:\//.test(rawPath) ||
    rawPath.includes('\0') ||
    path.split('/').some(part => !part || part === '..' || part === '.')
  ) {
    throw new Error('Skill 资源路径无效')
  }
  const url = `${base}/${path.split('/').map(encodeURIComponent).join('/')}`
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`Skill 资源读取失败: ${path}`)
  return await response.text()
}

/**
 * Resolve a skill name to its system prompt text for direct mode.
 * Extracted from duplicate definitions in useChat.ts and chatCloud.ts (2026-06-30).
 */
export async function resolveWebSkillSystemPrompt(
  skillName: string,
  skills: Array<{ name?: string; id?: string; description?: string; skillContent?: string | null }>,
): Promise<string> {
  const name = String(skillName || '').trim()
  if (!name) return ''
  const selected = skills.find(skill => skill.name === name || skill.id === name)
  if (!selected) return ''
  const skillMd = await resolveSkillUriContent(String(selected.skillContent || ''))
  if (!skillMd.trim()) {
    return [
      `当前用户选择的 Skill：${selected.name}`,
      selected.description ? `Skill 描述：${selected.description}` : '',
    ].filter(Boolean).join('\n')
  }
  return [
    `当前用户选择的 Skill：${selected.name}`,
    '请严格按照下面的 SKILL.md 执行，但不要声称你正在调用外部工具。',
    '<SKILL.md>',
    skillMd,
    '</SKILL.md>',
  ].join('\n')
}
