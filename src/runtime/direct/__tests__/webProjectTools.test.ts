import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FileEntry } from '@/composables/useFileStore'
import { createWebProjectFiles, type WebProjectRecordAdapter } from '@/utils/webProjectFiles'
import type { WebBinarySource, WebProjectBinaryAdapter } from '@/utils/webProjectBinaryStore'
import {
  buildWebProjectToolDefinitions,
  buildMemoryWebProjectToolDefinitions,
  READ_ONLY_DOCUMENT_TOOL_DEFINITIONS,
  WEB_PROJECT_TOOL_DEFINITIONS,
  createWebProjectToolExecutor,
} from '../webProjectTools'

function memoryAdapter(): WebProjectRecordAdapter {
  const records = new Map<string, FileEntry>()
  return {
    async all() { return [...records.values()] },
    async get(id) { return records.get(id) },
    async put(entry) { records.set(entry.id, structuredClone(entry)) },
    async remove(id) { records.delete(id) },
  }
}

async function sourceBlob(source: WebBinarySource): Promise<Blob> {
  if (source instanceof Blob) return source
  const reader = source.getReader()
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return new Blob(chunks)
}

function memoryBinaryAdapter(): WebProjectBinaryAdapter {
  const blobs = new Map<string, Blob>()
  return {
    async write(id, source) {
      const blob = await sourceBlob(source)
      blobs.set(id, blob)
      return blob.size
    },
    async read(id) {
      const blob = blobs.get(id)
      if (!blob) throw new Error(`二进制文件不存在: ${id}`)
      return blob
    },
    async remove(id) { blobs.delete(id) },
    async estimate() { return { usage: 0, quota: 1_000_000 } },
    async persist() { return true },
  }
}

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }
}

test('web project tools use OpenCode-compatible names', () => {
  assert.deepEqual(
    WEB_PROJECT_TOOL_DEFINITIONS.map(tool => tool.function.name),
    ['skill', 'wiki', 'read', 'glob', 'grep', 'write', 'edit'],
  )
})

test('quick document grep requires the approved attachment path', () => {
  const grep = READ_ONLY_DOCUMENT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'grep')
  assert.deepEqual(grep?.function.parameters.required, ['pattern', 'path'])
})

test('web project tool definitions append connected MCP tools without Desktop terminal', () => {
  const original = (globalThis as any).__jiucaihezi_mcpStore__
  ;(globalThis as any).__jiucaihezi_mcpStore__ = {
    useMcpStore: () => ({
      allMcpTools: [{
        name: 'mcp__docs__lookup',
        description: 'Lookup docs',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        serverId: 'docs',
        originalName: 'lookup',
      }],
      isServerEnabled: () => true,
      isServerConnected: () => true,
    }),
  }

  try {
    assert.deepEqual(
      buildWebProjectToolDefinitions().map(tool => tool.function.name),
      ['skill', 'wiki', 'read', 'glob', 'grep', 'write', 'edit', 'mcp__docs__lookup'],
    )
    assert.deepEqual(
      buildMemoryWebProjectToolDefinitions().map(tool => tool.function.name),
      ['skill', 'wiki', 'read', 'glob', 'grep', 'write', 'edit', 'mkdir', 'move', 'delete', 'export_markdown_png', 'create_document', 'create_html', 'create_3d_scene', 'mcp__docs__lookup'],
    )
  } finally {
    ;(globalThis as any).__jiucaihezi_mcpStore__ = original
  }
})

