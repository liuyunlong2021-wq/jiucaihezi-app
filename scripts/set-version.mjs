#!/usr/bin/env node
/**
 * set-version.mjs — 统一版本号脚本
 * 用法: node scripts/set-version.mjs 1.0.7
 * 修改: package.json / tauri.conf.json / Cargo.toml
 */
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('用法: node scripts/set-version.mjs 1.0.7')
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
