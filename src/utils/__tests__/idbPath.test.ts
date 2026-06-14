import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

test('web storage fallback uses IndexedDB and migrates legacy localStorage stores', () => {
  const source = readFileSync(join(process.cwd(), 'src/utils/idb.ts'), 'utf8')

  assert.match(source, /\.open\(WEB_DB_NAME/)
  assert.match(source, /migrateWebLocalStorageToIndexedDb/)
  assert.match(source, /jc_store_\$\{store\}/)
  assert.match(source, /jc_media_tasks_v1/)
  assert.doesNotMatch(source, /if \(!isTauri\) \{\s*console\.warn\('[^']*localStorage/)
})