test('web memory artifact tools generate real project files and keep same-name outputs', async () => {
  const files = createWebProjectFiles(memoryAdapter(), () => {}, memoryBinaryAdapter())
  const project = await files.createProject('作品工具')
  const execute = createWebProjectToolExecutor({
    projectId: project.id,
    files,
    renderImage: async () => new Blob(['PNG'], { type: 'image/png' }),
  })

  assert.match((await execute(call('export_markdown_png', { title: '周报', content: '# 周报' }))).content, /\.raw\/jc-media\/图片\/周报\.png/)
  assert.match((await execute(call('export_markdown_png', { title: '周报', content: '# 周报' }))).content, /周报 \(1\)\.png/)
  assert.match((await execute(call('create_document', { title: '周报', content: '# 周报', format: 'docx' }))).content, /\.raw\/jc-media\/文档\/周报\.docx/)
  assert.match((await execute(call('create_html', { title: '周报', content: '# 周报' }))).content, /\.raw\/jc-media\/文档\/周报\.html/)
  const sceneResult = await execute(call('create_3d_scene', {
    title: '宫殿排位', objects: [{ id: 'emperor', type: 'person', position: [0, 0, 0] }],
    formations: [{ id: 'ministers', type: 'grid', count: 20, position: [0, 0, 3] }],
  }))
  assert.match(sceneResult.content, /\.raw\/jc-media\/文档\/宫殿排位\.jcscene/)
  assert.match(sceneResult.content, /jc:scene/)
  assert.match((await execute(call('create_html', {
    title: '完整网页',
    content: '<!doctype html><html><head><style>button{color:red}</style></head><body><button>开始</button></body></html>',
  }))).content, /\.raw\/jc-media\/文档\/完整网页\.html/)

  const image = await files.readBinary(project.id, '.raw/jc-media/图片/周报.png')
  const docx = new Uint8Array(await (await files.readBinary(project.id, '.raw/jc-media/文档/周报.docx')).arrayBuffer())
  const html = await files.read(project.id, '.raw/jc-media/文档/周报.html')
  const fullHtml = await files.read(project.id, '.raw/jc-media/文档/完整网页.html')
  assert.equal(await image.text(), 'PNG')
  assert.deepEqual([...docx.slice(0, 2)], [0x50, 0x4b])
  assert.match(html.content, /<!doctype html>/i)
  assert.match(html.content, /<h1>周报<\/h1>/)
  assert.match(fullHtml.content, /<style>button\{color:red\}<\/style>/)
  assert.match(fullHtml.content, /<button>开始<\/button>/)
  assert.doesNotMatch(fullHtml.content, /&lt;button/)
  await assert.rejects(
    () => execute(call('create_html', { title: '半截网页', content: '<div>缺少网页结构</div>' })),
    /网页内容不完整/,
  )
  await assert.rejects(
    () => execute(call('create_document', { title: '错误', content: '正文', format: 'pdf' })),
    /不支持的文档格式/,
  )
})

test('web project tools execute the native Wiki runtime without Python or Node', async () => {
  const files = createWebProjectFiles(memoryAdapter())
  const project = await files.createProject('原生 Wiki')
  const execute = createWebProjectToolExecutor({ projectId: project.id, files })

  assert.match((await execute(call('wiki', { action: 'scaffold', type: 'dev_project' }))).content, /created-or-completed: docs\/wiki/)
  assert.match((await execute(call('wiki', { action: 'inspect' }))).content, /path: docs\/wiki/)
  assert.equal((await files.list(project.id)).some(entry => entry.path === '.raw' || entry.path.startsWith('.raw/')), false)
})

