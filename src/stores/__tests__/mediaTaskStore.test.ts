import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('mediaTaskStore validates result URLs before publishing successful tasks', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')

  assert.equal(source.includes("import { validateMediaModelInputs } from '@/data/mediaModelInputValidation'"), true)
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

test('mediaTaskStore persists submitted upstream task metadata before polling continues', () => {
  const source = readFileSync(join(process.cwd(), 'src/stores/mediaTaskStore.ts'), 'utf8')

  assert.equal(source.includes('void markTaskSubmitted(task, submitted)'), false)
  assert.match(source, /onSubmitted: async submitted => \{ await markTaskSubmitted\(task, submitted\) \}/)
  assert.doesNotMatch(source, /catch\s*\{\s*\/\* noop \*\/\s*\}/)
  assert.match(source, /async function saveTasks[\s\S]*catch \(error\)[\s\S]*throw error/)
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

test('MediaTaskBubble treats audio as audio when saving and checks result URL safety', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/chat/MediaTaskBubble.vue'), 'utf8')

  assert.equal(source.includes("import { isAllowedCreationResultUrl } from '@/utils/urlSafety'"), true)
  assert.equal(source.includes("const isSafeResult = computed(() => Boolean(task.value?.resultUrl && isAllowedCreationResultUrl(task.value.resultUrl)))"), true)
  assert.equal(source.includes("const fileType: 'image' | 'video' | 'audio' = t.type"), true)
  assert.equal(source.includes("const ext = t.type === 'video' ? 'mp4' : t.type === 'audio' ? 'mp3' : 'png'"), true)
  assert.equal(source.includes("const mimeType = t.type === 'video' ? 'video/mp4' : t.type === 'audio' ? 'audio/mpeg' : 'image/png'"), true)
  assert.equal(source.includes('v-else-if="isSuccess && isSafeResult"'), true)
})
