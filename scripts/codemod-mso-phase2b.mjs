#!/usr/bin/env node
/**
 * Phase 2B Codemod: 剩余 <span class="mso*"> → <JcIcon />
 *
 * 处理 Phase 2A 未覆盖的形态：
 *   - 额外 CSS class（如 "mso spin"）
 *   - 额外属性（style, :style, @click, v-if, aria-* 等）
 *   - 动态名称（{{ expr }} 或函数调用）
 *
 * 用法：
 *   node scripts/codemod-mso-phase2b.mjs           # dry-run
 *   node scripts/codemod-mso-phase2b.mjs --write   # 实际改写
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WRITE = process.argv.includes('--write')

const SRC_DIR = join(ROOT, 'src')
const SKIP_FILES = new Set([
  join(SRC_DIR, 'components/icons/JcIcon.vue'),
  join(SRC_DIR, 'components/skills/shared/PlatformIcon.vue'),
])

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { walk(full, files) }
    else if (full.endsWith('.vue')) { files.push(full) }
  }
  return files
}

// ─── 类别统计 ───
let countExtraClassStatic = 0   // class="mso EXTRA">STATIC</span>
let countExtraClassDynamic = 0  // class="mso EXTRA">{{ X }}</span>
let countAttrStatic = 0         // class="mso" ATTRS>STATIC</span>
let countAttrDynamic = 0        // class="mso" ATTRS>{{ X }}</span>
let countExtraClassAttrStatic =0// class="mso EXTRA" ATTRS>STATIC</span>
let countExtraClassAttrDynamic=0// class="mso EXTRA" ATTRS>{{ X }}</span>
let countComplexDynamic = 0     // 复杂属性组合
let countPlatformIcon = 0       // PlatformIcon.vue 内部
let countFuncCallExtraClass = 0 // class="mso EXTRA">{{ func() }}</span>

const files = walk(SRC_DIR)
const filesChanged = []

function processFile(file, src) {
  let out = src
  let changed = false

  // ── Pattern 1: class="mso EXTRA">{{ EXPR }}</span> ──
  // 例: <span class="mso tw-icon">{{ card.icon }}</span>
  out = out.replace(
    /<span\s+class="mso\s+([a-z][a-z0-9_-]+)"\s*>\s*\{\{\s*(.+?)\s*\}\}\s*<\/span>/g,
    (_, cls, expr) => {
      countExtraClassDynamic++
      return `<JcIcon :name="${expr.trim()}" class="${cls}" />`
    }
  )

  // ── Pattern 2: class="mso" ATTRS>STATIC</span> ──
  // 例: <span class="mso" style="font-size:20px">settings</span>
  out = out.replace(
    /<span\s+class="mso"\s+((?:(?!(?<!:)class\s*=)[^>])+)>\s*([a-z][a-z0-9_]*)\s*<\/span>/g,
    (_, attrs, name) => {
      countAttrStatic++
      return `<JcIcon name="${name}" ${attrs.trim()} />`
    }
  )

  // ── Pattern 3: class="mso" ATTRS>{{ EXPR }}</span> ──
  // 例: <span class="mso" style="...">{{ showKey ? 'a' : 'b' }}</span>
  out = out.replace(
    /<span\s+class="mso"\s+((?:(?!(?<!:)class\s*=)[^>])+)>\s*\{\{\s*(.+?)\s*\}\}\s*<\/span>/g,
    (_, attrs, expr) => {
      countAttrDynamic++
      return `<JcIcon :name="${expr.trim()}" ${attrs.trim()} />`
    }
  )

  // ── Pattern 4: class="mso EXTRA" ATTRS>STATIC</span> ──
  // 例: <span class="mso spin" style="...">progress_activity</span>
  out = out.replace(
    /<span\s+class="mso\s+([a-z][a-z0-9_-]+)"\s+((?:(?!(?<!:)class\s*=)[^>])+)>\s*([a-z][a-z0-9_]*)\s*<\/span>/g,
    (_, cls, attrs, name) => {
      countExtraClassAttrStatic++
      return `<JcIcon name="${name}" class="${cls}" ${attrs.trim()} />`
    }
  )

  // ── Pattern 5: class="mso EXTRA" ATTRS>{{ EXPR }}</span> ──
  out = out.replace(
    /<span\s+class="mso\s+([a-z][a-z0-9_-]+)"\s+((?:(?!(?<!:)class\s*=)[^>])+)>\s*\{\{\s*(.+?)\s*\}\}\s*<\/span>/g,
    (_, cls, attrs, expr) => {
      countExtraClassAttrDynamic++
      return `<JcIcon :name="${expr.trim()}" class="${cls}" ${attrs.trim()} />`
    }
  )

  // ── Pattern 6: class="mso EXTRA">STATIC</span> (no attrs, Phase 2A 遗漏) ──
  out = out.replace(
    /<span\s+class="mso\s+([a-z][a-z0-9_-]+)"\s*>\s*([a-z][a-z0-9_]*)\s*<\/span>/g,
    (_, cls, name) => {
      countExtraClassStatic++
      return `<JcIcon name="${name}" class="${cls}" />`
    }
  )

  // ── Pattern 7: class="mso">{{ EXPR }}</span> (pure dynamic, no extra anything) ──
  out = out.replace(
    /<span\s+class="mso"\s*>\s*\{\{\s*(.+?)\s*\}\}\s*<\/span>/g,
    (_, expr) => {
      countAttrDynamic++  // reuse counter
      return `<JcIcon :name="${expr.trim()}" />`
    }
  )

  // ── Pattern 8: 含复杂属性的动态名 (":style", ":class", "@click" 等) ──
  // 用更宽松的正则，捕获所有非 class 属性
  out = out.replace(
    /<span\s+class="mso\s+([a-z][a-z0-9_-]+)"\s+((?:(?!(?<!:)class\s*=)[^>])+)>\s*\{\{\s*(.+?)\s*\}\}\s*<\/span>/g,
    (_, cls, attrs, expr) => {
      countComplexDynamic++
      return `<JcIcon :name="${expr.trim()}" class="${cls}" ${attrs.trim()} />`
    }
  )

  if (out !== src) changed = true
  return { out, changed }
}

// 扫描并处理
for (const file of files) {
  if (SKIP_FILES.has(file)) continue
  const src = readFileSync(file, 'utf8')
  const { out, changed } = processFile(file, src)
  if (changed) {
    filesChanged.push(file.replace(ROOT + '/', ''))
    if (WRITE) writeFileSync(file, out, 'utf8')
  }
}

// 扫描剩余 mso
let leftover = 0
const leftoverSamples = []
for (const file of files) {
  if (SKIP_FILES.has(file)) continue
  const src = WRITE ? readFileSync(file, 'utf8') : readFileSync(file, 'utf8')
  const matches = src.match(/<span\s+class="[^"]*\bmso\b[^"]*"[^>]*>/g) || []
  if (matches.length > 0) {
    leftover += matches.length
    if (leftoverSamples.length < 15) {
      const lines = src.split('\n')
      for (let idx = 0; idx < lines.length && leftoverSamples.length < 15; idx++) {
        if (/<span\s+class="[^"]*\bmso\b/.test(lines[idx])) {
          leftoverSamples.push(`${file.replace(ROOT + '/', '')}:${idx + 1}  ${lines[idx].trim().slice(0, 120)}`)
        }
      }
    }
  }
}

const total = countExtraClassStatic + countExtraClassDynamic +
  countAttrStatic + countAttrDynamic +
  countExtraClassAttrStatic + countExtraClassAttrDynamic +
  countComplexDynamic

console.log('\n=== Phase 2B Codemod Report ===')
console.log(`Mode: ${WRITE ? 'WRITE' : 'DRY RUN'}`)
console.log(`Files affected: ${filesChanged.length}`)
console.log(`Replacements:`)
console.log(`  extra-class + static name       ${countExtraClassStatic}`)
console.log(`  extra-class + dynamic name      ${countExtraClassDynamic}`)
console.log(`  attrs + static name             ${countAttrStatic}`)
console.log(`  attrs + dynamic name            ${countAttrDynamic}`)
console.log(`  extra-class + attrs + static    ${countExtraClassAttrStatic}`)
console.log(`  extra-class + attrs + dynamic   ${countExtraClassAttrDynamic}`)
console.log(`  complex dynamic                 ${countComplexDynamic}`)
console.log(`  TOTAL                           ${total}`)
console.log(`\nRemaining <span class="mso*">: ${leftover}`)
if (leftoverSamples.length > 0) {
  console.log('Samples:')
  leftoverSamples.forEach(s => console.log(`  ${s}`))
}
if (!WRITE) console.log('\nRe-run with --write to apply.')
