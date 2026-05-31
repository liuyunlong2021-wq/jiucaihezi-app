/** Redact secrets before text enters any derived memory or external index. */
export function sanitizeSensitiveText(text: string): string {
  return String(text || '')
    .replace(/Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Authorization: Bearer [TOKEN已脱敏]')
    .replace(/Bearer\s+[A-Za-z0-9_\-.]{20,}/gi, 'Bearer [TOKEN已脱敏]')
    .replace(/eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}/g, '[JWT已脱敏]')
    .replace(/\b(?:sk|jc|or|wr)-[A-Za-z0-9_\-]{12,}/gi, '[API_KEY已脱敏]')
    .replace(/\b(?:api[_-]?key|x-api-key)\s*[=:]\s*['"]?[A-Za-z0-9._~+/=-]{16,}['"]?/gi, 'api_key=[API_KEY已脱敏]')
    .replace(/\b([A-Za-z0-9+/=]{40,})\b/g, (match) => {
      const entropy = new Set(match).size
      return entropy > 30 ? '[SESSION已脱敏]' : match
    })
    .replace(/(["']?(?:password|passwd|secret)["']?)\s*[:=]\s*["'][^"']{4,}["']/gi, '$1: "[已脱敏]"')
}
