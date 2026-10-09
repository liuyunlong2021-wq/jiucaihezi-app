import { marked, type Links, type Token } from 'marked'

export type MarkdownChunk = {
  key: string
  raw: string
  token: Token
  stable: boolean
}

export type IncrementalMarkdownSnapshot = {
  chunks: MarkdownChunk[]
  links: Links
  linksVersion: number
  revision: number
  sourceLength: number
  relexedCharacters: number
}

const options = { breaks: true, gfm: true }

function mergeLinks(target: Links, next: Links): boolean {
  let changed = false
  for (const [key, value] of Object.entries(next)) {
    if (!(key in target)) {
      target[key] = value
      changed = true
    }
  }
  return changed
}

function isVisible(token: Token): boolean {
  return token.type !== 'space' && token.type !== 'def'
}

function hasOpenFence(source: string): boolean {
  let open: { marker: string; length: number } | null = null
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (!match) continue
    const marker = match[1]!
    const rest = match[2] || ''
    if (!open) {
      open = { marker: marker[0]!, length: marker.length }
      continue
    }
    if (marker[0] === open.marker && marker.length >= open.length && !rest.trim()) open = null
  }
  return Boolean(open)
}

/**
 * Keeps committed Markdown blocks and only lexes the small, mutable suffix on append.
 * Two semantic blocks stay mutable so lists, setext headings, tables and open fences
 * can finish without invalidating older rendered nodes.
 */
export class IncrementalMarkdown {
  private identity = ''
  private source = ''
  private committedTokens: Token[] = []
  private committedLength = 0
  private links: Links = Object.create(null) as Links
  private linksVersion = 0
  private revision = 0
  private chunks: MarkdownChunk[] = []

  update(source: string, identity: string): IncrementalMarkdownSnapshot {
    // marked normalizes CRLF while lexing; normalize before tracking token lengths
    // so committed source offsets and the mutable suffix use the same coordinate space.
    const next = String(source || '').replace(/\r\n?/g, '\n')
    const reset = identity !== this.identity || !next.startsWith(this.source)
    if (reset) this.reset(identity)

    const suffix = next.slice(this.committedLength)
    const mutableTokens = suffix ? marked.lexer(suffix, options) : []
    const nextLinks = (mutableTokens as Token[] & { links?: Links }).links || Object.create(null) as Links
    const linksChanged = mergeLinks(this.links, nextLinks)
    if (linksChanged) this.linksVersion += 1

    // A new reference definition can change inline tokens in any earlier block.
    // Pay the full-document parse only on that rare semantic invalidation.
    const tokens = linksChanged
      ? marked.lexer(next, options) as Token[]
      : [...this.committedTokens, ...mutableTokens]
    let visibleCount = 0
    let freezeBefore = tokens.length
    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      if (!isVisible(tokens[index]!)) continue
      visibleCount += 1
      if (visibleCount === 3) {
        freezeBefore = index + 1
        break
      }
    }

    // Do not commit a tail containing an open fence: marked treats it as a code token,
    // but its raw range will change when the closing fence arrives.
    const openFence = hasOpenFence(suffix)
    if (openFence) {
      let openCode = -1
      for (let index = tokens.length - 1; index >= 0; index -= 1) {
        if (tokens[index]?.type === 'code') {
          openCode = index
          break
        }
      }
      if (openCode >= 0) freezeBefore = Math.min(freezeBefore, openCode)
    }

    if (linksChanged) {
      this.committedTokens = tokens.slice(0, freezeBefore)
      this.committedLength = this.committedTokens.reduce((length, token) => length + token.raw.length, 0)
    } else {
      const newlyCommitted = tokens.slice(this.committedTokens.length, freezeBefore)
      if (newlyCommitted.length) {
        this.committedTokens.push(...newlyCommitted)
        this.committedLength += newlyCommitted.reduce((length, token) => length + token.raw.length, 0)
      }
    }

    this.source = next
    const mutableStart = this.committedLength
    let tokenStart = 0
    this.chunks = tokens.map(token => {
      const start = tokenStart
      tokenStart += token.raw.length
      return {
        key: `${identity}:${start}`,
        raw: token.raw,
        token,
        stable: start + token.raw.length <= mutableStart,
      }
    }).filter(chunk => isVisible(chunk.token))

    return {
      chunks: this.chunks,
      links: this.links,
      linksVersion: this.linksVersion,
      revision: this.revision,
      sourceLength: next.length,
      relexedCharacters: linksChanged ? next.length : suffix.length,
    }
  }

  private reset(identity: string) {
    this.revision += 1
    this.identity = identity
    this.source = ''
    this.committedTokens = []
    this.committedLength = 0
    this.links = Object.create(null) as Links
    this.linksVersion = 0
    this.chunks = []
  }
}
