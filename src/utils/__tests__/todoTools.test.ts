import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  clearTodoToolStateForTests,
  executeTodoToolCall,
  getTodoToolDefinitions,
} from '../todoTools'

function call(name: string, args: Record<string, unknown>) {
  return {
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  }
}

test('getTodoToolDefinitions exposes create update list and clear tools', () => {
  assert.deepEqual(
    getTodoToolDefinitions().map(tool => tool.function.name),
    ['todo_create', 'todo_update', 'todo_list', 'todo_clear'],
  )
})

test('todo tools create update list and clear session tasks', async () => {
  clearTodoToolStateForTests()

  const created = JSON.parse(await executeTodoToolCall(call('todo_create', {
    items: ['审计 DeepSeek V4', '实现 todo 工具'],
  })))
  assert.equal(created.status, 'success')
  assert.equal(created.todos.length, 2)
  assert.equal(created.todos[0].status, 'pending')

  const updated = JSON.parse(await executeTodoToolCall(call('todo_update', {
    id: created.todos[0].id,
    status: 'completed',
    note: '运行时测试已通过',
  })))
  assert.equal(updated.todos[0].status, 'completed')
  assert.equal(updated.todos[0].note, '运行时测试已通过')

  const listed = JSON.parse(await executeTodoToolCall(call('todo_list', {})))
  assert.equal(listed.todos.length, 2)

  const cleared = JSON.parse(await executeTodoToolCall(call('todo_clear', {})))
  assert.equal(cleared.todos.length, 0)
})

test('todo_update rejects unknown ids and invalid status', async () => {
  clearTodoToolStateForTests()

  const missing = JSON.parse(await executeTodoToolCall(call('todo_update', {
    id: 'todo_missing',
    status: 'completed',
  })))
  assert.equal(missing.status, 'error')
  assert.equal(missing.error, 'TODO_NOT_FOUND')

  const invalid = JSON.parse(await executeTodoToolCall(call('todo_update', {
    id: 'todo_missing',
    status: 'done',
  })))
  assert.equal(invalid.status, 'error')
  assert.equal(invalid.error, 'INVALID_TODO_STATUS')
})
