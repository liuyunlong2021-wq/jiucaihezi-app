import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { isAllowedCreationResultUrl, isAllowedCreationPollUrl, isAllowedDownloadUrl, isAllowedExternalUrl, isAllowedMediaAttachmentUrl, normalizeEditorLinkUrl } from '../urlSafety'

test('normalizeEditorLinkUrl allows web and mail links and rejects scriptable protocols', () => {
  assert.equal(normalizeEditorLinkUrl('https://jiucaihezi.studio/docs'), 'https://jiucaihezi.studio/docs')
  assert.equal(normalizeEditorLinkUrl('example.com/path'), 'https://example.com/path')
  assert.equal(normalizeEditorLinkUrl('mailto:hello@example.com'), 'mailto:hello@example.com')
  assert.equal(normalizeEditorLinkUrl('javascript:alert(1)'), null)
  assert.equal(normalizeEditorLinkUrl('data:text/html,<script>alert(1)</script>'), null)
  assert.equal(normalizeEditorLinkUrl('file:///Users/by3/secret.txt'), null)
})

test('isAllowedExternalUrl permits browser and payment schemes only', () => {
  assert.equal(isAllowedExternalUrl('https://pay.example.com/qrcode'), true)
  assert.equal(isAllowedExternalUrl('alipays://platformapi/startapp'), true)
  assert.equal(isAllowedExternalUrl('weixin://wxpay/bizpayurl'), true)
  assert.equal(isAllowedExternalUrl('mailto:hello@example.com'), true)
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false)
  assert.equal(isAllowedExternalUrl('data:text/html,<script>alert(1)</script>'), false)
  assert.equal(isAllowedExternalUrl('file:///Users/by3/secret.txt'), false)
})

test('download and media attachment url guards reject unsafe protocols and broad data urls', () => {
  assert.equal(isAllowedDownloadUrl('https://cdn.example.com/file.pdf'), true)
  assert.equal(isAllowedDownloadUrl('asset://localhost/Users/by3/Library/Application%20Support/jiucaihezi/media-outputs/audio.mp3'), true)
  assert.equal(isAllowedDownloadUrl('data:text/html,<script>alert(1)</script>'), true)
  assert.equal(isAllowedDownloadUrl('file:///Users/by3/secret.txt'), false)
  assert.equal(isAllowedDownloadUrl('javascript:alert(1)'), false)

  assert.equal(isAllowedMediaAttachmentUrl('data:image/png;base64,YWJj'), true)
  assert.equal(isAllowedMediaAttachmentUrl('data:video/mp4;base64,YWJj'), true)
  assert.equal(isAllowedMediaAttachmentUrl('https://cdn.example.com/image.png'), true)
  assert.equal(isAllowedMediaAttachmentUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), false)
  assert.equal(isAllowedMediaAttachmentUrl('data:image/png,not-base64'), false)
  assert.equal(isAllowedMediaAttachmentUrl('data:text/html,<script>alert(1)</script>'), false)
  assert.equal(isAllowedMediaAttachmentUrl('javascript:alert(1)'), false)

  assert.equal(isAllowedCreationResultUrl('https://cdn.jiucaihezi.studio/result.png'), true)
  assert.equal(isAllowedCreationResultUrl('https://api.jiucaihezi.studio/api/creations/files/result.png'), true)
  assert.equal(isAllowedCreationResultUrl('https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/output/result.mp4'), true)
  assert.equal(isAllowedCreationResultUrl('https://cdn.sd2.mengfactory.cn/sd2/result-assets/result.mp4'), true)
  assert.equal(isAllowedCreationResultUrl('https://webstatic.aiproxy.vip/output/result.png'), true)
  assert.equal(isAllowedCreationResultUrl('asset://localhost/Users/by3/Library/Application%20Support/jiucaihezi/media-outputs/audio.mp3'), false)
  assert.equal(isAllowedCreationResultUrl('blob:https://jiucaihezi.studio/result'), false)
  assert.equal(isAllowedCreationResultUrl('https://cdn.example.com/result.png'), false)
  assert.equal(isAllowedCreationResultUrl('javascript:alert(1)'), false)
  assert.equal(isAllowedCreationResultUrl('file:///Users/by3/result.png'), false)
})

test('Tauri CSP allows approved creation result CDN hosts used for media caching', () => {
  const tauriConfig = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri/tauri.conf.json'), 'utf8'))
  const csp = String(tauriConfig.app?.security?.csp || '')
  const connectSrc = csp.split(';').map(part => part.trim()).find(part => part.startsWith('connect-src ')) || ''
  const mediaSrc = csp.split(';').map(part => part.trim()).find(part => part.startsWith('media-src ')) || ''

  assert.match(connectSrc, /https:\/\/\*\.aiproxy\.vip/)
  assert.match(connectSrc, /https:\/\/aiproxy\.vip/)
  assert.doesNotMatch(connectSrc, /(^|\s)https:(\s|$)/)
  assert.match(mediaSrc, /(^|\s)data:(\s|$)/)
  assert.match(mediaSrc, /(^|\s)blob:(\s|$)/)
  assert.match(mediaSrc, /(^|\s)https:(\s|$)/)
})

test('creation poll url guard only allows known task polling paths', () => {
  assert.equal(isAllowedCreationPollUrl('/api/creations/tasks/rh_task_001'), true)
  assert.equal(isAllowedCreationPollUrl('/api/seedance/v1/videos/seedance_task_001'), true)
  assert.equal(isAllowedCreationPollUrl('/v1/images/generations/image_task_001'), true)
  assert.equal(isAllowedCreationPollUrl('/v1/audio/generations/audio_task_001'), true)
  assert.equal(isAllowedCreationPollUrl('/v1/videos/video_task_001'), true)
  assert.equal(isAllowedCreationPollUrl('/v2/videos/generations/video_task_001'), true)
  assert.equal(isAllowedCreationPollUrl('/rh/tasks/rh_task_001'), true)
  assert.equal(isAllowedCreationPollUrl('/rh/tasks/rh_task_001?ai_app=true'), true)
  assert.equal(isAllowedCreationPollUrl('/suno/fetch/suno_task_001'), true)
  assert.equal(isAllowedCreationPollUrl('/api/user/self'), false)
  assert.equal(isAllowedCreationPollUrl('/rh/tasks/rh_task_001?redirect=/api/user/self'), false)
  assert.equal(isAllowedCreationPollUrl('https://api.jiucaihezi.studio/api/creations/tasks/rh_task_001'), false)
  assert.equal(isAllowedCreationPollUrl('/api/creations/tasks/../../user/self'), false)
})
