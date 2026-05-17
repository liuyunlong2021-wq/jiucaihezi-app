/**
 * @deprecated
 * useCreationEngine.ts — 旧版阻塞式创作引擎 (V5)
 * 此文件已废弃。全域媒体生成现已统一迁移至 store/mediaTaskStore.ts。
 * 保留此文件仅为了短期回退需要，稳定后将删除。
 */
import { cpState, currentModel, addResult } from '@/composables/useCreation'
import { RH_CREATION_MODELS } from '@/data/creationModels'
import { generateImage, generateVideo, generateAudio } from '@/api/media-generation'

// ─── 主入口（fire-and-forget，支持并发） ───
export function runCreation() {
  const m = currentModel.value
  if (!m) {
    showCreationError('请先选择模型')
    return
  }
  if (!cpState.prompt.trim() && m.provider !== 'newapi-suno') {
    showCreationError('请输入提示词')
    return
  }

  // 快照参数（允许用户在生成中修改参数继续提交）
  const snapshot = {
    modelKey: cpState.modelKey,
    prompt: cpState.prompt,
    task: cpState.task,
    ar: cpState.ar,
    size: cpState.size,
    res: cpState.res,
    dur: cpState.dur,
    files: [...cpState.files],
  }

  // 并发计数器 +1
  cpState.runningTasks++
  cpState.generating = cpState.runningTasks > 0
  cpState.progressText = `${cpState.runningTasks}个任务生成中...`

  // Fire-and-forget: 不 await，允许连续点击
  _executeCreation(snapshot).finally(() => {
    cpState.runningTasks--
    cpState.generating = cpState.runningTasks > 0
    if (cpState.runningTasks > 0) {
      cpState.progressText = `${cpState.runningTasks}个任务生成中...`
    } else if (!cpState.progressText.startsWith('生成失败:')) {
      cpState.progress = 0
      cpState.progressText = ''
    }
  })
}

// ─── 实际执行（每个任务独立） ───
async function _executeCreation(snap: {
  modelKey: string; prompt: string; task: string;
  ar: string; size: string; res: string; dur: number; files: File[];
}) {
  const modelDef = RH_CREATION_MODELS[snap.modelKey]
  if (!modelDef) throw new Error(`未知模型: ${snap.modelKey}`)

  // 从 provider 推断类型
  const mediaType = modelDef.provider === 'newapi-image' ? 'image'
    : modelDef.provider === 'newapi-suno' ? 'audio' : 'video'

  const onProgress = (elapsed: number, status: string) => {
    cpState.progressText = `${cpState.runningTasks}个任务 · ${Math.round(elapsed)}s · ${status}`
  }

  try {
    if (mediaType === 'image') {
      // 智能检测：有文件就自动当图生图（不依赖 task 选择器）
      const hasRefImage = snap.files.length > 0
      const imageParam = hasRefImage
        ? await fileToDataUrl(snap.files[0])
        : undefined

      const result = await generateImage({
        model: modelDef.modelName,
        prompt: snap.prompt,
        size: snap.size !== 'auto' ? snap.size : undefined,
        aspectRatio: snap.ar || '1:1',
        resolution: snap.res || '1k',
        image: imageParam,
      }, onProgress)

      addResult({ url: result.url, type: 'image', model: modelDef.label, task: hasRefImage ? 'image-image' : 'text-image', ts: Date.now() })

    } else if (mediaType === 'video') {
      // 智能检测：有文件就自动当图生视频
      const hasRefImage = snap.files.length > 0
      
      // 支持多图
      let imageUrl: string | undefined
      let imageUrls: string[] | undefined
      
      if (hasRefImage) {
        if (snap.files.length === 1) {
          imageUrl = await fileToDataUrl(snap.files[0])
        } else {
          imageUrls = await Promise.all(snap.files.map(f => fileToDataUrl(f)))
        }
      }

      const result = await generateVideo({
        model: modelDef.modelName,
        prompt: snap.prompt,
        aspectRatio: snap.ar || '16:9',
        resolution: snap.res,
        duration: snap.dur,
        imageUrl,
        imageUrls,
      }, onProgress)

      addResult({ url: result.url, type: 'video', model: modelDef.label, task: hasRefImage ? 'image-video' : 'text-video', ts: Date.now() })

    } else if (mediaType === 'audio') {
      const result = await generateAudio(snap.prompt)
      addResult({ url: result.url, type: 'audio', model: modelDef.label, task: 'text-music', ts: Date.now() })
    }
  } catch (e: any) {
    // BUG-8 修复: 用状态文字替代 alert()，避免多任务并发时阻塞 UI
    const errMsg = e.message || String(e)
    showCreationError(errMsg.slice(0, 100))
    console.error('Creation engine error:', e)
  }
}

function showCreationError(message: string) {
  cpState.progress = 0
  cpState.progressText = `生成失败: ${message}`
}

// ─── 工具 ───

/** 读取文件并压缩图片（防止 413 请求体过大） */
async function fileToDataUrl(f: File): Promise<string> {
  // 非图片直接读取
  if (!f.type.startsWith('image/')) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(f)
    })
  }

  // 图片：加载到 canvas 压缩
  const MAX_DIM = 2048  // 最大边长
  const MAX_SIZE = 4 * 1024 * 1024  // 4MB

  const img = new Image()
  const url = URL.createObjectURL(f)
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = reject
    img.src = url
  })
  URL.revokeObjectURL(url)

  let { width, height } = img
  // 缩放到最大边长
  if (width > MAX_DIM || height > MAX_DIM) {
    const scale = MAX_DIM / Math.max(width, height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, width, height)

  // 尝试不同质量直到小于 MAX_SIZE
  for (const quality of [0.9, 0.8, 0.7, 0.5]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (dataUrl.length * 0.75 < MAX_SIZE) return dataUrl
  }
  return canvas.toDataURL('image/jpeg', 0.5)
}
