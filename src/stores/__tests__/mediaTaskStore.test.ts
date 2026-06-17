import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { buildCreationRunPlan } from '@/runtime/creation/creationMediaPlan'
import { __resetApiKeyMemoryCacheForTests } from '@/services/newApiClient'
import { __setCreationSubmitExecutorForTests, useMediaTaskStore } from '../mediaTaskStore'

function installLocalStorage(values: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(values))
  const previous = (globalThis as any).localStorage
  const previousWindow = (globalThis as any).window
  ;(globalThis as any).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  }
  ;(globalThis as any).window = { __TAURI_INTERNALS__: undefined, location: { href: 'http://localhost/' } }
  return {
    restore() {
      ;(globalThis as any).localStorage = previous
      ;(globalThis as any).window = previousWindow
    },
  }
}

async function withImmediateTimers<T>(fn: () => Promise<T>): Promise<T> {
  const previousSetTimeout = globalThis.setTimeout
  ;(globalThis as any).setTimeout = (handler: (...args: unknown[]) => void, _timeout?: number, ...args: unknown[]) => {
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
  assert.equal(source.includes("import { isAllowedCreationResultUrl } from '@/utils/urlSafety'"), true)
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
  assert.equal(source.indexOf('resultUrl = await pollTask(result.pollUrl, result.pollKind, onProgress') < source.indexOf('const safeResultUrl = assertSafeResultUrl(resultUrl)'), true)
})

