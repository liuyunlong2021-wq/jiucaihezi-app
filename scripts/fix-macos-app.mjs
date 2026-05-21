import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const appPath = join(root, 'src-tauri', 'target', 'release', 'bundle', 'macos', '韭菜盒子.app')
const plistPath = join(appPath, 'Contents', 'Info.plist')

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0 && !options.allowFail) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
    throw new Error(`${command} ${args.join(' ')} failed\n${output}`)
  }
  return result
}

if (process.platform !== 'darwin' || !existsSync(appPath) || !existsSync(plistPath)) {
  process.exit(0)
}

run('/usr/bin/xattr', ['-cr', appPath], { allowFail: true })

for (const key of ['LSRequiresCarbon', 'CSResourcesFileMapped']) {
  run('/usr/bin/plutil', ['-remove', key, plistPath], { allowFail: true })
}
run('/usr/bin/plutil', ['-remove', 'NSPrincipalClass', plistPath], { allowFail: true })
run('/usr/bin/plutil', ['-insert', 'NSPrincipalClass', '-string', 'NSApplication', plistPath])

run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath])
run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath])
run('/usr/bin/touch', [appPath])

console.log(`Fixed macOS app bundle: ${appPath}`)
