import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = process.cwd()

test('tool warehouse no longer embeds media workbench — tools are GitHub-installed', () => {
  const source = readFileSync(join(root, 'src/components/tools/ToolWarehousePanel.vue'), 'utf8')

  assert.doesNotMatch(source, /MediaWorkbenchPanel/)
  for (const cardId of [
    'local_media_inspect',
    'local_media_process',
    'local_media_transcribe',
    'local_subtitle_burn',
  ]) {
    assert.doesNotMatch(source, new RegExp(cardId))
  }
})

test('media workbench uses direct user-facing action labels', () => {
  const source = readFileSync(join(root, 'src/components/tools/MediaWorkbenchPanel.vue'), 'utf8')

  for (const copy of ['音视频工坊', '查看信息', '转文字', '压缩转格式', '视频上字幕']) {
    assert.match(source, new RegExp(copy))
  }

  assert.match(source, /media_inspect_file/)
  assert.match(source, /media_transcribe_file/)
  assert.match(source, /media_process_file/)
  assert.match(source, /media_burn_subtitles/)
  assert.match(source, /media_open_file/)
  assert.match(source, /media_reveal_file/)
})

test('media workbench does not expose local dependency setup language', () => {
  const source = readFileSync(join(root, 'src/components/tools/MediaWorkbenchPanel.vue'), 'utf8')

  for (const forbidden of [/ffmpeg/i, /whisper/i, /PATH/, /Homebrew/i, /本地能力中心/, /等待配置/, /请安装/]) {
    assert.doesNotMatch(source, forbidden)
  }
})

test('media workbench gates actions by media capabilities before running', () => {
  const source = readFileSync(join(root, 'src/components/tools/MediaWorkbenchPanel.vue'), 'utf8')

  assert.match(source, /modeDisabledReason/)
  assert.match(source, /choiceDisabledReason/)
  assert.match(source, /转文字需要文件中包含音频/)
  assert.match(source, /视频上字幕需要选择视频文件/)
  assert.match(source, /导出音频需要文件中包含音频/)
})
