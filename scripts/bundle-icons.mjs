#!/usr/bin/env node
/**
 * 扫描 src/ 所有 <JcIcon name="..."> 用法 + 6 个动态映射函数 + JcIcon.vue 的 ICON_ALIAS，
 * 提取所有图标名，从 @iconify-json/material-symbols 的完整数据集中提取子集，
 * 输出 src/assets/icons-bundle.json，供 JcIcon.vue 在运行时 addCollection() 使用。
 *
 * 用法：
 *   node scripts/bundle-icons.mjs           # 生成 bundle
 *   node scripts/bundle-icons.mjs --check   # 只检查覆盖率，不写文件
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const OUT_DIR = join(SRC, 'assets')
const OUT_PATH = join(OUT_DIR, 'icons-bundle.json')

const CHECK_ONLY = process.argv.includes('--check')

const msoData = require('@iconify-json/material-symbols/icons.json')

// <JcIcon name="add_circle" /> 或 <JcIcon ... name="add_circle" /> 或单引号
const STATIC_RE = /<JcIcon\b[^>]*\bname=["']([a-z][a-z0-9_]*)["']/g

// 任何引号字符串（用于扫 6 个映射函数所在文件的所有候选）
const STRING_RE = /["']([a-z][a-z0-9_]{2,})["']/g

// 6 个已知的动态映射函数名（用来识别需要全字符串扫描的文件）
const DYNAMIC_FUNC_RE = /\b(statusIcon|iconFor|getIcon|fileStatusIcon|toolLabel)\b/

// 与 JcIcon.vue 保持一致的 alias 映射
const ICON_ALIAS = {
  'auto_awesome': 'auto-awesome',
  'collections': 'collections-bookmark',
  'file_download': 'download',
  'file_import': 'download',
  'file_upload': 'upload-file',
  'film_frames': 'movie',
  'folder_search': 'folder-managed',
  'save_alt': 'save-as',
  'source': 'source-environment',
  'view_agenda': 'view-list',
  'volume_up': 'volume-up',
}

const collected = new Set()

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'node_modules') continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      walk(full, files)
    } else if (full.endsWith('.vue') || full.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

const files = walk(SRC)

for (const file of files) {
  const src = readFileSync(file, 'utf8')

  // Pass 1：所有显式 <JcIcon name="X" />
  for (const m of src.matchAll(STATIC_RE)) {
    collected.add(m[1])
  }

  // Pass 1.5：JS 数据对象如 { icon: 'translate' } 或 icon: "analytics"
  for (const m of src.matchAll(/icon:\s*["']([a-z][a-z0-9_]*)["']/g)) {
    const name = m[1]
    const resolved = ICON_ALIAS[name] ?? name
    const kebab = resolved.replace(/_/g, '-')
    if (msoData.icons[kebab]) collected.add(name)
  }

  // Pass 2：含 6 个映射函数任意一个的文件，把所有"形似图标名"的字符串都做候选
  if (DYNAMIC_FUNC_RE.test(src)) {
    for (const m of src.matchAll(STRING_RE)) {
      const name = m[1]
      const resolved = ICON_ALIAS[name] ?? name
      const kebab = resolved.replace(/_/g, '-')
      if (msoData.icons[kebab]) {
        collected.add(name)
      }
    }
  }
}

// 强制收集 ICON_ALIAS 的所有 key（防 Pass 1/2 漏抓）
for (const userName of Object.keys(ICON_ALIAS)) {
  collected.add(userName)
}

// 构造 Iconify subset
const subset = {
  prefix: 'material-symbols',
  width: msoData.width ?? 24,
  height: msoData.height ?? 24,
  info: msoData.info,
  icons: {},
}

const unmapped = []

for (const name of [...collected].sort()) {
  const resolved = ICON_ALIAS[name] ?? name
  const kebab = resolved.replace(/_/g, '-')
  const iconData = msoData.icons[kebab]
  if (iconData) {
    subset.icons[kebab] = iconData
  } else {
    unmapped.push(name)
  }
}

const json = JSON.stringify(subset)
const sizeKB = (json.length / 1024).toFixed(1)

console.log('\n=== Icon bundle report ===')
console.log(`Files scanned:       ${files.length}`)
console.log(`Icon names collected: ${collected.size}`)
console.log(`Icons bundled:       ${Object.keys(subset.icons).length}`)
console.log(`Bundle size (raw):   ${sizeKB} KB`)

if (unmapped.length > 0) {
  console.log(`\n⚠️  ${unmapped.length} icon names NOT FOUND in Material Symbols:`)
  for (const name of unmapped) {
    console.log(`  - ${name}`)
  }
  console.log(`\nActions:`)
  console.log(`  1. Add a mapping in ICON_ALIAS (JcIcon.vue AND this script) pointing to a real MS name`)
  console.log(`  2. Or change the call site to a real MS name`)
  console.log(`  3. Or accept silent blank icon (not recommended)`)
}

if (CHECK_ONLY) {
  console.log('\n(--check mode: no file written)')
  process.exit(unmapped.length > 0 ? 1 : 0)
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_PATH, json)
console.log(`\n✅ Bundle written to: ${OUT_PATH.replace(ROOT + '/', '')}`)
