# DeepSeek V4 Runtime And Todo Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DeepSeek V4 Pro/Flash behave like first-class coding/agent models in Jiucaihezi by adding model-specific thinking/runtime parameters and a persistent LLM-visible todo tool.

**Architecture:** Keep the existing `useChat` tool loop and local tool registry. Add model-family runtime helpers in `runtimeCapabilities.ts`, then expose an in-memory/session-scoped todo tool through the same `buildAvailableTools()` and `executeToolCall()` path as browser/dev/document tools. Superpower will use the todo tool by prompt policy rather than a separate `runSubagent` implementation in this phase.

**Tech Stack:** Vue 3 + Pinia + TypeScript, Node test runner through esbuild-bundled focused tests, existing OpenAI-compatible `/v1/chat/completions` streaming runtime.

---

## File Map

- Modify: `src/utils/runtimeCapabilities.ts`
  - Recognize DeepSeek V4 models as reasoning/thinking-capable.
  - Add DeepSeek-specific chat extras builder output: `thinking` and DeepSeek-compatible `reasoning_effort`.
- Modify: `src/composables/useChat.ts`
  - Use DeepSeek-aware runtime extras in chat completions.
  - Register todo tools in `buildAvailableTools()`.
  - Execute todo tool calls in `executeToolCall()`.
  - Add prompt instruction telling models when to use todo.
- Create: `src/utils/todoTools.ts`
  - Define `todo_create`, `todo_update`, `todo_list`, `todo_clear`.
  - Keep todo state local to the current app session.
  - Return JSON results for model tool loop consumption.
- Create: `src/utils/__tests__/todoTools.test.ts`
  - Unit tests for todo creation, update, listing, clearing, and validation.
- Modify: `src/utils/__tests__/runtimeCapabilities.test.ts`
  - Tests for DeepSeek V4 reasoning detection and request extras.
- Modify: `src/utils/__tests__/useChatSendMessage.test.ts`
  - Integration test proving DeepSeek V4 request body carries thinking config and todo tool definitions.
- Modify: `package.json`
  - Add `todoTools.test.ts` to `test:focused:build` and `test:focused:run`.

---

## Task 1: DeepSeek V4 Runtime Extras

**Files:**
- Modify: `src/utils/runtimeCapabilities.ts`
- Test: `src/utils/__tests__/runtimeCapabilities.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests to `src/utils/__tests__/runtimeCapabilities.test.ts`:

```ts
test('resolveRuntimeProfile treats DeepSeek V4 models as reasoning-capable', () => {
  const pro = resolveRuntimeProfile({
    providerId: 'jiucaihezi',
    modelId: 'deepseek-v4-pro',
    requestedTier: 'deep',
  })
  const flash = resolveRuntimeProfile({
    providerId: 'jiucaihezi',
    modelId: 'deepseek-v4-flash',
    requestedTier: 'balanced',
  })

  assert.equal(pro.supportsReasoningEffort, true)
  assert.equal(pro.reasoningEffort, 'high')
  assert.equal(flash.supportsReasoningEffort, true)
  assert.equal(flash.reasoningEffort, 'medium')
})

test('buildReasoningChatExtras emits DeepSeek V4 thinking parameters', () => {
  const profile = resolveRuntimeProfile({
    providerId: 'jiucaihezi',
    modelId: 'deepseek-v4-pro',
    requestedTier: 'deep',
  })

  assert.deepEqual(buildReasoningChatExtras(profile, { enabled: true }), {
    thinking: { type: 'enabled' },
    reasoning_effort: 'high',
  })
})

