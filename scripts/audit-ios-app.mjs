import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

// 这一层审计只对「已经用 tauri ios build 打出来的 .app」有效：
// 前端 dist 审计看不到 bundle.resources，而 Xcode 会把 gen/apple/assets 整个当资源目录打进去。
// 2026-09-27 就是在这里发现安装包带着 8 月 25 日那份陈旧资源拷贝（含 1.2 MB skills）。
const appDir = resolve(process.argv[2] || process.env.IOS_APP_DIR || 'src-tauri/gen/apple/build/arm64-sim/韭菜盒子.app')

// 桌面端才需要的资源，任何一项出现在手机包里都违反合同 §13.4。
const forbiddenResourceDirs = ['skills', 'deepseek-harness', 'creation-mcp', 'storyboarder', 'jev-scorer']

if (!existsSync(appDir)) {
  console.error(`[ios-app] 找不到安装包：${appDir}`)
  console.error('  先跑 npx tauri ios build -t aarch64-sim -d，或把路径作为第一个参数传进来')
  process.exit(1)
}

const failures = []

for (const name of forbiddenResourceDirs) {
  for (const candidate of [join(appDir, 'assets', name), join(appDir, name)]) {
    if (existsSync(candidate)) {
      failures.push({ path: relative(appDir, candidate).split(sep).join('/'), reason: 'desktop resource in mobile bundle' })
    }
  }
}

const assetsDir = join(appDir, 'assets')
if (existsSync(assetsDir) && readdirSync(assetsDir).length > 0) {
  const extra = readdirSync(assetsDir).slice(0, 10).join(', ')
  failures.push({ path: 'assets', reason: `unexpected bundled resources: ${extra}` })
}

const infoPlist = join(appDir, 'Info.plist')
if (!existsSync(infoPlist)) {
  failures.push({ path: 'Info.plist', reason: 'missing' })
} else {
  // Xcode 打出来的 Info.plist 是二进制 plist，只能靠 plutil 读。
  const readPlistValue = (key) => {
    try {
      return execFileSync('plutil', ['-extract', key, 'raw', infoPlist], { encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  }
  // 缺相机用途说明时，真机一调扫码就崩（App Store 审核也会退）。
  if (!readPlistValue('NSCameraUsageDescription')) {
    failures.push({ path: 'Info.plist', reason: 'NSCameraUsageDescription missing' })
  }
  if (readPlistValue('CFBundleIdentifier') !== 'com.jiucaihezi.mobile') {
    failures.push({ path: 'Info.plist', reason: `unexpected bundle identifier: ${readPlistValue('CFBundleIdentifier')}` })
  }
}

if (failures.length > 0) {
  console.error('[ios-app] audit failed:')
  for (const failure of failures) console.error(`  - ${failure.path} (${failure.reason})`)
  process.exit(1)
}

const binary = readdirSync(appDir).find(name => {
  const target = join(appDir, name)
  return !name.startsWith('.')
    && name !== 'PkgInfo'
    && statSync(target).isFile()
    && !/\.(plist|png|jpg|json|car)$/.test(name)
})
console.log(`[ios-app] audit passed (${binary || 'app'} · 无桌面资源)`)
