/**
 * postinstall 补丁脚本
 * 修复 Monterey (Safari 15) 不支持的 regex lookbehind 断言
 * 
 * marked — lookbehind 特性检测 (new RegExp("(?<=1)(?<!1)"))
 */

import { readFileSync, writeFileSync } from 'fs'

let patched = 0

// ─── 修复 marked — lookbehind 特性检测 ───
import { globSync } from 'fs'
// marked 可能在 pnpm 的多个版本目录下
const markedFiles = globSync('node_modules/.pnpm/marked@*/node_modules/marked/lib/marked.esm.js')

for (const file of markedFiles) {
  try {
    let content = readFileSync(file, 'utf8')
    if (content.includes('RegExp("(?<=1)(?<!1)"')) {
      content = content.replace(
        /return\s*!!\s*new\s+RegExp\("\(\?\<=1\)\(\(\?\<!1\)"\+?\w*\)\)/g,
        'false/*LB-fixed*/'
      )
      // also handle the simpler form
      content = content.replace(
        /!!new RegExp\("\(\?\<=1\)\(\?\<!1\)"\)/g,
        'false/*LB-fixed*/'
      )
      content = content.replace(
        /!!new RegExp\("\(\?\<=1\)\(\?\<!1\)"\+l\)/g,
        'false/*LB-fixed*/'
      )
      writeFileSync(file, content, 'utf8')
      console.log(`  ✅ patched: ${file}`)
      patched++
    } else {
      console.log(`  ⏭️  already clean: ${file}`)
    }
  } catch (e) {
    // file not found, skip
  }
}

if (patched > 0) {
  console.log(`\n🔧 Monterey compat: ${patched} file(s) patched for regex lookbehind compatibility`)
} else {
  console.log(`\n✅ Monterey compat: all files already clean`)
}
