import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tauriConfig = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
const workflow = readFileSync('.github/workflows/build.yml', 'utf8')
const rustApp = readFileSync('src-tauri/src/lib.rs', 'utf8')
const rustManifest = readFileSync('src-tauri/Cargo.toml', 'utf8')
const packageManifest = JSON.parse(readFileSync('package.json', 'utf8'))

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

test('disabled updater cannot panic application startup', () => {
  assert.equal(tauriConfig.plugins.updater, undefined)
  assert.doesNotMatch(rustApp, /tauri_plugin_updater/)
  assert.doesNotMatch(rustManifest, /tauri-plugin-updater/)
  assert.equal(packageManifest.dependencies['@tauri-apps/plugin-updater'], undefined)
  assert.match(workflow, /Smoke test — Windows app startup/)
  assert.match(workflow, /Start-Process[\s\S]*jiucaihezi-app\.exe/)
  assert.match(workflow, /HasExited/)
})

test('desktop release creation and public download manifest are independent from OTA', () => {
  assert.match(workflow, /prepare-release:[\s\S]*gh release create/)
  assert.match(workflow, /workflow_dispatch:[\s\S]*publish_tag:/)
  assert.match(workflow, /macos-arm:\n\s+needs: prepare-release/)
  assert.match(workflow, /macos-intel:\n\s+needs: prepare-release/)
  assert.match(workflow, /windows:\n\s+needs: prepare-release/)

  const downloadJob = workflow.match(/\n  publish-download-manifest:[\s\S]*$/)?.[0]
  assert.ok(downloadJob)
  assert.doesNotMatch(downloadJob, /&& false/)
  assert.doesNotMatch(downloadJob, /SIGNING_PRIVATE_KEY|signature/)
  assert.match(downloadJob, /gh release download/)
  assert.match(downloadJob, /inputs\.publish_tag \|\| github\.ref_name/)
  assert.match(downloadJob, /\/opt\/updates\/latest\.json/)
})

test('every desktop release job builds the bundled Creation MCP before Tauri', () => {
  for (const [job, nextJob] of [
    ['macos-arm', 'macos-intel'],
    ['macos-intel', 'windows'],
    ['windows', 'publish-download-manifest'],
  ]) {
    const body = workflow.match(new RegExp(`\\n  ${job}:[\\s\\S]*?(?=\\n  ${nextJob}:)`))?.[0]
    assert.ok(body, job)
    assert.match(body, /pnpm run build:creation-mcp/, job)
    assert.ok(body.indexOf('pnpm run build:creation-mcp') < body.indexOf('pnpm tauri'), job)
  }
})

test('Storyboarder assets are fetchable and included in the Windows portable zip', () => {
  const csp = tauriConfig.app.security.csp
  const connectSrc = csp.match(/connect-src ([^;]+)/)?.[1] || ''
  assert.match(connectSrc, /(?:^|\s)asset:(?:\s|$)/)
  assert.match(connectSrc, /(?:^|\s)http:\/\/asset\.localhost(?:\s|$)/)

  assert.match(workflow, /Copy-Item "\$releaseDir\\storyboarder" \(Join-Path \$portableDir "storyboarder"\) -Recurse/)
  for (const path of [
    'storyboarder/manifest.json',
    'storyboarder/models/adult-male.glb',
    'storyboarder/models/adult-female.glb',
    'storyboarder/models/teen-male.glb',
    'storyboarder/models/teen-female.glb',
    'storyboarder/models/child.glb',
  ]) assert.ok(workflow.includes(`"${path}"`), path)
})
