import type { ChatCompletionTool, ToolCallLike } from '@/composables/officeTools'

type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'blocked'

interface TodoItem {
  id: string
  content: string
  status: TodoStatus
  note?: string
  updatedAt: number
}

const todos: TodoItem[] = []

export function getTodoToolDefinitions(): ChatCompletionTool[] {
  return [
    {
      type: 'function',
      function: {
        name: 'todo_create',
        description: '为复杂任务创建本轮待办清单。适合需要多步执行、审计、开发或调研的任务。',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: { type: 'string' },
              description: '待办事项文本列表。',
            },
          },
          required: ['items'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'todo_update',
        description: '更新本轮待办事项状态。每完成或阻塞一个步骤时调用。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '待办 ID。' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'] },
            content: { type: 'string', description: '可选，更新待办文本。' },
            note: { type: 'string', description: '可选，状态说明。' },
          },
          required: ['id', 'status'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'todo_list',
        description: '查看本轮待办清单。',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'todo_clear',
        description: '清空本轮待办清单。只在任务结束或用户要求重置计划时调用。',
        parameters: { type: 'object', properties: {} },
      },
    },
  ]
}

export function isTodoToolName(name: string): boolean {
  return getTodoToolDefinitions().some(tool => tool.function.name === name)
}

export async function executeTodoToolCall(call: ToolCallLike): Promise<string> {
  const name = call.function.name
  if (!isTodoToolName(name)) return ''
  const args = parseArgs(call.function.arguments)

  if (name === 'todo_create') {
    const items = Array.isArray(args.items) ? args.items.map(item => String(item || '').trim()).filter(Boolean) : []
    if (!items.length) {
      return JSON.stringify({ status: 'error', error: 'TODO_ITEMS_REQUIRED', tool: name, message: '请提供至少一个待办事项。' })
    }
    todos.splice(0, todos.length, ...items.slice(0, 30).map((content, index) => ({
      id: `todo_${Date.now()}_${index + 1}`,
      content,
      status: 'pending' as const,
      updatedAt: Date.now(),
    })))
    return JSON.stringify({ status: 'success', tool: name, todos: [...todos] })
  }

  if (name === 'todo_update') {
    const id = String(args.id || '').trim()
    const status = String(args.status || '').trim()
    if (!isTodoStatus(status)) {
      return JSON.stringify({ status: 'error', error: 'INVALID_TODO_STATUS', tool: name, message: '状态必须是 pending、in_progress、completed 或 blocked。' })
    }
    const item = todos.find(todo => todo.id === id)
    if (!item) {
      return JSON.stringify({ status: 'error', error: 'TODO_NOT_FOUND', tool: name, message: `未找到待办: ${id}` })
    }
    item.status = status
    if (typeof args.content === 'string' && args.content.trim()) item.content = args.content.trim()
    if (typeof args.note === 'string') item.note = args.note.trim() || undefined
    item.updatedAt = Date.now()
    return JSON.stringify({ status: 'success', tool: name, todos: [...todos] })
  }

  if (name === 'todo_list') {
    return JSON.stringify({ status: 'success', tool: name, todos: [...todos] })
  }

  if (name === 'todo_clear') {
    todos.splice(0, todos.length)
    return JSON.stringify({ status: 'success', tool: name, todos: [] })
  }

  return ''
}

export function clearTodoToolStateForTests(): void {
  todos.splice(0, todos.length)
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function isTodoStatus(value: string): value is TodoStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'blocked'
}
