import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import {
  buildCreativeToolDefinitions,
  buildMemoryDesktopToolDefinitions,
  CREATIVE_PROJECT_TOOL_DEFINITIONS,
} from '../creativeToolContract'
import { createDesktopProjectToolExecutor } from '../desktopProjectTools'

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }
}

function fixtureInvoke(command: string, payload: any): Promise<any> {
  const path = payload.input?.relativePath || payload.input?.path
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
  if (command === 'dev_read_external_file') {
    if (path === '/tmp/frames/frame_01.jpg' || path === '/private/tmp/frames/frame_01.jpg') return Promise.resolve({ path, content: '', base64: 'aW1n', size: 3, truncated: false })
    if (path === '/tmp/notes.txt' || path === '/private/tmp/notes.txt') return Promise.resolve({ path, content: '外部内容\n林风', base64: '5aSW6YOo5YaF5a65Cuadpemjjo==', size: 14, truncated: false })
    throw new Error(`external file not found: ${path}`)
  }
  if (command === 'dev_list_external_files') {
    if (path === '/tmp/frames/frame_01.jpg') return Promise.resolve([
      { path: '/private/tmp/frames/frame_01.jpg', isDir: false, size: 3 },
    ])
    return Promise.resolve([
      { path: '/private/tmp', isDir: true },
      { path: '/private/tmp/frames', isDir: true },
      { path: '/private/tmp/frames/frame_01.jpg', isDir: false, size: 3 },
      { path: '/private/tmp/notes.txt', isDir: false, size: 14 },
    ])
  }
  if (command === 'dev_write_file') return Promise.resolve({ path, bytesWritten: payload.input.content.length })
  if (command === 'dev_replace_in_file') return Promise.resolve({ path, replacements: 1 })
  if (command === 'dev_create_dir') return Promise.resolve()
  if (command === 'dev_rename_file') return Promise.resolve(payload.input.newRelativePath)
  if (command === 'dev_delete_file') return Promise.resolve({ status: 'trashed' })
  if (command === 'dev_write_external_file') return Promise.resolve({ path, bytesWritten: payload.input.content.length })
  if (command === 'dev_replace_in_external_file') return Promise.resolve({ path, replacements: 1 })
  throw new Error(`unexpected command: ${command}`)
}

test('creative tool contract exposes the project tools and Desktop terminal', () => {
  assert.deepEqual(
    CREATIVE_PROJECT_TOOL_DEFINITIONS.map(tool => tool.function.name),
    ['skill', 'wiki', 'read', 'glob', 'grep', 'write', 'edit', 'terminal'],
  )
  const terminal = CREATIVE_PROJECT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'terminal')
  assert.match(terminal?.function.description || '', /explicitly lists that exact token/)
  assert.match(terminal?.function.description || '', /absolute paths supplied in user text directly/)
})

test('wiki tool contract exposes evidence, scoped replace, and no bare link action', () => {
  const wiki = CREATIVE_PROJECT_TOOL_DEFINITIONS.find(tool => tool.function.name === 'wiki')!
  const properties = wiki.function.parameters.properties as Record<string, any>

  assert.deepEqual(properties.action.enum, ['inspect', 'scaffold', 'search', 'status', 'graph', 'validate', 'audit', 'evidence', 'closeout', 'replace', 'extend'])
  assert.equal(properties.replaceAll.type, 'boolean')
  assert.equal(properties.target, undefined)
})

test('desktop wiki evidence fingerprints the original project bytes', async () => {
  const execute = createDesktopProjectToolExecutor({ projectDir: '/tmp/project', invoke: fixtureInvoke })

  const output = (await execute(call('wiki', { action: 'evidence', evidencePaths: ['media/ref.png'] }))).content

  assert.match(output, new RegExp(`media/ref\\.png sha256:${createHash('sha256').update('img').digest('hex')}`))
})

