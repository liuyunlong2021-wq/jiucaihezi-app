import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('macOS OpenCode packaging includes both Apple Silicon and Intel runtimes', () => {
  const root = process.cwd()
  const libSource = readFileSync(join(root, 'src-tauri/src/lib.rs'), 'utf8')
  const updaterSource = readFileSync(join(root, 'scripts/update-opencode-runtime.mjs'), 'utf8')
  const tauriConfig = readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8')
  const buildWorkflow = readFileSync(join(root, '.github/workflows/build.yml'), 'utf8')

  assert.match(libSource, /opencode-aarch64-apple-darwin/)
  assert.match(libSource, /opencode-x86_64-apple-darwin/)
  assert.match(updaterSource, /opencode-darwin-arm64\.zip/)
  assert.match(updaterSource, /opencode-darwin-x64\.zip/)
  assert.match(tauriConfig, /"binaries\/opencode"/)
  assert.match(buildWorkflow, /Download OpenCode \(darwin arm64\)[\s\S]*--platform=darwin --arch=arm64/)
  assert.match(buildWorkflow, /Download OpenCode \(darwin x64\)[\s\S]*--platform=darwin --arch=x64/)
})
