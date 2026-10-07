import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tauriConfig = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))
// 统一行尾：仓库在 Windows 上 checkout 出来是 CRLF，而下面的断言用 \n 匹配
const workflow = readFileSync('.github/workflows/build.yml', 'utf8').replace(/\r\n/g, '\n')
const rustApp = readFileSync('src-tauri/src/lib.rs', 'utf8')
const rustManifest = readFileSync('src-tauri/Cargo.toml', 'utf8')
const packageManifest = JSON.parse(readFileSync('package.json', 'utf8'))
const macSigner = readFileSync('scripts/fix-macos-app.mjs', 'utf8')
const nodeEntitlements = readFileSync('src-tauri/node-entitlements.plist', 'utf8')

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

test('desktop updater registers safely and retains native startup checks', () => {
  assert.match(tauriConfig.plugins.updater.pubkey, /^[A-Za-z0-9+/=]+$/)
  assert.deepEqual(tauriConfig.plugins.updater.endpoints, ['https://api.jiucaihezi.studio/updates/updater.json'])
  assert.equal(tauriConfig.plugins.updater.windows.installMode, 'passive')
  assert.match(rustApp, /commands::desktop_update::setup/)
  assert.match(rustManifest, /tauri-plugin-updater/)
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
  assert.match(downloadJob, /updater\.json/)
  assert.match(downloadJob, /gh release download/)
  assert.match(downloadJob, /inputs\.publish_tag \|\| github\.ref_name/)
  assert.match(downloadJob, /\/opt\/updates\/latest\.json/)
  // 上传完之后必须收掉旧版本：每个版本 ≈ 487MB，只增不减会把服务器磁盘吃满。
  assert.match(downloadJob, /bash -s \/opt\/updates 5/)
  assert.match(downloadJob, /prune-updates\.sh/)
})

test('every desktop release job uses the audited desktop build before Tauri', () => {
  for (const [job, nextJob] of [
    ['macos-arm', 'macos-intel'],
    ['macos-intel', 'windows'],
    ['windows', 'publish-download-manifest'],
  ]) {
    const body = workflow.match(new RegExp(`\\n  ${job}:[\\s\\S]*?(?=\\n  ${nextJob}:)`))?.[0]
    assert.ok(body, job)
    assert.match(body, /pnpm run build:desktop:quick/, job)
    assert.ok(body.indexOf('pnpm run build:desktop:quick') < body.indexOf('pnpm tauri'), job)
  }
})

test('macOS release signs nested code before packaging and requires accepted notarization', () => {
  for (const [job, nextJob, architecture] of [
    ['macos-arm', 'macos-intel', 'aarch64-apple-darwin'],
    ['macos-intel', 'windows', 'x86_64-apple-darwin'],
  ]) {
    const body = workflow.match(new RegExp(`\\n  ${job}:[\\s\\S]*?(?=\\n  ${nextJob}:)`))?.[0]
    assert.ok(body, job)
    assert.match(body, new RegExp(`--target ${architecture} --bundles app`), job)
    assert.match(body, new RegExp(`fix-macos-app\\.mjs .*${architecture}`), job)
    assert.ok(body.indexOf('fix-macos-app.mjs') < body.indexOf('Create DMG'), job)
    assert.ok(body.indexOf('Create DMG') < body.indexOf('Notarize macOS app'), job)
    assert.match(body, /\.status'\)" = "Accepted"/, job)
    assert.match(body, /notarytool log/, job)
    assert.match(body, /stapler validate/, job)
    assert.doesNotMatch(body, /name: Notarize macOS app[^\n]*\n\s+continue-on-error: true/, job)
    assert.match(body, /find "\$APP_PATH\/Contents\/MacOS" -maxdepth 1 -type f -iname 'opencode\*'/, job)
  }

  assert.match(macSigner, /files\.sort\(\(left, right\) => right\.length - left\.length\)/)
  assert.match(macSigner, /node-entitlements\.plist/)
  assert.match(macSigner, /codesign'[\s\S]*--verify'[\s\S]*--deep'[\s\S]*--strict'/)
  assert.match(nodeEntitlements, /com\.apple\.security\.cs\.allow-jit/)
  assert.doesNotMatch(nodeEntitlements, /get-task-allow/)
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

test('every new workbench constructor holds the native task gate until attachment completes', () => {
  const body = rustApp.match(/pub\(crate\) fn spawn_workbench_window\([\s\S]*?\n\}/)?.[0]
  assert.ok(body)
  assert.match(body, /let _update_task = commands::desktop_update::native_task\(app\)\?;/)
  assert.ok(body.indexOf('native_task(app)') < body.indexOf('build_workbench_window'))
})

test('native screenshot session owns its update lease until capture, annotation, save or cancel finishes', () => {
  const screenshot = readFileSync('src-tauri/src/commands/screenshot.rs', 'utf8')
  assert.match(screenshot, /struct Active \{[\s\S]*?update_task: Option<super::desktop_update::NativeTask>/)
  assert.match(screenshot, /async fn begin\([\s\S]*?let update_task = super::desktop_update::native_task\(&app\)\?;/)
  assert.match(screenshot, /state\.active = Some\(Active \{[\s\S]*?update_task,/)
})

test('Windows upgrade probe embeds the real app manifest into its isolated lib test executable', () => {
  const probe = readFileSync('scripts/native-upgrade-probe.mjs', 'utf8')
  assert.match(probe, /--no-run/)
  assert.match(probe, /prepare-windows-upgrade-test\.ps1/)
  const manifest = readFileSync('scripts/prepare-windows-upgrade-test.ps1', 'utf8')
  assert.match(manifest, /inputresource:\$InstalledExe;#1/)
  assert.match(manifest, /outputresource:\$TestExe;#1/)
  assert.match(manifest, /Microsoft\.Windows\.Common-Controls/)
  assert.match(manifest, /& \$mt -nologo -manifest \$manifest /)
  assert.doesNotMatch(manifest, /outputresource:\$InstalledExe/)
})

test('existing-tag revalidation runs native probes and promotion despite skipped build ancestors', () => {
  assert.match(workflow, /verify-native-upgrade:\n\s+needs: publish-download-manifest\n\s+if: always\(\) && needs\.publish-download-manifest\.result == 'success'/)
  assert.match(workflow, /promote-updater:[\s\S]*?if: always\(\) && needs\.verify-native-upgrade\.result == 'success'/)
})

test('published immutable assets reuse full server checksums only after prior public verification and promotion', () => {
  assert.match(workflow, /PUBLIC_VERIFIED=false/)
  assert.match(workflow, /latest\.json[\s\S]*?PUBLIC_VERIFIED=true/)
  assert.match(workflow, /if \[ "\$PUBLIC_VERIFIED" = true \]; then/)
  assert.match(workflow, /Online size mismatch/)
  assert.match(workflow, /Online signature mismatch/)
  assert.match(workflow, /else\n\s+node scripts\/verify-online-updates\.mjs/)
})
