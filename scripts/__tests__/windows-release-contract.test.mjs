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
  assert.match(downloadJob, /bash -s \/opt\/updates '\$VERSION' downloads/)
  // R2 迁移验收完成前保留源文件，避免失去下载映射回滚能力。
  assert.doesNotMatch(downloadJob, /< scripts\/prune-updates\.sh/)
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
    assert.match(body, /apple-stapler\.mjs validate/, job)
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

test('version tag releases automatically promote OTA only after all native upgrades pass', () => {
  const condition = workflow.match(/\n  promote-updater:[\s\S]*?\n    if: ([^\n]+)/)?.[1]
  assert.ok(condition)
  const expression = condition
    .replace(/needs\.verify-native-upgrade\.result/g, 'result')
    .replace(/github\.event_name/g, 'event')
    .replace(/github\.ref/g, 'ref')
    .replace(/inputs\.native_platform/g, 'platform')
    .replace(/inputs\.promote_updater/g, 'promote')
    .replace(/inputs\.publish_tag/g, 'tag')
  const accepts = new Function('result', 'event', 'ref', 'platform', 'promote', 'tag', 'always', 'startsWith', `return ${expression}`)
  const scenarios = [
    ['tag release', 'success', 'push', 'refs/tags/v2.2.40', '', false, '', true],
    ['failed upgrades', 'failure', 'push', 'refs/tags/v2.2.40', '', false, '', false],
    ['cancelled upgrades', 'cancelled', 'push', 'refs/tags/v2.2.40', '', false, '', false],
    ['skipped upgrades', 'skipped', 'push', 'refs/tags/v2.2.40', '', false, '', false],
    ['branch push', 'success', 'push', 'refs/heads/main', '', false, '', false],
    ['manual promotion', 'success', 'workflow_dispatch', 'refs/heads/main', 'all', true, 'v2.2.39', true],
    ['download republication', 'success', 'workflow_dispatch', 'refs/heads/main', 'all', false, 'v2.2.39', false],
    ['manual tag republication', 'success', 'workflow_dispatch', 'refs/tags/v2.2.39', 'all', false, 'v2.2.39', false],
    ['Windows diagnostics', 'success', 'workflow_dispatch', 'refs/heads/main', 'windows', true, 'v2.2.39', false],
  ]
  for (const [name, result, event, ref, platform, promote, tag, expected] of scenarios) {
    assert.equal(accepts(result, event, ref, platform, promote, tag, () => true, (value, prefix) => value.startsWith(prefix)), expected, name)
  }
})

test('R2 publication verifies all immutable public bytes before redirects and download promotion', () => {
  const job = workflow.slice(workflow.indexOf('\n  publish-download-manifest:'), workflow.indexOf('\n  verify-native-upgrade:'))
  assert.match(job, /--pattern '\*_x64_windows_portable\.zip'/)
  assert.match(job, /publish-r2-updates\.py/)
  assert.match(job, /ref: \$\{\{ github\.ref \}\}/)
  assert.match(job, /group: desktop-download-publish/)
  assert.match(job, /R2-SHA256SUMS/)
  assert.match(job, /verify-online-updates\.mjs "\$VERSION" "\$ASSET_DIR" r2/)
  const upload = job.indexOf('python scripts/publish-r2-updates.py')
  const verify = job.indexOf('node scripts/verify-online-updates.mjs')
  const activate = job.indexOf('python3 /opt/updates/.release-tools/configure-r2-downloads.py')
  const promote = job.indexOf('bash -s /opt/updates')
  assert.ok(upload < verify && verify < activate && activate < promote)
  assert.match(job, /if ! node scripts\/verify-online-updates\.mjs[^\n]+ redirects \|\|/)
  assert.match(job, /configure-r2-downloads\.py '\$VERSION' '\/opt\/updates\/\$VERSION' rollback/)
  assert.doesNotMatch(job, /PUBLIC_VERIFIED/)
})

test('Windows-only diagnostics cannot promote a public updater manifest', () => {
  assert.match(workflow, /native_platform:[\s\S]*?options: \[all, windows\]/)
  assert.match(workflow, /matrix: \$\{\{ fromJSON\(inputs\.native_platform == 'windows'/)
  assert.match(workflow, /promote-updater:[\s\S]*?inputs\.native_platform != 'windows'/)
})

test('native A-to-B probe uses an updater-enabled baseline and allows slow NSIS installation', () => {
  assert.match(workflow, /gh release download v2\.2\.22/)
  assert.match(workflow, /native-upgrade-probe\.mjs "\$\{CANDIDATE_TAG#v\}" 2\.2\.22/)
  const probe = readFileSync('scripts/native-upgrade-probe.mjs', 'utf8')
  assert.match(probe, /Date\.now\(\) \+ 10 \* 60 \* 1000/)
  assert.match(probe, /if \(mismatches\.length\) \{[\s\S]*throw new Error\(`NSIS did not install/)
})

test('macOS build does not publish intermediate apps before final signing and notarization', () => {
  const macJobs = workflow.slice(workflow.indexOf('\n  macos-arm:'), workflow.indexOf('\n  windows:'))
  assert.doesNotMatch(macJobs, /tagName:|releaseId:|releaseName:|releaseBody:/)
  assert.equal((macJobs.match(/node scripts\/apple-stapler.mjs/g) || []).length, 8)
})

test('Apple ticket network failures retry without accepting invalid signatures', async () => {
  const { runStapler } = await import('../apple-stapler.mjs')
  let calls = 0
  const waits = []
  await runStapler('validate', '/tmp/app', { run() { if (++calls < 3) throw Object.assign(new Error('network lost'), { status: 68 }) }, wait: async ms => waits.push(ms) })
  assert.equal(calls, 3)
  assert.deepEqual(waits, [10000, 20000])
  calls = 0
  await assert.rejects(runStapler('validate', '/tmp/app', { run() { calls++; throw Object.assign(new Error('invalid ticket'), { status: 65 }) }, wait: async () => {} }), /invalid ticket/)
  assert.equal(calls, 1)
  calls = 0
  await assert.rejects(runStapler('staple', '/tmp/app', { run() { calls++; throw Object.assign(new Error('network lost'), { status: 68 }) }, wait: async () => {} }), /network lost/)
  assert.equal(calls, 3)
})