test('buildReasoningChatExtras can disable DeepSeek V4 thinking for fast tier', () => {
  const profile = resolveRuntimeProfile({
    providerId: 'jiucaihezi',
    modelId: 'deepseek-v4-flash',
    requestedTier: 'fast',
  })

  assert.deepEqual(buildReasoningChatExtras(profile, { enabled: true }), {
    thinking: { type: 'disabled' },
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm exec esbuild src/utils/__tests__/runtimeCapabilities.test.ts --bundle --platform=node --format=esm --alias:@=./src --outbase=src --outdir=/private/tmp/jc-deepseek-plan-tests && node --test /private/tmp/jc-deepseek-plan-tests/utils/__tests__/runtimeCapabilities.test.js
```

Expected: tests fail because DeepSeek V4 is not yet recognized by `isReasoningModel()` and `buildReasoningChatExtras()` does not emit DeepSeek-specific `thinking`.

- [ ] **Step 3: Implement DeepSeek model detection**

In `src/utils/runtimeCapabilities.ts`, update `isReasoningModel()`:

```ts
function isReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return id === 'gpt-5.5'
    || id.includes('/gpt-5.5')
    || id === 'deepseek-v4-pro'
    || id === 'deepseek-v4-flash'
    || id.includes('/deepseek-v4-pro')
    || id.includes('/deepseek-v4-flash')
    || /^o[134](?:-|$)/.test(id)
}
```

- [ ] **Step 4: Implement DeepSeek-specific extras**

In `src/utils/runtimeCapabilities.ts`, add helper:

```ts
function isDeepSeekV4Model(modelId: string): boolean {
  const id = modelId.toLowerCase()
  return id === 'deepseek-v4-pro'
    || id === 'deepseek-v4-flash'
    || id.includes('/deepseek-v4-pro')
    || id.includes('/deepseek-v4-flash')
}
```

Update `buildReasoningChatExtras()`:

```ts
export function buildReasoningChatExtras(
  profile: RuntimeProfile,
  options: ReasoningChatExtrasOptions = {},
): Record<string, unknown> {
  if (!options.enabled) return {}
  if (!profile.supportsReasoningEffort || !profile.reasoningEffort) return {}

  if (isDeepSeekV4Model(profile.modelId)) {
    if (profile.reasoningEffort === 'low') {
      return { thinking: { type: 'disabled' } }
    }
    return {
      thinking: { type: 'enabled' },
      reasoning_effort: profile.reasoningEffort,
    }
  }

  return {
    reasoning_effort: profile.reasoningEffort,
    reasoning: { effort: profile.reasoningEffort },
  }
}
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm exec esbuild src/utils/__tests__/runtimeCapabilities.test.ts --bundle --platform=node --format=esm --alias:@=./src --outbase=src --outdir=/private/tmp/jc-deepseek-plan-tests && node --test /private/tmp/jc-deepseek-plan-tests/utils/__tests__/runtimeCapabilities.test.js
```

Expected: all `runtimeCapabilities` tests pass.

---

## Task 2: DeepSeek V4 Request Integration

**Files:**
- Modify: `src/composables/useChat.ts`
- Test: `src/utils/__tests__/useChatSendMessage.test.ts`

- [ ] **Step 1: Write failing integration test**

Add a test to `src/utils/__tests__/useChatSendMessage.test.ts`:

```ts
test('sendMessage sends DeepSeek V4 thinking extras with chat completions request', async () => {
  const restoreStorage = installLocalStorage({
    jcGatewaySessionToken: 'session-cloud',
    jcModel: 'deepseek-v4-pro',
    jcModelProviderId: 'jiucaihezi',
    jcLocalToolsEnabled: '0',
    jcGatewayReasoningExtras: 'true',
  })
  const previousFetch = (globalThis as any).fetch
  const requests: any[] = []

  try {
    setActivePinia(createPinia())
    ;(globalThis as any).process.env.NODE_ENV = 'test'
    __resetApiKeyMemoryCacheForTests('session-cloud')
    __setUseChatTestDeps({
      isCloudLoggedIn: async () => true,
      recallKnowledgeWithTrace: async () => ({
        text: '',
        hits: [],
        searched: true,
        staticKnowledgeInjected: false,
      }),
    })
    useAgentStore().setModel('deepseek-v4-pro', 'jiucaihezi')
    useToolStore().setLocalToolsEnabled(false)

    ;(globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init?.body || '{}')) })
      return sseResponse('DeepSeek V4 ready.')
    }

    const chat = useChat()
    await chat.sendMessage('测试 DeepSeek V4', {
      modelId: 'deepseek-v4-pro',
      modelProviderId: 'jiucaihezi',
      capabilityTier: 'deep',
    })

    const request = requests.find(item => item.url === 'https://api.jiucaihezi.studio/v1/chat/completions')
    assert.ok(request)
    assert.equal(request.body.model, 'deepseek-v4-pro')
    assert.deepEqual(request.body.thinking, { type: 'enabled' })
    assert.equal(request.body.reasoning_effort, 'high')
  } finally {
    __setUseChatTestDeps(null)
    __resetApiKeyMemoryCacheForTests('')
    ;(globalThis as any).fetch = previousFetch
    restoreStorage()
  }
})
```

- [ ] **Step 2: Run and verify RED or existing GREEN**

Run:

```bash
pnpm exec esbuild src/utils/__tests__/useChatSendMessage.test.ts --bundle --platform=node --format=esm --alias:@=./src --outbase=src --outdir=/private/tmp/jc-deepseek-usechat-tests && node --test /private/tmp/jc-deepseek-usechat-tests/utils/__tests__/useChatSendMessage.test.js
```

Expected before Task 1 implementation: fail because DeepSeek extras are absent. After Task 1: pass.

- [ ] **Step 3: Confirm `useChat.ts` uses runtime profile extras**

In `src/composables/useChat.ts`, verify the chat completion body contains:

```ts
...buildReasoningChatExtras(options._runtimeProfile || resolveRuntimeProfile({
  modelId: options.modelId || config.model,
  providerId: config.providerId,
  requestedTier: options.capabilityTier || 'balanced',
}), {
  enabled: localStorage.getItem('jcGatewayReasoningExtras') === 'true',
}),
```

If absent, add it to the `/v1/chat/completions` request body in `runToolLoop()`.

- [ ] **Step 4: Verify GREEN**

Run the same `useChatSendMessage.test.ts` command.

Expected: DeepSeek request body includes `thinking` and `reasoning_effort`.

---

## Task 3: Todo Tool Core

**Files:**
- Create: `src/utils/todoTools.ts`
- Test: `src/utils/__tests__/todoTools.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/utils/__tests__/todoTools.test.ts`:

```ts
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
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec esbuild src/utils/__tests__/todoTools.test.ts --bundle --platform=node --format=esm --alias:@=./src --outbase=src --outdir=/private/tmp/jc-todo-tests && node --test /private/tmp/jc-todo-tests/utils/__tests__/todoTools.test.js
```

Expected: fail because `src/utils/todoTools.ts` does not exist.

- [ ] **Step 3: Implement todo tools**

Create `src/utils/todoTools.ts`:

```ts
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
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm exec esbuild src/utils/__tests__/todoTools.test.ts --bundle --platform=node --format=esm --alias:@=./src --outbase=src --outdir=/private/tmp/jc-todo-tests && node --test /private/tmp/jc-todo-tests/utils/__tests__/todoTools.test.js
```

Expected: all todo tool tests pass.

---

## Task 4: Register Todo Tool In Chat Tool Loop

**Files:**
- Modify: `src/composables/useChat.ts`
- Test: `src/utils/__tests__/useChatSendMessage.test.ts`

- [ ] **Step 1: Write failing integration test**

Add to `src/utils/__tests__/useChatSendMessage.test.ts`:

```ts
function todoToolCallSseResponse(): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_todo_1',
              type: 'function',
              function: { name: 'todo_create', arguments: '{"items":["读取代码","实现功能"]}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      })}\n\n`))
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

test('sendMessage exposes and executes todo tools in tool loop', async () => {
  const restoreStorage = installLocalStorage({
    jcGatewaySessionToken: 'session-cloud',
    jcModel: 'deepseek-v4-pro',
    jcModelProviderId: 'jiucaihezi',
    jcLocalToolsEnabled: '1',
  })
  const previousFetch = (globalThis as any).fetch
  const requests: any[] = []

  try {
    setActivePinia(createPinia())
    ;(globalThis as any).process.env.NODE_ENV = 'test'
    __resetApiKeyMemoryCacheForTests('session-cloud')
    __setUseChatTestDeps({
      isCloudLoggedIn: async () => true,
      recallKnowledgeWithTrace: async () => ({
        text: '',
        hits: [],
        searched: true,
        staticKnowledgeInjected: false,
      }),
    })
    useAgentStore().setModel('deepseek-v4-pro', 'jiucaihezi')
    useToolStore().setLocalToolsEnabled(true)

    ;(globalThis as any).fetch = async (url: string, init?: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init?.body || '{}')) })
      if (requests.filter(request => request.url === 'https://api.jiucaihezi.studio/v1/chat/completions').length === 1) {
        return todoToolCallSseResponse()
      }
      return sseResponse('已创建并使用待办清单。')
    }

    const chat = useChat()
    await chat.sendMessage('帮我分步骤完成这个开发任务', {
      modelId: 'deepseek-v4-pro',
      modelProviderId: 'jiucaihezi',
      capabilityTier: 'deep',
    })

    const firstRequest = requests.find(request => request.url === 'https://api.jiucaihezi.studio/v1/chat/completions')
    assert.ok(firstRequest.body.tools.some((tool: any) => tool.function.name === 'todo_create'))
    assert.ok(chat.messages.value.some((message: ChatMessage) => message.role === 'tool' && message.toolName === 'todo_create'))
    assert.equal(chat.messages.value.findLast((message: ChatMessage) => message.role === 'assistant')?.content, '已创建并使用待办清单。')
  } finally {
    __setUseChatTestDeps(null)
    __resetApiKeyMemoryCacheForTests('')
    ;(globalThis as any).fetch = previousFetch
    restoreStorage()
  }
})
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
pnpm exec esbuild src/utils/__tests__/useChatSendMessage.test.ts --bundle --platform=node --format=esm --alias:@=./src --outbase=src --outdir=/private/tmp/jc-usechat-todo-tests && node --test /private/tmp/jc-usechat-todo-tests/utils/__tests__/useChatSendMessage.test.js
```

Expected: fail because todo tools are not registered or executed.

- [ ] **Step 3: Register definitions**

In `src/composables/useChat.ts`, import:

```ts
import { executeTodoToolCall, getTodoToolDefinitions } from '@/utils/todoTools'
```

Update `buildAvailableTools()`:

```ts
const todoTools = getTodoToolDefinitions()
return [...todoTools, ...nonOfficeTools, ...browserTools, ...localContentTools, ...officeTools, ...devTools]
```

- [ ] **Step 4: Add execution path**

In `executeToolCall()` before dev/browser/office execution:

```ts
const todoResult = await executeTodoToolCall(call)
if (todoResult) return todoResult
```

- [ ] **Step 5: Add local capability instruction**

In `buildLocalCapabilityInstruction()`, add this sentence inside `<local_capability>`:

```text
复杂任务、开发任务、审计任务或用户要求“逐步执行”时，先调用 todo_create 创建简短待办清单；每完成或阻塞一步时调用 todo_update，最后用自然语言总结。
```

- [ ] **Step 6: Verify GREEN**

Run:

```bash
pnpm exec esbuild src/utils/__tests__/useChatSendMessage.test.ts --bundle --platform=node --format=esm --alias:@=./src --outbase=src --outdir=/private/tmp/jc-usechat-todo-tests && node --test /private/tmp/jc-usechat-todo-tests/utils/__tests__/useChatSendMessage.test.js
```

Expected: integration test passes and a `todo_create` tool result message appears.

---

## Task 5: Add Todo Test To Focused Suite

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update `test:focused:build`**

Add `src/utils/__tests__/todoTools.test.ts` to the esbuild input list.

- [ ] **Step 2: Update `test:focused:run`**

Add `/private/tmp/jc-focused-tests/utils/__tests__/todoTools.test.js` to the node test command.

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm run test:focused
```

