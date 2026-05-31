import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8')
const deploy = readFileSync(new URL('../deploy.sh', import.meta.url), 'utf8')
const service = readFileSync(new URL('../rh-adapter.service', import.meta.url), 'utf8')

test('rh-adapter defaults to localhost and supports internal bearer auth', () => {
  assert.match(source, /RH_ADAPTER_HOST[^\n]+127\.0\.0\.1/)
  assert.match(source, /RH_ADAPTER_SECRET/)
  assert.match(source, /Authorization/)
  assert.match(source, /Unauthorized/)
  assert.doesNotMatch(source, /server\.listen\(PORT,\s*'0\.0\.0\.0'/)
  assert.doesNotMatch(source, /if \(!RH_ADAPTER_SECRET\) return true/)
  assert.match(source, /FATAL: RH_ADAPTER_SECRET/)
})

test('rh-adapter has request size and upstream timeout guards', () => {
  assert.match(source, /RH_ADAPTER_MAX_BODY_BYTES/)
  assert.match(source, /Request body too large/)
  assert.match(source, /fetchWithTimeout/)
  assert.match(source, /RH_ADAPTER_QUERY_ERROR_LIMIT/)
})

test('rh-adapter registers grok-video-3 direct model mapping', () => {
  assert.match(source, /'grok-video-3'\s*:\s*\{\s*endpoint:\s*'\/openapi\/v2\/rhart-video-g\/text-to-video'/)
})

test('rh-adapter deployment writes a secret without printing it and binds systemd to docker bridge env', () => {
  assert.match(deploy, /RH_ADAPTER_SECRET=/)
  assert.match(deploy, /ADAPTER_HOST=.*docker0/)
  assert.match(deploy, /RH_ADAPTER_HOST=\$\{ADAPTER_HOST\}/)
  assert.match(deploy, /Authorization: Bearer/)
  assert.doesNotMatch(deploy, /\$\{RH_SECRET\}'/)
  assert.doesNotMatch(service, /Environment=RH_ADAPTER_HOST=127\.0\.0\.1/)
})
