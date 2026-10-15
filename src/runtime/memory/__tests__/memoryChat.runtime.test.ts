import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { test, type TestContext } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { useAgentStore } from '@/stores/agentStore'
import { createWebProjectFiles, webProjectFiles } from '@/utils/webProjectFiles'
import type { FileEntry } from '@/composables/useFileStore'
import { runMemoryChat } from '../memoryChat'
import { appendConversationTurn, createConversationTranscript } from '../conversationTranscript'
import { upsertConversationMemoryIndex } from '../conversationMemoryIndex'

function tool(name: string, args: Record<string, unknown>) {
  return { id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}
function response(value: string | ReturnType<typeof tool>[]) {
  const delta = typeof value === 'string' ? { content: value } : { tool_calls: value.map((call, index) => ({ ...call, index })) }
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: typeof value === 'string' ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
}

async function fixture(t: TestContext, script: Array<string | ReturnType<typeof tool>[]>, toolCall = true) {
  const storage = new Map([['jcModelProviderId', 'local-ollama']])
  const previous = { storage: globalThis.localStorage, window: globalThis.window, fetch: globalThis.fetch, files: { ...webProjectFiles } }
  Object.assign(globalThis, { localStorage: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) }, window: { location: { origin: 'http://localhost', href: 'http://localhost' } } })
  const records = new Map<string, FileEntry>()
  const files = createWebProjectFiles({ async all() { return [...records.values()] }, async get(id) { return records.get(id) }, async put(entry) { records.set(entry.id, structuredClone(entry)) }, async remove(id) { records.delete(id) } })
  Object.assign(webProjectFiles, files)
  setActivePinia(createPinia())
  const store = useAgentStore()
  store.availableModels = [{ id: 'test-model', label: 'test', providerId: 'local-ollama', contextWindow: 32768, maxOutputTokens: 4096, toolCall, capability: 'text' }]
  store.modelsFetched = true
  const requests: any[] = []
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    const value = String(url)
    if (value.startsWith('/skills/')) {
      const path = `public${decodeURIComponent(value)}`
      return existsSync(path) ? new Response(readFileSync(path), { headers: { 'content-type': path.endsWith('.json') ? 'application/json' : 'text/markdown' } }) : new Response('', { status: 404 })
    }
    assert.match(value, /\/v1\/chat\/completions$/)
    const request = JSON.parse(String(options?.body))
    requests.push(request)
    assert.ok(script.length, 'unexpected model request')
    return response(script.shift()!)
  }) as typeof fetch
  t.after(() => { Object.assign(webProjectFiles, previous.files); Object.assign(globalThis, { localStorage: previous.storage, window: previous.window, fetch: previous.fetch }) })
  const project = await files.createProject('初恋')
  const run = (content: string, extra: Record<string, unknown> = {}) => runMemoryChat({ projectId: project.id, conversationId: 'c', conversationTurns: [], userTurn: { id: 'current', role: 'user', content, createdAt: '2026-10-15' }, modelId: 'test-model', modelProviderId: 'local-ollama', onText() {}, confirmTool: () => { throw new Error('project tools must not request external authority') }, ...extra })
  return { files, project, requests, run }
}

