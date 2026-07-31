const ORIGINALS = 'jc-materials/originals'
const MARKDOWN = 'jc-materials/markdown'

function safeName(name: string): string {
  return (String(name || '').replace(/\\/g, '/').split('/').pop() || 'document')
    .replace(/[:*?"<>|\0]/g, '_')
    .trim() || 'document'
}

export function nextMaterialPath(directory: string, name: string, existing: Set<string>): string {
  const filename = safeName(name)
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  const extension = dot > 0 ? filename.slice(dot) : ''
  let path = `${directory}/${filename}`
  for (let index = 1; existing.has(path); index += 1) path = `${directory}/${base} (${index})${extension}`
  return path
}

export function nextOriginalMaterialPath(name: string, existing: Set<string>): string {
  return nextMaterialPath(ORIGINALS, name, existing)
}

export function materialMarkdownPath(originalPath: string): string {
  return `${MARKDOWN}/${safeName(originalPath)}.md`
}

export function nextMaterialMarkdownPath(originalPath: string, existing: Set<string>): string {
  return nextMaterialPath(MARKDOWN, `${safeName(originalPath)}.md`, existing)
}
