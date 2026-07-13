import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stripInternalSystemReminders } from '../messageDisplay'

test('hides internal system reminders from assistant text', () => {
  assert.equal(
    stripInternalSystemReminders('回答\n<system-reminder>内部上下文</system-reminder>\n继续'),
    '回答\n继续',
  )
})
