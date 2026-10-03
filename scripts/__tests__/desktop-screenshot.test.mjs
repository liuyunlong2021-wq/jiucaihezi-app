import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
test('screenshot window has an isolated entry and only screenshot permissions', () => {
  const capability = JSON.parse(read('src-tauri/capabilities/screenshot.json'))
  const workbench = JSON.parse(read('src-tauri/capabilities/default.json'))
  assert.deepEqual(capability.windows, ['shot-*'])
  assert.deepEqual(capability.platforms, ['macOS', 'windows'])
  assert(!workbench.windows.includes('shot-*'))
  for (const permission of capability.permissions) {
    assert(!/shell|sql|allow-app-commands|fs:default|core:default/.test(typeof permission === 'string' ? permission : permission.identifier))
  }
  const entry = read('src/screenshot.ts')
  assert.match(entry, /createApp\(ScreenshotOverlay\)/)
  assert.doesNotMatch(entry, /import.*(?:App\.vue|main|pinia|deepSeekHarness|desktopRemote)/)
  const allowed = JSON.parse(read('src-tauri/permissions/screenshot.json')).permission[0].commands.allow
  assert(allowed.includes('screenshot_crop'))
  assert(allowed.includes('screenshot_end'))
  assert(!allowed.includes('screenshot_set_settings'))
  assert(!allowed.includes('screenshot_begin'))
})
test('screenshot dependencies keep the existing platform patches active', () => {
  const cargo = read('src-tauri/Cargo.toml')
  assert.match(cargo, /tauri-plugin-global-shortcut = "=2\.3\.1"/)
  assert.match(cargo, /\[target\.'cfg\(target_os = "windows"\)'\.dependencies\]\s*xcap/)
  assert.match(cargo, /tauri-runtime-wry = \{ path = "vendor\/tauri-runtime-wry" \}/)
})
test('screenshot entry resolves outside /try/ in development and inside bundled assets', () => {
  const source = read('src-tauri/src/commands/screenshot.rs')
  const entry = source.match(/WebviewUrl::App\("([^"]+)"\.into\(\)\)/)?.[1]
  assert(entry)
  assert.equal(new URL(entry, 'http://localhost:1420/try/').pathname, '/screenshot/index.html')
  assert.equal(new URL(entry, 'tauri://localhost/').pathname, '/screenshot/index.html')
})
test('screenshot settings stay separate from appearance and reuse product theme', () => {
  const settings = read('src/components/memory/MemorySettings.vue')
  assert.match(settings, /v-else-if="tab === 'theme'" class="memory-appearance"/)
  assert.doesNotMatch(settings, /v-else class="memory-appearance"/)
  assert.doesNotMatch(settings, /grid-template-columns: repeat\(6, 1fr\)/)
  const entry = read('src/screenshot.ts')
  assert.match(entry, /styles\/design-tokens\.css/)
  assert.match(entry, /useTheme\(\)/)
  const overlay = read('src/components/memory/ScreenshotOverlay.vue')
  assert.match(overlay, /background:var\(--surface\)/)
  assert.doesNotMatch(overlay, /background:#333|background:#222;/)
  assert.match(read('src-tauri/src/commands/screenshot.rs'), /shortcut: "Control\+Shift\+A"\.into\(\)/)
  assert.match(read('src/components/memory/ScreenshotSettings.vue'), /shortcutKeys/)
})
