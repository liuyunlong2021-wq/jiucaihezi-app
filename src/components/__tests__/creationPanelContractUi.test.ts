import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const root = process.cwd()

test('creation panel reads registry-backed plan state instead of legacy RH-only model heuristics', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /CREATION_PANEL_MODELS/)
  assert.match(source, /currentCreationSpec/)
  assert.match(source, /currentRunPlan/)
  assert.match(source, /currentRunPlanError/)
  assert.match(source, /currentSubmitSummary/)
  assert.doesNotMatch(source, /currentContractWarnings/)
  assert.doesNotMatch(source, /cp-contract-warnings/)

  assert.doesNotMatch(source, /RH_CREATION_MODELS/)
  assert.doesNotMatch(source, /validateMediaModelInputs/)
  assert.doesNotMatch(source, /const rhMode = computed/)
})

test('creation panel persists and restores complete Leafer scene snapshots', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /app\.tree\.children\.map\(child => stripRuntimeVideoPoster\(child\.toJSON\(\) as CanvasSceneNode\)\)/)
  assert.match(source, /canvasStore\.getCanvasDocument\(getCanvasScene\(\)\)/)
  assert.match(source, /restoreCanvasScene\((?:document!?|result\.document)(?:, path)?\)/)
  assert.match(source, /UI\.one\(node(?: as any)?\)/)
  assert.match(source, /canvasRestoring/)
  assert.match(source, /flushQueuedCanvasMedia\(\)/)
  assert.match(source, /定位当前画布/)
  assert.match(source, /新建画布/)
  assert.match(source, /canvas:locate/)
  assert.match(source, /onCanvasPaste/)
  assert.match(source, /addCanvasFiles/)
  assert.match(source, /referenceNodeIds/)
  assert.doesNotMatch(source, /canvasEditOperation/)
  assert.doesNotMatch(source, /替换原图/)
  assert.match(source, /lockRatio:\s*true/)
  assert.doesNotMatch(source, /middlePoint:/)
  assert.match(source, /cornerRadius:\s*6/)
})

test('creation panel uses a static video reference node and native preview instead of a canvas player', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /moveLayer/)
  assert.match(source, /rotateLeft/)
  assert.match(source, /flipHorizontal/)
  assert.match(source, /showCanvasMore/)
  assert.match(source, /extractVideoFirstFrameThumbnail/)
  assert.match(source, /createVideoReferenceNode/)
  assert.match(source, /openVideoPreview/)
  assert.match(source, /stripRuntimeVideoPoster/)
  assert.match(source, /getMediaSubmissionUrl/)
  assert.match(source, /result\.truncated/)
  assert.match(source, /预览不可用/)
  assert.doesNotMatch(source, /VideoPlayer/)
  assert.doesNotMatch(source, /requestAnimationFrame\(this\.renderTick\)/)
})