test('web project tool executor reads writes searches and edits the bound project', async () => {
  const files = createWebProjectFiles(memoryAdapter())
  const project = await files.createProject('工具测试')
  const execute = createWebProjectToolExecutor({ projectId: project.id, files })

  await execute(call('write', { path: 'wiki/hot.md', content: '# 热缓存\n林风' }))
  assert.match((await execute(call('read', { path: '.' }))).content, /wiki/)
  assert.match((await execute(call('read', { path: 'wiki/hot.md' }))).content, /林风/)
  assert.match((await execute(call('read', { path: 'wiki/hot.md', offset: 2, limit: 1 }))).content, /lines 2-2 of 2; eof=true/)
  assert.match((await execute(call('glob', { pattern: 'wiki/**/*.md' }))).content, /wiki\/hot.md/)
  assert.match((await execute(call('grep', { pattern: '林风' }))).content, /Line 2/)
  assert.match((await execute(call('edit', {
    path: 'wiki/hot.md', oldString: '林风', newString: '陆川', replaceAll: false,
  }))).content, /Replacements: 1/)
  assert.match((await execute(call('read', { path: 'wiki/hot.md' }))).content, /陆川/)
  assert.match((await execute(call('mkdir', { path: '资料/会议' }))).content, /资料\/会议/)
  assert.match((await execute(call('move', { path: 'wiki/hot.md', destination: '资料/会议/纪要.md' }))).content, /资料\/会议\/纪要.md/)
  assert.match((await execute(call('read', { path: '资料/会议/纪要.md' }))).content, /陆川/)
  assert.match((await execute(call('delete', { path: '资料/会议/纪要.md' }))).content, /已删除/)
  await assert.rejects(() => execute(call('read', { path: '资料/会议/纪要.md' })), /文件不存在/)

  await assert.rejects(() => execute(call('read', { path: '../secret.md' })), /项目路径/)
})

test('web project tools return MCP bridge connection errors to the model', async () => {
  const original = (globalThis as any).__jiucaihezi_mcpStore__
  ;(globalThis as any).__jiucaihezi_mcpStore__ = {
    useMcpStore: () => ({
      allMcpTools: [],
      isServerEnabled: () => true,
      isServerConnected: () => false,
    }),
  }

  try {
    const files = createWebProjectFiles(memoryAdapter())
    const project = await files.createProject('MCP 工具')
    const execute = createWebProjectToolExecutor({ projectId: project.id, files })
    const result = await execute(call('mcp__docs__lookup', { query: 'MCP' }))
    assert.match(result.content, /MCP_NOT_CONNECTED/)
  } finally {
    ;(globalThis as any).__jiucaihezi_mcpStore__ = original
  }
})

test('web project tools send OPFS images as data URLs and summarize OPFS video and audio', async () => {
  const files = createWebProjectFiles(memoryAdapter(), () => {}, memoryBinaryAdapter())
  const project = await files.createProject('媒体工具')
  const execute = createWebProjectToolExecutor({ projectId: project.id, files })

  await files.writeBinary(project.id, 'media/ref.png', new Blob(['image-bytes'], { type: 'text/plain' }), {
    category: 'image', mimeType: 'image/png',
  })
  const image = await execute(call('read', { path: 'media/ref.png' }))
  assert.equal(image.content, 'Image read successfully: media/ref.png')
  assert.deepEqual(image.followupMessages, [{
    role: 'user',
    content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2UtYnl0ZXM=' } }],
  }])

  const videoFile = await files.writeBinary(project.id, 'media/clip.mp4', new Blob(['video-bytes']), {
    category: 'video', mimeType: 'video/mp4',
  })
  const audioFile = await files.writeBinary(project.id, 'media/voice.mp3', new Blob(['audio-bytes']), {
    category: 'audio', mimeType: 'audio/mpeg',
  })
  const video = await execute(call('read', { path: 'media/clip.mp4' }))
  const audio = await execute(call('read', { path: 'media/voice.mp3' }))

  assert.match(video.content, /media\/clip\.mp4/)
  assert.match(video.content, /video\/mp4/)
  assert.match(video.content, new RegExp(String(videoFile.size)))
  assert.doesNotMatch(video.content, /data:/)
  assert.equal(video.followupMessages, undefined)
  assert.match(audio.content, /media\/voice\.mp3/)
  assert.match(audio.content, /audio\/mpeg/)
  assert.match(audio.content, new RegExp(String(audioFile.size)))
  assert.doesNotMatch(audio.content, /data:/)
  assert.equal(audio.followupMessages, undefined)
})
