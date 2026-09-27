import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = path => readFileSync(path, 'utf8')
const pkg = () => JSON.parse(source('package.json'))

// iOS 平台配置是通过 JSON Merge Patch（RFC 7396）合并到 tauri.conf.json 上的。
// 在 RFC 7396 里，null 才会删除成员；空对象「什么都不做」。所以要让 iOS 不带
// 桌面资源，只能写 resources: null —— 写成 {} 或省略都会静默继承那五项
// （其中 resources/deepseek-harness 就是打包进安装包的 Node 运行时）。
test('iOS 配置用 JSON Merge Patch 删掉桌面专属资源', () => {
  const ios = JSON.parse(source('src-tauri/tauri.ios.conf.json'))

  assert.equal(ios.bundle.resources, null)
  assert.equal(ios.identifier, 'com.jiucaihezi.mobile')
})

test('桌面配置的资源没有被 iOS 的隔离改动削弱', () => {
  const desktop = JSON.parse(source('src-tauri/tauri.conf.json'))

  assert.deepEqual(Object.keys(desktop.bundle.resources).sort(), [
    '../public/skills',
    '../scripts/jev-scorer/serve.py',
    '../scripts/jiucaihezi-creation-mcp/dist',
    'resources/deepseek-harness',
    'resources/storyboarder',
  ])
})

test('iOS 构建只编控制器入口，不准备 Harness 与创作 MCP 资源', () => {
  const script = pkg().scripts['build:ios:quick']

  assert.match(script, /JC_BUILD_TARGET=mobile vite build/)
  assert.match(script, /prune-ios-dist\.mjs/)
  assert.match(script, /audit:ios-dist/)
  assert.doesNotMatch(script, /deepseek-harness|creation-mcp/)
})

test('vite 默认仍编落地页与工作台两个入口，只有 iOS 收窄到控制器', () => {
  const config = source('vite.config.ts')

  assert.match(config, /process\.env\.JC_BUILD_TARGET === 'mobile'\s*\?\s*\{\s*index:\s*resolve\(__dirname, 'mobile\/index\.html'\)\s*\}/)
  assert.match(config, /index:\s*resolve\(__dirname, 'index\.html'\),\s*\n\s*try:\s*resolve\(__dirname, 'try\/index\.html'\),/)
})

test('控制器入口不导入工作台 Runtime 与对话执行器', () => {
  const entry = source('src/mobile/main.ts')
  const component = source('src/mobile/MobileController.vue')
  const forbidden = /@app-root|deepSeekHarness|memoryChat|agentStore|runtime\/memory|mcpBridge|newApiClient|desktopRemoteBridge/

  assert.doesNotMatch(entry, forbidden)
  assert.doesNotMatch(component, forbidden)
  assert.match(entry, /from '\.\/MobileController\.vue'/)
  assert.doesNotMatch(entry, /createPinia/)
})

test('iOS 产物审计仍然拦桌面运行时标记与悬空引用', () => {
  const audit = source('scripts/audit-ios-dist.mjs')

  assert.match(audit, /deepseek-harness/)
  assert.match(audit, /mcp_spawn_stdio/)
  assert.match(audit, /dangling reference/)
  assert.match(audit, /allowedRootNames = new Set\(\['assets', 'favicon\.svg', 'index\.html'\]\)/)
})

test('安装包审计盯住打进 .app 的桌面资源', () => {
  const audit = source('scripts/audit-ios-app.mjs')

  // 前端 dist 审计看不到 bundle.resources，这一层是 §13.4 的唯一出口。
  for (const name of ['skills', 'deepseek-harness', 'creation-mcp', 'storyboarder', 'jev-scorer']) {
    assert.match(audit, new RegExp(`'${name}'`))
  }
  assert.match(audit, /NSCameraUsageDescription missing/)
  assert.match(source('package.json'), /"audit:ios-app"/)
})

test('扫码权限只给 iOS，并且相机用途说明随包提交', () => {
  const capability = JSON.parse(source('src-tauri/capabilities/mobile.json'))
  const desktop = JSON.parse(source('src-tauri/capabilities/default.json'))
  const plist = source('src-tauri/Info.ios.plist')

  assert.deepEqual(capability.platforms, ['iOS'])
  assert.ok(capability.permissions.includes('barcode-scanner:allow-scan'))
  // 手机端拿不到桌面那套文件 / Shell / SQL 能力。
  assert.deepEqual(desktop.platforms, ['macOS', 'windows', 'linux'])
  assert.doesNotMatch(JSON.stringify(capability), /fs:|shell:|sql:|dialog:/)
  // App Store 审核要求相机权限有用途说明，缺了会在真机上直接崩。
  assert.match(plist, /<key>NSCameraUsageDescription<\/key>\s*<string>[^<]+<\/string>/)
})
