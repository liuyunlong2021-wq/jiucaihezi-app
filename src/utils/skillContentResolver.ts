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