test('mediaTaskStore waits for initialization before submitting a new task', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')

  assert.match(source, /async function submitTask\(params: MediaTaskSubmitParams\): Promise<string> \{\s+await init\(\)/)
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

  assert.match(source, /const shouldUseCreationRuntime = params\.source === 'creation' && params\.plan/)
  assert.doesNotMatch(source, /const shouldUseCreationRuntime = params\.source === 'creation' && params\.plan && !params\.plan\.usesRhAdapter/)
  assert.match(source, /creationSubmitExecutor\(\s*request,\s*onProgress,\s*async submitted => \{/)
})

test('mediaTaskStore persists submitted upstream task metadata before polling continues', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')

  assert.equal(source.includes('void markTaskSubmitted(task, submitted)'), false)
  assert.match(source, /onSubmitted: async submitted => \{\s+const persisted = await markTaskSubmitted\(task, submitted\)/)
  assert.match(source, /if \(!persisted\) markPersistenceWarning\(task, '任务已提交，但本地保存失败'\)/)
  assert.doesNotMatch(source, /catch\s*\{\s*\/\* noop \*\/\s*\}/)
  assert.match(source, /async function saveTasks[\s\S]*catch \(error\)[\s\S]*throw error/)
})

test('mediaTaskStore rejects creation submissions that are missing a plan instead of falling back to legacy task routes', { concurrency: false }, async () => {
  const storage = installLocalStorage()
  setActivePinia(createPinia())
  __resetApiKeyMemoryCacheForTests('session-cloud')
  const store = useMediaTaskStore()

  try {
    await assert.rejects(
      () => store.submitTask({
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
})

test('mediaTaskStore keeps accepted upstream poll metadata on the task even if later persistence fails', { concurrency: false }, async () => {
  const storage = installLocalStorage()
  setActivePinia(createPinia())
  __resetApiKeyMemoryCacheForTests('session-cloud')
  const store = useMediaTaskStore()

  let saveCount = 0
  __setCreationSubmitExecutorForTests(async (_request, _progress, onSubmitted) => {
    await onSubmitted?.({ taskId: 'rh_task_recovery_001', pollUrl: '/rh/tasks/rh_task_recovery_001', pollKind: 'image' })
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
    storage.restore()
  }
})

test('mediaTaskStore does not flip a completed creation task to failed when final persistence fails', { concurrency: false }, async () => {
  const storage = installLocalStorage()
  setActivePinia(createPinia())
  __resetApiKeyMemoryCacheForTests('session-cloud')
  const store = useMediaTaskStore()

  let saveCount = 0
  __setCreationSubmitExecutorForTests(async (_request, _progress, onSubmitted) => {
    await onSubmitted?.({ taskId: 'rh_success_persist_001', pollUrl: '/rh/tasks/rh_success_persist_001', pollKind: 'image' })
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
    storage.restore()
  }
})

test('mediaTaskStore classifies RunningHub creation failures as upstream-rh', { concurrency: false }, async () => {
  const storage = installLocalStorage()
  setActivePinia(createPinia())
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
    storage.restore()
  }
})

test('mediaTaskStore restores async polling from persisted pollUrl and pollKind without guessing by model name', { concurrency: false }, async () => {
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
      route: 'runninghub-adapter',
      upstreamFamily: 'runninghub',
      apiStyle: 'rh-standard',
      mode: 'text-to-video',
      upstreamTaskId: 'rh_restore_001',
      pollUrl: '/rh/tasks/rh_restore_001',
      pollKind: 'video',
      planSnapshot: {
        modelId: 'runninghub/api/rh-seedance2-text-video',
        model: 'rh-seedance2-text-video',
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
          model: 'rh-seedance2-text-video',
          prompt: '恢复测试',
          duration: 6,
        },
      },
    },
  ]
  const storage = installLocalStorage({
    jc_media_tasks_v1: JSON.stringify(savedTasks),
  })
  const previousFetch = globalThis.fetch
  const requestedUrls: string[] = []
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = String(input)
    requestedUrls.push(url)
    if (url.endsWith('/rh/tasks/rh_restore_001')) {
      return Response.json({ status: 'success', url: 'https://webstatic.aiproxy.vip/output/rh-restore.mp4' })
    }
    throw new Error(`Unexpected fetch ${url}`)
  }
  setActivePinia(createPinia())
  __resetApiKeyMemoryCacheForTests('session-cloud')
  const store = useMediaTaskStore()

  try {
    await withImmediateTimers(async () => {
      await store.init()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    const task = store.getTask('mtask_restore_by_poll_url')

    assert.equal(task?.status, 'success')
    assert.equal(task?.resultUrl, 'https://webstatic.aiproxy.vip/output/rh-restore.mp4')
    assert.equal(requestedUrls.some(url => url.endsWith('/rh/tasks/rh_restore_001')), true)
    assert.equal(requestedUrls.some(url => url.includes('misleading-direct-model-name')), false)
  } finally {
    globalThis.fetch = previousFetch
    storage.restore()
  }
})

test('mediaTaskStore does not fail pending creation tasks without poll metadata during init recovery', { concurrency: false }, async () => {
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
})

test('creation gallery deletion can remove the backing media task', () => {
  const storeSource = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')
  const panelSource = readFileSync(join(process.cwd(), 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(storeSource, /function deleteTask\(taskId: string\)/)
  assert.match(storeSource, /tasks\.value = tasks\.value\.filter\(t => t\.id !== taskId\)/)
  assert.match(storeSource, /init, submitTask, cancelTask, clearFinished, deleteTask, getTask/)
  assert.match(panelSource, /const taskId = cpState\.results\[index\]\?\.taskId/)
  assert.match(panelSource, /if \(taskId\) mediaTaskStore\.deleteTask\(taskId\)/)
})

test('creation gallery settled events use the guarded reconcile path', () => {
  const panelSource = readFileSync(join(process.cwd(), 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(panelSource, /async function addSettledCreationTaskToGallery\(task: MediaTask\)/)
  assert.match(panelSource, /if \(isResultDeleted\(task\.id, task\.resultUrl\)\) return/)
  assert.match(panelSource, /const task = mediaTaskStore\.getTask\(payload\.taskId\)/)
  assert.match(panelSource, /await addSettledCreationTaskToGallery\(task\)/)
  const eventHandler = panelSource.slice(
    panelSource.indexOf("const offTaskSettled = onEvent('media-task-settled'"),
    panelSource.indexOf('const runningCount = creationRunningCount.value'),
  )
  assert.doesNotMatch(eventHandler, /cpState\.results\.unshift/)
  assert.doesNotMatch(eventHandler, /addFailureCard\(/)
})

test('creation media tasks are not automatically saved twice into media assets', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')

  assert.match(source, /function shouldAutoSaveMediaToFileTree\(task: MediaTask\)/)
  assert.match(source, /return task\.source !== 'creation'/)
  assert.match(source, /if \(shouldAutoSaveMediaToFileTree\(task\)\) saveMediaToFileTree\(task\)\.catch\(\(\) => \{\}\)/)
})

test('creation gallery selection state is keyed by stable result identity', () => {
  const panelSource = readFileSync(join(process.cwd(), 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(panelSource, /function resultKey\(result: CreationResult\)/)
  assert.match(panelSource, /const selectedKeys = ref<Set<string>>/)
  assert.doesNotMatch(panelSource, /const selectedIndices = ref<Set<number>>/)
  assert.match(panelSource, /function resultIndexByKey\(key: string\)/)
  assert.match(panelSource, /selectedKeys\.value = new Set\(displayResults\.value\.map\(item => item\.key\)\)/)
})

test('creation gallery cards recover when async media urls resolve', () => {
  const cardSource = readFileSync(join(process.cwd(), 'src/components/creation/GalleryCard.vue'), 'utf8')

  assert.match(cardSource, /watch\(\(\) => props\.url/)
  assert.match(cardSource, /imgError\.value = false/)
  assert.match(cardSource, /v-if="isImage && url && !imgError"/)
})

test('creation gallery failed cards keep retry prompt separate from error text', () => {
  const panelSource = readFileSync(join(process.cwd(), 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(panelSource, /content: params\.content \|\| ''/)
  assert.match(panelSource, /errorMsg: params\.message \|\| '请重试'/)
  assert.match(panelSource, /const prompt = r\.type === 'failed' \? \(r\.content \|\| ''\) : ''/)
})

test('creation media results remain visible when local cache fails', () => {
  const panelSource = readFileSync(join(process.cwd(), 'src/components/creation/CreationPanel.vue'), 'utf8')

  const successPath = panelSource.slice(
    panelSource.indexOf("if (task.status === 'success' && task.type !== 'text'"),
    panelSource.indexOf("if (task.status === 'success' && task.type === 'text'"),
  )
  const cacheFailurePath = successPath.slice(
    successPath.indexOf("const message = e instanceof Error ? e.message : String(e || '本地缓存失败')"),
    successPath.indexOf('    }\n    saveCpState()'),
  )
  assert.match(successPath, /const result = upsertCreationResultFromTask\(task, task\.resultUrl\)/)
  assert.match(cacheFailurePath, /result\.errorMsg = `本地缓存失败，已用远程地址临时展示: \$\{message\}`/)
  assert.doesNotMatch(cacheFailurePath, /addFailureCard\(/)
})

test('creation media result url is published before local cache work', () => {
  const panelSource = readFileSync(join(process.cwd(), 'src/components/creation/CreationPanel.vue'), 'utf8')
  const successPath = panelSource.slice(
    panelSource.indexOf("if (task.status === 'success' && task.type !== 'text'"),
    panelSource.indexOf("if (task.status === 'success' && task.type === 'text'"),
  )

  assert.match(successPath, /const result = upsertCreationResultFromTask\(task, task\.resultUrl\)/)
  assert.equal(successPath.indexOf('upsertCreationResultFromTask(task, task.resultUrl)') < successPath.indexOf('cacheCreationMediaResult({'), true)
})

test('creation media asset library includes generated result fallbacks', () => {
  const panelSource = readFileSync(join(process.cwd(), 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(panelSource, /mediaDisplayAssetFromCreationResult/)
  assert.match(panelSource, /const creationTaskMediaAssets = computed/)
  assert.match(panelSource, /const creationResultMediaAssets = computed/)
  assert.match(panelSource, /const combinedMediaLibraryAssets = computed/)
  assert.match(panelSource, /mediaTaskStore\.tasks/)
  assert.match(panelSource, /return combinedMediaLibraryAssets\.value/)
  assert.match(panelSource, /\? combinedMediaLibraryAssets\.value\.length/)
})

test('creation media asset library dedupes result and task fallback by task id', () => {
  const panelSource = readFileSync(join(process.cwd(), 'src/components/creation/CreationPanel.vue'), 'utf8')
  const mediaDisplaySource = readFileSync(join(process.cwd(), 'src/utils/mediaDisplayAsset.ts'), 'utf8')

  assert.match(panelSource, /dedupeMediaDisplayAssets\(/)
  assert.match(mediaDisplaySource, /if \(asset\.taskId\) keys\.add\(`task:\$\{asset\.taskId\}`\)/)
  assert.match(mediaDisplaySource, /if \(asset\.localRef\) keys\.add\(`local:\$\{asset\.localRef\}`\)/)
  assert.match(mediaDisplaySource, /if \(asset\.originalUrl\) keys\.add\(`url:\$\{asset\.originalUrl\}`\)/)
  assert.match(mediaDisplaySource, /if \(asset\.fileId\) score \+= 100/)
})

test('creation media cards and viewer expose generated media URL copy affordance', () => {
  const cardSource = readFileSync(join(process.cwd(), 'src/components/media/MediaAssetCard.vue'), 'utf8')
  const viewerSource = readFileSync(join(process.cwd(), 'src/components/media/MediaViewer.vue'), 'utf8')
  const panelSource = readFileSync(join(process.cwd(), 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(cardSource, /copyUrl: \[asset: MediaDisplayAsset\]/)
  assert.match(cardSource, /title="复制URL"/)
  assert.match(viewerSource, /urlLabel/)
  assert.match(viewerSource, /title="复制URL"/)
  assert.match(panelSource, /async function copyMediaAssetUrl/)
  assert.match(panelSource, /@copy-url="copyMediaAssetUrl"/)
})

test('creation gallery resolver state is initialized before result fallback computeds run', () => {
  const panelSource = readFileSync(join(process.cwd(), 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.equal(
    panelSource.indexOf('const resolvedGalleryAssets = ref'),
    panelSource.indexOf('const resolvedGalleryAssets = ref'),
  )
  assert.equal(
    panelSource.indexOf('const resolvedGalleryAssets = ref') < panelSource.indexOf('const creationResultMediaAssets = computed'),
    true,
  )
})

test('creation media asset library reads only explicit creation gallery files', () => {
  const panelSource = readFileSync(join(process.cwd(), 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(panelSource, /visibleCreationGalleryFiles/)
  assert.match(panelSource, /visibleCreationGalleryFiles\(mediaEntries\)\s+\.map\(mediaDisplayAssetFromFileEntry\)/)
  assert.match(panelSource, /source: CREATION_GALLERY_SOURCE/)
  assert.doesNotMatch(panelSource, /mediaLibraryAssets\.value = mediaEntries\s+\.map\(mediaDisplayAssetFromFileEntry\)/)
})

test('creation panel surfaces RunningHub channel, mode, and submit summary without changing layout', () => {
  const panelSource = readFileSync(join(process.cwd(), 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(panelSource, /const rhChannelLabel = computed/)
  assert.match(panelSource, /displayModelLabel/)
  assert.match(panelSource, /const rhModeLabel = computed/)
  assert.match(panelSource, /currentSubmitSummary/)
  assert.match(panelSource, /currentRunPlanError/)
  assert.match(panelSource, /class="cp-rh-summary"/)
  assert.match(panelSource, /渠道/)
  assert.match(panelSource, /模式/)
  assert.match(panelSource, /NewAPI 直连/)
  assert.match(panelSource, /RH 工作流|RH 官方 API/)
  assert.doesNotMatch(panelSource, /cp-contract-warnings/)
  assert.match(panelSource, /class="cp-result-meta-line"/)
  assert.doesNotMatch(panelSource, /左侧：参数/)
  assert.doesNotMatch(panelSource, /右侧：成果/)
})

test('MediaTaskBubble treats audio as audio when saving and checks result URL safety', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/chat/MediaTaskBubble.vue'), 'utf8')

  assert.equal(source.includes("import { isAllowedCreationResultUrl } from '@/utils/urlSafety'"), true)
  assert.equal(source.includes("const isSafeResult = computed(() => Boolean(task.value?.resultUrl && isAllowedCreationResultUrl(task.value.resultUrl)))"), true)
  assert.equal(source.includes("const fileType: 'image' | 'video' | 'audio' = t.type"), true)
  assert.equal(source.includes("const ext = t.type === 'video' ? 'mp4' : t.type === 'audio' ? 'mp3' : 'png'"), true)
  assert.equal(source.includes("const mimeType = t.type === 'video' ? 'video/mp4' : t.type === 'audio' ? 'audio/mpeg' : 'image/png'"), true)
  assert.equal(source.includes('v-else-if="isSuccess && isSafeResult"'), true)
})
