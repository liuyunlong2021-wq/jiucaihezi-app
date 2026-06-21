#!/usr/bin/env node
/**
 * Codemod: <span class="mso">NAME</span> → <JcIcon name="NAME" />
 *
 * 处理两种形态：
 *   1. <span class="mso">add_circle</span>                → <JcIcon name="add_circle" />
 *   2. <span class="mso mso-fill">favorite</span>          → <JcIcon name="favorite" fill />
 *      (也支持反向 class 顺序 "mso-fill mso")
 *
 * 跳过：
 *   - 含 Vue 插值的（{{ ... }}）—— 动态调用，Phase 2B 处理
 *   - 含额外属性的（class="mso" + 其它属性）—— 保守起见本期不动，由人工处理
 *   - PlatformIcon.vue（Phase 2B 处理）
 *
 * 用法：
 *   node scripts/codemod-mso-to-jcicon.mjs           # dry-run，只统计
 *   node scripts/codemod-mso-to-jcicon.mjs --write   # 实际改写
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WRITE = process.argv.includes('--write')

const SRC_DIR = join(ROOT, 'src')
const SKIP_FILES = new Set([
  join(SRC_DIR, 'components/icons/JcIcon.vue'),
  join(SRC_DIR, 'components/skills/shared/PlatformIcon.vue'),
])

const SIMPLE_RE = /<span\s+class="mso"\s*>\s*([a-z][a-z0-9_]*)\s*<\/span>/g
const EXTRA_CLASS_RE = /<span\s+class="mso\s+([a-z][a-z0-9_-]+)"\s*>\s*([a-z][a-z0-9_]*)\s*<\/span>/g
const FILL_RE = /<span\s+class="mso\s+mso-fill"\s*>\s*([a-z][a-z0-9_]*)\s*<\/span>/g
const FILL_REV_RE = /<span\s+class="mso-fill\s+mso"\s*>\s*([a-z][a-z0-9_]*)\s*<\/span>/g

// 用来探测"还剩多少未处理的 mso 用法"
const ANY_MSO_RE = /<span\s+class="[^"]*\bmso\b[^"]*"[^>]*>/g

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      walk(full, files)
    } else if (full.endsWith('.vue')) {
      files.push(full)
    }
  }
  return files
}

const files = walk(SRC_DIR)

let totalSimple = 0
let totalExtraClass = 0
let totalFill = 0
const filesChanged = []

// 第一遍：仅替换、统计
for (const file of files) {
  if (SKIP_FILES.has(file)) continue
  const src = readFileSync(file, 'utf8')
  let out = src

  out = out.replace(SIMPLE_RE, (_, name) => {
    totalSimple++
    return `<JcIcon name="${name}" />`
  })
  out = out.replace(EXTRA_CLASS_RE, (_, extraClass, name) => {
    totalExtraClass++
    return `<JcIcon name="${name}" class="${extraClass}" />`
  })
  out = out.replace(FILL_RE, (_, name) => {
    totalFill++
    return `<JcIcon name="${name}" fill />`
  })
  out = out.replace(FILL_REV_RE, (_, name) => {
    totalFill++
    return `<JcIcon name="${name}" fill />`
  })

  if (out !== src) {
    filesChanged.push({ file: file.replace(ROOT + '/', ''), before: src, after: out })
    if (WRITE) writeFileSync(file, out, 'utf8')
  }
}

// 第二遍：扫剩余的 mso 用法，方便用户知道还有多少需要 Phase 2B 处理
let leftover = 0
const leftoverSamples = []
for (const file of files) {
  if (SKIP_FILES.has(file)) continue
  const src = WRITE && filesChanged.find(c => join(ROOT, c.file) === file)
    ? readFileSync(file, 'utf8')
    : readFileSync(file, 'utf8')
  const matches = src.match(ANY_MSO_RE) || []
  if (matches.length > 0) {
    leftover += matches.length
    if (leftoverSamples.length < 10) {
      const lines = src.split('\n')
      lines.forEach((ln, idx) => {
        if (ANY_MSO_RE.test(ln) && leftoverSamples.length < 10) {
          leftoverSamples.push(`${file.replace(ROOT + '/', '')}:${idx + 1}  ${ln.trim().slice(0, 100)}`)
        }
        ANY_MSO_RE.lastIndex = 0
      })
    }
  }
}

console.log('\n=== Codemod report ===')
console.log(`Mode: ${WRITE ? 'WRITE (files modified)' : 'DRY RUN (no files modified)'}`)
console.log(`Files scanned: ${files.length} .vue files under src/`)
console.log(`Files affected: ${filesChanged.length}`)
console.log(`Replacements:`)
console.log(`  <JcIcon name="X" />                 ${totalSimple}`)
console.log(`  <JcIcon name="X" class="..." />     ${totalExtraClass}`)
console.log(`  <JcIcon name="X" fill />            ${totalFill}`)
console.log(`  TOTAL                                ${totalSimple + totalExtraClass + totalFill}`)
console.log(`\nLeftover <span class="mso*"> (will be handled in Phase 2B):`)
console.log(`  Count: ${leftover}`)
if (leftoverSamples.length > 0) {
  console.log(`  Samples:`)
  leftoverSamples.forEach(s => console.log(`    ${s}`))
}
console.log('')
if (!WRITE) {
  console.log('Re-run with --write to apply changes.')
}
