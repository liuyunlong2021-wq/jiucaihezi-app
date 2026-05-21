import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getDefaultOfficeToolDefinitions, getOfficeToolDefinitions } from '../officeTools'

test('exposes office tools for the hidden default executor', () => {
  const tools = getDefaultOfficeToolDefinitions()
  const names = tools.map(tool => tool.function.name)

  assert.deepEqual(names, [
    'office_create',
    'office_read',
    'office_convert',
    'office_execute',
  ])
})

test('keeps agent office matching narrow for non-office agents', () => {
  assert.equal(getOfficeToolDefinitions('general-chat', '通用聊天'), undefined)
})
