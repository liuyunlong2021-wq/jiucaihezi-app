import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
} from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const appPath = resolve(process.argv[2] || join(
  root,
  'src-tauri',
  'target',
  'release',
  'bundle',
  'macos',
  '韭菜盒子.app',
))
const plistPath = join(appPath, 'Contents', 'Info.plist')
const appEntitlements = join(root, 'src-tauri', 'entitlements.plist')
const nodeEntitlements = join(root, 'src-tauri', 'node-entitlements.plist')
const tauriConfig = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY || tauriConfig.bundle?.macOS?.signingIdentity || '-'

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.status !== 0 && !options.allowFail) {
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n')
    throw new Error(`${command} ${args.join(' ')} failed\n${output}`)
  }
  return result
}

const machOMagic = new Set([
  0xfeedface,
  0xcefaedfe,
  0xfeedfacf,
  0xcffaedfe,
  0xcafebabe,
  0xbebafeca,
  0xcafebabf,
  0xbfbafeca,
])

const isMachO = (path) => {
  const descriptor = openSync(path, 'r')
  try {
    const header = Buffer.alloc(4)
    return readSync(descriptor, header, 0, 4, 0) === 4 && machOMagic.has(header.readUInt32BE(0))
  } finally {
    closeSync(descriptor)
  }
}

const files = []
const bundles = []
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) {
      walk(path)
      if (/\.(?:app|appex|bundle|framework|xpc)$/i.test(extname(path))) bundles.push(path)
    } else if (entry.isFile() && lstatSync(path).size >= 4 && isMachO(path)) {
      files.push(path)
    }
  }
}

const sign = (path, entitlements) => {
  const args = ['--force', '--options', 'runtime']
  if (signingIdentity !== '-') args.push('--timestamp')
  if (entitlements) args.push('--entitlements', entitlements)
  args.push('--sign', signingIdentity, path)
  run('/usr/bin/codesign', args)
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

walk(join(appPath, 'Contents'))
files.sort((left, right) => right.length - left.length)
for (const path of files) {
  sign(path, /\/deepseek-harness\/node_modules\/node\/bin\/node$/.test(path) ? nodeEntitlements : undefined)
}
bundles.sort((left, right) => right.length - left.length)
for (const path of bundles) sign(path)
sign(appPath, appEntitlements)

run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath])
run('/usr/bin/touch', [appPath])

console.log(`Signed ${files.length} nested Mach-O files and ${bundles.length} nested bundles`)
