import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// 下载服务器每个版本要放 arm dmg + intel dmg + win setup ≈ 490MB，只增不减会把
// 磁盘吃满。脚本的真实执行环境是服务器（Linux），这里在临时目录里跑同一份脚本。
// 没有 bash 的开发机（常见于 Windows）跳过，否则门禁会在这些机器上永久变红。
const noBash = { skip: hasBash() ? false : '需要 bash，本机未安装' }

function hasBash() {
  try {
    execFileSync('bash', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function arrange(versions, latestVersion, keep) {
  const dir = mkdtempSync(join(tmpdir(), 'jc-updates-'))
  for (const version of versions) mkdirSync(join(dir, version))
  mkdirSync(join(dir, 'backup')) // 非版本目录：绝不能被删
  writeFileSync(join(dir, 'latest.json'), JSON.stringify({ version: latestVersion }))
  execFileSync('bash', ['scripts/prune-updates.sh', dir, String(keep)])
  return dir
}

function versionDirs(dir) {
  return readdirSync(dir).filter(name => /^\d/.test(name)).sort()
}

test('prune-updates keeps the newest N version directories and nothing else', noBash, () => {
  const dir = arrange(['2.1.0', '2.1.1', '2.2.0', '2.2.1', '2.2.2'], '2.2.2', 3)

  assert.deepEqual(versionDirs(dir), ['2.2.0', '2.2.1', '2.2.2'])
  assert.ok(existsSync(join(dir, 'latest.json')), 'latest.json 不能被删')
  assert.ok(existsSync(join(dir, 'backup')), '非版本目录不能被删')
})

test('prune-updates never deletes the version latest.json points at', noBash, () => {
  // 保留 2 个时按数量该删掉 2.2.0，但 latest.json 正指着它 —— 必须留下
  const dir = arrange(['2.1.0', '2.1.1', '2.2.0', '2.2.1', '2.2.2'], '2.2.0', 2)

  assert.deepEqual(versionDirs(dir), ['2.2.0', '2.2.1', '2.2.2'])
})

test('prune-updates does nothing when there is nothing to prune', noBash, () => {
  const dir = arrange(['2.2.0', '2.2.1'], '2.2.1', 5)

  assert.deepEqual(versionDirs(dir), ['2.2.0', '2.2.1'])
  assert.ok(existsSync(join(dir, 'latest.json')))
})

test('prune-updates reads its target and keep count from arguments', noBash, () => {
  // CI 传的就是这两个位置参数，签名变了要立刻发现
  const dir = arrange(['1.0.0', '1.9.0', '1.10.0'], '1.10.0', 1)

  assert.deepEqual(versionDirs(dir), ['1.10.0'])
})
