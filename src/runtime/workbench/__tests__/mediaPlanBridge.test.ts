import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildMediaPlanSubmission } from '../mediaPlanBridge'

test('media plan bridge materializes an image plan through the existing creation run plan', () => {
  const submission = buildMediaPlanSubmission({
    kind: 'image',
    title: '精华液主图',
    prompt: '白色台面上的精华液产品摄影',
    modelId: 'newapi/t8/gpt-image-2',
    ratio: '1:1',
    resolution: '2k',
    referenceImages: ['data:image/png;base64,AA=='],
  })

  assert.equal(submission.type, 'image')
  assert.equal(submission.model, 'gpt-image-2')
  assert.equal(submission.plan.modelId, 'newapi/t8/gpt-image-2')
  assert.equal(submission.plan.debug.referenceImageCount, 1)
  assert.equal(submission.source, 'creation')
})

test('media plan bridge never materializes an invalid plan', () => {
  assert.throws(() => buildMediaPlanSubmission({
    kind: 'image', title: '错误', prompt: 'test', modelId: 'not-real',
  }), /未注册/)
})

test('media plan bridge sends the product image and selected ratio to GPT Image 2 official', () => {
  const submission = buildMediaPlanSubmission({
    kind: 'image',
    title: '商品图复刻',
    prompt: '保留产品包装，复刻参考图的画面语言。',
    modelId: 'runninghub/api/rh-gpt2-official',
    ratio: '3:4',
    referenceImages: ['data:image/png;base64,product'],
  })

  assert.equal(submission.model, 'rh-gpt2-official')
  assert.equal(submission.plan.debug.referenceImageCount, 1)
  assert.equal(submission.plan.debug.normalizedParams.aspectRatio, '3:4')
  assert.equal(submission.plan.debug.normalizedParams.resolution, '1k')
})

test('media plan bridge reuses the creation contract for video', () => {
  const video = buildMediaPlanSubmission({
    kind: 'video',
    title: '海边短片',
    prompt: '清晨海边的缓慢推进镜头',
    modelId: 'runninghub/api/rh-grok-text-video',
    duration: 8,
  })
  assert.equal(video.type, 'video')
  assert.equal(video.videoParams?.duration, 8)
  assert.equal(video.source, 'creation')
})

test('creative chat exposes a reviewed plan and delegates execution to CreationPanel', () => {
  const root = process.cwd()
  const chat = readFileSync(join(root, 'src/components/chat/ChatPanel.vue'), 'utf8')
  const bubble = readFileSync(join(root, 'src/components/chat/MessageBubble.vue'), 'utf8')
  const creation = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const fileTree = readFileSync(join(root, 'src/components/filetree/ProjectFileTree.vue'), 'utf8')
  const card = readFileSync(join(root, 'src/components/chat/MediaPlanCard.vue'), 'utf8')
  const uploader = readFileSync(join(root, 'src/components/chat/FileUploader.vue'), 'utf8')
  const direct = readFileSync(join(root, 'src/composables/creativeChat.ts'), 'utf8')
  const web = readFileSync(join(root, 'src/composables/web/chatCloud.ts'), 'utf8')

  assert.match(direct, /MEDIA_PLAN_POLICY/)
  assert.match(web, /MEDIA_PLAN_POLICY/)
  assert.match(chat, /if \(isWebRuntime\.value\) attachMediaPlan\(lastAssistantMsg, mediaContext\)/)
  assert.match(chat, /attachMediaPlan\(reactiveAssistantMessage,/)
  assert.match(chat, /buildMediaPlanPolicy/)
  assert.match(chat, /buildRecentTaskReferences/)
  assert.match(chat, /materializeMediaPlanReferences/)
  assert.match(chat, /onEvent\('media-reference:add'/)
  assert.match(fileTree, /emitEvent\('media-reference:add'/)
  assert.match(fileTree, /application\/x-jc-media-reference/)
  assert.match(chat, /application\/x-jc-media-reference/)
  assert.match(creation, /emitEvent\('media-reference:add'/)
  assert.match(card, /plan\.mediaReferences/)
  assert.match(card, /props\.blocked/)
  assert.match(bubble, /:blocked="mediaPlanBlocked"/)
  assert.match(chat, /:media-plan-blocked="isMediaPlanBlocked/)
  assert.match(chat, /:media-plan-error="mediaPlanDisplayError/)
  assert.match(uploader, /mediaReferenceValue/)
  assert.match(
    uploader,
    /resource\s*\?\s*'project-reference'\s*:\s*modelValue/,
  )
  assert.match(chat, /kind: 'video'/)
  assert.match(bubble, /MediaPlanCard/)
  assert.match(chat, /@approve-media-plan="approveMediaPlan"/)
  assert.match(chat, /emitEvent\('media-plan-approved'/)
  assert.match(creation, /onEvent\('media-plan-approved'/)
  assert.match(creation, /buildMediaPlanSubmission\(data\.plan\)/)
  assert.match(creation, /mediaTaskStore\.submitTask\(submission\)/)
  assert.doesNotMatch(chat, /buildCreationSubmitRequest/)
})

test('media plan approval locks before refreshing references to prevent duplicate paid submissions', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/chat/ChatPanel.vue'), 'utf8')
  const start = source.indexOf('async function approveMediaPlan')
  const end = source.indexOf('\nfunction removeMediaReference', start)
  const approval = source.slice(start, end)

  assert.ok(start >= 0 && end > start)
  assert.ok(
    approval.indexOf("message.mediaPlanStatus = 'submitting'") <
      approval.indexOf('await refreshMediaPlanReferenceValues'),
  )
})

test('media plan card disables approval while its references or creation contract are invalid', () => {
  const source = readFileSync(join(process.cwd(), 'src/components/chat/MediaPlanCard.vue'), 'utf8')

  assert.match(source, /const canApprove = computed/)
  assert.match(source, /reference\.invalidReason/)
  assert.match(source, /validateMediaPlan\(props\.plan\)/)
  assert.match(source, /:disabled="!canApprove"/)
})
