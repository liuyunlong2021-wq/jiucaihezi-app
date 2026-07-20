import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { normalizeCreationModelAvailability } from '../creationModelAvailability'

const source = readFileSync('src/services/creationModelAvailability.ts', 'utf8')

test('Web reads creation model availability from the deployed API service', () => {
  assert.match(source, /const apiUrl = `\$\{DEFAULT_API_BASE_URL\}\/api\/creation\/models`/)
  assert.doesNotMatch(source, /:\s*`?\/api\/creation\/models`?/)
})

test('normalizes creation model availability payloads from backend models list', () => {
  const availability = normalizeCreationModelAvailability({
    data: {
      models: [
        {
          id: 'rh-grok-text-video',
          status: 'maintenance',
          reason: 'RunningHub 维护中',
          last_success_at: '2026-05-31T08:00:00Z',
          estimated_wait_seconds: 600,
        },
        {
          model: 'gpt-image-2',
          available: true,
        },
      ],
    },
  })

  assert.deepEqual(availability, [
    {
      id: 'rh-grok-text-video',
      status: 'degraded',
      reason: 'RunningHub 维护中',
      lastSuccessAt: '2026-05-31T08:00:00Z',
      estimatedWaitSeconds: 600,
    },
    {
      id: 'gpt-image-2',
      status: 'enabled',
      reason: undefined,
      lastSuccessAt: undefined,
      estimatedWaitSeconds: undefined,
    },
  ])
})

test('normalizes disabled aliases and ignores invalid entries', () => {
  const availability = normalizeCreationModelAvailability({
    items: [
      { name: 'suno_music', enabled: false, message: 'quota exhausted' },
      { id: '', status: 'enabled' },
      null,
    ],
  })

  assert.deepEqual(availability, [
    {
      id: 'suno_music',
      status: 'disabled',
      reason: 'quota exhausted',
      lastSuccessAt: undefined,
      estimatedWaitSeconds: undefined,
    },
  ])
})