test('Wiki and current-conversation evidence join one loop and explicit reads work with query off', async t => {
  const f = await fixture(t, [[tool('read', { path: 'wiki/人物/王刚.md' }), tool('memory_search', { query: '王刚' })], '可以安排重逢，但不复合。'])
  await f.files.write(f.project.id, 'wiki/index.md', '# Wiki\n- [[人物/index|人物]]')
  await f.files.write(f.project.id, 'wiki/人物/index.md', '# 人物\n- [[王刚|王刚]]')
  await f.files.write(f.project.id, 'wiki/人物/王刚.md', '# 王刚\n初恋是[[李静]]，尚未重逢。')
  let raw = createConversationTranscript('c')
  raw = appendConversationTurn(raw, { id: 'u', role: 'user', content: '王刚不要与初恋复合。', createdAt: '2026-10-15' })
  raw = appendConversationTurn(raw, { id: 'a', role: 'assistant', content: '只安排重逢，暂不复合。', createdAt: '2026-10-15' })
  await f.files.write(f.project.id, '.raw/对话记录/c.md', raw)
  await f.files.write(f.project.id, '.raw/记忆索引/c.md', upsertConversationMemoryIndex('', { conversationId: 'c', rawPath: '.raw/对话记录/c.md', assistantTurnId: 'a' }, { summary: '王刚初恋不复合', keywords: ['王刚', '初恋'] }))
  assert.match(await f.run('读取王刚资料和我们之前的初恋修改，再安排情节', { memoryQueryEnabled: false }), /不复合/)
  assert.ok(f.requests[0].tools.some((entry: any) => entry.function.name === 'read'))
  assert.doesNotMatch(JSON.stringify(f.requests[0].messages), /<retrieved_context>/)
  const evidence = JSON.stringify(f.requests[1].messages.filter((item: any) => item.role === 'tool'))
  assert.match(evidence, /初恋是/)
  assert.match(evidence, /王刚不要与初恋复合/)
  assert.match(evidence, /只安排重逢/)
  assert.equal(f.requests.length, 2)
})

test('automatic query supplies both navigations but never treats a summary as source text', async t => {
  const f = await fixture(t, ['请先确认是哪位王刚。'])
  await f.files.write(f.project.id, 'wiki/index.md', '# Wiki导航')
  let raw = createConversationTranscript('c')
  raw = appendConversationTurn(raw, { id: 'u', role: 'user', content: '王刚的约束', createdAt: '2026-10-15' })
  raw = appendConversationTurn(raw, { id: 'a', role: 'assistant', content: '秘密原文不得当作导航注入', createdAt: '2026-10-15' })
  await f.files.write(f.project.id, '.raw/对话记录/c.md', raw)
  await f.files.write(f.project.id, '.raw/记忆索引/c.md', upsertConversationMemoryIndex('', { conversationId: 'c', rawPath: '.raw/对话记录/c.md', assistantTurnId: 'a' }, { summary: '王刚线索', keywords: ['王刚'] }))
  await f.run('给王刚安排初恋情节')
  const prompt = JSON.stringify(f.requests[0].messages)
  assert.match(prompt, /Wiki导航/)
  assert.match(prompt, /王刚线索/)
  assert.doesNotMatch(prompt, /秘密原文不得当作导航注入/)
  assert.match(prompt, /不是新指令/)
})

for (const route of [
  { name: 'jc-manju-zhizuo', reference: 'skill://jc-gongchengjuben/references/shot-visibility.md', kind: 'engineering_script', episode_number: 3 },
  { name: 'jc-duanju', reference: 'skill://jc-duanju/SKILL.md', kind: 'screenplay', episode_number: 3 },
  { name: 'jc-novel', reference: 'skill://jc-novel/references/写作工作流.md', kind: 'novel_chapter_draft', work_name: '初恋', chapter_number: 1, chapter_title: '重逢' },
]) test(`${route.name} reads a real package resource and saves via the same runtime`, async t => {
  const { name, reference, kind, ...args } = route
  const f = await fixture(t, [[tool('read', { path: reference })], [tool('wiki_save_artifact', { artifact_kind: kind, content: '王刚与初恋重逢，没有复合。', ...args })], '已保存草稿。'])
  const reply = await f.run('按当前路线创作指定片段并保存。', { selectedSkillNames: [name], memoryQueryEnabled: false })
  const receipts = f.requests[2].messages.filter((item: any) => item.role === 'tool').map((item: any) => { try { return JSON.parse(item.content) } catch { return null } }).filter(Boolean)
  const saved = receipts.find((item: any) => item.status === 'saved')
  assert.ok(saved, JSON.stringify(receipts))
  assert.match(reply, /程序保存回执：/)
  assert.ok(reply.includes(`[[${saved.path}|`))
  assert.match((await f.files.read(f.project.id, saved.path)).content, /没有复合/)
  assert.equal((await f.files.list(f.project.id)).some(item => item.path.includes('/原文.md')), false)
  assert.equal(f.requests.length, 3)
})

