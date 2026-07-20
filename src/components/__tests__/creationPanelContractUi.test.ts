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

test('ecommerce-approved media plans enter the existing Creation task engine and return their task result', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /buildMediaPlanSubmission/)
  assert.match(source, /ecommerce-media-plan-approved/)
  assert.match(source, /mediaTaskStore\.submitTask\(submission\)/)
  assert.match(source, /source: 'creation'/)
  assert.match(source, /ecommerce-media-plan-submitted/)
})

test('creation panel persists and restores complete Leafer scene snapshots', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(
    source,
    /app\.tree\.children\s*\.filter\(child => child\.tag !== 'SimulateElement'\)\s*\.map\(child => \{\s+const node = stripRuntimeVideoPoster\(child\.toJSON\(\) as CanvasSceneNode\)/,
  )
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
  assert.match(
    source,
    /async function getMediaSubmissionUrl\(filePath: string, owner: string\): Promise<string>/,
  )
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
  assert.match(
    source,
    /field\.key !== 'customWidth' && field\.key !== 'customHight'\)[\s\S]{0,80}\|\|[\s\S]{0,40}cpState\.ar === 'custom'/,
  )
  assert.match(source, /textWrap:\s*'none'/)
  assert.doesNotMatch(source, /Math\.random\(\)/)
  assert.doesNotMatch(source, /预览不可用/)
  assert.doesNotMatch(source, /VideoPlayer/)
  assert.doesNotMatch(source, /requestAnimationFrame\(this\.renderTick\)/)
})

test('creation panel restores audio as a native audio card without submitting it as an image reference', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /function createAudioReferenceNode/)
  assert.match(source, /tag = 'canvas-audio-card'/)
  assert.match(source, /asset\?\.kind === 'audio'/)
  assert.match(source, /new Audio\(src\)/)
  assert.match(source, /if \(asset\.kind === 'audio'\) continue/)
  assert.match(
    source,
    /payload\?\.kind === 'image' \|\| payload\?\.kind === 'video' \|\| payload\?\.kind === 'audio'/,
  )
  assert.match(source, /onProjectResourceChange\(reconcileCurrentCanvasMedia\)/)
  assert.match(source, /function relinkSelectedCanvasAsset/)
  assert.match(source, /if \(relinkCanvasAsset\(filePath, kind, projectId\)\) return/)
  assert.match(source, /accept="image\/\*,video\/\*,audio\/\*"/)
})

test('creation panel restores the canvas once after applying every media change in a resource batch', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const reconcile =
    source.match(
      /function reconcileCurrentCanvasMedia[\s\S]*?\n}\n\nconst offProjectResourceChange/,
    )?.[0] || ''

  assert.match(
    reconcile,
    /const changed = flattenProjectResourceChange\(change\)\.some\(reconcileCurrentCanvasMediaEntry\)/,
  )
  assert.match(reconcile, /if \(changed\) restoreCurrentCanvasMedia\(\)/)
  assert.doesNotMatch(reconcile, /flattenProjectResourceChange\(change\)\.forEach/)
})

test('Desktop audio playback reads project bytes instead of relying on the asset protocol', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const toggleAudio =
    source.match(
      /async function toggleCanvasAudio[\s\S]*?\n}\n\nasync function hydrateAudioReferenceNode/,
    )?.[0] || ''

  assert.match(
    toggleAudio,
    /const src = isTauriRuntime\(\)[\s\S]{0,120}\? await getMediaSubmissionUrl\(filePath, owner\)[\s\S]{0,80}: await getMediaRuntimeUrl\(filePath, owner\)/,
  )
  assert.match(toggleAudio, /audio\.onerror/)
})

test('creation panel renders missing video as a missing card and releases deleted asset URLs', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const restore =
    source.match(
      /async function restoreCanvasScene[\s\S]*?\n}\n\nasync function openCanvas/,
    )?.[0] || ''
  const deletion = source.match(/case 'delete':[\s\S]*?break/)?.[0] || ''

  assert.match(
    restore,
    /if \(asset\?\.missing\) \{[\s\S]*?createMissingMediaNode[\s\S]*?if \(asset\?\.kind === 'video'\)/,
  )
  assert.match(deletion, /releaseCanvasAssetRuntimeUrl\(assetId\)/)
})

test('creation panel removes only unreferenced deleted assets before it saves the canvas', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const deletion = source.match(/case 'delete':[\s\S]*?break/)?.[0] || ''

  assert.match(deletion, /unreferencedCanvasAssetIds\(getCanvasScene\(\), deletedAssetIds\)/)
  assert.match(deletion, /delete canvasStore\.assets\[assetId\]/)
  assert.match(deletion, /canvasStore\.removeLayer\(assetId\)/)
  assert.match(deletion, /saveCanvasHistory\(\)/)
})

