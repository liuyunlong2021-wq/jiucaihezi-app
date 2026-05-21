import assert from 'node:assert/strict'
import { test } from 'node:test'

import { joinTauriPath, resolveDesktopDataDirs } from '../idb'

test('joinTauriPath keeps hidden home folders under the home directory', () => {
  assert.equal(joinTauriPath('/Users/by3', '.jiucaihezi', 'data'), '/Users/by3/.jiucaihezi/data')
  assert.equal(joinTauriPath('/Users/by3/', '.jiucaihezi', 'data'), '/Users/by3/.jiucaihezi/data')
})

test('resolveDesktopDataDirs prefers app data and keeps legacy path readable', () => {
  const dirs = resolveDesktopDataDirs(
    '/Users/by3/Library/Application Support/com.jiucaihezi.desktop',
    '/Users/by3'
  )

  assert.equal(dirs.dataDir, '/Users/by3/Library/Application Support/com.jiucaihezi.desktop/data')
  assert.equal(dirs.legacyDataDir, '/Users/by3/.jiucaihezi/data')
})