Expected: all focused tests pass.

---

## Task 6: Final Verification

**Files:**
- No new implementation files unless previous tasks fail.

- [ ] **Step 1: Type-check**

Run:

```bash
pnpm exec vue-tsc -b
```

Expected: exit code 0.

- [ ] **Step 2: Production frontend build**

Run:

```bash
pnpm exec vite build
```

Expected: build succeeds. Existing chunk-size warnings are acceptable.

- [ ] **Step 3: Diff whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Secret scan**

Run:

```bash
rg -n "localStorage\\.setItem\\(['\\\"]jcApiKey|localStorage\\.getItem\\(['\\\"]jcApiKey|localStorage\\.removeItem\\(['\\\"]jcApiKey|provider\\.apiKey\\s*=\\s*key|apiKey:\\s*'sk-|Authorization.*console|console\\.(log|error|warn).*apiKey|console\\.(log|error|warn).*Authorization" src src-tauri package.json -S
```

Expected: only test fixture hits, no production secret logging or localStorage key persistence.

---

## Acceptance Criteria

- DeepSeek V4 Pro/Flash are treated as reasoning-capable chat models.
- With `jcGatewayReasoningExtras=true`, DeepSeek V4 requests include `thinking` and compatible `reasoning_effort`.
- Fast tier disables DeepSeek V4 thinking; balanced/deep/full-vault enable it.
- Todo tools are available when local tools are enabled.
- Todo tool loop can create, update, list, and clear tasks.
- Complex task prompt policy tells the model to use todo before multi-step execution.
- All focused tests, type-check, and production build pass.

## Deferred

- `runSubagent` stays deferred and should be implemented through the Superpower/Connection boundary, not as a separate VS Code-style tool in this phase.
- Vision proxy for DeepSeek V4 stays deferred because the app already has `imageBridge.ts`; integrate only after text/tool reliability is proven.
- Pylance, container tools, and VS Code-specific APIs stay out of scope.