test('canvas media nodes are draggable and selected canvas references drive the displayed run mode', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /new Group\(\{[\s\S]{0,80}id,[\s\S]{0,80}editable: true,[\s\S]{0,80}draggable: true/)
  assert.match(source, /new Image\(\{[\s\S]{0,80}id: layer\.id,[\s\S]{0,80}url,[\s\S]{0,80}editable: true,[\s\S]{0,80}draggable: true/)
  assert.match(source, /function addMediaToCanvas[\s\S]*?canvasTool\('select'\)/)
  assert.match(source, /const canvasReferenceRunPlan = computed/)
  assert.match(source, /params: buildCurrentCreationParams\(\{ images, videos, audios: \[\] \}\)/)
  assert.match(source, /canvasReferenceRunPlan\.value\?\.mode \|\| currentRunPlan\.value\?\.mode/)
})

test('canvas text and number markers use Leafer page coordinates', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /const onTextDown = \(e: any\) => \{\s+const point = e\.getPagePoint\(\)/)
  assert.match(source, /x: point\.x,[\s\S]{0,40}y: point\.y/)
  assert.match(source, /const onNumberDown = \(e: any\) => \{\s+const point = e\.getPagePoint\(\)/)
  assert.match(source, /x: point\.x - 14,[\s\S]{0,40}y: point\.y - 14/)
})

test('canvas viewport tools keep the viewport center stable', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(
    source,
    /function setCanvasViewportScale\(scale: number, focus\?: \{ x: number; y: number \}\)/,
  )
  assert.match(source, /const worldCenterX = focus\?\.x \?\? \(width \/ 2 - x\) \/ currentScale/)
  assert.match(source, /const worldCenterY = focus\?\.y \?\? \(height \/ 2 - y\) \/ currentScale/)
  assert.match(source, /case 'fit':[\s\S]{0,80}arrangeCanvasMedia\(\)[\s\S]{0,80}fitCanvasViewport\(\)[\s\S]{0,40}break/)
  assert.match(
    source,
    /case 'zoomIn':\s+setCanvasViewportScale\(Number\(app\.zoomLayer\.scale \|\| 1\) \* 1\.3\)\s+break/,
  )
  assert.match(
    source,
    /case 'zoomOut':\s+setCanvasViewportScale\(Number\(app\.zoomLayer\.scale \|\| 1\) \/ 1\.3\)\s+break/,
  )
  assert.doesNotMatch(source, /case 'zoomIn': app\.zoomLayer\.scale/)
})

test('canvas fit arranges media into a centered grid before framing it', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /function arrangeCanvasMedia\(\)/)
  assert.match(source, /filter\(child => Boolean\(canvasStore\.assets\[String\(child\.id\)\]\)\)/)
  assert.match(source, /const columns = Math\.ceil\(Math\.sqrt\(media\.length\)\)/)
  assert.match(source, /canvasStore\.updateLayerPosition\(String\(node\.id\), node\.x, node\.y\)/)
  assert.match(
    source,
    /const children = app\.tree\.children\.filter\(child => Boolean\(canvasStore\.assets\[String\(child\.id\)\]\)\)/,
  )
  assert.match(source, /case 'fit':[\s\S]{0,80}arrangeCanvasMedia\(\)[\s\S]{0,80}fitCanvasViewport\(\)[\s\S]{0,40}break/)
})

test('new canvas media is placed beside the existing media bounds', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(
    source,
    /const media =[\s\S]{0,80}app\?\.tree\.children\.filter\(child => Boolean\(canvasStore\.assets\[String\(child\.id\)\]\)\) \|\| \[\]/,
  )
  assert.match(
    source,
    /const maxRight = Math\.max\(\s+\.\.\.media\.map\(node => Number\(node\.x \|\| 0\) \+ Number\(node\.width \|\| CANVAS_MEDIA_WIDTH\)\),?\s+\)/,
  )
  assert.match(source, /x: maxRight \+ CANVAS_MEDIA_GAP/)
})

test('canvas restore skips Leafer runtime nodes and supports Ctrl+S persistence', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(source, /filter\(child => child\.tag !== 'SimulateElement'\)/)
  assert.match(source, /if \(\(node as any\)\.tag === 'SimulateElement'\) continue/)
  assert.match(source, /if \(!restored \|\| restored\.destroyed\) continue/)
  assert.match(
    source,
    /if \(asset && !\(restored as any\)\.locked\)[\s\S]{0,80}\(restored as any\)\.set\(\{ editable: true, draggable: true \}\)/,
  )
  assert.match(source, /ctrl && e\.key\.toLowerCase\(\) === 's'/)
  assert.match(source, /void flushCanvasSave\(\)/)
})

