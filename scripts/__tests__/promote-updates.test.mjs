import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
const supported = process.platform !== 'win32'
function candidate(root, version) {
  const dir = join(root, version)
  mkdirSync(dir)
  const platforms = Object.fromEntries(['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64'].map(platform => {
    const file = `${platform}.${platform.startsWith('darwin') ? 'app.tar.gz' : 'exe'}`
    writeFileSync(join(dir, file), 'fixture')
    writeFileSync(join(dir, file + '.sig'), 'signed fixture')
    return [platform, { url: `https://api.jiucaihezi.studio/updates/${version}/${file}`, signature: 'signed fixture' }]
  }))
  const manifest = { version, platforms }
  for (const name of ['updater.json', 'latest.json']) writeFileSync(join(dir, name), JSON.stringify(manifest))
  return manifest
}
function promote(root, version, mode = 'updater') {
  execFileSync('bash', ['scripts/promote-updates.sh', root, version, mode], { stdio: 'pipe' })
}
test('OTA promotion is separate from downloads, keeps previous manifest and is idempotent', { skip: !supported }, () => {
  const root = mkdtempSync(join(tmpdir(), 'jc-promote-'))
  try {
    const old = candidate(root, '2.3.0'), next = candidate(root, '2.3.1')
    promote(root, '2.3.0')
    promote(root, '2.3.1', 'downloads')
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'updater.json'))), old)
    promote(root, '2.3.1')
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'updater-previous.json'))), old)
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'updater.json'))), next)
    promote(root, '2.3.1')
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'updater-previous.json'))), old)
    assert.throws(() => promote(root, '2.3.0'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
test('missing artifact or invalid candidate leaves the live OTA manifest byte-for-byte unchanged', { skip: !supported }, () => {
  const root = mkdtempSync(join(tmpdir(), 'jc-promote-'))
  try {
    candidate(root, '2.3.0'); candidate(root, '2.3.1')
    promote(root, '2.3.0')
    const before = readFileSync(join(root, 'updater.json'))
    rmSync(join(root, '2.3.1', 'windows-x86_64.exe'))
    assert.throws(() => promote(root, '2.3.1'))
    assert.deepEqual(readFileSync(join(root, 'updater.json')), before)
    writeFileSync(join(root, '2.3.1', 'updater.json'), '{broken')
    assert.throws(() => promote(root, '2.3.1'))
    assert.deepEqual(readFileSync(join(root, 'updater.json')), before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
