import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = process.cwd()

test('tool warehouse no longer embeds media url capture — tools are GitHub-installed', () => {
  const source = readFileSync(join(root, 'src/components/tools/ToolWarehousePanel.vue'), 'utf8')

  assert.doesNotMatch(source, /MediaUrlCapturePanel/)
  assert.doesNotMatch(source, /local_media_url_download/)
})

test('media url capture panel includes the SDD states and user-facing actions', () => {
  const source = readFileSync(join(root, 'src/components/tools/MediaUrlCapturePanel.vue'), 'utf8')

  for (const state of ['idle', 'inspecting', 'ready', 'downloading', 'done', 'cancelled', 'error']) {
    assert.match(source, new RegExp(`['"]${state}['"]`))
  }

  for (const copy of ['粘贴视频/音频网页链接', '下载到本地', '打开播放', '在 Finder 中显示', '取消下载']) {
    assert.match(source, new RegExp(copy))
  }
})

test('media url capture panel uses active tool commands instead of setup detection', () => {
  const source = readFileSync(join(root, 'src/components/tools/MediaUrlCapturePanel.vue'), 'utf8')

  assert.match(source, /media_url_inspect/)
  assert.match(source, /media_url_download/)
  assert.match(source, /cancel_media_url_download/)
  assert.match(source, /media_open_file/)
  assert.match(source, /media_reveal_file/)
  assert.match(source, /media-url-capture-progress/)
  assert.match(source, /downloadLocked/)
  assert.match(source, /downloadSnapshot/)
  assert.match(source, /保存位置/)
  assert.match(source, /thumbnailUrl/)
})

test('media url capture panel never exposes internal capture component setup to users', () => {
  const source = readFileSync(join(root, 'src/components/tools/MediaUrlCapturePanel.vue'), 'utf8')

  assert.doesNotMatch(source, /requiresYtdlpSetup/)
  assert.doesNotMatch(source, /detectYtdlpCapability/)
  assert.doesNotMatch(source, /ytdlp/i)
  assert.doesNotMatch(source, /yt-dlp/i)
  assert.doesNotMatch(source, /本地能力中心/)
  assert.doesNotMatch(source, /重新检测/)
  assert.doesNotMatch(source, /等待配置/)
})

test('media url capture panel gates unavailable download types and hides unfinished result actions', () => {
  const source = readFileSync(join(root, 'src/components/tools/MediaUrlCapturePanel.vue'), 'utf8')

  assert.match(source, /downloadKindDisabledReason/)
  assert.match(source, /selectDownloadKind/)
  assert.match(source, /这个链接没有可下载的视频/)
  assert.match(source, /这个链接没有可下载的音频/)
  assert.match(source, /这个链接没有可下载的字幕/)
  assert.doesNotMatch(source, /<button disabled>加入对话<\/button>/)
  assert.doesNotMatch(source, /<button disabled>转写字幕<\/button>/)
  assert.doesNotMatch(source, /<button disabled>抽取音频<\/button>/)
})

test('media url capture panel retries browser-state sites and carries that state into download', () => {
  const source = readFileSync(join(root, 'src/components/tools/MediaUrlCapturePanel.vue'), 'utf8')

  assert.match(source, /useBrowserSessionForCurrentUrl/)
  assert.match(source, /needsBrowserStateRetry/)
  assert.match(source, /inspectUrlWithBrowserState\(rawUrl, false\)/)
  assert.match(source, /inspectUrlWithBrowserState\(rawUrl, true\)/)
  assert.match(source, /useBrowserSession: useBrowserSessionForCurrentUrl\.value/)
  assert.match(source, /正在补充网站访问信息/)
})
