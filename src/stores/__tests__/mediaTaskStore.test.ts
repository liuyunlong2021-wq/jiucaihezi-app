import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { buildCreationRunPlan } from '@/runtime/creation/creationMediaPlan'
import { __resetApiKeyMemoryCacheForTests } from '@/services/newApiClient'
import { useProjectStore } from '@/stores/projectStore'
import * as eventBus from '@/utils/eventBus'
import { webProjectFiles } from '@/utils/webProjectFiles'
import {
  __setCreationSubmitExecutorForTests,
  __setMediaTaskSaverForTests,
  useMediaTaskStore,
} from '../mediaTaskStore'

function installLocalStorage(values: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(values))
  const previous = (globalThis as any).localStorage
  const previousWindow = (globalThis as any).window
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  }
  ;(globalThis as any).window = {
    __TAURI_INTERNALS__: undefined,
    location: { href: 'http://localhost/' },
  }
  return {
    restore() {
      ;(globalThis as any).localStorage = previous
      ;(globalThis as any).window = previousWindow
    },
  }
}

interface TauriTaskFileStore {
  calls: Array<{ command: string; root: string; path: string }>
  downloads: string[]
  get(root: string, path: string): string | undefined
  set(root: string, path: string, content: string): void
  restore(): void
}

function installTauriTaskFileStore(): TauriTaskFileStore {
  const contents = new Map<string, Map<string, string>>()
  const calls: Array<{ command: string; root: string; path: string }> = []
  const downloads: string[] = []
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

  function projectContents(root: string): Map<string, string> {
    let files = contents.get(root)
    if (!files) {
      files = new Map()
      contents.set(root, files)
    }
    return files
  }

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      isTauri: true,
      __TAURI_INTERNALS__: {
        async invoke(
          command: string,
          args: {
            input?: Record<string, string>
            paths?: string[]
            request?: { url?: string }
          } = {},
        ) {
          if (command === 'http_download_base64') {
            downloads.push(args.request?.url || '')
            return { status: 200, data_base64: 'cG5n', headers: { 'content-type': 'image/png' } }
          }
          if (command === 'http_request') {
            const url = args.request?.url || ''
            if (url.endsWith('/rh/tasks/targeted-owner')) {
              return {
                status: 200,
                body: JSON.stringify({
                  status: 'success',
                  url: 'https://webstatic.aiproxy.vip/output/resumed-targeted-owner.png',
                }),
                headers: { 'content-type': 'application/json' },
              }
            }
            if (url.endsWith('/rh/tasks/legacy-targeted')) {
              return {
                status: 200,
                body: JSON.stringify({
                  status: 'success',
                  url: 'https://webstatic.aiproxy.vip/output/legacy-targeted.png',
                }),
                headers: { 'content-type': 'application/json' },
              }
            }
            throw new Error(`unexpected Rust HTTP request: ${url}`)
          }
          if (command === 'plugin:path|join') return (args.paths || []).join('/')

          const input = args.input || {}
          const root = input.root || ''
          const path = input.relativePath || input.targetRelativePath || ''
          calls.push({ command, root, path })
          const files = projectContents(root)

          if (command === 'dev_write_file_bytes') {
            files.set(
              input.relativePath || '',
              Buffer.from(input.dataBase64 || '', 'base64').toString('utf8'),
            )
            return
          }
          if (command === 'dev_file_exists') return files.has(input.relativePath || '')
          if (command === 'dev_read_file') {
            const content = files.get(input.relativePath || '')
            if (content === undefined) throw new Error(`文件不存在: ${input.relativePath}`)
            return { content, truncated: false }
          }
          if (command === 'dev_replace_file') {
            const content = files.get(input.temporaryRelativePath || '')
            if (content === undefined) throw new Error('temporary canvas file missing')
            files.delete(input.temporaryRelativePath || '')
            files.set(input.targetRelativePath || '', content)
            return
          }
          throw new Error(`unexpected Tauri command: ${command}`)
        },
      },
    },
  })

  return {
    calls,
    downloads,
    get(root, path) {
      return contents.get(root)?.get(path)
    },
    set(root, path, content) {
      projectContents(root).set(path, content)
    },
    restore() {
      if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
      else Reflect.deleteProperty(globalThis, 'window')
    },
  }
}

function targetedCanvasDocument(canvasId: string) {
  return JSON.stringify({
    version: 2,
    canvasId,
    updatedAt: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
    scene: [],
    assets: {},
  })
}

interface WebTaskFileStore {
  binaryWrites: Array<{
    projectId: string
    path: string
    blob: Blob
    options: Record<string, unknown>
  }>
  canvasWrites: Array<{ projectId: string; path: string; content: string }>
  setCanvas(projectId: string, path: string, content: string): void
  canvas(projectId: string, path: string): string | undefined
  holdBinaryWrites(): void
  releaseBinaryWrites(): void
  completedBinaryWrites(): number
  restore(): void
}

function installWebTaskFileStore(): WebTaskFileStore {
  const binaryWrites: WebTaskFileStore['binaryWrites'] = []
  const canvasWrites: WebTaskFileStore['canvasWrites'] = []
  const canvases = new Map<string, string>()
  const originalWriteBinary = webProjectFiles.writeBinary
  const originalRead = webProjectFiles.read
  const originalWrite = webProjectFiles.write
  let holdWrites = false
  let releaseWrites: () => void = () => {}
  let writeGate = new Promise<void>(resolve => {
    releaseWrites = resolve
  })
  let binaryWriteCompletions = 0

  webProjectFiles.writeBinary = async (projectId, path, source, options) => {
    assert.equal(source instanceof Blob, true, 'Web creation persistence must write a Blob')
    const blob = source as Blob
    binaryWrites.push({ projectId, path, blob, options: options as Record<string, unknown> })
    if (holdWrites) await writeGate
    binaryWriteCompletions++
    return {
      id: `webfile_${projectId}_${path}`,
      name: path.split('/').pop() || 'creation',
      category: options.category,
      mimeType: options.mimeType,
      size: blob.size,
      content: '',
      metadata: { binaryStorage: 'opfs', projectId, relativePath: path },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any
  }
  webProjectFiles.read = async (projectId, path) => {
    const content = canvases.get(`${projectId}:${path}`)
    if (content === undefined) throw new Error(`文件不存在: ${path}`)
    return {
      id: `canvas_${projectId}_${path}`,
      name: path.split('/').pop() || 'canvas',
      category: 'text',
      mimeType: 'application/json',
      size: content.length,
      content,
      metadata: { projectId, relativePath: path },
      createdAt: 1,
      updatedAt: 1,
    } as any
  }
  webProjectFiles.write = async (projectId, path, content) => {
    canvases.set(`${projectId}:${path}`, content)
    canvasWrites.push({ projectId, path, content })
    return {
      id: `canvas_${projectId}_${path}`,
      name: path.split('/').pop() || 'canvas',
      category: 'text',
      mimeType: 'application/json',
      size: content.length,
      content,
      metadata: { projectId, relativePath: path },
      createdAt: 1,
      updatedAt: Date.now(),
    } as any
  }

  return {
    binaryWrites,
    canvasWrites,
    setCanvas(projectId, path, content) {
      canvases.set(`${projectId}:${path}`, content)
    },
    canvas(projectId, path) {
      return canvases.get(`${projectId}:${path}`)
    },
    holdBinaryWrites() {
      holdWrites = true
      writeGate = new Promise<void>(resolve => {
        releaseWrites = resolve
      })
    },
    releaseBinaryWrites() {
      holdWrites = false
      releaseWrites()
    },
    completedBinaryWrites() {
      return binaryWriteCompletions
    },
    restore() {
      webProjectFiles.writeBinary = originalWriteBinary
      webProjectFiles.read = originalRead
      webProjectFiles.write = originalWrite
    },
  }
}

function installWebCreationTestEnvironment(projectId = 'web-test-project') {
  const projectStore = useProjectStore()
  const originalProjectId = projectStore.webProjectId.value
  const originalProjectName = projectStore.webProjectName.value
  const previousFetch = globalThis.fetch
  const files = installWebTaskFileStore()

  projectStore.webProjectId.value = projectId
  projectStore.webProjectName.value = 'Web 测试项目'
  globalThis.fetch = async () =>
    new Response(new Blob(['fixture'], { type: 'image/png' }), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })

  return {
    files,
    restore() {
      globalThis.fetch = previousFetch
      projectStore.webProjectId.value = originalProjectId
      projectStore.webProjectName.value = originalProjectName
      files.restore()
    },
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (condition()) return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('timed out waiting for task completion')
}

async function withImmediateTimers<T>(fn: () => Promise<T>): Promise<T> {
  const previousSetTimeout = globalThis.setTimeout
  ;(globalThis as any).setTimeout = (
    handler: (...args: unknown[]) => void,
    _timeout?: number,
    ...args: unknown[]
  ) => {
    queueMicrotask(() => handler(...args))
    return 0
  }
  try {
    return await fn()
  } finally {
    globalThis.setTimeout = previousSetTimeout
  }
}

test('mediaTaskStore validates result URLs before publishing successful tasks', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')

  assert.equal(source.includes('function validateTaskInputs'), true)
  assert.equal(source.includes('validateTaskInputs(params)'), true)
  assert.equal(
    source.includes("import { isAllowedCreationResultUrl } from '@/utils/urlSafety'"),
    true,
  )
  assert.equal(source.includes('function assertSafeResultUrl'), true)
  assert.equal(source.includes("throw new Error('媒体结果地址不安全，已阻止展示')"), true)
  assert.equal(source.includes('const safeMediaUrl = assertSafeResultUrl(mediaUrl)'), true)
  assert.equal(source.includes('const safeResultUrl = assertSafeResultUrl(resultUrl)'), true)
  assert.equal(source.includes('task.resultUrl = safeResultUrl'), true)
})

