import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { signUpdater, verifyUpdaterSignature } from '../sign-updater.mjs'

let available = true
try { execFileSync('minisign', ['-v'], { stdio: 'ignore' }) } catch { available = false }
test('actual signatures reject tampering, an announced version mismatch, and another public key', { skip: available ? false : 'requires minisign' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'jc-update-sign-test-'))
  const previousKey = process.env.TAURI_SIGNING_PRIVATE_KEY
  const previousPassword = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  try {
    execFileSync('minisign', ['-G', '-W', '-s', join(dir, 'key'), '-p', join(dir, 'pub')], { stdio: 'ignore' })
    const publicKey = readFileSync(join(dir, 'pub')).toString('base64')
    process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(join(dir, 'key')).toString('base64')
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
    const path = join(dir, 'update.exe')
    writeFileSync(path, 'real signed package fixture')
    signUpdater(path, '2.3.0', publicKey)
    verifyUpdaterSignature(path, '2.3.0', publicKey)
    assert.throws(() => verifyUpdaterSignature(path, '9.9.9', publicKey))
    execFileSync('minisign', ['-G', '-W', '-s', join(dir, 'other-key'), '-p', join(dir, 'other-pub')], { stdio: 'ignore' })
    assert.throws(() => verifyUpdaterSignature(path, '2.3.0', readFileSync(join(dir, 'other-pub')).toString('base64')))
    writeFileSync(path, 'tampered package')
    assert.throws(() => verifyUpdaterSignature(path, '2.3.0', publicKey))
  } finally {
    if (previousKey === undefined) delete process.env.TAURI_SIGNING_PRIVATE_KEY
    else process.env.TAURI_SIGNING_PRIVATE_KEY = previousKey
    if (previousPassword === undefined) delete process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    else process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = previousPassword
    rmSync(dir, { recursive: true, force: true })
  }
})
