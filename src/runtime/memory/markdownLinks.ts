import type { ProjectResource } from '@/utils/projectResource'

export interface WikiLink {
  target: string
  label: string
}

const WIKI_LINK = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g

export function parseWikiLinks(markdown: string): WikiLink[] {
  return [...String(markdown || '').matchAll(WIKI_LINK)].map(match => ({
    target: match[1].trim(),
    label: (match[2] || match[1]).trim(),
  })).filter(link => link.target)
}

function markdownLabel(value: string): string {
  return value.replace(/[\\[\]]/g, '\\$&').replace(/\r?\n/g, ' ')
}

export function renderWikiLinks(markdown: string): string {
  return String(markdown || '').replace(WIKI_LINK, (_match, target: string, label?: string) => {
    const value = target.trim()
    return `[${markdownLabel((label || value).trim())}](#jc-file=${encodeURIComponent(value)})`
  })
}

function withoutMarkdownExtension(path: string): string {
  return path.replace(/\.md$/i, '')
}

function normalizedTarget(target: string): string {
  return withoutMarkdownExtension(target.trim().replace(/^\.\//, '').replace(/^\/+/, ''))
}

export function resolveWikiLinkTarget(
  target: string,
  sourcePath: string,
  resources: ProjectResource[],
): ProjectResource | undefined {
  const wanted = normalizedTarget(target)
  if (!wanted) return undefined
  const sourceDirectory = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : ''
  const candidates = [
    sourceDirectory ? `${sourceDirectory}/${wanted}` : '',
    wanted,
  ].filter(Boolean)
  for (const candidate of candidates) {
    const exact = resources.find(resource => !resource.isDirectory && withoutMarkdownExtension(resource.path) === candidate)
    if (exact) return exact
  }
  const short = resources.filter(resource => !resource.isDirectory && withoutMarkdownExtension(resource.path).split('/').at(-1) === wanted)
  return short.length === 1 ? short[0] : undefined
}

export function findWikiBacklinks(
  target: ProjectResource,
  sources: Array<{ resource: ProjectResource; content: string }>,
): ProjectResource[] {
  return sources
    .filter(source => source.resource.path !== target.path)
    .filter(source => parseWikiLinks(source.content).some(link => resolveWikiLinkTarget(link.target, source.resource.path, [target])?.path === target.path))
    .map(source => source.resource)
}