test('mediaTaskStore polls async media results before URL safety validation', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')

  assert.match(source, /if \(!resultUrl && result\?\.pollUrl && result\?\.pollKind\)/)
  assert.match(source, /resultUrl = await pollTask\(result\.pollUrl, result\.pollKind, onProgress/)
  assert.equal(
    source.indexOf('resultUrl = await pollTask(result.pollUrl, result.pollKind, onProgress') <
      source.indexOf('const safeResultUrl = assertSafeResultUrl(resultUrl)'),
    true,
  )
})

test('mediaTaskStore waits for initialization before submitting a new task', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')

  assert.match(
    source,
    /async function submitTask\(params: MediaTaskSubmitParams\): Promise<string> \{\s+const capturedProjectId = captureWebCreationProjectId\(params\)\s+await init\(\)/,
  )
})

test('mediaTaskStore uses the immutable canvas target owner for Desktop result persistence', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')

  assert.match(source, /function canvasTaskOwner\(task: MediaTask\): string \| undefined/)
  assert.match(source, /canvasWriteStatus\?: 'pending' \| 'written' \| 'unwritten'/)
  assert.match(source, /const canvasOwner = canvasTaskOwner\(task\)/)
  assert.match(
    source,
    /if \(task\.canvasTarget && !canvasOwner\) \{\s+markCanvasWriteUnwritten\(task\)\s+return/,
  )
  assert.match(source, /const projectDir = canvasOwner \|\| useProjectStore\(\)\.projectDir\.value/)
  assert.match(source, /writeProjectMedia\(\{[\s\S]*?projectDir,/)
  assert.match(source, /const webRuntime = !isTauriRuntime\(\)/)
  assert.match(source, /String\(task\.projectId \|\| ''\)/)
  assert.match(source, /String\(task\.projectPath \|\| ''\)/)
  assert.match(source, /task\.assetUri && owner && task\.assetUri\.startsWith\(`\$\{owner\}\/`\)/)
  assert.match(source, /await emitEventAsync\('canvas:before-task-write', payload\)/)
  assert.match(
    source,
    /const document = await writeCanvasTaskResult\(task\.canvasTarget, relativeAssetPath, owner\)/,
  )
  assert.match(
    source,
    /await emitEventAsync\('canvas:task-result', \{ target: task\.canvasTarget, document, owner, release \}\)/,
  )
  assert.match(source, /canvasWriteStatus: params\.canvasTarget \? 'pending' : undefined/)
})

test(
  'mediaTaskStore keeps a targeted Desktop result with its submission owner after a project switch',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    const files = installTauriTaskFileStore()
    const projectStore = useProjectStore()
    const originalProjectDir = projectStore.projectDir.value
    const ownerA = '/projects/a'
    const ownerB = '/projects/b'
    const canvasPath = 'jc-canvas/shared.jccanvas'
    const canvasId = 'shared-canvas'

    files.set(ownerA, canvasPath, targetedCanvasDocument(canvasId))
    files.set(ownerB, canvasPath, targetedCanvasDocument(canvasId))
    projectStore.projectDir.value = ownerA
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()
    __setCreationSubmitExecutorForTests(async () => {
      projectStore.projectDir.value = ownerB
      return { url: 'https://webstatic.aiproxy.vip/output/targeted-owner.png', type: 'image' }
    })

    try {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/api/rh-gpt2-image',
        params: {
          prompt: '保持项目 A',
          aspectRatio: '16:9',
          images: ['https://cdn.jiucaihezi.studio/input.png'],
        },
      })
      const taskId = await store.submitTask({
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: '图片模型',
        prompt: '保持项目 A',
        source: 'creation',
        plan,
        canvasTarget: {
          canvasId,
          canvasPath,
          owner: ownerA,
          operation: 'append',
          referenceNodeIds: [],
        },
      })

      await waitFor(() => store.getTask(taskId)?.canvasWriteStatus !== 'pending')
      const task = store.getTask(taskId)
      const ownerACanvas = JSON.parse(files.get(ownerA, canvasPath) || '{}')
      const ownerBCanvas = JSON.parse(files.get(ownerB, canvasPath) || '{}')

      assert.equal(task?.canvasTarget?.owner, ownerA)
      assert.equal(task?.assetUri?.startsWith(`${ownerA}/jc-media/images/`), true)
      assert.equal(task?.canvasWriteStatus, 'written')
      assert.equal(ownerACanvas.scene.length, 1)
      assert.equal(ownerBCanvas.scene.length, 0)
      assert.equal(
        files.calls.some(call => call.root === ownerB && call.path.startsWith('jc-media/images/')),
        false,
      )
    } finally {
      __setCreationSubmitExecutorForTests(null)
      files.restore()
      projectStore.projectDir.value = originalProjectDir
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore resumes a targeted task with its persisted Desktop owner',
  { concurrency: false },
  async () => {
    const ownerA = '/projects/a'
    const ownerB = '/projects/b'
    const canvasPath = 'jc-canvas/shared.jccanvas'
    const canvasId = 'shared-canvas'
    const storage = installLocalStorage({
      jc_media_tasks_v1: JSON.stringify([
        {
          id: 'mtask_targeted_resume',
          type: 'image',
          model: 'rh-gpt2-image',
          modelLabel: '图片模型',
          prompt: '恢复到 A',
          referenceImages: [],
          status: 'running',
          progress: 25,
          progressText: '生成中...',
          createdAt: 1,
          source: 'creation',
          pollUrl: '/rh/tasks/targeted-owner',
          pollKind: 'image',
          canvasTarget: {
            canvasId,
            canvasPath,
            owner: ownerA,
            operation: 'append',
            referenceNodeIds: [],
          },
        },
      ]),
    })
    const files = installTauriTaskFileStore()
    const projectStore = useProjectStore()
    const originalProjectDir = projectStore.projectDir.value

    files.set(ownerA, canvasPath, targetedCanvasDocument(canvasId))
    files.set(ownerB, canvasPath, targetedCanvasDocument(canvasId))
    projectStore.projectDir.value = ownerB
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()

    try {
      await withImmediateTimers(async () => {
        await store.init()
        await waitFor(() => store.getTask('mtask_targeted_resume')?.canvasWriteStatus !== 'pending')
      })
      const task = store.getTask('mtask_targeted_resume')
      const ownerACanvas = JSON.parse(files.get(ownerA, canvasPath) || '{}')
      const ownerBCanvas = JSON.parse(files.get(ownerB, canvasPath) || '{}')

      assert.equal(task?.assetUri?.startsWith(`${ownerA}/jc-media/images/`), true)
      assert.equal(task?.canvasWriteStatus, 'written')
      assert.equal(ownerACanvas.scene.length, 1)
      assert.equal(ownerBCanvas.scene.length, 0)
    } finally {
      files.restore()
      projectStore.projectDir.value = originalProjectDir
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore requires an active Web project before sending a creation task',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    const projectStore = useProjectStore()
    const originalProjectId = projectStore.webProjectId.value
    const originalProjectName = projectStore.webProjectName.value
    let sent = false

    projectStore.webProjectId.value = ''
    projectStore.webProjectName.value = ''
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    __setCreationSubmitExecutorForTests(async () => {
      sent = true
      return { url: 'https://webstatic.aiproxy.vip/output/should-not-send.png', type: 'image' }
    })

    try {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/api/rh-gpt2-image',
        params: {
          prompt: '没有项目不能发送',
          aspectRatio: '16:9',
          images: ['https://cdn.jiucaihezi.studio/input.png'],
        },
      })
      await assert.rejects(
        () =>
          useMediaTaskStore().submitTask({
            type: 'image',
            model: 'rh-gpt2-image',
            modelLabel: '图片模型',
            prompt: '没有项目不能发送',
            source: 'creation',
            plan,
          }),
        /请先选择 Web 项目/,
      )
      assert.equal(sent, false)
    } finally {
      __setCreationSubmitExecutorForTests(null)
      projectStore.webProjectId.value = originalProjectId
      projectStore.webProjectName.value = originalProjectName
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore freezes the Web project when creation submission starts',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    const files = installWebTaskFileStore()
    const projectStore = useProjectStore()
    const originalProjectId = projectStore.webProjectId.value
    const originalProjectName = projectStore.webProjectName.value
    const previousFetch = globalThis.fetch
    const projectA = 'web-project-a'
    const projectB = 'web-project-b'

    projectStore.webProjectId.value = projectA
    projectStore.webProjectName.value = '项目 A'
    globalThis.fetch = async (input: RequestInfo | URL) => {
      assert.equal(String(input), 'https://webstatic.aiproxy.vip/output/submit-start-owner.png')
      return new Response(new Blob(['submit-start-owner'], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    }
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()
    __setCreationSubmitExecutorForTests(async () => ({
      url: 'https://webstatic.aiproxy.vip/output/submit-start-owner.png',
      type: 'image',
    }))

    try {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/api/rh-gpt2-image',
        params: {
          prompt: '提交时固定项目',
          aspectRatio: '16:9',
          images: ['https://cdn.jiucaihezi.studio/input.png'],
        },
      })
      const taskIdPromise = store.submitTask({
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: '图片模型',
        prompt: '提交时固定项目',
        source: 'creation',
        plan,
      })

      projectStore.webProjectId.value = projectB
      projectStore.webProjectName.value = '项目 B'

      const taskId = await taskIdPromise
      assert.equal(store.getTask(taskId)?.projectId, projectA)
      await waitFor(() => store.getTask(taskId)?.status === 'success')
      assert.equal(files.binaryWrites[0]?.projectId, projectA)
    } finally {
      __setCreationSubmitExecutorForTests(null)
      globalThis.fetch = previousFetch
      projectStore.webProjectId.value = originalProjectId
      projectStore.webProjectName.value = originalProjectName
      files.restore()
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore writes a Web creation result to the project captured before a project switch',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    const files = installWebTaskFileStore()
    const projectStore = useProjectStore()
    const originalProjectId = projectStore.webProjectId.value
    const originalProjectName = projectStore.webProjectName.value
    const previousFetch = globalThis.fetch
    const projectA = 'web-project-a'
    const projectB = 'web-project-b'
    const resultUrl = 'https://webstatic.aiproxy.vip/output/project-switch.webp'

    projectStore.webProjectId.value = projectA
    projectStore.webProjectName.value = '项目 A'
    files.holdBinaryWrites()
    globalThis.fetch = async (input: RequestInfo | URL) => {
      assert.equal(String(input), resultUrl)
      return new Response(new Blob(['web-result'], { type: 'image/webp' }), {
        status: 200,
        headers: { 'content-type': 'image/webp' },
      })
    }
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()
    __setCreationSubmitExecutorForTests(async () => {
      projectStore.webProjectId.value = projectB
      projectStore.webProjectName.value = '项目 B'
      return { url: resultUrl, type: 'image' }
    })

    try {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/api/rh-gpt2-image',
        params: {
          prompt: '项目 A 的 WebP',
          aspectRatio: '16:9',
          images: ['https://cdn.jiucaihezi.studio/input.png'],
        },
      })
      const taskId = await store.submitTask({
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: '图片模型',
        prompt: '项目 A 的 WebP',
        source: 'creation',
        plan,
      })

      assert.equal(store.getTask(taskId)?.projectId, projectA)
      await waitFor(() => files.binaryWrites.length === 1)
      assert.notEqual(store.getTask(taskId)?.assetStatus, 'local')

      files.releaseBinaryWrites()
      await waitFor(() => store.getTask(taskId)?.status === 'success')
      const task = store.getTask(taskId)
      const write = files.binaryWrites[0]

      assert.equal(write.projectId, projectA)
      assert.match(write.path, /^jc-media\/images\/.+\.webp$/)
      assert.equal(write.options.mimeType, 'image/webp')
      assert.equal(task?.projectPath, write.path)
      assert.equal(task?.assetStatus, 'local')
      assert.equal(task?.assetUri, undefined)
      assert.equal(task?.resultUrl, resultUrl)
    } finally {
      __setCreationSubmitExecutorForTests(null)
      globalThis.fetch = previousFetch
      projectStore.webProjectId.value = originalProjectId
      projectStore.webProjectName.value = originalProjectName
      files.restore()
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore keeps a Web creation task cancelled while its binary write is pending',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    const files = installWebTaskFileStore()
    const projectStore = useProjectStore()
    const originalProjectId = projectStore.webProjectId.value
    const originalProjectName = projectStore.webProjectName.value
    const previousFetch = globalThis.fetch
    const resultUrl = 'https://webstatic.aiproxy.vip/output/cancelled-persistence.png'
    let completionEvents = 0
    const offComplete = eventBus.onEvent('media-task-complete', () => {
      completionEvents++
    })

    projectStore.webProjectId.value = 'web-project-a'
    projectStore.webProjectName.value = '项目 A'
    files.holdBinaryWrites()
    globalThis.fetch = async (input: RequestInfo | URL) => {
      assert.equal(String(input), resultUrl)
      return new Response(new Blob(['cancelled-persistence'], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    }
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()
    __setCreationSubmitExecutorForTests(async () => ({ url: resultUrl, type: 'image' }))

    try {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/api/rh-gpt2-image',
        params: {
          prompt: '取消等待中的保存',
          aspectRatio: '16:9',
          images: ['https://cdn.jiucaihezi.studio/input.png'],
        },
      })
      const taskId = await store.submitTask({
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: '图片模型',
        prompt: '取消等待中的保存',
        source: 'creation',
        plan,
      })

      await waitFor(() => files.binaryWrites.length === 1)
      store.cancelTask(taskId)
      files.releaseBinaryWrites()
      await waitFor(() => files.completedBinaryWrites() === 1)

      assert.equal(store.getTask(taskId)?.status, 'cancelled')
      assert.equal(completionEvents, 0)
    } finally {
      files.releaseBinaryWrites()
      offComplete()
      __setCreationSubmitExecutorForTests(null)
      globalThis.fetch = previousFetch
      projectStore.webProjectId.value = originalProjectId
      projectStore.webProjectName.value = originalProjectName
      files.restore()
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore resumes a Web creation result into its persisted project',
  { concurrency: false },
  async () => {
    const projectA = 'web-project-a'
    const projectB = 'web-project-b'
    const resultUrl = 'https://webstatic.aiproxy.vip/output/resumed-project-a.png'
    const storage = installLocalStorage({
      jc_media_tasks_v1: JSON.stringify([
        {
          id: 'mtask_web_resume_a',
          type: 'image',
          model: 'rh-gpt2-image',
          modelLabel: '图片模型',
          prompt: '恢复到 Web 项目 A',
          referenceImages: [],
          status: 'running',
          progress: 25,
          progressText: '生成中...',
          createdAt: 1,
          source: 'creation',
          projectId: projectA,
          pollUrl: '/rh/tasks/web-project-a',
          pollKind: 'image',
          assetStatus: 'pending',
        },
      ]),
    })
    const files = installWebTaskFileStore()
    const projectStore = useProjectStore()
    const originalProjectId = projectStore.webProjectId.value
    const originalProjectName = projectStore.webProjectName.value
    const previousFetch = globalThis.fetch
    let markPollStarted: () => void = () => {}
    const pollStarted = new Promise<void>(resolve => {
      markPollStarted = resolve
    })
    let offSettled: () => void = () => {}
    const settled = new Promise<string>(resolve => {
      offSettled = eventBus.onEvent('media-task-settled', payload => {
        if ((payload as { taskId?: string }).taskId === 'mtask_web_resume_a') {
          resolve(String((payload as { status?: string }).status || ''))
        }
      })
    })
    let markSuccessPersisted: () => void = () => {}
    const successPersisted = new Promise<void>(resolve => {
      markSuccessPersisted = resolve
    })

    projectStore.webProjectId.value = projectB
    projectStore.webProjectName.value = '项目 B'
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/rh/tasks/web-project-a')) {
        markPollStarted()
        return Response.json({ status: 'success', url: resultUrl })
      }
      if (url === resultUrl) {
        return new Response(new Blob(['resumed'], { type: 'image/png' }), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    }
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    __setMediaTaskSaverForTests(async tasks => {
      if (tasks.some(task => task.id === 'mtask_web_resume_a' && task.status === 'success'))
        markSuccessPersisted()
    })
    const store = useMediaTaskStore()

    try {
      await withImmediateTimers(async () => {
        await store.init()
        await pollStarted
        assert.equal(await settled, 'success')
        await successPersisted
      })
      const task = store.getTask('mtask_web_resume_a')

      assert.equal(files.binaryWrites.length, 1)
      assert.equal(files.binaryWrites[0].projectId, projectA)
      assert.equal(files.binaryWrites[0].path, task?.projectPath)
      assert.equal(
        files.binaryWrites.some(write => write.projectId === projectB),
        false,
      )
      assert.match(task?.projectPath || '', /^jc-media\/images\/.+\.png$/)
      assert.equal(task?.assetStatus, 'local')
    } finally {
      __setMediaTaskSaverForTests(null)
      offSettled()
      globalThis.fetch = previousFetch
      projectStore.webProjectId.value = originalProjectId
      projectStore.webProjectName.value = originalProjectName
      files.restore()
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore writes a Web canvas result with its persisted project path',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    const files = installWebTaskFileStore()
    const projectStore = useProjectStore()
    const originalProjectId = projectStore.webProjectId.value
    const originalProjectName = projectStore.webProjectName.value
    const previousFetch = globalThis.fetch
    const projectA = 'web-project-a'
    const projectB = 'web-project-b'
    const canvasId = 'web-target-canvas'
    const canvasPath = 'jc-canvas/web-target.jccanvas'
    const resultUrl = 'https://webstatic.aiproxy.vip/output/web-canvas.png'

    files.setCanvas(projectA, canvasPath, targetedCanvasDocument(canvasId))
    files.setCanvas(projectB, canvasPath, targetedCanvasDocument(canvasId))
    projectStore.webProjectId.value = projectA
    projectStore.webProjectName.value = '项目 A'
    globalThis.fetch = async (input: RequestInfo | URL) => {
      assert.equal(String(input), resultUrl)
      return new Response(new Blob(['canvas-result'], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    }
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()
    __setCreationSubmitExecutorForTests(async () => {
      projectStore.webProjectId.value = projectB
      projectStore.webProjectName.value = '项目 B'
      return { url: resultUrl, type: 'image' }
    })

    try {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/api/rh-gpt2-image',
        params: {
          prompt: '写回 Web 画布',
          aspectRatio: '16:9',
          images: ['https://cdn.jiucaihezi.studio/input.png'],
        },
      })
      const taskId = await store.submitTask({
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: '图片模型',
        prompt: '写回 Web 画布',
        source: 'creation',
        plan,
        canvasTarget: {
          canvasId,
          canvasPath,
          owner: projectA,
          operation: 'append',
          referenceNodeIds: [],
        },
      })

      await waitFor(() => store.getTask(taskId)?.canvasWriteStatus === 'written')
      const task = store.getTask(taskId)
      const canvas = JSON.parse(files.canvas(projectA, canvasPath) || '{}')

      assert.equal(
        files.canvasWrites.some(write => write.projectId === projectA && write.path === canvasPath),
        true,
      )
      assert.equal(
        files.canvasWrites.some(write => write.projectId === projectB),
        false,
      )
      assert.equal(task?.canvasWriteStatus, 'written')
      assert.equal(canvas.scene.length, 1)
      assert.equal(canvas.assets[canvas.scene[0].id].path, task?.projectPath)
    } finally {
      __setCreationSubmitExecutorForTests(null)
      globalThis.fetch = previousFetch
      projectStore.webProjectId.value = originalProjectId
      projectStore.webProjectName.value = originalProjectName
      files.restore()
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore reports Web media persistence failures without publishing a successful result',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    const files = installWebTaskFileStore()
    const projectStore = useProjectStore()
    const originalProjectId = projectStore.webProjectId.value
    const originalProjectName = projectStore.webProjectName.value
    const previousFetch = globalThis.fetch
    const resultUrl = 'https://webstatic.aiproxy.vip/output/cors-failure.png'
    let completionEvents = 0
    let canvasEvents = 0
    const offComplete = eventBus.onEvent('media-task-complete', () => {
      completionEvents++
    })
    const offCanvas = eventBus.onEvent('canvas:task-result', () => {
      canvasEvents++
    })

    projectStore.webProjectId.value = 'web-project-a'
    projectStore.webProjectName.value = '项目 A'
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch')
    }
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()
    __setCreationSubmitExecutorForTests(async () => ({ url: resultUrl, type: 'image' }))

    try {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/api/rh-gpt2-image',
        params: {
          prompt: '跨域保存失败',
          aspectRatio: '16:9',
          images: ['https://cdn.jiucaihezi.studio/input.png'],
        },
      })
      const taskId = await store.submitTask({
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: '图片模型',
        prompt: '跨域保存失败',
        source: 'creation',
        plan,
      })

      await waitFor(() => store.getTask(taskId)?.status === 'failed')
      const task = store.getTask(taskId)

      assert.equal(task?.assetStatus, 'failed')
      assert.equal(task?.resultUrl, resultUrl)
      assert.match(task?.errorMsg || '', /保存到项目失败/)
      assert.equal(completionEvents, 0)
      assert.equal(canvasEvents, 0)
      assert.equal(files.binaryWrites.length, 0)
    } finally {
      offComplete()
      offCanvas()
      __setCreationSubmitExecutorForTests(null)
      globalThis.fetch = previousFetch
      projectStore.webProjectId.value = originalProjectId
      projectStore.webProjectName.value = originalProjectName
      files.restore()
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore reports rejected Web binary writes without publishing a successful result',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    const files = installWebTaskFileStore()
    const projectStore = useProjectStore()
    const originalProjectId = projectStore.webProjectId.value
    const originalProjectName = projectStore.webProjectName.value
    const previousFetch = globalThis.fetch
    const resultUrl = 'https://webstatic.aiproxy.vip/output/opfs-write-failure.png'
    let completionEvents = 0
    const offComplete = eventBus.onEvent('media-task-complete', () => {
      completionEvents++
    })

    projectStore.webProjectId.value = 'web-project-a'
    projectStore.webProjectName.value = '项目 A'
    globalThis.fetch = async (input: RequestInfo | URL) => {
      assert.equal(String(input), resultUrl)
      return new Response(new Blob(['opfs-write-failure'], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    }
    webProjectFiles.writeBinary = async () => {
      throw new Error('OPFS 配额不足')
    }
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()
    __setCreationSubmitExecutorForTests(async () => ({ url: resultUrl, type: 'image' }))

    try {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/api/rh-gpt2-image',
        params: {
          prompt: '写入 OPFS 失败',
          aspectRatio: '16:9',
          images: ['https://cdn.jiucaihezi.studio/input.png'],
        },
      })
      const taskId = await store.submitTask({
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: '图片模型',
        prompt: '写入 OPFS 失败',
        source: 'creation',
        plan,
      })

      await waitFor(() => store.getTask(taskId)?.status === 'failed')
      const task = store.getTask(taskId)

      assert.equal(task?.assetStatus, 'failed')
      assert.equal(task?.resultUrl, resultUrl)
      assert.match(task?.errorMsg || '', /保存到项目失败：OPFS 配额不足/)
      assert.equal(completionEvents, 0)
      assert.equal(files.binaryWrites.length, 0)
    } finally {
      offComplete()
      __setCreationSubmitExecutorForTests(null)
      globalThis.fetch = previousFetch
      projectStore.webProjectId.value = originalProjectId
      projectStore.webProjectName.value = originalProjectName
      files.restore()
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore retries a failed Web media persistence without resubmitting generation',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    const files = installWebTaskFileStore()
    const projectStore = useProjectStore()
    const originalProjectId = projectStore.webProjectId.value
    const originalProjectName = projectStore.webProjectName.value
    const previousFetch = globalThis.fetch
    const originalWriteBinary = webProjectFiles.writeBinary
    const resultUrl = 'https://webstatic.aiproxy.vip/output/retry-persistence.png'
    let binaryWriteAttempts = 0
    let generationSubmissions = 0

    projectStore.webProjectId.value = 'web-project-a'
    projectStore.webProjectName.value = '项目 A'
    globalThis.fetch = async (input: RequestInfo | URL) => {
      assert.equal(String(input), resultUrl)
      return new Response(new Blob(['retry-persistence'], { type: 'image/png' }), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    }
    webProjectFiles.writeBinary = async (...args) => {
      binaryWriteAttempts++
      if (binaryWriteAttempts === 1) throw new Error('OPFS 暂时不可用')
      return originalWriteBinary(...args)
    }
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()
    __setCreationSubmitExecutorForTests(async () => {
      generationSubmissions++
      return { url: resultUrl, type: 'image' }
    })

    try {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/api/rh-gpt2-image',
        params: {
          prompt: '重试项目保存',
          aspectRatio: '16:9',
          images: ['https://cdn.jiucaihezi.studio/input.png'],
        },
      })
      const taskId = await store.submitTask({
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: '图片模型',
        prompt: '重试项目保存',
        source: 'creation',
        plan,
      })

      await waitFor(() => store.getTask(taskId)?.status === 'failed')
      assert.equal(store.getTask(taskId)?.resultUrl, resultUrl)

      assert.equal(await store.retryWebMediaPersistence(taskId), true)
      assert.equal(store.getTask(taskId)?.status, 'success')
      assert.equal(store.getTask(taskId)?.assetStatus, 'local')
      assert.equal(binaryWriteAttempts, 2)
      assert.equal(generationSubmissions, 1)
      assert.equal(files.binaryWrites.length, 1)
    } finally {
      __setCreationSubmitExecutorForTests(null)
      globalThis.fetch = previousFetch
      projectStore.webProjectId.value = originalProjectId
      projectStore.webProjectName.value = originalProjectName
      files.restore()
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore writes Base64 creation images locally without HTTP download on Desktop',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    const files = installTauriTaskFileStore()
    const projectStore = useProjectStore()
    const originalProjectDir = projectStore.projectDir.value
    const projectDir = '/projects/base64-image'

    projectStore.projectDir.value = projectDir
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()
    const resultUrl = 'data:image/png;base64,cG5n'
    __setCreationSubmitExecutorForTests(async () => ({ url: resultUrl, type: 'image' }))

    try {
      const plan = buildCreationRunPlan({
        modelId: 'newapi/t8/gpt-image-2',
        params: { prompt: 'Base64 图片', ratio: '16:9', resolution: '2k' },
      })
      const taskId = await store.submitTask({
        type: 'image',
        model: 'gpt-image-2',
        modelLabel: 'GPT Image 2 · 直连',
        prompt: 'Base64 图片',
        source: 'creation',
        plan,
      })

      await waitFor(() => store.getTask(taskId)?.status === 'success')
      const task = store.getTask(taskId)

      assert.equal(files.downloads.length, 0)
      assert.equal(task?.resultUrl, resultUrl)
      assert.match(task?.assetUri || '', /^\/projects\/base64-image\/jc-media\/images\//)
      assert.equal(task?.assetStatus, 'local')
    } finally {
      __setCreationSubmitExecutorForTests(null)
      files.restore()
      projectStore.projectDir.value = originalProjectDir
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore leaves legacy targeted tasks without an owner unwritten',
  { concurrency: false },
  async () => {
    const ownerB = '/projects/b'
    const canvasPath = 'jc-canvas/shared.jccanvas'
    const canvasId = 'shared-canvas'
    const storage = installLocalStorage({
      jc_media_tasks_v1: JSON.stringify([
        {
          id: 'mtask_legacy_targeted',
          type: 'image',
          model: 'rh-gpt2-image',
          modelLabel: '图片模型',
          prompt: '旧任务',
          referenceImages: [],
          status: 'running',
          progress: 25,
          progressText: '生成中...',
          createdAt: 1,
          source: 'creation',
          pollUrl: '/rh/tasks/legacy-targeted',
          pollKind: 'image',
          canvasTarget: { canvasId, canvasPath, operation: 'append', referenceNodeIds: [] },
        },
      ]),
    })
    const files = installTauriTaskFileStore()
    const projectStore = useProjectStore()
    const originalProjectDir = projectStore.projectDir.value

    files.set(ownerB, canvasPath, targetedCanvasDocument(canvasId))
    projectStore.projectDir.value = ownerB
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()

    try {
      await withImmediateTimers(async () => {
        await store.init()
        await waitFor(() => store.getTask('mtask_legacy_targeted')?.canvasWriteStatus !== 'pending')
      })
      const task = store.getTask('mtask_legacy_targeted')
      const ownerBCanvas = JSON.parse(files.get(ownerB, canvasPath) || '{}')

      assert.equal(task?.canvasWriteStatus, 'unwritten')
      assert.equal(ownerBCanvas.scene.length, 0)
      assert.equal(
        files.calls.some(call => call.root === ownerB && call.path.startsWith('jc-media/images/')),
        false,
      )
    } finally {
      files.restore()
      projectStore.projectDir.value = originalProjectDir
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore retains a targeted task while its canvas write gate is pending',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    const files = installTauriTaskFileStore()
    const projectStore = useProjectStore()
    const originalProjectDir = projectStore.projectDir.value
    const owner = '/projects/pending-task'
    const canvasPath = 'jc-canvas/pending-task.jccanvas'
    const canvasId = 'pending-task-canvas'
    let releaseGate: () => void = () => {}
    let markGateStarted: () => void = () => {}
    const gateStarted = new Promise<void>(resolve => {
      markGateStarted = resolve
    })
    const gate = new Promise<void>(resolve => {
      releaseGate = resolve
    })
    const off = eventBus.onEvent('canvas:before-task-write', async () => {
      markGateStarted()
      await gate
    })

    files.set(owner, canvasPath, targetedCanvasDocument(canvasId))
    projectStore.projectDir.value = owner
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()
    __setCreationSubmitExecutorForTests(async () => ({
      url: 'https://webstatic.aiproxy.vip/output/pending-task.png',
      type: 'image',
    }))

    try {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/api/rh-gpt2-image',
        params: {
          prompt: '等待画布写入',
          aspectRatio: '16:9',
          images: ['https://cdn.jiucaihezi.studio/input.png'],
        },
      })
      const taskId = await store.submitTask({
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: '图片模型',
        prompt: '等待画布写入',
        source: 'creation',
        plan,
        canvasTarget: { canvasId, canvasPath, owner, operation: 'append', referenceNodeIds: [] },
      })

      await gateStarted
      store.deleteTask(taskId)
      store.clearFinished()

      assert.equal(store.getTask(taskId)?.canvasWriteStatus, 'pending')
      assert.equal(store.hasPendingCanvasWrite(owner, canvasPath), true)

      releaseGate()
      await waitFor(() => store.getTask(taskId)?.canvasWriteStatus === 'written')

      assert.equal(store.hasPendingCanvasWrite(owner, canvasPath), false)
      store.deleteTask(taskId)
      assert.equal(store.getTask(taskId), undefined)
    } finally {
      releaseGate()
      off()
      __setCreationSubmitExecutorForTests(null)
      files.restore()
      projectStore.projectDir.value = originalProjectDir
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore restores and projects persisted chat tasks only for their Desktop session',
  { concurrency: false },
  async () => {
    const savedTasks = [
      {
        id: 'mtask_session_one',
        type: 'image',
        model: 'gpt-image-1',
        modelLabel: '图片模型',
        prompt: '第一会话',
        referenceImages: [],
        status: 'success',
        progress: 100,
        progressText: '完成',
        createdAt: 1,
        source: 'chat',
        sessionId: 'ses_one',
        directory: '/project',
        resultUrl: 'https://webstatic.aiproxy.vip/one.png',
      },
      {
        id: 'mtask_session_two',
        type: 'image',
        model: 'gpt-image-1',
        modelLabel: '图片模型',
        prompt: '第二会话',
        referenceImages: [],
        status: 'success',
        progress: 100,
        progressText: '完成',
        createdAt: 2,
        source: 'chat',
        sessionId: 'ses_two',
        directory: '/project',
        resultUrl: 'https://webstatic.aiproxy.vip/two.png',
      },
      {
        id: 'mtask_empty_draft',
        type: 'image',
        model: 'gpt-image-1',
        modelLabel: '图片模型',
        prompt: '旧空草稿',
        referenceImages: [],
        status: 'success',
        progress: 100,
        progressText: '完成',
        createdAt: 3,
        source: 'chat',
        sessionId: '',
        directory: '/project',
        resultUrl: 'https://webstatic.aiproxy.vip/draft.png',
      },
      {
        id: 'mtask_legacy',
        type: 'image',
        model: 'gpt-image-1',
        modelLabel: '图片模型',
        prompt: '旧任务',
        referenceImages: [],
        status: 'success',
        progress: 100,
        progressText: '完成',
        createdAt: 4,
        source: 'chat',
        resultUrl: 'https://webstatic.aiproxy.vip/legacy.png',
      },
    ]
    const storage = installLocalStorage({ jc_media_tasks_v1: JSON.stringify(savedTasks) })
    try {
      setActivePinia(createPinia())
      const store = useMediaTaskStore()
      await store.init()

      assert.deepEqual(
        store.chatTasksFor('ses_one', '/project').map(task => task.id),
        ['mtask_session_one'],
      )
      assert.deepEqual(
        store.chatTasksFor('ses_two', '/project').map(task => task.id),
        ['mtask_session_two'],
      )
      assert.deepEqual(store.chatTasksFor('ses_one', '/other'), [])
      assert.deepEqual(store.chatTasksFor('', '/project'), [])
      assert.deepEqual(store.chatTasksFor('', '/other'), [])
    } finally {
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore rolls back the inserted task when initial persistence fails',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()
    await store.init()
    const previousSetItem = (globalThis as any).localStorage.setItem
    ;(globalThis as any).localStorage.setItem = () => {
      throw new Error('initial task persistence failed')
    }

    try {
      await assert.rejects(
        () =>
          store.submitTask({
            type: 'image',
            model: 'gpt-image-2',
            modelLabel: 'GPT Image 2',
            prompt: '不要留下孤儿任务',
            referenceImages: [],
            source: 'chat',
            sessionId: 'ses_one',
            directory: '/project',
          }),
        /initial task persistence failed/,
      )

      assert.deepEqual(store.tasks, [])
      assert.equal(store.runningCount, 0)
    } finally {
      ;(globalThis as any).localStorage.setItem = previousSetItem
      storage.restore()
    }
  },
)

test(
  'concurrent initial saves never persist a task whose earlier save failed',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    setActivePinia(createPinia())
    const environment = installWebCreationTestEnvironment()
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()
    await store.init()
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve
    })
    let saveCalls = 0
    __setMediaTaskSaverForTests(async tasks => {
      saveCalls++
      if (saveCalls === 1) {
        await firstGate
        throw new Error('first save failed')
      }
      localStorage.setItem('jc_media_tasks_v1', JSON.stringify(tasks))
    })
    let releaseExecution!: () => void
    const executionGate = new Promise<void>(resolve => {
      releaseExecution = resolve
    })
    __setCreationSubmitExecutorForTests(async () => {
      await executionGate
      return { url: 'https://webstatic.aiproxy.vip/output/only-b.png', type: 'image' }
    })
    const plan = buildCreationRunPlan({
      modelId: 'runninghub/api/rh-gpt2-image',
      params: {
        prompt: 'B',
        aspectRatio: '16:9',
        images: ['https://cdn.jiucaihezi.studio/input.png'],
      },
    })

    try {
      const first = store.submitTask({
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: 'A',
        prompt: 'A',
        source: 'creation',
        plan,
      })
      await new Promise(resolve => setTimeout(resolve, 0))
      const second = store.submitTask({
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: 'B',
        prompt: 'B',
        source: 'creation',
        plan,
      })
      releaseFirst()

      await assert.rejects(first, /first save failed/)
      const secondId = await second
      setActivePinia(createPinia())
      const restored = useMediaTaskStore()
      await restored.init()
      assert.deepEqual(
        restored.tasks.map(task => task.id),
        [secondId],
      )
    } finally {
      releaseExecution()
      await new Promise(resolve => setTimeout(resolve, 30))
      __setCreationSubmitExecutorForTests(null)
      __setMediaTaskSaverForTests(null)
      environment.restore()
      storage.restore()
    }
  },
)

test(
  'legacy chat tasks require explicit binding and persist their selected official session',
  { concurrency: false },
  async () => {
    const legacy = {
      id: 'mtask_legacy_bind',
      type: 'image',
      model: 'gpt-image-2',
      modelLabel: '旧模型',
      prompt: '旧任务',
      referenceImages: [],
      status: 'success',
      progress: 100,
      progressText: '完成',
      createdAt: 1,
      source: 'chat',
      resultUrl: 'https://webstatic.aiproxy.vip/output/legacy.png',
    }
    const storage = installLocalStorage({ jc_media_tasks_v1: JSON.stringify([legacy]) })
    try {
      setActivePinia(createPinia())
      const store = useMediaTaskStore()
      await store.init()
      assert.equal(
        await store.bindLegacyChatTask('mtask_legacy_bind', 'ses_selected', '/project'),
        true,
      )

      setActivePinia(createPinia())
      const restored = useMediaTaskStore()
      await restored.init()
      assert.equal(restored.getTask('mtask_legacy_bind')?.sessionId, 'ses_selected')
      assert.equal(restored.getTask('mtask_legacy_bind')?.directory, '/project')
      assert.equal(
        await restored.bindLegacyChatTask('mtask_legacy_bind', 'sess_fake', '/other'),
        false,
      )
    } finally {
      storage.restore()
    }
  },
)

test('all media task writes share one queued snapshot writer', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')
  assert.equal((source.match(/mediaTaskSaver\(/g) || []).length, 1)
  assert.match(source, /async function persistTasksSafely[\s\S]*queueTaskPersistence\(/)
  assert.match(
    source,
    /submitTask[\s\S]*queueTaskPersistence\(\s*\(\) => tasks\.value\.unshift\(task\)/,
  )
})

test('task history exposes unscoped legacy chat tasks with explicit recovery only', () => {
  const panel = readFileSync(
    join(process.cwd(), 'src/components/creation/CreationPanel.vue'),
    'utf8',
  )
  assert.match(panel, /isLegacyChatTask\(task\)/)
  assert.match(panel, /旧任务 \/ 未归属/)
  assert.match(panel, /bindLegacyTaskToCurrentSession\(task\)/)
  assert.doesNotMatch(panel, /bindLegacyChatTask\([^,]+,\s*['"`]ses_/)
})

test('legacy task classification and recovery controls are Desktop-only', () => {
  const panel = readFileSync(
    join(process.cwd(), 'src/components/creation/CreationPanel.vue'),
    'utf8',
  )
  const classifier = panel.slice(
    panel.indexOf('function isLegacyChatTask'),
    panel.indexOf('const creationTasks'),
  )
  assert.match(classifier, /return isTauriRuntime\(\) && task\.source === 'chat'/)
  assert.match(panel, /v-if="isLegacyChatTask\(task\)"[\s\S]*旧任务 \/ 未归属/)
  assert.match(panel, /v-if="isLegacyChatTask\(task\)"[\s\S]*绑定当前会话/)
})

test('mediaTaskStore persists planSnapshot and route identity for creation task recovery', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')

  assert.match(source, /planSnapshot\?:/)
  assert.match(source, /source: TaskSource/)
  assert.match(source, /route\?:/)
  assert.match(source, /upstreamFamily\?:/)
  assert.match(source, /apiStyle\?:/)
  assert.match(source, /mode\?:/)
  assert.match(source, /task\.planSnapshot =/)
})

test('mediaTaskStore stores structured creation task errors alongside legacy errorMsg', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')

  assert.match(source, /export type CreationErrorCategory =/)
  assert.match(source, /'persistence'/)
  assert.match(source, /export type CreationErrorStage =/)
  assert.match(source, /export interface CreationTaskError/)
  assert.match(source, /error\?: CreationTaskError/)
  assert.match(source, /category: 'plan-validation'/)
  assert.match(source, /stage: 'validation'/)
  assert.match(source, /task\.error =/)
})

test('mediaTaskStore routes all creation plans through the plan-driven runtime, including RunningHub', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')

  assert.match(
    source,
    /const shouldUseCreationRuntime = params\.source === 'creation' && params\.plan/,
  )
  assert.doesNotMatch(
    source,
    /const shouldUseCreationRuntime = params\.source === 'creation' && params\.plan && !params\.plan\.usesRhAdapter/,
  )
  assert.match(source, /creationSubmitExecutor\(\s*request,\s*onProgress,\s*async submitted => \{/)
})

test('mediaTaskStore persists submitted upstream task metadata before polling continues', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')

  assert.equal(source.includes('void markTaskSubmitted(task, submitted)'), false)
  assert.match(
    source,
    /onSubmitted: async submitted => \{\s+const persisted = await markTaskSubmitted\(task, submitted\)/,
  )
  assert.match(
    source,
    /if \(!persisted\) markPersistenceWarning\(task, '任务已提交，但本地保存失败'\)/,
  )
  assert.doesNotMatch(source, /catch\s*\{\s*\/\* noop \*\/\s*\}/)
  assert.match(source, /async function saveTasks[\s\S]*catch \(error\)[\s\S]*throw error/)
})

test(
  'mediaTaskStore rejects creation submissions that are missing a plan instead of falling back to legacy task routes',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()

    try {
      await assert.rejects(
        () =>
          store.submitTask({
            type: 'video',
            model: 'rh-aiapp-director',
            modelLabel: '我是导演 · RunningHub 工作流',
            prompt: '女人在跳舞',
            source: 'creation',
          }),
        /Creation source tasks must include a run plan/,
      )
    } finally {
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore starts two creation submissions without waiting for the first task',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    setActivePinia(createPinia())
    const environment = installWebCreationTestEnvironment()
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()
    let started = 0
    let release: (() => void) | undefined
    const finished = new Promise<void>(resolve => {
      release = resolve
    })

    __setCreationSubmitExecutorForTests(async () => {
      started += 1
      await finished
      return { url: `https://webstatic.aiproxy.vip/output/${started}.png`, type: 'image' }
    })

    try {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/api/rh-gpt2-image',
        params: {
          prompt: '并发测试',
          aspectRatio: '16:9',
          images: ['https://cdn.jiucaihezi.studio/input.png'],
        },
      })
      const submit = () =>
        store.submitTask({
          type: 'image',
          model: 'rh-gpt2-image',
          modelLabel: 'GPT Image 2',
          prompt: '并发测试',
          source: 'creation',
          plan,
        })

      const [firstId, secondId] = await Promise.all([submit(), submit()])
      await new Promise(resolve => setTimeout(resolve, 0))
      assert.equal(started, 2)
      assert.equal(store.getTask(firstId)?.status, 'running')
      assert.equal(store.getTask(secondId)?.status, 'running')
      release?.()
      await new Promise(resolve => setTimeout(resolve, 20))
    } finally {
      __setCreationSubmitExecutorForTests(null)
      environment.restore()
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore keeps accepted upstream poll metadata on the task even if later persistence fails',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    setActivePinia(createPinia())
    const environment = installWebCreationTestEnvironment()
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()

    let saveCount = 0
    __setCreationSubmitExecutorForTests(async (_request, _progress, onSubmitted) => {
      await onSubmitted?.({
        taskId: 'rh_task_recovery_001',
        pollUrl: '/rh/tasks/rh_task_recovery_001',
        pollKind: 'image',
      })
      return {
        url: 'https://webstatic.aiproxy.vip/output/rh-recovery.png',
        type: 'image',
        taskId: 'rh_task_recovery_001',
        pollUrl: '/rh/tasks/rh_task_recovery_001',
        pollKind: 'image',
      }
    })

    const previousSetItem = (globalThis as any).localStorage.setItem
    ;(globalThis as any).localStorage.setItem = (key: string, value: string) => {
      saveCount += 1
      if (key === 'jc_media_tasks_v1' && saveCount >= 4) {
        throw new Error('simulated persistence failure')
      }
      previousSetItem(key, value)
    }

    try {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/api/rh-gpt2-image',
        params: {
          prompt: '保留人物，改成赛博都市',
          aspectRatio: '16:9',
          resolution: '2k',
          images: ['https://cdn.jiucaihezi.studio/input.png'],
        },
      })

      const taskId = await store.submitTask({
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: 'GPT2.0 图生图 · RunningHub',
        prompt: '保留人物，改成赛博都市',
        referenceImages: ['https://cdn.jiucaihezi.studio/input.png'],
        source: 'creation',
        plan,
      })

      await new Promise(resolve => setTimeout(resolve, 50))
      const task = store.getTask(taskId)

      assert.equal(task?.upstreamTaskId, 'rh_task_recovery_001')
      assert.equal(task?.pollUrl, '/rh/tasks/rh_task_recovery_001')
      assert.equal(task?.pollKind, 'image')
      assert.equal(task?.status, 'success')
    } finally {
      __setCreationSubmitExecutorForTests(null)
      environment.restore()
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore does not flip a completed creation task to failed when final persistence fails',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    setActivePinia(createPinia())
    const environment = installWebCreationTestEnvironment()
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()

    let saveCount = 0
    __setCreationSubmitExecutorForTests(async (_request, _progress, onSubmitted) => {
      await onSubmitted?.({
        taskId: 'rh_success_persist_001',
        pollUrl: '/rh/tasks/rh_success_persist_001',
        pollKind: 'image',
      })
      return {
        url: 'https://webstatic.aiproxy.vip/output/rh-success.png',
        type: 'image',
        taskId: 'rh_success_persist_001',
        pollUrl: '/rh/tasks/rh_success_persist_001',
        pollKind: 'image',
      }
    })

    const previousSetItem = (globalThis as any).localStorage.setItem
    ;(globalThis as any).localStorage.setItem = (key: string, value: string) => {
      saveCount += 1
      if (key === 'jc_media_tasks_v1' && saveCount >= 5) {
        throw new Error('simulated final persistence failure')
      }
      previousSetItem(key, value)
    }

    try {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/api/rh-gpt2-image',
        params: {
          prompt: '保留人物，改成赛博都市',
          aspectRatio: '16:9',
          resolution: '2k',
          images: ['https://cdn.jiucaihezi.studio/input.png'],
        },
      })

      const taskId = await store.submitTask({
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: 'GPT2.0 图生图 · RunningHub',
        prompt: '保留人物，改成赛博都市',
        referenceImages: ['https://cdn.jiucaihezi.studio/input.png'],
        source: 'creation',
        plan,
      })

      await new Promise(resolve => setTimeout(resolve, 50))
      const task = store.getTask(taskId)

      assert.equal(task?.status, 'success')
      assert.equal(task?.resultUrl, 'https://webstatic.aiproxy.vip/output/rh-success.png')
      assert.equal(task?.error?.category, 'persistence')
    } finally {
      __setCreationSubmitExecutorForTests(null)
      environment.restore()
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore classifies RunningHub creation failures as upstream-rh',
  { concurrency: false },
  async () => {
    const storage = installLocalStorage()
    setActivePinia(createPinia())
    const environment = installWebCreationTestEnvironment()
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()

    __setCreationSubmitExecutorForTests(async () => {
      throw new Error('RunningHub upstream task failed')
    })

    try {
      const plan = buildCreationRunPlan({
        modelId: 'runninghub/api/rh-gpt2-image',
        params: {
          prompt: '保留人物，改成赛博都市',
          aspectRatio: '16:9',
          resolution: '2k',
          images: ['https://cdn.jiucaihezi.studio/input.png'],
        },
      })

      const taskId = await store.submitTask({
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: 'GPT2.0 图生图 · RunningHub',
        prompt: '保留人物，改成赛博都市',
        referenceImages: ['https://cdn.jiucaihezi.studio/input.png'],
        source: 'creation',
        plan,
      })

      await new Promise(resolve => setTimeout(resolve, 50))
      const task = store.getTask(taskId)

      assert.equal(task?.status, 'failed')
      assert.equal(task?.error?.category, 'upstream-rh')
      assert.equal(task?.error?.stage, 'submit')
    } finally {
      __setCreationSubmitExecutorForTests(null)
      environment.restore()
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore restores async polling from persisted pollUrl and pollKind without guessing by model name',
  { concurrency: false },
  async () => {
    const savedTasks = [
      {
        id: 'mtask_restore_by_poll_url',
        type: 'video',
        model: 'misleading-direct-model-name',
        modelLabel: '历史任务',
        prompt: '恢复测试',
        referenceImages: [],
        status: 'running',
        progress: 36,
        progressText: '生成中...',
        createdAt: Date.now(),
        source: 'creation',
        projectId: 'web-restore-project',
        assetStatus: 'pending',
        route: 'runninghub-adapter',
        upstreamFamily: 'runninghub',
        apiStyle: 'rh-standard',
        mode: 'text-to-video',
        upstreamTaskId: 'rh_restore_001',
        pollUrl: '/rh/tasks/rh_restore_001',
        pollKind: 'video',
        planSnapshot: {
          modelId: 'runninghub/api/rh-seedance2-mini',
          model: 'rh-seedance2-mini',
          label: 'Seedance 2.0 文生视频 · RunningHub',
          task: 'video',
          source: 'runninghub',
          route: 'runninghub-adapter',
          upstreamFamily: 'runninghub',
          apiStyle: 'rh-standard',
          mode: 'text-to-video',
          endpoint: '/v1/videos',
          usesRhAdapter: true,
          pollKind: 'rh-task',
          assetFlow: 'rh-upload',
          submitSummary: 'RunningHub · RH 官方 API · 文生视频',
          normalizedParams: {
            model: 'rh-seedance2-mini',
            prompt: '恢复测试',
            duration: 6,
          },
        },
      },
    ]
    const storage = installLocalStorage({
      jc_media_tasks_v1: JSON.stringify(savedTasks),
    })
    const files = installWebTaskFileStore()
    const projectStore = useProjectStore()
    const originalProjectId = projectStore.webProjectId.value
    const originalProjectName = projectStore.webProjectName.value
    const previousFetch = globalThis.fetch
    const requestedUrls: string[] = []
    let markPollStarted: () => void = () => {}
    const pollStarted = new Promise<void>(resolve => {
      markPollStarted = resolve
    })
    let offSettled: () => void = () => {}
    const settled = new Promise<string>(resolve => {
      offSettled = eventBus.onEvent('media-task-settled', payload => {
        if ((payload as { taskId?: string }).taskId === 'mtask_restore_by_poll_url') {
          resolve(String((payload as { status?: string }).status || ''))
        }
      })
    })
    let markSuccessPersisted: () => void = () => {}
    const successPersisted = new Promise<void>(resolve => {
      markSuccessPersisted = resolve
    })
    projectStore.webProjectId.value = 'web-current-project'
    projectStore.webProjectName.value = '当前项目'
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url.endsWith('/rh/tasks/rh_restore_001')) {
        markPollStarted()
        return Response.json({
          status: 'success',
          url: 'https://webstatic.aiproxy.vip/output/rh-restore.mp4',
        })
      }
      if (url === 'https://webstatic.aiproxy.vip/output/rh-restore.mp4') {
        return new Response(new Blob(['restored-video'], { type: 'video/mp4' }), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        })
      }
      throw new Error(`Unexpected fetch ${url}`)
    }
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    __setMediaTaskSaverForTests(async tasks => {
      if (tasks.some(task => task.id === 'mtask_restore_by_poll_url' && task.status === 'success'))
        markSuccessPersisted()
    })
    const store = useMediaTaskStore()

    try {
      await withImmediateTimers(async () => {
        await store.init()
        await pollStarted
        assert.equal(await settled, 'success')
        await successPersisted
      })
      const task = store.getTask('mtask_restore_by_poll_url')

      assert.equal(task?.status, 'success')
      assert.equal(task?.resultUrl, 'https://webstatic.aiproxy.vip/output/rh-restore.mp4')
      assert.equal(
        requestedUrls.some(url => url.endsWith('/rh/tasks/rh_restore_001')),
        true,
      )
      assert.equal(
        requestedUrls.some(url => url.includes('misleading-direct-model-name')),
        false,
      )
    } finally {
      __setMediaTaskSaverForTests(null)
      offSettled()
      globalThis.fetch = previousFetch
      projectStore.webProjectId.value = originalProjectId
      projectStore.webProjectName.value = originalProjectName
      files.restore()
      storage.restore()
    }
  },
)

test(
  'mediaTaskStore does not fail pending creation tasks without poll metadata during init recovery',
  { concurrency: false },
  async () => {
    const savedTasks = [
      {
        id: 'mtask_recover_pending',
        type: 'image',
        model: 'rh-gpt2-image',
        modelLabel: 'GPT2.0 图生图 · RunningHub',
        prompt: '保留人物，改成赛博都市',
        referenceImages: ['https://cdn.jiucaihezi.studio/input.png'],
        status: 'pending',
        progress: 0,
        progressText: '排队中...',
        createdAt: Date.now(),
        source: 'creation',
        route: 'runninghub-adapter',
        upstreamFamily: 'runninghub',
        apiStyle: 'rh-standard',
        mode: 'image-to-image',
        planSnapshot: {
          modelId: 'runninghub/api/rh-gpt2-image',
          model: 'rh-gpt2-image',
          label: 'GPT2.0 图生图 · RunningHub',
          task: 'image',
          source: 'runninghub',
          route: 'runninghub-adapter',
          upstreamFamily: 'runninghub',
          apiStyle: 'rh-standard',
          mode: 'image-to-image',
          endpoint: '/v1/images/generations',
          usesRhAdapter: true,
          pollKind: 'rh-task',
          assetFlow: 'rh-upload',
          submitSummary: 'RunningHub · RH 官方 API · 图生图',
          normalizedParams: {
            model: 'rh-gpt2-image',
            prompt: '保留人物，改成赛博都市',
            images: ['https://cdn.jiucaihezi.studio/input.png'],
            aspectRatio: '16:9',
            resolution: '2k',
          },
        },
      },
    ]
    const storage = installLocalStorage({
      jc_media_tasks_v1: JSON.stringify(savedTasks),
    })
    setActivePinia(createPinia())
    __resetApiKeyMemoryCacheForTests('session-cloud')
    const store = useMediaTaskStore()

    try {
      await store.init()
      const task = store.getTask('mtask_recover_pending')
      assert.equal(task?.status, 'pending')
      assert.equal(task?.errorMsg, undefined)
    } finally {
      storage.restore()
    }
  },
)

test('creation media tasks are not automatically saved twice into media assets', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')

  assert.match(source, /function shouldAutoSaveMediaToFileTree\(task: MediaTask\)/)
  assert.match(source, /return task\.source !== 'creation'/)
  assert.match(
    source,
    /if \(shouldAutoSaveMediaToFileTree\(task\)\) saveMediaToFileTree\(task\)\.catch\(\(\) => \{\}\)/,
  )
})

test('creation gallery cards recover when async media urls resolve', () => {
  const cardSource = readFileSync(
    join(process.cwd(), 'src/components/creation/GalleryCard.vue'),
    'utf8',
  )

  assert.match(cardSource, /watch\(\(\) => props\.url/)
  assert.match(cardSource, /imgError\.value = false/)
  assert.match(cardSource, /v-if="isImage && url && !imgError"/)
})

test('MediaTaskBubble treats audio as audio when saving and checks result URL safety', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/chat/MediaTaskBubble.vue'),
    'utf8',
  )

  assert.equal(
    source.includes("import { isAllowedCreationResultUrl } from '@/utils/urlSafety'"),
    true,
  )
  assert.equal(
    source.includes(
      'const isSafeResult = computed(() => Boolean(task.value?.resultUrl && isAllowedCreationResultUrl(task.value.resultUrl)))',
    ),
    true,
  )
  assert.equal(source.includes("const fileType: 'image' | 'video' | 'audio' = t.type"), true)
  assert.equal(
    source.includes("const ext = t.type === 'video' ? 'mp4' : t.type === 'audio' ? 'mp3' : 'png'"),
    true,
  )
  assert.equal(
    source.includes(
      "const mimeType = t.type === 'video' ? 'video/mp4' : t.type === 'audio' ? 'audio/mpeg' : 'image/png'",
    ),
    true,
  )
  assert.equal(source.includes('v-else-if="isSuccess && isSafeResult"'), true)
})
