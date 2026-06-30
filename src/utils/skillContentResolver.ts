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
