import assert from 'node:assert/strict'
import { test } from 'node:test'

import { CREATIVE_PROJECT_TOOL_DEFINITIONS } from '../creativeToolContract'
import { createDesktopProjectToolExecutor } from '../desktopProjectTools'

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }
}

function fixtureInvoke(command: string, payload: any): Promise<any> {
  const path = payload.input?.relativePath
  if (command === 'dev_list_files') {
    return Promise.resolve([
      { path: 'wiki', isDir: true },
      { path: 'wiki/hot.md', isDir: false, size: 14 },
      { path: 'media/ref.png', isDir: false, size: 3 },
      { path: 'media/clip.mp4', isDir: false, size: 5 },
    ])
  }
  if (command === 'dev_read_file') {
    if (path === 'wiki/hot.md') return Promise.resolve({ path, content: '# 热缓存\n林风', base64: 'IyDng63nvpHlrZgK5p6X6aOO', size: 14, truncated: false })
    if (path === 'media/ref.png') return Promise.resolve({ path, content: '', base64: 'aW1n', size: 3, truncated: false })
    if (path === 'media/clip.mp4') return Promise.resolve({ path, content: '', base64: 'dmlkZW8=', size: 5, truncated: false })
    throw new Error(`file not found: ${path}`)
  }
  if (command === 'dev_write_file') return Promise.resolve({ path, bytesWritten: payload.input.content.length })
  if (command === 'dev_replace_in_file') return Promise.resolve({ path, replacements: 1 })
  throw new Error(`unexpected command: ${command}`)
}

test('creative tool contract exposes only the shared six tool names', () => {
  assert.deepEqual(
    CREATIVE_PROJECT_TOOL_DEFINITIONS.map(tool => tool.function.name),
    ['skill', 'read', 'glob', 'grep', 'write', 'edit'],
  )
})

test('desktop project tools use relative Tauri IPC with Web-compatible output', async () => {
  const execute = createDesktopProjectToolExecutor({ projectDir: '/fixture', invoke: fixtureInvoke })

  assert.match((await execute(call('read', { path: '.' }))).content, /dir\twiki/)
  assert.match((await execute(call('read', { path: 'wiki/hot.md' }))).content, /2: 林风/)
  assert.deepEqual((await execute(call('read', { path: 'media/ref.png' }))).followupMessages, [{
    role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1n' } }],
  }])
  assert.match((await execute(call('read', { path: 'media/clip.mp4' }))).content, /video\/mp4/)
  assert.match((await execute(call('glob', { pattern: 'wiki/**/*.md' }))).content, /wiki\/hot.md/)
  assert.match((await execute(call('grep', { pattern: '林风' }))).content, /wiki\/hot.md: Line 2: 林风/)
  assert.match((await execute(call('grep', { pattern: '林风', include: '*.md' }))).content, /wiki\/hot.md: Line 2: 林风/)
  assert.match((await execute(call('write', { path: 'wiki/new.md', content: '正文' }))).content, /wiki\/new.md/)
  assert.match((await execute(call('edit', { path: 'wiki/hot.md', oldString: '林风', newString: '陆川' }))).content, /Replacements: 1/)
  await assert.rejects(() => execute(call('read', { path: '../secret.md' })), /项目路径/)
  await assert.rejects(() => execute(call('read', { path: 'missing.md' })), /file not found/)
})

test('desktop project tools allow only resources declared by a loaded Skill', async () => {
  const fetcher = async (url: string) => {
    if (url === '/skills/index.json') return new Response(JSON.stringify([{
      id: 'test/skill', name: '测试 Skill', description: null, triggers: [], commands: [], files: ['SKILL.md', 'references/rule.md'],
    }]))
    if (url === '/skills/test/skill/SKILL.md') return new Response('# 测试 Skill')
    if (url === '/skills/test/skill/references/rule.md') return new Response('只允许这个资源')
    return new Response('', { status: 404 })
  }
  const execute = createDesktopProjectToolExecutor({ projectDir: '/fixture', invoke: fixtureInvoke, fetcher: fetcher as typeof fetch })

  await execute(call('skill', { name: '测试 Skill' }))
  assert.match((await execute(call('read', { path: '/skills/test/skill/references/rule.md' }))).content, /只允许这个资源/)
  await assert.rejects(
    () => execute(call('read', { path: '/skills/test/skill/private.md' })),
    /Skill 资源不存在/,
  )
})
