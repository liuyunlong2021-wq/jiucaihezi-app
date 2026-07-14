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
  assert.match(source, /restoreCanvasScene\((?:document!?|result\.document), path, owner/)
  assert.match(source, /UI\.one\(node(?: as any)?\)/)
  assert.match(source, /canvasRestoring/)
  assert.match(source, /flushQueuedCanvasMedia\(/)
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
  assert.match(source, /async function getMediaSubmissionUrl\(filePath: string, owner: string\): Promise<string>/)
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

test('creation panel keeps canvases bound to their runtime owner', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /const projectStore = useProjectStore\(\)/)
  assert.match(source, /const canvasOwner = ref\(''\)/)
  assert.match(source, /function selectedCanvasOwner\(\): string \{\s+return isTauriRuntime\(\) \? projectStore\.projectDir\.value : projectStore\.webProjectId\.value/)
  assert.match(source, /function canvasLastPathKey\(owner: string\)/)
  assert.match(source, /`jc_canvas_last_path:\$\{owner\}`/)
  assert.match(source, /localStorage\.getItem\(canvasLastPathKey\(owner\)\)/)
  assert.match(source, /localStorage\.setItem\(canvasLastPathKey\(owner\), path\)/)
  assert.match(source, /const owner = canvasOwner\.value \|\| undefined/)
  assert.match(source, /saveCanvas\([\s\S]*?owner/)
  assert.match(source, /restoreCanvasAtPath\(path, owner\)/)
  assert.match(source, /path === canvasStore\.canvasPath && owner === canvasOwner\.value/)
  assert.match(source, /watch\(\(\) => selectedCanvasOwner\(\), owner =>/)
  assert.match(source, /owner !== canvasOwner\.value\) \{\s+await flushCanvasSave\(\)/)
  assert.match(source, /if \(!owner\) \{\s+if \(canvasReady\) \{\s+await flushCanvasSave\(\)\s+if \(!isCurrentCanvasLoad\(loadToken, owner\)\) return\s+\}\s+if \(!isCurrentCanvasLoad\(loadToken, owner\)\) return\s+canvasReady = false\s+canvasOwner\.value = ''\s+releaseCanvasRuntimeMediaUrls\(\)\s+app\.tree\.clear\(\)\s+return/)
})

test('creation panel reopens an existing project canvas before creating one', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /async function loadCanvasForProject[\s\S]*?const files = await listCanvasFiles\(owner\)[\s\S]*?const first = files\[0\][\s\S]*?restoreCanvasAtPath\(first\.path, owner\)[\s\S]*?if \(result\.status !== 'ready'\) throw new Error\('画布无法打开'\)[\s\S]*?else \{[\s\S]*?const created = await createCanvasFile\(owner\)/)
})

test('creation panel fences stale restores and drains queued media after restoration', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const load = source.match(/async function loadCanvasForProject[\s\S]*?\n}\n\nwatch\(/)?.[0] || ''

  assert.match(source, /let canvasLoadToken = 0/)
  assert.match(load, /const loadToken = \+\+canvasLoadToken/)
  assert.ok((load.match(/if \(!isCurrentCanvasLoad\(loadToken, owner\)\) return/g) || []).length >= 8)
  assert.match(source, /const queued = queuedCanvasMedia\.splice\(0\)/)
  assert.match(load, /canvasRestoring = false\s+await flushQueuedCanvasMedia\(/)
  assert.match(source, /async function createAndOpenCanvas[\s\S]*?await flushCanvasSave\(\)[\s\S]*?if \(!isCurrentCanvasOwner\(owner\)\) return[\s\S]*?createCanvasFile\(owner\)/)
  assert.match(source, /onBeforeUnmount\(\(\) => \{\s+\+\+canvasLoadToken/)
})

test('creation panel resolves Web project media without serializing object URLs', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /import \{ webProjectFiles \} from '@\/utils\/webProjectFiles'/)
  assert.match(source, /webProjectFiles\.readBinary\(owner, filePath\)/)
  assert.match(source, /URL\.createObjectURL\(blob\)/)
  assert.match(source, /URL\.revokeObjectURL\(url\)/)
  assert.match(source, /canvasRuntimeMediaUrls\.clear\(\)/)
  assert.match(source, /releaseCanvasRuntimeMediaUrls\(\)\s+app\.tree\.clear\(\)/)
  assert.match(source, /webProjectFiles\.readBinaryDataUrl\(owner, filePath\)/)
  assert.match(source, /asset\.path, asset\.id, owner, canContinue/)
  assert.match(source, /asset\.path, owner\)/)
  assert.match(source, /getMediaSubmissionUrl\(isTauriRuntime\(\) \? `\$\{owner\}\/\$\{asset\.path\}` : asset\.path, owner\)/)
})

test('creation panel rejects direct Web blob drops until project upload exists', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /if \(!isTauriRuntime\(\) && filePath\.startsWith\('blob:'\)\) \{\s+cpState\.progressText = 'Web 端暂不支持直接拖入或粘贴媒体，请先保存到项目文件后加入画布'\s+return/)
  assert.match(source, /async function addCanvasFiles[\s\S]*?if \(!isTauriRuntime\(\)\) \{\s+cpState\.progressText = 'Web 端暂不支持直接拖入或粘贴媒体，请先保存到项目文件后加入画布'\s+return/)
})

test('creation panel snapshots debounced saves and binds media work to its restore owner', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const schedule = source.match(/function scheduleCanvasSave\(\)[\s\S]*?\n}\n\nasync function flushCanvasSave/)?.[0] || ''
  const load = source.match(/async function loadCanvasForProject[\s\S]*?\n}\n\nwatch\(/)?.[0] || ''
  const addMedia = source.match(/async function addMediaToCanvas[\s\S]*?\n}\n\nasync function flushQueuedCanvasMedia/)?.[0] || ''

  assert.match(schedule, /if \(!app \|\| !canvasReady \|\| canvasRestoring\) return/)
  assert.match(schedule, /const document = canvasStore\.getCanvasDocument\(getCanvasScene\(\)\)/)
  assert.match(schedule, /setTimeout\(\(\) => \{\s+saveTimer = undefined\s+void saveCanvas\(document, path, owner\)/)
  assert.doesNotMatch(schedule, /setTimeout\([\s\S]*?getCanvasDocument\(getCanvasScene\(\)\)/)
  assert.match(load, /canvasRestoring = true[\s\S]*?await flushCanvasSave\(\)/)
  assert.match(load, /canvasRestoring = true\s+try \{[\s\S]*?await flushCanvasSave\(\)/)

  assert.match(source, /interface CanvasMediaRequest \{[\s\S]*?owner: string[\s\S]*?loadToken: number/)
  assert.match(source, /function captureCanvasMediaRequest\(/)
  assert.match(addMedia, /const request = queuedRequest \|\| captureCanvasMediaRequest\(/)
  assert.match(addMedia, /if \(!isCurrentCanvasMediaRequest\(request\)\) return/)
  assert.match(addMedia, /queuedCanvasMedia\.push\(request\)/)
  assert.ok((addMedia.match(/if \(!isCurrentCanvasMediaRequest\(request\)\) return/g) || []).length >= 3)
  assert.match(source, /async function flushQueuedCanvasMedia\(owner: string, loadToken: number\)/)
  assert.match(source, /request\.owner !== owner \|\| request\.loadToken !== loadToken/)
})

test('creation task resolution keeps the event-time canvas owner', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const sync = source.match(/const offCanvasSync = onEvent\('media-task-settled',[\s\S]*?\n}\)\n\n\/\*\* 文件树/)?.[0] || ''

  assert.match(source, /function captureCanvasMediaOwnership\(\)/)
  assert.match(sync, /const ownership = captureCanvasMediaOwnership\(\)\s+void nextTick/)
  assert.match(sync, /if \(!isCurrentCanvasMediaRequest\(ownership\)\) return[\s\S]*?const filePath = await resolveTaskFilePath\(task\)\s+if \(!isCurrentCanvasMediaRequest\(ownership\) \|\| !filePath\) return/)
  assert.match(sync, /await addMediaToCanvas\(filePath, task\.type, 'creation', task\.prompt \|\| '', task\.modelLabel \|\| '', captureCanvasMediaRequest\(filePath, task\.type, 'creation', task\.prompt \|\| '', task\.modelLabel \|\| '', ownership\)\)/)
})

test('canvas file imports retain the drop-time canvas owner', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const addFiles = source.match(/async function addCanvasFiles[\s\S]*?\n}\n\nfunction onCanvasImport/)?.[0] || ''

  assert.match(addFiles, /const ownership = captureCanvasMediaOwnership\(\)/)
  assert.ok((addFiles.match(/if \(!isCurrentCanvasMediaRequest\(ownership\)\) return/g) || []).length >= 4)
  assert.match(addFiles, /await addMediaToCanvas\(filePath, kind, 'drop', file\.name, '', captureCanvasMediaRequest\(filePath, kind, 'drop', file\.name, '', ownership\)\)/)
  assert.match(addFiles, /await addMediaToCanvas\(base64, kind, 'drop', file\.name, '', captureCanvasMediaRequest\(base64, kind, 'drop', file\.name, '', ownership\)\)/)
})

test('creation panel guards Desktop owner changes and deferred initial fit', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const mediaUrl = source.match(/async function getMediaRuntimeUrl[\s\S]*?\n}\n\nasync function getMediaSubmissionUrl/)?.[0] || ''
  const fit = source.match(/function scheduleInitialCanvasFit[\s\S]*?\n}\n\nfunction mediaDisplayName/)?.[0] || ''
  const addMedia = source.match(/async function addMediaToCanvas[\s\S]*?\n}\n\nasync function flushQueuedCanvasMedia/)?.[0] || ''
  const taskResult = source.match(/const offCanvasTaskResult = onEvent\('canvas:task-result',[\s\S]*?\n}\)\n\n\/\*\* 读取 CSS/)?.[0] || ''

  assert.match(source, /function isCurrentCanvasOwner\(owner: string\): boolean \{\s+return owner === selectedCanvasOwner\(\)/)
  assert.match(source, /function isCurrentCanvasMediaRequest\(request: CanvasMediaOwnership\): boolean \{[\s\S]*?request\.owner === canvasMediaOwner\(\)[\s\S]*?request\.owner === selectedCanvasOwner\(\)/)
  assert.match(mediaUrl, /const projectDir = owner/)
  assert.doesNotMatch(mediaUrl, /useProjectStore\(\)\.projectDir\.value/)
  assert.match(fit, /function scheduleInitialCanvasFit\(canContinue: CanvasLoadGuard = \(\) => true\) \{\s+window\.setTimeout\(\(\) => \{\s+if \(canContinue\(\)\) canvasTool\('fit'\)/)
  assert.match(addMedia, /if \(shouldFit\) scheduleInitialCanvasFit\(\(\) => isCurrentCanvasMediaRequest\(request\)\)/)
  assert.match(taskResult, /if \(payload\?\.owner !== canvasOwner\.value \|\| payload\.owner !== selectedCanvasOwner\(\)\) return/)
  assert.match(taskResult, /const loadToken = canvasLoadToken/)
  assert.match(taskResult, /restoreCanvasScene\(payload\.document, canvasStore\.canvasPath, owner, \(\) => isCurrentCanvasLoad\(loadToken, owner\)\)/)
})
