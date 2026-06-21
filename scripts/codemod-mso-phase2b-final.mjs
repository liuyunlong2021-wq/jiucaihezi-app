#!/usr/bin/env node
/**
 * Phase 2B Final: 清理最后残余 <span class="mso*">
 * 处理 v-if/v-else/v-else-if 在 class 前、反向 class 顺序、数字开头内容等
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WRITE = process.argv.includes('--write')
const SRC_DIR = join(ROOT, 'src')

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { walk(full, files) }
    else if (full.endsWith('.vue')) { files.push(full) }
  }
  return files
}

const files = walk(SRC_DIR)
const filesChanged = []
let total = 0

// Content pattern: allow digit-starting names (e.g. "360")
const STATIC_NAME = /([a-z0-9][a-z0-9_]*)/.source
const DYNAMIC_EXPR = /\{\{\s*(.+?)\s*\}\}/.source

for (const file of files) {
  if (file.endsWith('JcIcon.vue')) continue
  let src = readFileSync(file, 'utf8')
  let changed = false

  // Pattern A: V-DIRECTIVE class="mso">STATIC</span>
  // <span v-else class="mso">movie</span>
  // <span v-if="selected" class="mso">check</span>
  src = src.replace(
    new RegExp(`<span\\s+((?:v-(?:else|if|else-if|show)(?:="[^"]*")?\\s+)+)class="mso"\\s*>\\s*${STATIC_NAME}\\s*<\\/span>`, 'g'),
    (_, vAttrs, name) => { total++; return `<JcIcon name="${name}" ${vAttrs.trim()} />` }
  )

  // Pattern B: V-DIRECTIVE class="mso" ATTRS>STATIC</span>
  src = src.replace(
    new RegExp(`<span\\s+((?:v-(?:else|if|else-if|show)(?:="[^"]*")?\\s+)+)class="mso"\\s+([^>]+)>\\s*${STATIC_NAME}\\s*<\\/span>`, 'g'),
    (_, vAttrs, attrs, name) => { total++; return `<JcIcon name="${name}" ${vAttrs.trim()} ${attrs.trim()} />` }
  )

  // Pattern C: V-DIRECTIVE class="mso">{{ EXPR }}</span>
  src = src.replace(
    new RegExp(`<span\\s+((?:v-(?:else|if|else-if|show)(?:="[^"]*")?\\s+)+)class="mso"\\s*>\\s*${DYNAMIC_EXPR}\\s*<\\/span>`, 'g'),
    (_, vAttrs, expr) => { total++; return `<JcIcon :name="${expr.trim()}" ${vAttrs.trim()} />` }
  )

  // Pattern D: V-DIRECTIVE class="mso EXTRA">{{ EXPR }}</span>
  src = src.replace(
    new RegExp(`<span\\s+((?:v-(?:else|if|else-if|show)(?:="[^"]*")?\\s+)+)class="mso\\s+([a-z][a-z0-9_-]+)"\\s*>\\s*${DYNAMIC_EXPR}\\s*<\\/span>`, 'g'),
    (_, vAttrs, cls, expr) => { total++; return `<JcIcon :name="${expr.trim()}" class="${cls}" ${vAttrs.trim()} />` }
  )

  // Pattern E: V-DIRECTIVE class="mso EXTRA">STATIC</span>
  src = src.replace(
    new RegExp(`<span\\s+((?:v-(?:else|if|else-if|show)(?:="[^"]*")?\\s+)+)class="mso\\s+([a-z][a-z0-9_-]+)"\\s*>\\s*${STATIC_NAME}\\s*<\\/span>`, 'g'),
    (_, vAttrs, cls, name) => { total++; return `<JcIcon name="${name}" class="${cls}" ${vAttrs.trim()} />` }
  )

  // Pattern F: Reverse class order "EXTRA mso">... (multi-line content)
  // <span class="EXTRA mso">\n  {{ expr }}\n</span>
  src = src.replace(
    /<span\s+class="([a-z][a-z0-9_-]+)\s+mso"\s*>\s*\{\{\s*(.+?)\s*\}\}\s*<\/span>/gs,
    (_, cls, expr) => { total++; return `<JcIcon :name="${expr.trim()}" class="${cls}" />` }
  )

  // Pattern G: v-else-if class="mso">STATIC
  src = src.replace(
    new RegExp(`<span\\s+v-else-if="[^"]*"\\s+class="mso"\\s*>\\s*${STATIC_NAME}\\s*<\\/span>`, 'g'),
    (m) => {
      const vMatch = m.match(/v-else-if="([^"]*)"/)
      const nMatch = m.match(new RegExp(STATIC_NAME))
      if (vMatch && nMatch) { total++; return `<JcIcon v-else-if="${vMatch[1]}" name="${nMatch[1]}" />` }
      return m
    }
  )

  if (src !== readFileSync(file, 'utf8')) {
    filesChanged.push(file.replace(ROOT + '/', ''))
    if (WRITE) writeFileSync(file, src, 'utf8')
  }
}

// Final check
let leftover = 0
const leftoverSamples = []
for (const file of files) {
  if (file.endsWith('JcIcon.vue')) continue
  const src = WRITE ? readFileSync(file, 'utf8') : readFileSync(file, 'utf8')
  const matches = src.match(/<span\s[^>]*class="[^"]*\bmso\b[^"]*"[^>]*>/g) || []
  for (const m of matches) {
    // Skip false positives (div, button, etc. not span)
    if (!m.startsWith('<span')) continue
    leftover++
    if (leftoverSamples.length < 10) {
      const lines = src.split('\n')
      for (let idx = 0; idx < lines.length && leftoverSamples.length < 10; idx++) {
        if (lines[idx].includes(m.slice(0, 30))) {
          leftoverSamples.push(`${file.replace(ROOT + '/', '')}:${idx + 1}  ${lines[idx].trim().slice(0, 120)}`)
          break
        }
      }
    }
  }
}

console.log(`Mode: ${WRITE ? 'WRITE' : 'DRY RUN'}`)
console.log(`Files affected: ${filesChanged.length}`)
console.log(`Replacements: ${total}`)
console.log(`Remaining <span class="mso*">: ${leftover}`)
if (leftoverSamples.length) leftoverSamples.forEach(s => console.log(`  ${s}`))
if (!WRITE) console.log('\nRe-run with --write to apply.')
