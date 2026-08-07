import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tauriConfig = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
const workflow = readFileSync('.github/workflows/build.yml', 'utf8')

test('Windows release config installs WebView2 through the NSIS installer', () => {
  assert.deepEqual(tauriConfig.bundle.windows.webviewInstallMode, {
    type: 'downloadBootstrapper',
    silent: false,
  })
  assert.match(workflow, /--bundles nsis/)
  assert.match(workflow, /windows_setup\.exe/)
  assert.match(workflow, /\$setupPath = "src-tauri\\target\\韭菜盒子_\$\{tag\}_x64_windows_setup\.exe"/)
  assert.match(workflow, /gh release upload \$tag \$zipPath \$setupPath --clobber/)
})
