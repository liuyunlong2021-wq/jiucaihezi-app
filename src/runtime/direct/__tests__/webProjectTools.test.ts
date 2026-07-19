import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FileEntry } from '@/composables/useFileStore'
import { createWebProjectFiles, type WebProjectRecordAdapter } from '@/utils/webProjectFiles'
import type { WebBinarySource, WebProjectBinaryAdapter } from '@/utils/webProjectBinaryStore'
import {
  buildWebProjectToolDefinitions,
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
    ['skill', 'read', 'glob', 'grep', 'write', 'edit'],
  )
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
      ['skill', 'read', 'glob', 'grep', 'write', 'edit', 'mcp__docs__lookup'],
    )
  } finally {
    ;(globalThis as any).__jiucaihezi_mcpStore__ = original
  }
})

test('web project tool executor reads writes searches and edits the bound project', async () => {
  const files = createWebProjectFiles(memoryAdapter())
  const project = await files.createProject('工具测试')
  const execute = createWebProjectToolExecutor({ projectId: project.id, files })

  await execute(call('write', { path: 'wiki/hot.md', content: '# 热缓存\n林风' }))
  assert.match((await execute(call('read', { path: '.' }))).content, /wiki/)
  assert.match((await execute(call('read', { path: 'wiki/hot.md' }))).content, /林风/)
  assert.match((await execute(call('glob', { pattern: 'wiki/**/*.md' }))).content, /wiki\/hot.md/)
  assert.match((await execute(call('grep', { pattern: '林风' }))).content, /Line 2/)
  assert.match((await execute(call('edit', {
    path: 'wiki/hot.md', oldString: '林风', newString: '陆川', replaceAll: false,
  }))).content, /Replacements: 1/)
  assert.match((await execute(call('read', { path: 'wiki/hot.md' }))).content, /陆川/)

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
