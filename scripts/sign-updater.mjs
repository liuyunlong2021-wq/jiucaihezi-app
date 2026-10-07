import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function verifyUpdaterSignature(path, version, publicKey = readFileSync('src-tauri/updater.pub', 'utf8').trim()) {
  const dir = mkdtempSync(join(tmpdir(), 'jc-update-verify-'))
  try {
    const signature = Buffer.from(readFileSync(`${path}.sig`, 'utf8').trim(), 'base64').toString('utf8')
    const key = Buffer.from(publicKey, 'base64').toString('utf8')
    writeFileSync(join(dir, 'public.key'), key)
    writeFileSync(join(dir, 'signature'), signature)
    execFileSync('minisign', ['-V', '-q', '-p', join(dir, 'public.key'), '-x', join(dir, 'signature'), '-m', path], { stdio: 'ignore' })
    const comment = signature.split('\n').find(line => line.startsWith('trusted comment: '))?.slice('trusted comment: '.length)
    if (!comment?.split('\t').includes(`version:${version}`)) throw new Error('Signed version mismatch')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

export function signUpdater(path, version, publicKey = readFileSync('src-tauri/updater.pub', 'utf8').trim()) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid updater version')
  const key = process.env.TAURI_SIGNING_PRIVATE_KEY
  if (!key) throw new Error('Updater signing key is missing')
  const dir = mkdtempSync(join(tmpdir(), 'jc-update-sign-'))
  try {
    writeFileSync(join(dir, 'private.key'), Buffer.from(key.trim(), 'base64'), { mode: 0o600 })
    const comment = `timestamp:${Math.floor(Date.now() / 1000)}\tfile:${basename(path)}\tversion:${version}`
    execFileSync('minisign', ['-S', '-s', join(dir, 'private.key'), '-x', join(dir, 'signature'), '-t', comment, '-m', path], {
      input: `${process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || ''}\n`, stdio: ['pipe', 'ignore', 'ignore'],
    })
    writeFileSync(`${path}.sig`, readFileSync(join(dir, 'signature')).toString('base64') + '\n')
    verifyUpdaterSignature(path, version, publicKey)
  } catch { throw new Error('Updater signing or verification failed; sensitive output suppressed') }
  finally { rmSync(dir, { recursive: true, force: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, ...paths] = process.argv.slice(2)
  if (!paths.length) throw new Error('No updater artifacts specified')
  for (const path of paths) {
    if (existsSync(`${path}.sig`)) verifyUpdaterSignature(path, version)
    else signUpdater(path, version)
    console.log(`Signed and verified: ${basename(path)} (${version})`)
  }
}
