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

  assert.match(source, /app\.tree\.children\s*\.filter\(child => child\.tag !== 'SimulateElement'\)\s*\.map\(child => stripRuntimeVideoPoster\(child\.toJSON\(\) as CanvasSceneNode\)\)/)
  assert.match(source, /canvasStore\.getCanvasDocument\(getCanvasScene\(\)\)/)
  assert.match(source, /restoreCanvasScene\((?:document!?|result\.document)(?:, path(?:, projectId)?)?\)/)
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
  assert.match(source, /PointerEvent\.TAP/)
  assert.match(source, /getLocalPoint\(card\)/)
  assert.match(source, /handleVideoPreviewError/)
  assert.match(source, /open_in_shell/)
  assert.match(source, /createVideoReferenceNode/)
  assert.match(source, /openVideoPreview/)
  assert.match(source, /stripRuntimeVideoPoster/)
  assert.match(source, /getMediaSubmissionUrl/)
  assert.match(source, /async function getMediaSubmissionUrl\(filePath: string\): Promise<string> \{\s+return getMediaRuntimeUrl\(filePath\)/)
  assert.match(source, /result\.truncated/)
  assert.match(source, /nextCanvasMediaPosition/)
  assert.match(source, /fitCanvasImageSize/)
  assert.match(source, /selectCanvasReferences/)
  assert.match(source, /EditorEvent\.AFTER_SELECT/)
  assert.match(source, /selectedReferenceSummary/)
  assert.match(source, /scheduleInitialCanvasFit/)
  assert.match(source, /mediaDisplayName/)
  assert.match(source, /videoDisplayLabel/)
  assert.match(source, /setVideoReferenceLayout/)
  assert.match(source, /VIDEO_CAPTION_HEIGHT/)
  assert.match(source, /field\.key !== 'customWidth' && field\.key !== 'customHight'\) \|\| cpState\.ar === 'custom'/)
  assert.match(source, /textWrap:\s*'none'/)
  assert.doesNotMatch(source, /Math\.random\(\)/)
  assert.doesNotMatch(source, /预览不可用/)
  assert.doesNotMatch(source, /VideoPlayer/)
  assert.doesNotMatch(source, /requestAnimationFrame\(this\.renderTick\)/)
})

test('canvas media nodes are draggable and selected canvas references drive the displayed run mode', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /new Group\(\{\s*id, editable: true, draggable: true/)
  assert.match(source, /new Image\(\{ id: layer\.id, url, editable: true, draggable: true/)
  assert.match(source, /function addMediaToCanvas[\s\S]*?canvasTool\('select'\)/)
  assert.match(source, /const canvasReferenceRunPlan = computed/)
  assert.match(source, /params: buildCurrentCreationParams\(\{ images, videos, audios: \[\] \}\)/)
  assert.match(source, /canvasReferenceRunPlan\.value\?\.mode \|\| currentRunPlan\.value\?\.mode/)
})

test('canvas text and number markers use Leafer page coordinates', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /const onTextDown = \(e: any\) => \{\s+const point = e\.getPagePoint\(\)/)
  assert.match(source, /x: point\.x, y: point\.y/)
  assert.match(source, /const onNumberDown = \(e: any\) => \{\s+const point = e\.getPagePoint\(\)/)
  assert.match(source, /x: point\.x - 14, y: point\.y - 14/)
})

test('canvas viewport tools keep the viewport center stable', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /function setCanvasViewportScale\(scale: number, focus\?: \{ x: number; y: number \}\)/)
  assert.match(source, /const worldCenterX = focus\?\.x \?\? \(width \/ 2 - x\) \/ currentScale/)
  assert.match(source, /const worldCenterY = focus\?\.y \?\? \(height \/ 2 - y\) \/ currentScale/)
  assert.match(source, /case 'fit': arrangeCanvasMedia\(\); fitCanvasViewport\(\); break/)
  assert.match(source, /case 'zoomIn': setCanvasViewportScale\(Number\(app\.zoomLayer\.scale \|\| 1\) \* 1\.3\); break/)
  assert.match(source, /case 'zoomOut': setCanvasViewportScale\(Number\(app\.zoomLayer\.scale \|\| 1\) \/ 1\.3\); break/)
  assert.doesNotMatch(source, /case 'zoomIn': app\.zoomLayer\.scale/)
})

test('canvas fit arranges media into a centered grid before framing it', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /function arrangeCanvasMedia\(\)/)
  assert.match(source, /filter\(child => Boolean\(canvasStore\.assets\[String\(child\.id\)\]\)\)/)
  assert.match(source, /const columns = Math\.ceil\(Math\.sqrt\(media\.length\)\)/)
  assert.match(source, /canvasStore\.updateLayerPosition\(String\(node\.id\), node\.x, node\.y\)/)
  assert.match(source, /const children = app\.tree\.children\.filter\(child => Boolean\(canvasStore\.assets\[String\(child\.id\)\]\)\)/)
  assert.match(source, /case 'fit': arrangeCanvasMedia\(\); fitCanvasViewport\(\); break/)
})

test('new canvas media is placed beside the existing media bounds', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /const media = app\?\.tree\.children\.filter\(child => Boolean\(canvasStore\.assets\[String\(child\.id\)\]\)\) \|\| \[\]/)
  assert.match(source, /const maxRight = Math\.max\(\.\.\.media\.map\(node => Number\(node\.x \|\| 0\) \+ Number\(node\.width \|\| CANVAS_MEDIA_WIDTH\)\)\)/)
  assert.match(source, /x: maxRight \+ CANVAS_MEDIA_GAP/)
})

test('canvas restore skips Leafer runtime nodes and supports Ctrl+S persistence', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /filter\(child => child\.tag !== 'SimulateElement'\)/)
  assert.match(source, /if \(\(node as any\)\.tag === 'SimulateElement'\) continue/)
  assert.match(source, /if \(!restored \|\| restored\.destroyed\) continue/)
  assert.match(source, /if \(asset && !\(restored as any\)\.locked\) \(restored as any\)\.set\(\{ editable: true, draggable: true \}\)/)
  assert.match(source, /ctrl && e\.key\.toLowerCase\(\) === 's'/)
  assert.match(source, /void flushCanvasSave\(\)/)
})

test('creation panel keeps Web canvases bound to their project owner', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /const projectStore = useProjectStore\(\)/)
  assert.match(source, /const canvasProjectId = ref\(''\)/)
  assert.match(source, /function canvasLastPathKey\(projectId: string\)/)
  assert.match(source, /`jc_canvas_last_path:\$\{projectId\}`/)
  assert.match(source, /localStorage\.getItem\(canvasLastPathKey\(projectId\)\)/)
  assert.match(source, /localStorage\.setItem\(canvasLastPathKey\(projectId\), path\)/)
  assert.match(source, /const canvasOwner = canvasProjectId\.value \|\| undefined/)
  assert.match(source, /saveCanvas\([\s\S]*?canvasOwner/)
  assert.match(source, /restoreCanvasAtPath\(path, projectId \|\| undefined\)/)
  assert.match(source, /path === canvasStore\.canvasPath && projectId === canvasProjectId\.value/)
  assert.match(source, /watch\(\(\) => projectStore\.webProjectId\.value/)
  assert.match(source, /projectId !== canvasProjectId\.value\) await flushCanvasSave\(\)/)
  assert.match(source, /if \(!isTauriRuntime\(\) && !projectId\) \{\s+if \(canvasReady\) await flushCanvasSave\(\)\s+canvasReady = false\s+canvasProjectId\.value = ''\s+app\.tree\.clear\(\)\s+canvasRestoring = false/)
})