test('desktop Wiki audit classifies Rust ENOENT as a missing source', async () => {
  const invoke = async (command: string, payload: { input: Record<string, unknown> }) => {
    const path = String(payload.input.relativePath || '')
    if (command === 'dev_list_files') {
      return [
        { path: 'wiki', isDir: true },
        { path: 'wiki/index.md', isDir: false, size: 5 },
        { path: 'wiki/hot.md', isDir: false, size: 5 },
        { path: 'wiki/log.md', isDir: false, size: 5 },
        { path: 'wiki/来源索引.md', isDir: false, size: 260 },
        { path: 'wiki/制度.md', isDir: false, size: 20 },
      ]
    }
    if (command !== 'dev_read_file') throw new Error(`unexpected command: ${command}`)
    if (path === 'wiki/来源索引.md') {
      return {
        path,
        content: '# 来源索引\n\n## 证据记录\n\n| Wiki 位置 | 来源角色 | 原始来源 | 已处理范围 | 写入时指纹 | 记录时间 |\n|---|---|---|---|---|---|\n| [[制度#期限]] | 原件 | 资料/不存在.md | 全文 | sha256:' + 'a'.repeat(64) + ' | 2026-08-05T22:00:00+08:00 |\n',
        base64: '', size: 260, truncated: false,
      }
    }
    if (path === 'wiki/制度.md') return { path, content: '# 制度\n\n## 期限\n', base64: '', size: 20, truncated: false }
    if (path.startsWith('wiki/')) return { path, content: '# 页面\n', base64: '', size: 5, truncated: false }
    throw new Error('项目内路径不可访问: No such file or directory (os error 2)')
  }

  const execute = createDesktopProjectToolExecutor({ projectDir: '/tmp/project', invoke })
  const output = (await execute(call('wiki', { action: 'audit' }))).content

  assert.match(output, /来源不存在.*制度#期限/s)
})

test('creative tool definitions append connected MCP tools without changing core tools', () => {
  const original = (globalThis as any).__jiucaihezi_mcpStore__
  ;(globalThis as any).__jiucaihezi_mcpStore__ = {
    useMcpStore: () => ({
      allMcpTools: [
        {
          name: 'mcp__docs__lookup',
          description: 'Lookup docs',
          inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
          serverId: 'docs',
          originalName: 'lookup',
        },
        {
          name: 'mcp__docs__read',
          description: 'Collides with the core read tool',
          inputSchema: { type: 'object', properties: {} },
          serverId: 'docs',
          originalName: 'read',
        },
      ],
      isServerEnabled: () => true,
      isServerConnected: () => true,
    }),
  }

  try {
    assert.deepEqual(
      buildCreativeToolDefinitions().map(tool => tool.function.name),
      ['skill', 'wiki', 'read', 'glob', 'grep', 'write', 'edit', 'terminal', 'mcp__docs__lookup'],
    )
    assert.deepEqual(
      buildMemoryDesktopToolDefinitions().map(tool => tool.function.name),
      ['skill', 'wiki', 'read', 'glob', 'grep', 'write', 'edit', 'mkdir', 'move', 'delete', 'export_markdown_png', 'create_document', 'create_html', 'export_markdown_slides', 'create_3d_scene', 'edit_3d_scene', 'export_3d_scene_video', 'terminal', 'mcp__docs__lookup'],
    )
    assert.match(
      buildMemoryDesktopToolDefinitions().find(tool => tool.function.name === 'export_markdown_png')!.function.description,
      /Do not use it to create a new photo, illustration, product image, or other visual/,
    )
    assert.match(
      buildMemoryDesktopToolDefinitions().find(tool => tool.function.name === 'create_html')!.function.description,
      /complete standalone HTML document/,
    )
    const sceneTool = buildMemoryDesktopToolDefinitions().find(tool => tool.function.name === 'create_3d_scene')!
    assert.match(sceneTool.function.description, /add a camera action for every section/)
    assert.match(sceneTool.function.parameters.properties.timeline.description, /without duration is a hard cut/)
    const editSceneTool = buildMemoryDesktopToolDefinitions().find(tool => tool.function.name === 'edit_3d_scene')!
    assert.equal(editSceneTool.function.parameters.required.join(','), 'path,operations')
    assert.equal('objects' in editSceneTool.function.parameters.properties, false)
  } finally {
    ;(globalThis as any).__jiucaihezi_mcpStore__ = original
  }
})

test('desktop incrementally edits one existing scene and writes it once', async () => {
  const writes: any[] = []
  const execute = createDesktopProjectToolExecutor({
    projectDir: '/fixture',
    invoke: async (command, payload) => {
      if (command === 'dev_read_file') return { content: JSON.stringify({ title: '街道', objects: [{ id: 'person', type: 'person', position: [0, 0, 0] }] }) }
      if (command === 'dev_write_file') { writes.push(payload.input); return payload.input.relativePath }
      throw new Error(`unexpected command: ${command}`)
    },
  })
  const result = await execute(call('edit_3d_scene', {
    path: '.raw/jc-media/文档/街道.jcscene',
    operations: [{ action: 'move', target: 'person', to: [-2, 0, 1] }],
  }))
  assert.match(result.content, /已增量修改 3D 白膜场景/)
  assert.equal(writes.length, 1)
  assert.deepEqual(JSON.parse(writes[0].content).objects[0].position, [-2, 0, 1])
})

test('desktop exports an animated scene through the local recorder and FFmpeg command', async () => {
  const calls: Array<{ command: string; input: any }> = []
  const execute = createDesktopProjectToolExecutor({
    projectDir: '/fixture',
    recordSceneVideo: async scene => {
      assert.equal(scene.duration, 2)
      return new Blob(['video'], { type: 'video/webm' })
    },
    invoke: async (command, payload) => {
      calls.push({ command, input: payload.input })
      if (command === 'dev_read_file') return { content: JSON.stringify({ title: '选矿', objects: [], duration: 2, timeline: [{ at: 0, target: 'scene', action: 'label', text: '破碎' }] }) }
      if (command === 'dev_export_scene_video') return { path: '.raw/jc-media/视频/选矿.mp4', bytesWritten: 5 }
      throw new Error(`unexpected command: ${command}`)
    },
  })

  const result = await execute(call('export_3d_scene_video', { path: '.raw/jc-media/文档/选矿.jcscene' }))
  assert.match(result.content, /\.raw\/jc-media\/视频\/选矿\.mp4/)
  assert.equal(calls[1]?.command, 'dev_export_scene_video')
  assert.equal(calls[1]?.input.mimeType, 'video/webm')
})

test('desktop memory artifact tools write generated bytes inside project materials', async () => {
  const calls: Array<{ command: string; payload: any }> = []
  const execute = createDesktopProjectToolExecutor({
    projectDir: '/fixture',
    renderImage: async () => new Blob(['PNG'], { type: 'image/png' }),
    invoke: async (command, payload) => {
      calls.push({ command, payload })
      if (command === 'dev_list_files') return []
      if (command === 'save_generated_file') return { path: payload.input.path, bytesWritten: 3 }
      throw new Error(`unexpected command: ${command}`)
    },
  })

  assert.match((await execute(call('export_markdown_png', { title: '方案', content: '# 方案' }))).content, /\.raw\/jc-media\/图片\/方案\.png/)
  assert.match((await execute(call('create_document', { title: '方案', content: '# 方案', format: 'docx' }))).content, /\.raw\/jc-media\/文档\/方案\.docx/)
  assert.match((await execute(call('create_html', { title: '方案', content: '# 方案' }))).content, /\.raw\/jc-media\/文档\/方案\.html/)
  assert.match((await execute(call('export_markdown_slides', { title: '提案', content: '# 一\n\n---\n\n# 二', format: 'pptx' }))).content, /提案\.pptx/)
  assert.match((await execute(call('create_3d_scene', { title: '排位', objects: [], formations: [] }))).content, /\.raw\/jc-media\/文档\/排位\.jcscene/)

  assert.equal(calls.filter(call => call.command === 'save_generated_file').length, 5)
  assert.ok(calls.filter(call => call.command === 'save_generated_file').every(call => call.payload.input.keepBoth === true))
})

test('desktop project tools execute native Wiki inspection through existing Tauri files', async () => {
  const execute = createDesktopProjectToolExecutor({ projectDir: '/fixture', invoke: fixtureInvoke })

  const result = await execute(call('wiki', { action: 'inspect' }))

  assert.match(result.content, /state: existing/)
  assert.match(result.content, /path: wiki/)
  assert.match((await execute(call('wiki_search', { query: '林风' }))).content, /hot\.md/)
})

test('desktop project tools use relative Tauri IPC with Web-compatible output', async () => {
  const execute = createDesktopProjectToolExecutor({ projectDir: '/fixture', invoke: fixtureInvoke })

  assert.match((await execute(call('read', { path: '.' }))).content, /dir\twiki/)
  assert.match((await execute(call('read', { path: 'wiki/hot.md' }))).content, /2: 林风/)
  assert.match((await execute(call('read', { path: 'wiki/hot.md', offset: 2, limit: 1 }))).content, /lines 2-2 of 2; eof=true/)
  assert.deepEqual((await execute(call('read', { path: 'media/ref.png' }))).followupMessages, [{
    role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,aW1n' } }],
  }])
  assert.match((await execute(call('read', { path: 'media/clip.mp4' }))).content, /video\/mp4/)
  assert.match((await execute(call('glob', { pattern: 'wiki/**/*.md' }))).content, /wiki\/hot.md/)
  assert.match((await execute(call('grep', { pattern: '林风' }))).content, /wiki\/hot.md: Line 2: 林风/)
  assert.match((await execute(call('grep', { pattern: '林风', include: '*.md' }))).content, /wiki\/hot.md: Line 2: 林风/)
  assert.match((await execute(call('write', { path: 'wiki/new.md', content: '正文' }))).content, /wiki\/new.md/)
  assert.match((await execute(call('edit', { path: 'wiki/hot.md', oldString: '林风', newString: '陆川' }))).content, /Replacements: 1/)
  assert.match((await execute(call('mkdir', { path: '资料/会议' }))).content, /资料\/会议/)
  assert.match((await execute(call('move', { path: 'wiki/new.md', destination: '资料/会议/纪要.md' }))).content, /资料\/会议\/纪要.md/)
  assert.match((await execute(call('delete', { path: '资料/会议/纪要.md' }))).content, /废纸篓/)
  await assert.rejects(() => execute(call('read', { path: '../secret.md' })), /项目路径/)
  await assert.rejects(() => execute(call('read', { path: 'missing.md' })), /file not found/)
})

test('desktop project tools return MCP bridge connection errors to the model', async () => {
  const original = (globalThis as any).__jiucaihezi_mcpStore__
  ;(globalThis as any).__jiucaihezi_mcpStore__ = {
    useMcpStore: () => ({
      allMcpTools: [],
      isServerEnabled: () => true,
      isServerConnected: () => false,
    }),
  }

  try {
    const execute = createDesktopProjectToolExecutor({ projectDir: '/fixture', invoke: fixtureInvoke })
    const result = await execute(call('mcp__docs__lookup', { query: 'MCP' }))
    assert.match(result.content, /MCP_NOT_CONNECTED/)
  } finally {
    ;(globalThis as any).__jiucaihezi_mcpStore__ = original
  }
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

test('desktop project tools load a registered local Skill instead of requiring public/skills', async () => {
  const execute = createDesktopProjectToolExecutor({
    projectDir: '/fixture',
    invoke: fixtureInvoke,
    loadSkill: async (name) => name === 'JC-反推视频提示词'
      ? { content: '# local video workflow', resources: [], readResource: async () => '' }
      : null,
  })

  assert.match((await execute(call('skill', { name: 'JC-反推视频提示词' }))).content, /local video workflow/)
})

test('desktop project tools read only declared resources from a loaded local Skill', async () => {
  const execute = createDesktopProjectToolExecutor({
    projectDir: '/fixture',
    invoke: fixtureInvoke,
    loadSkill: async (name) => name === 'JC-反推视频提示词'
      ? {
          content: '# local video workflow',
          resources: ['references/character-prompt-format.md'],
          readResource: async (path) => path === 'references/character-prompt-format.md' ? '# character format' : '',
        }
      : null,
  })

  const loaded = await execute(call('skill', { name: 'JC-反推视频提示词' }))
  const base = loaded.content.match(/Base directory for this skill: (.+)/)?.[1]
  assert.ok(base)
  assert.match((await execute(call('read', { path: `${base}/references/character-prompt-format.md` }))).content, /character format/)
  await assert.rejects(
    () => execute(call('read', { path: `${base}/references/private.md` })),
    /Skill 资源不存在/,
  )
})

test('desktop project tools let the model inspect a temporary image after user approval', async () => {
  const execute = createDesktopProjectToolExecutor({ projectDir: '/fixture', invoke: fixtureInvoke })

  const result = await execute(call('read', { path: '/tmp/frames/frame_01.jpg' }))

  assert.equal(result.content, 'Image read successfully: /tmp/frames/frame_01.jpg')
  assert.deepEqual(result.followupMessages, [{
    role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,aW1n' } }],
  }])
})

test('desktop project tools use external IPC for absolute file paths', async () => {
  const calls: Array<{ command: string; payload: any }> = []
  const execute = createDesktopProjectToolExecutor({
    projectDir: '/fixture',
    invoke: async (command, payload) => {
      calls.push({ command, payload })
      return fixtureInvoke(command, payload)
    },
  })

  assert.match((await execute(call('glob', { pattern: '**/*.jpg', path: '/tmp' }))).content, /\/tmp\/frames\/frame_01.jpg/)
  assert.match((await execute(call('grep', { pattern: '林风', path: '/tmp' }))).content, /\/tmp\/notes.txt: Line 2: 林风/)
  await execute(call('write', { path: '/tmp/output/result.txt', content: '完成' }))
  await execute(call('edit', { path: '/tmp/notes.txt', oldString: '林风', newString: '陆川' }))

  assert.ok(calls.some(call => call.command === 'dev_list_external_files'))
  assert.ok(calls.some(call => call.command === 'dev_write_external_file' && call.payload.input.path === '/tmp/output/result.txt'))
  assert.ok(calls.some(call => call.command === 'dev_replace_in_external_file' && call.payload.input.path === '/tmp/notes.txt'))
})

test('desktop project tools keep malformed local Skill paths out of the project reader', async () => {
  const execute = createDesktopProjectToolExecutor({
    projectDir: '/fixture',
    invoke: fixtureInvoke,
    loadSkill: async () => ({
      content: '# local video workflow',
      resources: ['references/prop-format.md'],
      readResource: async () => '',
    }),
  })
  await execute(call('skill', { name: 'JC-反推视频提示词' }))

  await assert.rejects(
    () => execute(call('read', { path: 'skill://local/JC-反推视频提示词/references/prop-format.md' })),
    /Skill 资源路径不匹配.*references\/prop-format\.md/,
  )
})

test('desktop creative terminal runs a project command through the existing Tauri executor', async () => {
  const calls: Array<{ command: string; payload: any }> = []
  const execute = createDesktopProjectToolExecutor({
    projectDir: '/fixture',
    invoke: async (command, payload) => {
      calls.push({ command, payload })
      return { command: 'ffmpeg -version', exitCode: 0, stdout: 'ffmpeg version test', stderr: '', durationMs: 12 }
    },
  })

  const result = await execute(call('terminal', { command: 'ffmpeg -version' }))

  assert.equal(calls[0]?.command, 'dev_run_command')
  assert.equal(calls[0]?.payload.input.root, '/fixture')
  assert.equal(calls[0]?.payload.input.workdir, '.')
  assert.match(result.content, /Exit code: 0/)
  assert.match(result.content, /ffmpeg version test/)
})

test('desktop creative terminal passes a full shell command to Tauri after the chat approval', async () => {
  let request: any
  const execute = createDesktopProjectToolExecutor({
    projectDir: '/fixture',
    invoke: async (_command, payload) => {
      request = payload.input
      return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 }
    },
  })

  await execute(call('terminal', { command: 'mkdir -p /tmp/frames && ffmpeg -version' }))

  assert.equal(request.command, 'mkdir -p /tmp/frames && ffmpeg -version')
})

test('desktop creative terminal resolves an attachment token without exposing its cache path', async () => {
  let request: any
  const execute = createDesktopProjectToolExecutor({
    projectDir: '/fixture',
    attachments: [{ name: 'clip.mp4', inputPath: '/private/media-cache/clip.mp4' }],
    invoke: async (_command, payload) => {
      request = payload.input
      return { exitCode: 0, stdout: 'frame written', stderr: 'Input #0, from /private/media-cache/clip.mp4:', durationMs: 5 }
    },
  })

  const result = await execute(call('terminal', { command: 'ffmpeg -i {{attachment:clip.mp4}} jc-media/frame.jpg' }))

  assert.match(request.command, /\/private\/media-cache\/clip\.mp4/)
  assert.doesNotMatch(result.content, /\/private\/media-cache/)
  assert.match(result.content, /\{\{attachment:clip\.mp4\}\}/)
})

test('desktop creative terminal reports a nonzero exit as failed', async () => {
  const execute = createDesktopProjectToolExecutor({
    projectDir: '/fixture',
    invoke: async () => ({ exitCode: 1, stdout: '', stderr: 'ffmpeg failed', durationMs: 5 }),
  })

  const result = await execute(call('terminal', { command: 'ffmpeg -version' }))

  assert.equal(result.status, 'failed')
})

test('desktop creative terminal accepts an approved external working directory', async () => {
  let request: any
  const execute = createDesktopProjectToolExecutor({
    projectDir: '/fixture',
    invoke: async (_command, payload) => {
      request = payload.input
      return { exitCode: 0, stdout: '', stderr: '', durationMs: 1 }
    },
  })

  await execute(call('terminal', { command: 'ls', workdir: '/tmp/frames' }))

  assert.equal(request.workdir, undefined)
  assert.equal(request.externalWorkdir, '/tmp/frames')
})

test('desktop creative terminal blocks only an immediate identical retry after failure', async () => {
  const commands: string[] = []
  const execute = createDesktopProjectToolExecutor({
    projectDir: '/fixture',
    invoke: async (_command, payload) => {
      const command = payload.input.command as string
      commands.push(command)
      return command === 'repair-environment'
        ? { exitCode: 0, stdout: 'ready', stderr: '', durationMs: 1 }
        : { exitCode: 8, stdout: '', stderr: 'feature unavailable', durationMs: 1 }
    },
  })

  await execute(call('terminal', { command: 'extract-frame' }))
  const repeated = await execute(call('terminal', { command: 'extract-frame' }))
  await execute(call('terminal', { command: 'repair-environment' }))
  await execute(call('terminal', { command: 'extract-frame' }))

  assert.match(repeated.content, /不要原样重复/)
  assert.deepEqual(commands, ['extract-frame', 'repair-environment', 'extract-frame'])
})
