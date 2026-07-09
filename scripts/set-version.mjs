#!/usr/bin/env node
/**
 * set-version.mjs — 统一版本号脚本
 * 用法:
 *   node scripts/set-version.mjs 1.2.3       手动指定
 *   node scripts/set-version.mjs --auto       CI 自动从 git tag 读
 * 修改: package.json / tauri.conf.json / Cargo.toml
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const arg = process.argv[2]
let version = ''

if (arg === '--auto') {
  // ponytail: CI 模式下从 git describe 提取版本号，
  // 天花板: 需要 tag 已存在（CI 在 push tag 后触发，满足条件）
  try {
    const tag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim()
    version = tag.replace(/^v/, '')
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      console.error(`❌ 无法从 git tag "${tag}" 解析出版本号`)
      process.exit(1)
    }
    console.log(`🏷️ 从 Git tag 读取版本号: ${tag} → ${version}`)
  } catch (e) {
    console.error('❌ 无法获取 Git tag，请确保已打 tag 并推送')
    process.exit(1)
  }
} else if (arg && /^\d+\.\d+\.\d+$/.test(arg)) {
  version = arg
} else {
  console.error('用法: node scripts/set-version.mjs 1.2.3  或  node scripts/set-version.mjs --auto')
  process.exit(1)
}

// 1. package.json
const pkgPath = new URL('../package.json', import.meta.url).pathname
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.version = version
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
console.log(`✅ package.json → ${version}`)

// 2. tauri.conf.json
const tauriConfPath = new URL('../src-tauri/tauri.conf.json', import.meta.url).pathname
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf8'))
tauriConf.version = version
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n')
console.log(`✅ tauri.conf.json → ${version}`)

// 3. Cargo.toml
const cargoPath = new URL('../src-tauri/Cargo.toml', import.meta.url).pathname
let cargo = readFileSync(cargoPath, 'utf8')
const before = cargo.match(/^version = ".*"/m)?.[0] || '(not found)'
cargo = cargo.replace(/^version = ".*"/m, `version = "${version}"`)
writeFileSync(cargoPath, cargo)
console.log(`✅ Cargo.toml: ${before} → version = "${version}"`)

console.log(`\n🎉 版本号已统一设置为 ${version}`)
console.log('   下一步:')
console.log(`   git add . && git commit -m "chore: bump to ${version}"`)
console.log(`   git tag v${version} && git push origin v${version}`)
