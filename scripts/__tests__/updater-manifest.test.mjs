import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createUpdaterManifest, writeUpdaterManifest } from '../updater-manifest.mjs'

function assets(dir) {
  return Object.fromEntries(['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64'].map(platform => {
    const path = join(dir, platform === 'windows-x86_64' ? 'windows.exe' : `${platform}.app.tar.gz`)
    writeFileSync(path, 'signed package fixture')
    writeFileSync(`${path}.sig`, Buffer.from('untrusted comment: signature\nRWfixture\ntrusted comment: timestamp\tversion:2.3.0\nfixture\n').toString('base64'))
    return [platform, path]
  }))
}

test('updater manifest points each architecture to its versioned final file and embeds signature content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jc-updater-'))
  const packages = assets(dir)
  const manifest = createUpdaterManifest('2.3.0', packages)
  assert.equal(manifest.version, '2.3.0')
  assert.equal(Object.keys(manifest.platforms).length, 3)
  for (const [platform, path] of Object.entries(packages)) {
    assert.equal(manifest.platforms[platform].signature, readFileSync(`${path}.sig`, 'utf8').trim())
    assert.ok(manifest.platforms[platform].url.startsWith('https://api.jiucaihezi.studio/updates/2.3.0/'))
  }
})

test('missing platform or missing signature leaves the previous manifest untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jc-updater-'))
  const packages = assets(dir)
  const target = join(dir, 'updater.json')
  writeFileSync(target, '{"version":"2.2.19"}')
  delete packages['darwin-x86_64']
  assert.throws(() => writeUpdaterManifest(target, '2.3.0', packages))
  assert.equal(readFileSync(target, 'utf8'), '{"version":"2.2.19"}')
})

test('public manifests cannot contain traversal versions or use DMG files as updater payloads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jc-updater-'))
  const packages = assets(dir)
  assert.throws(() => createUpdaterManifest('../2.3.0', packages))
  packages['darwin-aarch64'] = join(dir, 'bad.dmg')
  assert.throws(() => createUpdaterManifest('2.3.0', packages))
})
