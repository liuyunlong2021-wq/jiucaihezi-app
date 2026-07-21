#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { marked } from 'marked'

const paths = JSON.parse(readFileSync(0, 'utf8'))
const wikilinkPattern = /\[\[([^\]|#]+)/g

function textNodes(value, result = []) {
  if (Array.isArray(value)) {
    for (const item of value) textNodes(item, result)
    return result
  }
  if (!value || typeof value !== 'object') return result
  if (['code', 'codespan', 'html', 'escape'].includes(value.type)) return result
  if (value.type === 'text') {
    if (Array.isArray(value.tokens)) return textNodes(value.tokens, result)
    result.push(value.raw || value.text || '')
    return result
  }
  for (const [key, child] of Object.entries(value)) {
    if (!['raw', 'text'].includes(key)) textNodes(child, result)
  }
  return result
}

const links = {}
for (const path of paths) {
  const markdown = readFileSync(path, 'utf8')
  const text = textNodes(marked.lexer(markdown)).join('\n')
  links[path] = [...text.matchAll(wikilinkPattern)].map((match) => match[1].trim())
}

process.stdout.write(JSON.stringify(links))
