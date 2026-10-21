import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'

test('native Wiki resources preserve all existing rules without publishing a Skill', async () => {
  const { attachWikiRuntime } = await import('../../src-tauri/resources/deepseek-harness/wiki-runtime.mjs')
  const tools = new Map(), sections = new Map()
  const releases = []
  const ctx = {
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } },
    systemPrompt: { section(section) { sections.set(section.name, section); return () => sections.delete(section.name) } },
    fs: {}, get() {}, effect(fn) { releases.push(fn()) },
  }
  const agent = { ctx: { plugin(def) { return {
    async await() { await def.apply(ctx) }, assertActive() {},
    async dispose() { for (const fn of releases.splice(0).reverse()) await fn?.() },
  } } } }
  const dispose = await attachWikiRuntime({ handle: { agent } }, resolve('public/skills'))
  assert.ok(tools.has('wiki_save_artifact'))
  assert.ok(tools.has('wiki_read_guidance'))
  const overview = await tools.get('wiki_read_guidance').execute({ topic: 'overview' })
  assert.match(overview, /saved_with_warnings/)
  assert.match(overview, /user_confirmed/)
  assert.match(await tools.get('wiki_read_guidance').execute({ topic: 'story' }), /prepare_story_analysis/)
  assert.match(await tools.get('wiki_read_guidance').execute({ topic: 'knowledge' }), /两阶段/)
  assert.match([...sections.values()][0].text, /wiki_read_guidance/)
  assert.ok(!existsSync('public/skills/wiki-memory/SKILL.md'))
  await dispose()
  assert.equal(tools.size, 0)
  assert.equal(sections.size, 0)
})

test('actual SDK exposes native Wiki and official present without a selected Skill, persists valid deliveries only', { timeout: 45000 }, async t => {
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createServer } = await import('node:http')
  const { execFileSync } = await import('node:child_process')
  execFileSync(process.execPath, ['scripts/prepare-deepseek-harness.mjs'])
  const { DeepSeekHarness } = await import('../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js')
  const root = mkdtempSync(join(tmpdir(), 'jc-native-wiki-'))
  writeFileSync(join(root, '剧本.md'), '# 第一集\n完成正文')
  mkdirSync(join(root, 'directory'))
  symlinkSync(join(root, '剧本.md'), join(root, 'link.md'))
  const requests = []
  const actions = [
    ['wiki_read_guidance', { topic: 'overview' }],
    ['present', { files: [{ path: 'missing.md' }] }],
    ['present', { files: [{ path: 'directory' }] }],
    ['present', { files: [{ path: 'link.md' }] }],
    ['present', { files: [{ path: '剧本.md', description: '第一集剧本' }] }],
  ]
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    requests.push(body)
    const index = requests.length - 1
    const action = actions[index]
    const delta = action
      ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${index}`, type: 'function', function: { name: action[0], arguments: JSON.stringify(action[1]) } }] }
      : { role: 'assistant', content: '已交付' }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    for (const [value, reason] of [[delta, null], [{}, action ? 'tool_calls' : 'stop']])
      res.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test', choices: [{ index: 0, delta: value, finish_reason: reason }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  let harness
  t.after(async () => { await harness?.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(root, { recursive: true, force: true }) })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const patch = join(root, 'route.yml')
  writeFileSync(patch, `- id: llm-pi-ai\n  config:\n    providers:\n      local:\n        apiKeyEnv: TEST_KEY\n        api: openai-completions\n        baseURL: http://127.0.0.1:${server.address().port}/v1\n        models:\n          - id: test\n            contextWindow: 65536\n            maxTokens: 2048\n`)
  const options = { cwd: root, processCwd: root, dshHome: join(root, 'home'), patches: [patch], provider: 'local', model: 'test',
    env: { ...process.env, TEST_KEY: 'test', DSH_BUNDLED_SKILL_DIR: resolve('public/skills'), DSH_PRIMARY_RUNTIME: '', DSH_AGENTS_HOME: join(root, 'agents') } }
  harness = new DeepSeekHarness(options)
  await harness.session('native').run('请交付现有剧本文件')
  assert.ok(requests[0].tools.some(tool => tool.function.name === 'wiki_save_artifact'))
  assert.ok(requests[0].tools.some(tool => tool.function.name === 'present'))
  assert.match(JSON.stringify(requests[1].messages), /小说章节分两步/)
  let snapshot = await harness.client.request('session/read', { sessionId: 'native' })
  const deliveries = snapshot.events.filter(event => event.type === 'deliverables/presented')
  assert.equal(deliveries.length, 1)
  assert.equal(deliveries[0].data.files[0].path, realpathSync(join(root, '剧本.md')))
  assert.equal(snapshot.events.filter(event => event.type === 'tool/result' && event.data.message.isError).length, 3)
  await harness.close()
  harness = new DeepSeekHarness(options)
  await harness.start()
  snapshot = await harness.client.request('session/read', { sessionId: 'native' })
  assert.deepEqual(snapshot.events.filter(event => event.type === 'deliverables/presented'), deliveries)
})
