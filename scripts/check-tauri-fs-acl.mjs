import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const capabilityPath = new URL('../src-tauri/capabilities/default.json', import.meta.url)
const capability = JSON.parse(await readFile(capabilityPath, 'utf8'))
const permissions = new Set(
  capability.permissions.filter((permission) => typeof permission === 'string')
)

const requiredPermissions = [
  'fs:allow-read-text-file',
  'fs:allow-write-text-file',
  'fs:allow-read-file',
  'fs:allow-write-file',
  'fs:allow-create',
]

for (const permission of requiredPermissions) {
  assert.equal(
    permissions.has(permission),
    true,
    `Missing Tauri FS permission: ${permission}`
  )
}

console.log(`Tauri FS ACL OK: ${requiredPermissions.join(', ')}`)
