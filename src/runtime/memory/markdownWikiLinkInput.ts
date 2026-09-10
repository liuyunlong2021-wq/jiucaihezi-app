import { searchItems } from '@/utils/generalSearch'

export interface WikiLinkCandidateResource {
  path: string
  isDirectory: boolean
}
export interface WikiLinkCandidate {
  path: string
  target: string
  name: string
  directory: string
}
export interface OpenWikiLink {
  start: number
  end: number
  query: string
}

export function findOpenWikiLink(value: string, cursor: number): OpenWikiLink | null {
  const prefix = value.slice(0, cursor)
  const start = prefix.lastIndexOf('[[')
  if (start < 0 || prefix.slice(start + 2).includes(']]')) return null
  const query = prefix.slice(start + 2)
  if (query.includes('\n')) return null
  return { start, end: cursor, query }
}

export function applyWikiLinkSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
) {
  const open = findOpenWikiLink(value, selectionStart)
  if (open && selectionStart === selectionEnd)
    return { value, selectionStart, selectionEnd, query: open.query }
  const selected = value.slice(selectionStart, selectionEnd)
  const insertion = `[[${selected}]]`
  return {
    value: value.slice(0, selectionStart) + insertion + value.slice(selectionEnd),
    selectionStart: selectionStart + 2,
    selectionEnd: selectionStart + 2 + selected.length,
    query: selected,
  }
}

export function completeWikiLink(
  value: string,
  cursor: number,
  candidate: WikiLinkCandidate,
  alias = '',
) {
  const open = findOpenWikiLink(value, cursor)
  if (!open) return { value, cursor }
  const body = alias.trim() ? `${candidate.target}|${alias.trim()}` : candidate.target
  const insertion = `[[${body}]]`
  const closing = value.indexOf(']]', open.end)
  const replaceEnd = closing >= 0 && !value.slice(open.end, closing).includes('[[') ? closing + 2 : open.end
  const next = value.slice(0, open.start) + insertion + value.slice(replaceEnd)
  return { value: next, cursor: open.start + insertion.length }
}

export function searchWikiLinkCandidates(
  resources: WikiLinkCandidateResource[],
  query: string,
  limit = 30,
): WikiLinkCandidate[] {
  const candidates = resources
    .filter(resource => !resource.isDirectory && /\.md$/i.test(resource.path))
    .filter(resource => !resource.path.split('/').some(segment => segment.startsWith('.')))
    .map(resource => {
      const parts = resource.path.split('/')
      const fileName = (parts.at(-1) || resource.path).replace(/\.md$/i, '')
      return {
        path: resource.path,
        target: resource.path.replace(/\.md$/i, ''),
        name: fileName.toLowerCase() === 'index' && parts.length > 1 ? `${parts.at(-2) || 'index'} · index` : fileName,
        directory: parts.slice(0, -1).join('/'),
      }
    })
  const ranked = query.trim()
    ? searchItems(query, candidates, item => `${item.name} ${item.path}`)
    : [...candidates].sort((a, b) => Number(a.name.endsWith(' · index')) - Number(b.name.endsWith(' · index')))
  return ranked.slice(0, Math.min(limit, 5))
}
