export const DIST_BLOCKED_FILE_PATTERNS = [
  /(^|\/)\.env(?:\..*)?$/i,
  /(^|\/)\.DS_Store$/i,
  /(^|\/)__pycache__(\/|$)/i,
  /\.pyc$/i,
  /\.(?:py|sh)$/i,
]

export function shouldRemoveFromDist(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/')
  return DIST_BLOCKED_FILE_PATTERNS.some(pattern => pattern.test(normalized))
}
