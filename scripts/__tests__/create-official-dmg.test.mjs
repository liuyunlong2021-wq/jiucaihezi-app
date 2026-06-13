import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildCreateDmgArgs,
  deriveDmgPaths,
  ensureSafeBundleName,
  shouldRefuseDirtySource,
} from '../create-official-dmg.mjs'

test('deriveDmgPaths writes official DMG artifacts outside the macOS source directory', () => {
  const paths = deriveDmgPaths({
    root: '/repo',
    bundleName: '韭菜盒子',
    version: '0.1.6',
    arch: 'aarch64',
    suffix: 'latest',
  })

  assert.equal(paths.appPath, '/repo/src-tauri/target/release/bundle/macos/韭菜盒子.app')
  assert.equal(paths.dmgPath, '/repo/src-tauri/target/release/bundle/dmg/韭菜盒子_0.1.6_aarch64_latest.dmg')
  assert.equal(paths.latestDmgPath, '/repo/src-tauri/target/release/bundle/dmg/韭菜盒子_0.1.6_aarch64_latest.dmg')
})

test('buildCreateDmgArgs keeps official Finder layout and uses a clean source directory', () => {
  const args = buildCreateDmgArgs({
    volumeName: '韭菜盒子',
    iconPath: '/repo/src-tauri/target/release/bundle/dmg/icon.icns',
    appName: '韭菜盒子.app',
    dmgPath: '/repo/src-tauri/target/release/bundle/dmg/韭菜盒子_0.1.6_aarch64_latest.dmg',
    sourceDir: '/private/tmp/jc-official-dmg-source',
  })

  assert.deepEqual(args, [
    '--volname',
    '韭菜盒子',
    '--volicon',
    '/repo/src-tauri/target/release/bundle/dmg/icon.icns',
    '--window-size',
    '660',
    '400',
    '--icon-size',
    '128',
    '--icon',
    '韭菜盒子.app',
    '180',
    '170',
    '--app-drop-link',
    '480',
    '170',
    '--no-internet-enable',
    '/repo/src-tauri/target/release/bundle/dmg/韭菜盒子_0.1.6_aarch64_latest.dmg',
    '/private/tmp/jc-official-dmg-source',
  ])
})

test('shouldRefuseDirtySource detects old packages that would pollute a DMG source folder', () => {
  assert.equal(shouldRefuseDirtySource(['韭菜盒子.app']), false)
  assert.equal(shouldRefuseDirtySource(['韭菜盒子.app', 'old.zip']), true)
  assert.equal(shouldRefuseDirtySource(['韭菜盒子.app', 'rw.123.韭菜盒子.dmg']), true)
})

test('ensureSafeBundleName rejects names that cannot be used as direct bundle children', () => {
  assert.doesNotThrow(() => ensureSafeBundleName('韭菜盒子'))
  assert.throws(() => ensureSafeBundleName('../bad'), /Invalid bundle name/)
  assert.throws(() => ensureSafeBundleName('bad/name'), /Invalid bundle name/)
})
