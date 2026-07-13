import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('macOS OpenCode packaging includes both Apple Silicon and Intel runtimes', () => {
  const root = process.cwd()
  const resolverSource = readFileSync(join(root, 'src-tauri/src/commands/tools.rs'), 'utf8')
  const updaterSource = readFileSync(join(root, 'scripts/update-opencode-runtime.mjs'), 'utf8')
  const tauriConfig = readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')
  const buildWorkflow = readFileSync(join(root, '.github/workflows/build.yml'), 'utf8')

  assert.match(resolverSource, /opencode-aarch64-apple-darwin/)
  assert.match(resolverSource, /opencode-x86_64-apple-darwin/)
  assert.match(updaterSource, /opencode-darwin-arm64\.zip/)
  assert.match(updaterSource, /opencode-darwin-x64-baseline\.zip/)
  assert.match(tauriConfig, /"binaries\/opencode"/)
  assert.match(buildWorkflow, /Download OpenCode \(darwin arm64\)[\s\S]*--platform=darwin --arch=arm64/)
  assert.match(buildWorkflow, /Download OpenCode \(darwin x64\)[\s\S]*--platform=darwin --arch=x64/)
})

test('OpenCode SDK, runtime manifest, and frontend metadata use one official version', () => {
  const root = process.cwd()
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const manifest = JSON.parse(readFileSync(join(root, 'src-tauri/binaries/opencode-runtime.json'), 'utf8'))
  const frontendInfo = readFileSync(join(root, 'src/data/opencodeRuntimeInfo.ts'), 'utf8')

  assert.equal(packageJson.dependencies['@opencode-ai/sdk'], manifest.version)
  assert.equal(manifest.release, `v${manifest.version}`)
  assert.match(frontendInfo, new RegExp(`"release": "v${manifest.version}"`))
  assert.match(frontendInfo, new RegExp(`"version": "${manifest.version}"`))
})

test('OpenCode updater uses baseline builds for every x64 desktop target', () => {
  const source = readFileSync(join(process.cwd(), 'scripts/update-opencode-runtime.mjs'), 'utf8')

  assert.match(source, /opencode-darwin-x64-baseline\.zip/)
  assert.match(source, /opencode-linux-x64-baseline\.tar\.gz/)
  assert.match(source, /opencode-windows-x64-baseline\.zip/)
})

test('OpenCode restarts preserve committed SQLite WAL data', () => {
  const source = readFileSync(join(process.cwd(), 'src-tauri/src/commands/opencode.rs'), 'utf8')

  assert.doesNotMatch(source, /remove_file\([^)]*(?:wal|shm|stale)/)
  assert.match(source, /async fn stop_opencode_session[\s\S]*current\.child\.wait\(\)/)
  assert.match(source, /if let Some\(current\) = replaced_session[\s\S]*stop_opencode_session\(current\)\.await/)
})

test('OpenCode desktop enables only the official desktop runtime flags', () => {
  const source = readFileSync(join(process.cwd(), 'src-tauri/src/commands/opencode.rs'), 'utf8')

  assert.doesNotMatch(source, /\.env\("OPENCODE_EXPERIMENTAL",\s*"true"\)/)
  assert.match(source, /\.env\("OPENCODE_EXPERIMENTAL_ICON_DISCOVERY",\s*"true"\)/)
  assert.match(source, /\.env\("OPENCODE_EXPERIMENTAL_FILEWATCHER",\s*"true"\)/)
  assert.match(source, /\.env\("OPENCODE_CLIENT",\s*"desktop"\)/)
})