test('creation panel keeps canvases bound to their runtime owner', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const load = source.match(/async function loadCanvasForProject[\s\S]*?\n}\n\nwatch\(/)?.[0] || ''
  const clearOwner = load.match(/if \(!owner\) \{[\s\S]*?\n    }/)?.[0] || ''

  assert.match(source, /const projectStore = useProjectStore\(\)/)
  assert.match(source, /const canvasOwner = ref\(''\)/)
  assert.match(
    source,
    /function selectedCanvasOwner\(\): string \{\s+return isTauriRuntime\(\) \? projectStore\.projectDir\.value : projectStore\.webProjectId\.value/,
  )
  assert.match(source, /function canvasLastPathKey\(owner: string\)/)
  assert.match(source, /`jc_canvas_last_path:\$\{owner\}`/)
  assert.match(source, /localStorage\.getItem\(canvasLastPathKey\(owner\)\)/)
  assert.match(source, /localStorage\.setItem\(canvasLastPathKey\(owner\), path\)/)
  assert.match(source, /const owner = canvasOwner\.value \|\| undefined/)
  assert.match(source, /saveCanvas\([\s\S]*?owner/)
  assert.match(source, /restoreCanvasAtPath\(path, owner\)/)
  assert.match(
    source,
    /path === canvasStore\.canvasPath\s+&&\s+owner === canvasOwner\.value/,
  )
  assert.match(source, /watch\(\s+\(\) => selectedCanvasOwner\(\),\s+owner =>/)
  assert.match(
    source,
    /owner !== canvasOwner\.value && !staleGate\) \{\s+await flushCanvasSave\(\)/,
  )
  assert.doesNotMatch(clearOwner, /flushCanvasSave\(/)
})

test('creation panel snapshots the canvas target owner before async reference resolution', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const target =
    source.match(/if \(selected\.length && canvasStore\.canvasPath\) \{[\s\S]*?\n  \}/)?.[0] || ''
  const canvasTypes = readFileSync(join(root, 'src/types/canvas.ts'), 'utf8')

  assert.match(canvasTypes, /export interface CanvasTaskTarget \{[\s\S]*?owner\?: string/)
  assert.match(target, /const owner = canvasOwner\.value \|\| selectedCanvasOwner\(\)/)
  assert.match(target, /const canvasId = canvasStore\.canvasId/)
  assert.match(target, /const canvasPath = canvasStore\.canvasPath/)
  assert.match(target, /canvasTarget = \{[\s\S]{0,100}canvasId,[\s\S]{0,60}canvasPath,[\s\S]{0,60}owner,[\s\S]{0,60}operation: 'append'/)
})

test('creation panel reopens an existing project canvas before creating one', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const load = source.match(/async function loadCanvasForProject[\s\S]*?\n}\n\nwatch\(/)?.[0] || ''

  assert.match(
    load,
    /const files = await listCanvasFiles\(owner\)[\s\S]*?const first = files\[0\][\s\S]*?restoreCanvasAtPath\(first\.path, owner\)[\s\S]*?if \(result\.status === 'error'\) throw result\.error[\s\S]*?if \(result\.status !== 'ready'\) throw new Error\('画布文件不存在或已被移除'\)[\s\S]*?else \{[\s\S]*?const created = await createCanvasFile\(owner\)/,
  )
})

test('creation panel clears a recovered canvas error and preserves its real failure reason', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const open =
    source.match(
      /async function openCanvas[\s\S]*?\n}\n\nasync function createAndOpenCanvas/,
    )?.[0] || ''
  const create =
    source.match(
      /async function createAndOpenCanvas[\s\S]*?\n}\n\nasync function loadCanvasForProject/,
    )?.[0] || ''
  const load = source.match(/async function loadCanvasForProject[\s\S]*?\n}\n\nwatch\(/)?.[0] || ''

  assert.match(
    source,
    /function reportCanvasRestoreFailure\(error: unknown\)[\s\S]*?画布无法打开: \$\{reason}\。原文件未被覆盖/,
  )
  assert.match(
    source,
    /function clearCanvasRestoreFailure\(\)[\s\S]*?cpState\.progressText\.startsWith\('画布无法打开'\)/,
  )
  assert.match(open, /canvasReady = true\s+clearCanvasRestoreFailure\(\)/)
  assert.match(create, /canvasReady = true\s+clearCanvasRestoreFailure\(\)/)
  assert.match(load, /canvasReady = true\s+clearCanvasRestoreFailure\(\)/)
  assert.match(
    source,
    /loadCanvasForProject\(owner\)\.catch\(error => \{[\s\S]*?reportCanvasRestoreFailure\(error\)/,
  )
})

test('creation panel fences stale restores and drains queued media after restoration', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const load = source.match(/async function loadCanvasForProject[\s\S]*?\n}\n\nwatch\(/)?.[0] || ''

  assert.match(source, /let canvasLoadToken = 0/)
  assert.match(load, /const loadToken = \+\+canvasLoadToken/)
  assert.ok(
    (load.match(/if \(!isCurrentCanvasLoad\(loadToken, owner\)\) return/g) || []).length >= 3,
  )
  assert.match(source, /const queued = queuedCanvasMedia\.splice\(0\)/)
  assert.match(load, /setCanvasRestoring\(false\)\s+await flushQueuedCanvasMedia\(/)
  assert.match(
    source,
    /async function createAndOpenCanvas[\s\S]*?await flushCanvasSave\(\)[\s\S]*?createCanvasFile\(owner\)/,
  )
  assert.match(source, /onBeforeUnmount\(\(\) => \{\s+\+\+canvasLoadToken/)
})

test('creation panel resolves Web project media without serializing object URLs', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const runtime =
    source.match(
      /async function getMediaRuntimeUrl[\s\S]*?\n}\n\nasync function getMediaSubmissionUrl/,
    )?.[0] || ''

  assert.match(source, /createProjectFileActions\(createRuntimeProjectFileService\(\)\)/)
  assert.match(source, /projectFileActions\.readMedia\(\{/)
  assert.match(source, /const bytes = new Uint8Array\(binary\.data\.byteLength\)/)
  assert.match(source, /bytes\.set\(binary\.data\)/)
  assert.match(
    source,
    /URL\.createObjectURL\(new Blob\(\[bytes\.buffer\], \{ type: binary\.mimeType \}\)\)/,
  )
  assert.match(source, /URL\.revokeObjectURL\(url\)/)
  assert.match(source, /canvasAssetUrlResolver\.releaseAll\(\)/)
  assert.match(source, /releaseCanvasRuntimeMediaUrls\(\)\s+app\.tree\.clear\(\)/)
  assert.match(source, /projectFileActions\.readMediaDataUrl\(\{/)
  assert.match(
    source,
    /isTauriRuntime\(\) \? `\$\{projectDir\}\/\$\{asset\.resource\.path\}` : asset\.resource\.path,\s+asset\.id,\s+owner,\s+canContinue/,
  )
  assert.match(
    source,
    /isTauriRuntime\(\) \? `\$\{projectDir\}\/\$\{asset\.resource\.path\}` : asset\.resource\.path,\s+owner/,
  )
  assert.match(
    source,
    /getMediaSubmissionUrl\(\s+isTauriRuntime\(\) \? `\$\{owner\}\/\$\{mediaPath\}` : mediaPath,\s+owner,?\s+\)/,
  )
  assert.match(runtime, /canvasAssetUrlResolver\.acquire\(owner, filePath/)
  assert.match(runtime, /projectFileActions\.readMedia\(\{/)
  assert.match(source, /import \{ CanvasAssetUrlResolver \}/)
})

test('creation panel resolves file-tree media from its project-relative event payload', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const receiver =
    source.match(/function addFileTreeMediaToCanvas\([\s\S]*?\n}\n\nconst offFileTreeMedia/)?.[0] ||
    ''
  const mounted =
    source.match(/const pendingMedia = consumeLastEvent\('canvas:add-media'\)[\s\S]*?\n  }/)?.[0] ||
    ''

  assert.match(receiver, /const projectId = String\(payload\?\.projectId \|\| ''\)/)
  assert.match(receiver, /const path = String\(payload\?\.path \|\| ''\)/)
  assert.match(
    receiver,
    /const filePath = isTauriRuntime\(\) \? `\$\{projectId\}\/\$\{path\}` : path/,
  )
  assert.match(
    receiver,
    /captureCanvasMediaRequest\(filePath, kind, 'import', label, '', \{[\s\S]{0,100}owner: projectId,[\s\S]{0,60}loadToken: canvasLoadToken/,
  )
  assert.doesNotMatch(receiver, /payload\.url/)
  assert.match(source, /if \(!owner \|\| !isWebProjectMediaPath\(filePath\)\) return filePath/)
  assert.match(mounted, /addFileTreeMediaToCanvas\(payload\)/)
})

test('creation panel rejects direct Web blob drops until project upload exists', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')

  assert.match(
    source,
    /if \(!isTauriRuntime\(\) && filePath\.startsWith\('blob:'\)\) \{\s+cpState\.progressText = 'Web 端暂不支持直接拖入或粘贴媒体，请先保存到项目文件后加入画布'\s+return/,
  )
  assert.match(
    source,
    /async function addCanvasFiles[\s\S]*?if \(!isTauriRuntime\(\)\) \{\s+cpState\.progressText = 'Web 端暂不支持直接拖入或粘贴媒体，请先保存到项目文件后加入画布'\s+return/,
  )
})

test('creation panel snapshots debounced saves and binds media work to its restore owner', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const schedule =
    source.match(
      /function scheduleCanvasSave\(\)[\s\S]*?\n}\n\nasync function flushCanvasSave/,
    )?.[0] || ''
  const load = source.match(/async function loadCanvasForProject[\s\S]*?\n}\n\nwatch\(/)?.[0] || ''
  const addMedia =
    source.match(
      /async function addMediaToCanvas[\s\S]*?\n}\n\nasync function flushQueuedCanvasMedia/,
    )?.[0] || ''

  assert.match(
    schedule,
    /if \(!app \|\| !canvasReady \|\| canvasRestoring \|\| activeCanvasGate\) return/,
  )
  assert.match(schedule, /const document = canvasStore\.getCanvasDocument\(getCanvasScene\(\)\)/)
  assert.match(
    schedule,
    /setTimeout\(\(\) => \{\s+saveTimer = undefined\s+void saveCanvas\(document, path, owner\)/,
  )
  assert.doesNotMatch(schedule, /setTimeout\([\s\S]*?getCanvasDocument\(getCanvasScene\(\)\)/)
  assert.match(load, /setCanvasRestoring\(true\)[\s\S]*?await flushCanvasSave\(\)/)
  assert.match(load, /setCanvasRestoring\(true\)\s+try \{[\s\S]*?await flushCanvasSave\(\)/)

  assert.match(
    source,
    /interface CanvasMediaRequest \{[\s\S]*?owner: string[\s\S]*?loadToken: number/,
  )
  assert.match(source, /function captureCanvasMediaRequest\(/)
  assert.match(addMedia, /const request = queuedRequest \|\| captureCanvasMediaRequest\(/)
  assert.match(addMedia, /if \(!isCurrentCanvasMediaRequest\(request\)\) return/)
  assert.match(addMedia, /queuedCanvasMedia\.push\(request\)/)
  assert.ok(
    (addMedia.match(/if \(!isCurrentCanvasMediaRequest\(request\)\) return/g) || []).length >= 3,
  )
  assert.match(source, /async function flushQueuedCanvasMedia\(owner: string, loadToken: number\)/)
  assert.match(source, /request\.owner !== owner \|\| request\.loadToken !== loadToken/)
})

test('creation task resolution keeps the event-time canvas owner', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const sync =
    source.match(
      /const offCanvasSync = onEvent\('media-task-settled',[\s\S]*?\n}\)\n\nlet relinkCanvasAssetId/,
    )?.[0] || ''

  assert.match(source, /function captureCanvasMediaOwnership\(\)/)
  assert.match(sync, /const ownership = captureCanvasMediaOwnership\(\)\s+void nextTick/)
  assert.match(
    sync,
    /if \(!isCurrentCanvasMediaRequest\(ownership\)\) return[\s\S]*?const filePath = await resolveTaskFilePath\(task\)\s+if \(!isCurrentCanvasMediaRequest\(ownership\) \|\| !filePath\) return/,
  )
  assert.match(
    sync,
    /await addMediaToCanvas\([\s\S]{0,500}filePath,[\s\S]{0,80}task\.type,[\s\S]{0,80}'creation',[\s\S]{0,200}captureCanvasMediaRequest\([\s\S]{0,400}ownership[\s\S]{0,80}\)/,
  )
})

test('Desktop canvas file imports retain their owner only after project persistence', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const addFiles =
    source.match(/async function addCanvasFiles[\s\S]*?\n}\n\nfunction onCanvasImport/)?.[0] || ''

  assert.match(addFiles, /const ownership = captureCanvasMediaOwnership\(\)/)
  assert.match(
    addFiles,
    /if \(!projectDir\) \{\s+cpState\.progressText = '请先选择项目文件夹'\s+return/,
  )
  assert.ok(
    (addFiles.match(/if \(!isCurrentCanvasMediaRequest\(ownership\)\) return/g) || []).length >= 4,
  )
  assert.match(
    addFiles,
    /await addMediaToCanvas\([\s\S]{0,300}filePath,[\s\S]{0,80}kind,[\s\S]{0,80}'drop',[\s\S]{0,180}captureCanvasMediaRequest\([\s\S]{0,240}ownership[\s\S]{0,80}\)/,
  )
  assert.match(
    addFiles,
    /catch \{\s+if \(!isCurrentCanvasMediaRequest\(ownership\)\) return\s+cpState\.progressText = '导入失败，未保存到项目文件夹，请重试'/,
  )
  assert.doesNotMatch(addFiles, /URL\.createObjectURL/)
  assert.doesNotMatch(addFiles, /addMediaToCanvas\(base64/)
})

test('creation panel scopes task write gates to the current owner and canvas path', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const mediaUrl =
    source.match(
      /async function getMediaRuntimeUrl[\s\S]*?\n}\n\nasync function getMediaSubmissionUrl/,
    )?.[0] || ''
  const fit =
    source.match(
      /function scheduleInitialCanvasFit[\s\S]*?\n}\n\nfunction mediaDisplayName/,
    )?.[0] || ''
  const addMedia =
    source.match(
      /async function addMediaToCanvas[\s\S]*?\n}\n\nasync function flushQueuedCanvasMedia/,
    )?.[0] || ''
  const beforeWrite =
    source.match(
      /const offCanvasBeforeTaskWrite = onEvent\('canvas:before-task-write',[\s\S]*?\n}\)\n\nasync function restoreCanvasTaskResult/,
    )?.[0] || ''
  const taskRestore =
    source.match(
      /async function restoreCanvasTaskResult[\s\S]*?\n}\n\nconst offCanvasTaskResult/,
    )?.[0] || ''
  const taskResult =
    source.match(
      /const offCanvasTaskResult = onEvent\('canvas:task-result',[\s\S]*?\n}\)\n\n\/\*\* 读取 CSS/,
    )?.[0] || ''

  assert.match(
    source,
    /function isCurrentCanvasOwner\(owner: string\): boolean \{\s+return owner === selectedCanvasOwner\(\)/,
  )
  assert.match(
    source,
    /function isCurrentCanvasMediaRequest\(request: CanvasMediaOwnership\): boolean \{[\s\S]*?request\.owner === canvasMediaOwner\(\)[\s\S]*?request\.owner === selectedCanvasOwner\(\)/,
  )
  assert.match(mediaUrl, /const projectDir = owner/)
  assert.doesNotMatch(mediaUrl, /useProjectStore\(\)\.projectDir\.value/)
  assert.match(
    fit,
    /function scheduleInitialCanvasFit\(canContinue: CanvasLoadGuard = \(\) => true\) \{\s+window\.setTimeout\(\(\) => \{\s+if \(canContinue\(\)\) canvasTool\('fit'\)/,
  )
  assert.match(
    addMedia,
    /if \(shouldFit\) scheduleInitialCanvasFit\(\(\) => isCurrentCanvasMediaRequest\(request\)\)/,
  )
  assert.match(
    source,
    /interface CanvasGate \{[\s\S]*?owner: string[\s\S]*?path: string[\s\S]*?loadToken: number[\s\S]*?promise: Promise<void>[\s\S]*?release: \(\) => void/,
  )
  assert.match(
    source,
    /canvasInteractionBlocked\.value = canvasRestoring \|\| Boolean\(activeCanvasGate\)/,
  )
  assert.match(
    beforeWrite,
    /while \(activeCanvasGate\?\.owner === owner && activeCanvasGate\.path === path\) \{\s+await activeCanvasGate\.promise/,
  )
  assert.match(
    beforeWrite,
    /if \([\s\S]{0,100}path !== canvasStore\.canvasPath[\s\S]{0,100}owner !== canvasOwner\.value[\s\S]{0,100}owner !== selectedCanvasOwner\(\)[\s\S]{0,60}\)[\s\S]{0,30}return/,
  )
  assert.match(
    beforeWrite,
    /const gate: CanvasGate = createCanvasGate\(owner, path, canvasLoadToken\)\s+cancelCanvasInteraction\(\)[\s\S]*?await flushCanvasSave\(\)[\s\S]*?payload\.release = gate\.release/,
  )
  assert.match(taskRestore, /const loadToken = \+\+canvasLoadToken/)
  assert.match(
    taskRestore,
    /canvasReady = false\s+setCanvasRestoring\(true\)\s+cancelCanvasInteraction\(\)/,
  )
  assert.match(taskRestore, /const result = await restoreCanvasAtPath\(path, owner\)/)
  assert.match(
    taskRestore,
    /await restoreCanvasScene\(result\.document, path, owner, \(\) =>\s+isCurrentCanvasTarget\(loadToken, owner, path\),?\s+\)/,
  )
  assert.doesNotMatch(taskRestore, /saveCanvas\(/)
  assert.match(taskResult, /if \(await restoreCanvasTaskResult\(path, owner\)\) release\?\.\(\)/)
  assert.doesNotMatch(
    source,
    /canvasSaveEpoch|canvasSaveGeneration|canvasTaskRestoreToken|CanvasFileLifecycleLock|deferredTaskAppends/,
  )
})

test('creation panel blocks input while a scoped gate exists and guards file lifecycle mutations', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const lifecycle =
    source.match(
      /async function flushCanvasBeforeFileLifecycle[\s\S]*?const offCanvasLifecycleFailed/,
    )?.[0] || ''

  assert.match(
    source,
    /:class="\{[\s\S]{0,120}'cp-canvas-dragover': canvasDragOver,[\s\S]{0,120}'cp-canvas-interaction-blocked': canvasInteractionBlocked,[\s\S]{0,40}\}"/,
  )
  assert.match(
    source,
    /\.cp-canvas-zone\.cp-canvas-interaction-blocked \.cp-canvas-container \{\s+pointer-events: none;/,
  )
  assert.match(source, /if \(!app \|\| canvasInteractionBlocked\.value\) return/)
  assert.match(
    lifecycle,
    /const activeGate = activeCanvasGate\s+if \(activeGate && activeGate\.owner === owner\) throw new Error\('画布正在切换，请稍候'\)/,
  )
  assert.match(
    lifecycle,
    /if \(mediaTaskStore\.hasPendingCanvasWrite\(owner, path\)\)\s+throw new Error\('画布有待写入的生成结果，请稍候'\)\s+if \(\s+path !== canvasStore\.canvasPath/,
  )
  assert.match(
    lifecycle,
    /const gate = createCanvasGate\(owner, path, loadToken\)[\s\S]*?await flushCanvasSave\(\)[\s\S]*?if \(mediaTaskStore\.hasPendingCanvasWrite\(owner, path\)\)/,
  )
  assert.match(lifecycle, /payload\.release = gate\.release/)
})

test('creation panel serializes same-canvas task writes and waits for a matching gate before reopening', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const beforeWrite =
    source.match(
      /const offCanvasBeforeTaskWrite = onEvent\('canvas:before-task-write',[\s\S]*?\n}\)\n\nasync function restoreCanvasTaskResult/,
    )?.[0] || ''
  const open =
    source.match(
      /async function openCanvas[\s\S]*?\n}\n\nasync function createAndOpenCanvas/,
    )?.[0] || ''

  assert.match(
    beforeWrite,
    /while \(activeCanvasGate\?\.owner === owner && activeCanvasGate\.path === path\) \{\s+await activeCanvasGate\.promise/,
  )
  assert.match(
    beforeWrite,
    /const gate: CanvasGate = createCanvasGate\(owner, path, canvasLoadToken\)[\s\S]*?await flushCanvasSave\(\)[\s\S]*?payload\.release = gate\.release/,
  )
  assert.match(
    source,
    /function releaseStaleCanvasGate\(owner: string, path: string\) \{\s+const gate = activeCanvasGate\s+if \(gate && \(gate\.owner !== owner \|\| gate\.path !== path\)\) gate\.release\(\)/,
  )
  assert.match(
    open,
    /const currentGate = activeCanvasGate\s+if \(!keepGate && currentGate\?\.owner === owner && currentGate\.path === path\) \{\s+const waitingLoadToken = canvasLoadToken\s+await currentGate\.promise\s+if \(!isCurrentCanvasTarget\(waitingLoadToken, owner, path\) \|\| activeCanvasGate\) return\s+\}/,
  )
  assert.match(
    open,
    /const staleGate =[\s\S]*?!keepGate && currentGate[\s\S]*?\? currentGate\s+: undefined[\s\S]*?if \(canvasReady && !staleGate\) \{/,
  )
  assert.match(
    source,
    /function scheduleCanvasSave\(\) \{\s+if \(!app \|\| !canvasReady \|\| canvasRestoring \|\| activeCanvasGate\) return/,
  )
})

test('creation panel does not requeue a gated canvas snapshot while clearing an owner or unmounting', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const load = source.match(/async function loadCanvasForProject[\s\S]*?\n}\n\nwatch\(/)?.[0] || ''
  const clearOwner = load.match(/if \(!owner\) \{[\s\S]*?\n    }/)?.[0] || ''
  const unmount = source.match(/onBeforeUnmount\(\(\) => \{[\s\S]*?\n}\)\n\n\/\/ 任务/)?.[0] || ''

  assert.doesNotMatch(clearOwner, /flushCanvasSave\(/)
  assert.match(
    source,
    /async function flushCanvasSave\(\) \{\s+if \(!app \|\| !canvasReady\) return\s+const owner = canvasOwner\.value \|\| undefined\s+if \(!owner \|\| owner !== selectedCanvasOwner\(\)\) return/,
  )
  assert.doesNotMatch(unmount, /flushCanvasSave\(/)
})

test('task-result restore failures hand off the gate without reviving the stale canvas scene', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const taskRestore =
    source.match(
      /async function restoreCanvasTaskResult[\s\S]*?\n}\n\nconst offCanvasTaskResult/,
    )?.[0] || ''
  const taskResult =
    source.match(
      /const offCanvasTaskResult = onEvent\('canvas:task-result',[\s\S]*?\n}\)\n\n\/\*\* 读取 CSS/,
    )?.[0] || ''
  const failure = taskResult.match(/catch \(error\) \{[\s\S]*?\n  }/)?.[0] || ''

  assert.match(
    taskRestore,
    /canvasReady = false\s+setCanvasRestoring\(true\)\s+cancelCanvasInteraction\(\)\s+const result = await restoreCanvasAtPath\(path, owner\)/,
  )
  assert.match(
    failure,
    /cpState\.progressText = '画布任务结果无法恢复，请重新打开画布'\s+release\?\.\(\)/,
  )
  assert.doesNotMatch(failure, /canvasReady = true|setCanvasRestoring\(false\)/)
})

test('creation panel releases lifecycle gates only after replacement canvases open', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const renamed =
    source.match(
      /const offCanvasRenamed = onEvent\('canvas:renamed',[\s\S]*?\n}\)\nconst offCanvasDeleted/,
    )?.[0] || ''
  const deleted =
    source.match(
      /const offCanvasDeleted = onEvent\('canvas:deleted',[\s\S]*?\n}\)\nconst offCanvasLocate/,
    )?.[0] || ''
  const failure =
    source.match(
      /const offCanvasLifecycleFailed = onEvent\('canvas:lifecycle-failed',[\s\S]*?\n}\)/,
    )?.[0] || ''

  assert.match(
    renamed,
    /void openCanvas\(payload\.newPath, owner, true\)\s+\.then\(\(\) => payload\.release\?\.\(\)\)/,
  )
  assert.match(
    deleted,
    /if \(files\[0\]\) await openCanvas\(files\[0\]\.path, owner, true\)\s+else await createAndOpenCanvas\(owner, true\)\s+payload\.release\?\.\(\)/,
  )
  assert.match(
    failure,
    /if \(!gate \|\| payload\?\.release !== gate\.release\) return[\s\S]*?gate\.release\(\)/,
  )
  assert.match(
    source,
    /function isCurrentCanvasTarget\(loadToken: number, owner: string, path: string\): boolean/,
  )
})

test('creation panel previews persisted Web task media in MediaViewer without a remote fallback', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const preview =
    source.match(
      /async function previewTask\(task: MediaTask\)[\s\S]*?\n}\n\nasync function openTaskFolder/,
    )?.[0] || ''
  const webPreview = preview.match(/if \(!isTauriRuntime\(\)\) \{[\s\S]*?\n  }/)?.[0] || ''

  assert.match(source, /import MediaViewer from '@\/components\/media\/MediaViewer\.vue'/)
  assert.match(source, /const taskPreview = ref/)
  assert.match(source, /function closeTaskPreview\(\)/)
  assert.match(source, /task\.projectPath \|\| task\.assetUri \|\| task\.resultUrl/)
  assert.match(webPreview, /const projectId = String\(task\.projectId \|\| ''\)/)
  assert.match(webPreview, /const projectPath = String\(task\.projectPath \|\| ''\)/)
  assert.match(webPreview, /projectFileActions\.readMedia\(\{[\s\S]{0,160}owner: projectId,[\s\S]{0,100}path: projectPath/)
  assert.match(webPreview, /const bytes = new Uint8Array\(binary\.data\.byteLength\)/)
  assert.match(webPreview, /bytes\.set\(binary\.data\)/)
  assert.match(
    webPreview,
    /URL\.createObjectURL\(new Blob\(\[bytes\.buffer\], \{ type: binary\.mimeType \}\)\)/,
  )
  assert.doesNotMatch(webPreview, /openExternal|window\.open/)
  assert.match(
    source,
    /<MediaViewer[\s\S]*?v-if="taskPreview"[\s\S]*?mode="file"[\s\S]*?@close="closeTaskPreview"/,
  )
  assert.match(source, /URL\.revokeObjectURL\(taskPreviewObjectUrl\)/)
})

test('creation panel exposes a retry only for failed Web project persistence', () => {
  const source = readFileSync(join(root, 'src/components/creation/CreationPanel.vue'), 'utf8')
  const retry =
    source.match(
      /function canRetryWebMediaPersistence[\s\S]*?\n}\n\nasync function retryTaskPersistence[\s\S]*?\n}/,
    )?.[0] || ''
  assert.match(retry, /!isTauriRuntime\(\)/)
  assert.match(retry, /task\.source === 'creation'/)
  assert.match(retry, /task\.status === 'failed'/)
  assert.match(retry, /task\.assetStatus === 'failed'/)
  assert.match(retry, /await mediaTaskStore\.retryWebMediaPersistence\(task\.id\)/)
  assert.match(
    source,
    /v-if="canRetryWebMediaPersistence\(task\)"[\s\S]{0,100}@click="retryTaskPersistence\(task\)"[\s\S]{0,80}>\s*重试保存\s*<\/button>/,
  )
  assert.match(
    source,
    /v-if="\s+\(task\.status === 'success' \|\| isLegacyChatTask\(task\)\) &&\s+\(task\.projectPath \|\| task\.assetUri \|\| task\.resultUrl\)\s+"\s+@click="previewTask\(task\)"/,
  )
})
