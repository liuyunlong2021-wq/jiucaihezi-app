import { readFileSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function createUpdaterManifest(version, packages) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version')
  const platforms = {}
  for (const platform of ['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64']) {
    const path = packages[platform]
    const extension = platform === 'windows-x86_64' ? '.exe' : '.app.tar.gz'
    if (!path?.endsWith(extension)) throw new Error(`Missing updater package: ${platform}`)
    if (!statSync(path).size) throw new Error(`Empty updater package: ${platform}`)
    const signature = readFileSync(`${path}.sig`, 'utf8').trim()
    const decoded = Buffer.from(signature, 'base64').toString('utf8')
    const comment = decoded.split('\n').find(line => line.startsWith('trusted comment: '))?.slice('trusted comment: '.length)
    if (!signature || !decoded.startsWith('untrusted comment:') || !comment?.split('\t').includes(`version:${version}`))
      throw new Error(`Invalid updater signature: ${platform}`)
    platforms[platform] = {
      url: `https://api.jiucaihezi.studio/updates/${version}/${encodeURIComponent(basename(path))}`,
      signature,
    }
  }
  return { version, notes: '更新内容见 GitHub Releases', pub_date: new Date().toISOString(), platforms }
}

export function writeUpdaterManifest(target, version, packages) {
  const manifest = createUpdaterManifest(version, packages)
  const temporary = `${target}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`)
  renameSync(temporary, target)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, target, arm, intel, windows] = process.argv.slice(2)
  writeUpdaterManifest(target, version, { 'darwin-aarch64': arm, 'darwin-x86_64': intel, 'windows-x86_64': windows })
}
