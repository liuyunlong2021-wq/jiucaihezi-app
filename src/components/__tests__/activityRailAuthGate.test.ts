import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('ActivityRail uses member state for locked product tabs', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/rail/ActivityRail.vue'), 'utf8')

  assert.equal(source.includes('isMember?: boolean'), true)
  assert.equal(source.includes('isCloudLoggedIn'), true)
  assert.equal(source.includes('getCloudRequiredMessage'), true)
  assert.equal(source.includes('isAuthenticated?: boolean'), false)
})

test('ActivityRail keeps its member gate while rendering text tabs', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/rail/ActivityRail.vue'), 'utf8')

  assert.equal(source.includes(':disabled="isLockedTab(tab.key)"'), true)
  assert.equal(source.includes('isLockedTab(tab.key) ?'), true)
  assert.equal(source.includes('ab-tab-label'), true)
  assert.equal(source.includes('rail.memberOnly'), true)
  assert.equal(source.includes('rail.loginRequired'), false)
})
