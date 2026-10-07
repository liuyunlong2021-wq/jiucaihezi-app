// CI 隔离安装目录中调用真实官方升级引擎；不宣称覆盖真实用户的点击、权限和业务操作。
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const [version, baseline, assetsDirectory] = process.argv.slice(2)
for (const value of [version, baseline]) if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error('Invalid upgrade version')
const assets = resolve(assetsDirectory)
const root = resolve(process.env.RUNNER_TEMP || '/tmp', 'jc-native-upgrade')
const installed = join(root, 'installed'), expected = join(root, 'expected')
mkdirSync(installed, { recursive: true }); mkdirSync(expected, { recursive: true })
const sentinel = join(root, 'user-data-sentinel.json')
writeFileSync(sentinel, JSON.stringify({ project: '保留中文项目', draft: '未发送草稿', version: baseline }))
const before = readFileSync(sentinel)
let exe, artifact, expectedExe
if (process.platform === 'darwin') {
  const suffix = process.arch === 'arm64' ? 'aarch64' : 'x64'
  artifact = join(assets, `_${suffix}.app.tar.gz`)
  execFileSync('tar', ['-xzf', join(assets, `baseline_${suffix}.app.tar.gz`), '-C', installed])
  execFileSync('tar', ['-xzf', artifact, '-C', expected])
  const executable = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', join(installed, '韭菜盒子.app/Contents/Info.plist')], { encoding: 'utf8' }).trim()
  exe = join(installed, '韭菜盒子.app/Contents/MacOS', executable)
  expectedExe = join(expected, '韭菜盒子.app/Contents/MacOS', executable)
} else if (process.platform === 'win32') {
  artifact = join(assets, readdirSync(assets).find(name => name.endsWith('_x64_windows_setup.exe')))
  const old = join(assets, 'baseline_setup.exe')
  execFileSync('powershell', ['-NoProfile', '-Command', "$p=Start-Process -FilePath $env:JC_PROBE_SETUP -ArgumentList @('/S',('/D='+$env:JC_PROBE_INSTALL)) -Wait -PassThru; if($p.ExitCode -ne 0){exit $p.ExitCode}"], { env: { ...process.env, JC_PROBE_SETUP: old, JC_PROBE_INSTALL: installed }, stdio: 'inherit' })
  exe = join(installed, 'jiucaihezi-app.exe')
} else throw new Error('Native probe requires macOS or Windows')
if (!existsSync(exe)) throw new Error('Baseline installer did not create executable')
execFileSync('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml', '--lib', 'native_release_upgrade', '--', '--ignored', '--nocapture'], {
  stdio: 'inherit', env: { ...process.env, JC_UPGRADE_INSTALLED_EXE: exe, JC_UPGRADE_PACKAGE: artifact, JC_UPGRADE_VERSION: version, JC_UPGRADE_OLD_VERSION: baseline }, timeout: 45 * 60 * 1000,
})
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
// Windows install() 启动 NSIS 后退出测试子进程，父进程等待文件完成替换。
if (process.platform === 'win32') {
  const hashes = JSON.parse(readFileSync(join(assets, 'native-windows-files.json'), 'utf8'))
  const complete = () => Object.entries(hashes).every(([path, hash]) => {
    try { return digest(join(installed, path)) === hash } catch { return false }
  })
  const deadline = Date.now() + 180000
  while (Date.now() < deadline && !complete()) await new Promise(resolve => setTimeout(resolve, 1000))
  if (!complete()) throw new Error('NSIS did not install all expected executable and runtime bytes')

} else {
  if (digest(exe) !== digest(expectedExe)) throw new Error('App executable mismatch')
  function verifyTree(relative = '') {
    for (const entry of readdirSync(join(expected, relative), { withFileTypes: true })) {
      const path = join(relative, entry.name)
      if (entry.isDirectory()) verifyTree(path)
      else if (entry.isFile() && digest(join(installed, path)) !== digest(join(expected, path))) throw new Error(`Installed resource mismatch: ${path}`)
    }
  }
  verifyTree()
  execFileSync('codesign', ['--verify', '--deep', '--strict', join(installed, '韭菜盒子.app')], { stdio: 'inherit' })
  execFileSync('xcrun', ['stapler', 'validate', join(installed, '韭菜盒子.app')], { stdio: 'inherit' })
  const actualVersion = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(installed, '韭菜盒子.app/Contents/Info.plist')], { encoding: 'utf8' }).trim()
  if (actualVersion !== version) throw new Error('Installed native version mismatch')
}
if (!readFileSync(sentinel).equals(before)) throw new Error('User fixture changed')
const app = spawn(exe, [], { stdio: 'inherit' })
let ended = false
app.on('exit', () => { ended = true })
await new Promise(resolve => setTimeout(resolve, 15000))
if (ended) throw new Error('Upgraded executable exited before 15 seconds')
app.kill()
console.log(`Verified official native install ${baseline} → ${version}, resources, isolated fixture and 15s startup (${process.platform}/${process.arch})`)
