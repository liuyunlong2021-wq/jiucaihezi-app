import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  ensureProfilePluginLinks,
  profileDirectory,
  profilePluginPackages,
  runtimePluginPath,
} from '../../src-tauri/resources/deepseek-harness/profile-plugins.mjs'

// Computer Use 的两个包不在官方 bundle 依赖图里：Loader 按 profile 目录解析裸包名，
// 解析不到时**只记一条 `failed to import`**——不报错、不失败、工具表里空无一物。
// 2026-10-03 真机排查：`dsh --profile sdk --patch <route>` 的 stderr 原话就是
//   `computer-use (@deepseek-ai/dsh-computer-use): failed to import`
// 在 profile 下补上可解析路径（本模块）后，同一条启动命令零输出、两个插件都激活
// （激活里含 `@trycua/cua-driver` 的动态导入与 56 个工具发现）。

const runtimePackageDirectory = () => mkdtempSync(join(tmpdir(), 'jc-runtime-'))
const harnessHome = () => mkdtempSync(join(tmpdir(), 'jc-home-'))

/** 造一个只有包目录（带 package.json）的假运行时。 */
function fakeRuntime(packages) {
  const root = runtimePackageDirectory()
  for (const name of packages) {
    const directory = join(root, '@deepseek-ai', name)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version: '0.0.0' }))
  }
  return root
}

const linkOf = (home, profile, name) =>
  join(profileDirectory(home, profile), 'node_modules', '@deepseek-ai', name)

test('打包运行时里带着 Computer Use 的两个插件包', t => {
  for (const name of profilePluginPackages) {
    if (!existsSync(join(runtimePluginPath(name), 'package.json'))) {
      return t.skip(`打包运行时缺少 ${name}（安装脚本被裁剪过？）`)
    }
  }
  assert.deepEqual(profilePluginPackages, [
    'dsh-computer-use',
    'dsh-experimental-computer-use-cua-driver-native',
  ])
})

test('profile 已存在时补上链接，且可重复执行', () => {
  const home = harnessHome()
  mkdirSync(profileDirectory(home), { recursive: true })
  const runtimeRoot = fakeRuntime(profilePluginPackages)

  const first = ensureProfilePluginLinks(home, { runtimeRoot })
  assert.equal(first.state, 'ok')
  assert.deepEqual(first.linked, profilePluginPackages, '两个包都要能挂上')
  for (const name of profilePluginPackages) {
    assert.ok(existsSync(join(linkOf(home, 'sdk', name), 'package.json')), `${name} 必须可从 profile 解析`)
  }

  const second = ensureProfilePluginLinks(home, { runtimeRoot })
  assert.deepEqual(second.linked, [], '第二次不该重复建链接')
})

test('运行时缺少某个包时只跳过它', () => {
  const home = harnessHome()
  mkdirSync(profileDirectory(home), { recursive: true })
  const runtimeRoot = fakeRuntime([profilePluginPackages[1]])

  const result = ensureProfilePluginLinks(home, { runtimeRoot })
  assert.deepEqual(result.linked, [profilePluginPackages[1]])
  assert.equal(existsSync(linkOf(home, 'sdk', profilePluginPackages[0])), false)
})

test('profile 不存在：先按官方路径催生，催不出来只跳过', () => {
  const home = harnessHome()
  const runtimeRoot = fakeRuntime(profilePluginPackages)

  const missing = ensureProfilePluginLinks(home, { runtimeRoot, initialize: () => {} })
  assert.deepEqual(missing, { state: 'skipped', reason: 'profile-missing' }, '不能凭空造 profile 骨架')

  const initialized = ensureProfilePluginLinks(home, {
    runtimeRoot,
    initialize: () => mkdirSync(profileDirectory(home), { recursive: true }),
  })
  assert.deepEqual(initialized.linked, profilePluginPackages)

  const failed = ensureProfilePluginLinks(harnessHome(), {
    runtimeRoot,
    initialize: () => { throw new Error('dsh 起不来') },
  })
  assert.deepEqual(failed, { state: 'skipped', reason: 'profile-init-failed' })
})

test('没有 DSH_HOME 时不动文件系统', () => {
  assert.deepEqual(ensureProfilePluginLinks(''), { state: 'skipped', reason: 'no-dsh-home' })
})

test('runner 只在开关打开时补链接，且由路由侧把开关传下来', () => {
  const runner = readFileSync('src-tauri/resources/deepseek-harness/runner.mjs', 'utf8')
  // 开关关着就不该动用户的 profile 目录。
  assert.match(runner, /if \(config\.computerUse\) ensureProfilePluginLinks\(config\.dshHome\)/)
  assert.match(runner, /import \{ ensureProfilePluginLinks \} from '\.\/profile-plugins\.mjs'/)

  const route = readFileSync('src/services/deepSeekHarness.ts', 'utf8')
  assert.match(route, /computerUse: computerUseEnabledNow\(\),/)
})
