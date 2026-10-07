import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

test('Windows installed executable fingerprint comes from final NSIS payload after bundle stamping', () => {
  const root = mkdtempSync(join(tmpdir(), 'jc-nsis-fingerprint-'))
  try {
    for (const dir of ['deepseek-harness', 'creation-mcp', 'skills', 'storyboarder']) {
      mkdirSync(join(root, dir)); writeFileSync(join(root, dir, 'resource'), dir)
    }
    writeFileSync(join(root, 'jiucaihezi-app.exe'), '__TAURI_BUNDLE_TYPE_VAR_UNK')
    const payload = join(root, 'final.exe'), output = join(root, 'hashes.json')
    writeFileSync(payload, '__TAURI_BUNDLE_TYPE_VAR_NSS')
    execFileSync(process.execPath, ['scripts/native-windows-fingerprint.mjs', root, output, payload])
    const hashes = JSON.parse(readFileSync(output, 'utf8'))
    assert.equal(hashes['jiucaihezi-app.exe'], createHash('sha256').update(readFileSync(payload)).digest('hex'))
    assert.equal(Object.keys(hashes).length, 5)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