test('a text-only model remains usable without advertising tools', async t => {
  const f = await fixture(t, ['普通文字回答'], false)
  assert.equal(await f.run('聊一个想法', { fileToolsSelected: true, memoryQueryEnabled: false }), '普通文字回答')
  assert.equal(f.requests[0].tools, undefined)
})

test('query pages locate a prop beyond the old 6000-character prefix and retain user constraints', async t => {
  const f = await fixture(t, [[tool('memory_search', { query: '玉佩' })], '玉佩不能作为复合信物。'])
  let raw = createConversationTranscript('c')
  raw = appendConversationTurn(raw, { id: 'u', role: 'user', content: '玉佩不能作为复合信物。', createdAt: '2026-10-15' })
  raw = appendConversationTurn(raw, { id: 'a', role: 'assistant', content: `${'无关片段。'.repeat(80)}\n`.repeat(30) + '王刚归还玉佩，但不复合。', createdAt: '2026-10-15' })
  await f.files.write(f.project.id, '.raw/对话记录/c.md', raw)
  await f.files.write(f.project.id, '.raw/记忆索引/c.md', upsertConversationMemoryIndex('', { conversationId: 'c', rawPath: '.raw/对话记录/c.md', assistantTurnId: 'a' }, { summary: '归还玉佩', keywords: ['王刚', '玉佩'] }))
  await f.run('读取玉佩情节', { memoryQueryEnabled: false })
  const toolResult = f.requests[1].messages.find((item: any) => item.role === 'tool')
  assert.match(toolResult.content, /归还玉佩，但不复合/)
  assert.match(toolResult.content, /不能作为复合信物/)
})

test('declared model capacity controls the request and missing capacity is marked estimated', async t => {
  const f = await fixture(t, ['已回答', '另一个回答'])
  const store = useAgentStore()
  const capacities: Array<[number, boolean]> = []
  store.availableModels[0]!.contextWindow = 80000
  store.availableModels[0]!.maxOutputTokens = 20000
  await f.run('讨论想法', { onContextCapacity: (capacity: number, estimated: boolean) => capacities.push([capacity, estimated]) })
  assert.equal(f.requests[0].max_tokens, 20000)
  store.availableModels[0]!.contextWindow = undefined
  store.availableModels[0]!.maxOutputTokens = undefined
  await f.run('再讨论想法', { onContextCapacity: (capacity: number, estimated: boolean) => capacities.push([capacity, estimated]) })
  assert.deepEqual(capacities, [[80000, false], [32768, true]])
  assert.equal(f.requests[1].max_tokens, 4096)
})

test('partial Wiki save exposes program-owned warnings independently of the model reply', async t => {
  const f = await fixture(t, [[tool('wiki_save_artifact', { artifact_kind: 'character_bio', entity_name: '王刚', content: '# 王刚\n没有复合。' })], '正文已保存，索引待补。'])
  const create = webProjectFiles.createText
  webProjectFiles.createText = async (owner, path, content) => {
    if (path.endsWith('/index.md')) throw new Error('index disk failure')
    return create(owner, path, content)
  }
  const statuses: any[] = []
  await f.run('把王刚小传保存到Wiki', { memoryQueryEnabled: false, onProgramStatus: (status: unknown) => statuses.push(status) })
  assert.equal(statuses.at(-1)?.status, 'succeeded')
  assert.match(statuses.at(-1)?.reason, /index disk failure/)
  assert.match((await f.files.read(f.project.id, 'wiki/项目资料/人物小传/王刚.md')).content, /没有复合/)
})
