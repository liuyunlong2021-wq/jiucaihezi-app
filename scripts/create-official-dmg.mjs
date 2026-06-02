import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)))

export function ensureSafeBundleName(bundleName) {
  if (!bundleName || bundleName.includes('/') || bundleName.includes('\\') || bundleName.includes('..')) {
    throw new Error(`Invalid bundle name: ${bundleName}`)
  }
}

export function deriveDmgPaths({
  root = defaultRoot,
  bundleName = '韭菜盒子',
  version = '0.1.0',
  arch = process.arch === 'arm64' ? 'aarch64' : process.arch,
  suffix = 'latest',
} = {}) {
  ensureSafeBundleName(bundleName)

  const bundleDir = join(root, 'src-tauri', 'target', 'release', 'bundle')
  const dmgDir = join(bundleDir, 'dmg')
  const appPath = join(bundleDir, 'macos', `${bundleName}.app`)
  const scriptPath = join(dmgDir, 'bundle_dmg.sh')
  const iconPath = join(dmgDir, 'icon.icns')
  const artifactName = `${bundleName}_${version}_${arch}${suffix ? `_${suffix}` : ''}.dmg`
  const dmgPath = join(dmgDir, artifactName)
  const latestDmgPath = join(dmgDir, `${bundleName}_${version}_${arch}_latest.dmg`)

  return { appPath, artifactName, bundleDir, dmgDir, dmgPath, iconPath, latestDmgPath, scriptPath }
}

export function buildCreateDmgArgs({ volumeName, iconPath, appName, dmgPath, sourceDir }) {
  return [
    '--volname',
    volumeName,
    '--volicon',
    iconPath,
    '--window-size',
    '660',
    '400',
    '--icon-size',
    '128',
    '--icon',
    appName,
    '180',
    '170',
    '--app-drop-link',
    '480',
    '170',
    '--no-internet-enable',
    dmgPath,
    sourceDir,
  ]
}

export function shouldRefuseDirtySource(entries) {
  return entries.some((entry) => entry !== '韭菜盒子.app')
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'inherit', ...options })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

async function createOfficialDmg() {
  if (process.platform !== 'darwin') {
    throw new Error('Official DMG creation requires macOS.')
  }

  const paths = deriveDmgPaths()
  const appName = '韭菜盒子.app'

  for (const requiredPath of [paths.appPath, paths.scriptPath, paths.iconPath]) {
    if (!existsSync(requiredPath)) {
      throw new Error(`Missing required DMG input: ${requiredPath}`)
    }
  }

  const cleanSource = mkdtempSync(join(tmpdir(), 'jc-official-dmg-source-'))
  try {
    await cp(paths.appPath, join(cleanSource, appName), { recursive: true, preserveTimestamps: true })
    const entries = readdirSync(cleanSource)
    if (shouldRefuseDirtySource(entries)) {
      throw new Error(`Refusing dirty DMG source: ${entries.join(', ')}`)
    }

    rmSync(paths.dmgPath, { force: true })
    if (paths.latestDmgPath !== paths.dmgPath) {
      rmSync(paths.latestDmgPath, { force: true })
    }

    run('bash', [
      paths.scriptPath,
      ...buildCreateDmgArgs({
        volumeName: '韭菜盒子',
        iconPath: paths.iconPath,
        appName,
        dmgPath: paths.dmgPath,
        sourceDir: cleanSource,
      }),
    ])

    if (paths.latestDmgPath !== paths.dmgPath) {
      await cp(paths.dmgPath, paths.latestDmgPath)
    }

    console.log(`Created official DMG: ${paths.dmgPath}`)
    console.log(`Latest official DMG: ${paths.latestDmgPath}`)
  } finally {
    if (cleanSource.startsWith(tmpdir() + sep)) {
      rmSync(cleanSource, { recursive: true, force: true })
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createOfficialDmg().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
