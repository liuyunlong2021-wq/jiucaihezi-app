import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const MODEL_LIST = 'rh-pro-image,rh-image-v2,rh-gpt2-image,rh-gpt2-text,rh-video-v31-fast,rh-seedance2-text-video,rh-seedance2-image-video,rh-seedance2-multimodal-video,rh-grok-text-video,rh-grok-image-video,rh-aiapp-fast-digital-human,rh-aiapp-digital-human,rh-aiapp-director,rh-speech-hd,rh-speech-turbo,rh-music,rh-voice-clone,rh-aiapp-voice-clone,rh-aiapp-voice-design'
const REMOVED_MODELS = /rh-3d-|rh-grok-video-edit|rh-mimic|rh-digital-human|rh-voice-design|rh-kling-v30-pro|rh-veo-31-|rh-seedance2(?!-)/

test('RH deploy nginx installer proxies /rh/tasks to the adapter task endpoint without auth', () => {
  const source = readFileSync('scripts/rh-deploy/install-nginx-rh-tasks.py', 'utf8')

  assert.match(source, /location \/rh\/tasks\//)
  assert.match(source, /proxy_pass http:\/\/172\.17\.0\.1:8789\/tasks\//)
  assert.match(source, /proxy_read_timeout 30s/)
  assert.doesNotMatch(source, /RH_ADAPTER_SECRET|Authorization: Bearer/)
})

test('RH NewAPI channel config carries the full 19 model list and no adapter secret', () => {
  const source = readFileSync('scripts/rh-deploy/newapi-rh-channel.md', 'utf8')

  assert.match(source, new RegExp(MODEL_LIST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(source, /Proxy URL: `http:\/\/rh-adapter:8789`/)
  assert.match(source, /Timeout: `30s`/)
  assert.doesNotMatch(source, /RH_ADAPTER_SECRET|Bearer/)
})

test('RH adapter compose does not publish the unauthenticated adapter on every host interface', () => {
  const source = readFileSync('rh-adapter/docker-compose.yml', 'utf8')

  assert.doesNotMatch(source, /-\s*["']?8789:8789["']?/)
  assert.match(source, /(127\.0\.0\.1|172\.17\.0\.1):8789:8789/)
})

test('legacy RH adapter scripts are physically removed', () => {
  for (const file of [
    'scripts/rh-adapter/server.mjs',
    'scripts/rh-adapter/deploy.sh',
    'scripts/rh-adapter/rh-adapter.service',
    'scripts/rh-adapter/__tests__/serverPolicy.test.mjs',
    'scripts/rh-deploy/step4-newapi-fix-group-and-refresh.sh',
  ]) {
    assert.equal(existsSync(file), false, `${file} should not exist`)
  }
})

test('canvas registry does not expose removed RH model ids', () => {
  const source = readFileSync('src/canvas/providers/canvasModels.ts', 'utf8')

  assert.doesNotMatch(source, /id:\s*'rh-seedance2'/)
  assert.doesNotMatch(source, /value:\s*'rh-seedance2'/)
  assert.match(source, /rh-seedance2-text-video/)
  assert.match(source, /rh-seedance2-image-video/)
  assert.match(source, /rh-seedance2-multimodal-video/)
  assert.doesNotMatch(source, REMOVED_MODELS)
})
