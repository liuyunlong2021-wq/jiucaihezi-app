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

test('MediaTaskBubble treats audio as audio when saving and checks result URL safety', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/chat/MediaTaskBubble.vue'), 'utf8')

  assert.equal(source.includes("import { isAllowedCreationResultUrl } from '@/utils/urlSafety'"), true)
  assert.equal(source.includes("const isSafeResult = computed(() => Boolean(task.value?.resultUrl && isAllowedCreationResultUrl(task.value.resultUrl)))"), true)
  assert.equal(source.includes("const fileType: 'image' | 'video' | 'audio' = t.type"), true)
  assert.equal(source.includes("const ext = t.type === 'video' ? 'mp4' : t.type === 'audio' ? 'mp3' : 'png'"), true)
  assert.equal(source.includes("const mimeType = t.type === 'video' ? 'video/mp4' : t.type === 'audio' ? 'audio/mpeg' : 'image/png'"), true)
  assert.equal(source.includes('v-else-if="isSuccess && isSafeResult"'), true)
})
