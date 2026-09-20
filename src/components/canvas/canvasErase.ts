/**
 * canvasErase.ts — 画布图片擦除
 *
 * 把画布上框选的一块交给 Rust 侧 vendored 的 `spot_heal`（Compositor, MIT）擦掉，
 * 结果作为一张新图片返回。原图不会被改动。
 *
 * 为什么只传「选区外扩后的小块」而不是整图：桌面端 IPC 走 JSON 序列化，
 * 整图 base64 会到几十 MB；而 `spot_heal` 只改选区内的像素，块内其余部分原样返回，
 * 所以贴回原图不会有接缝。
 *
 * 设计与实测见 `docs/wiki/开发/画布图像擦除能力SDD-2026-09-19.md`。
 */
export interface EraseRect {
  x: number
  y: number
  width: number
  height: number
}

interface Size {
  width: number
  height: number
}

/**
 * 选区外扩的最小边距。
 * `spot_heal` 要在周边找匹配的补丁做取样源，块太小会没有可用的 donor。
 */
const MIN_MARGIN = 64

/** 选区外扩成实际交给算法的像素块，并夹到图片范围内。 */
export function expandEraseRegion(rect: EraseRect, image: Size): EraseRect {
  const margin = Math.max(MIN_MARGIN, Math.round(Math.max(rect.width, rect.height)))
  const x = Math.max(0, Math.floor(rect.x) - margin)
  const y = Math.max(0, Math.floor(rect.y) - margin)
  const right = Math.min(image.width, Math.ceil(rect.x + rect.width) + margin)
  const bottom = Math.min(image.height, Math.ceil(rect.y + rect.height) + margin)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

/**
 * 画布节点本地坐标 → 图片原始像素坐标。
 * 画布上的图片节点是缩放显示过的（`CANVAS_MEDIA_WIDTH`），两者不是同一把尺子。
 */
export function toImagePixelRect(rect: EraseRect, node: Size, image: Size): EraseRect {
  const scaleX = node.width ? image.width / node.width : 1
  const scaleY = node.height ? image.height / node.height : 1
  return {
    x: rect.x * scaleX,
    y: rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  }
}

/** 选区太小的话擦不出东西，还容易把用户的一次误点当成擦除。 */
export const MIN_ERASE_SIDE = 4

export function isEraseRectUsable(rect: EraseRect): boolean {
  return rect.width >= MIN_ERASE_SIDE && rect.height >= MIN_ERASE_SIDE
}

function bytesToBase64(bytes: Uint8Array): string {
  // ponytail: 分块避免 String.fromCharCode 参数溢出，块大小取 32K 是常见安全值。
  const chunk = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/** 输出直接喂给 `ImageData`，所以用 Uint8ClampedArray 而不是 Uint8Array。 */
function base64ToBytes(value: string): Uint8ClampedArray<ArrayBuffer> {
  const binary = atob(value)
  const bytes = new Uint8ClampedArray(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * 取一张不污染 canvas 的图片。
 * `asset://` 等自定义协议直接塞给 `<img>` 会让 canvas 变成 tainted、`getImageData` 抛错，
 * 所以先 fetch 成同源 blob 再解码。
 */
async function loadCleanImage(url: string): Promise<HTMLImageElement> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`无法读取图片（${response.status}）`)
  const blobUrl = URL.createObjectURL(await response.blob())
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('无法解码这张图片'))
      image.src = blobUrl
    })
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

export interface EraseImageOptions {
  /** 能直接被 fetch 的图片地址。 */
  sourceUrl: string
  /** 图片原始像素坐标下的选区。 */
  rect: EraseRect
  /** 0 内容感知 / 1 生成纹理 / 2 邻近匹配。 */
  mode?: number
}

export interface EraseImageResult {
  /** 擦除后的整图 PNG，base64（不含 `data:` 前缀）。 */
  base64: string
  mime: string
}

/** 擦掉 `rect` 选中的像素，返回整张新图。原图不变。 */
export async function eraseImageRegion(options: EraseImageOptions): Promise<EraseImageResult> {
  if (!isEraseRectUsable(options.rect)) throw new Error('选区太小，框大一点再试')

  const image = await loadCleanImage(options.sourceUrl)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法创建画布上下文')
  context.drawImage(image, 0, 0)

  const region = expandEraseRegion(options.rect, { width: canvas.width, height: canvas.height })
  if (!region.width || !region.height) throw new Error('选区超出图片范围')

  const pixels = context.getImageData(region.x, region.y, region.width, region.height)
  const { invoke } = await import('@tauri-apps/api/core')
  const output = await invoke<{ pixelsBase64: string }>('erase_image_region', {
    input: {
      pixelsBase64: bytesToBase64(new Uint8Array(pixels.data.buffer)),
      width: region.width,
      height: region.height,
      rectX: Math.round(options.rect.x) - region.x,
      rectY: Math.round(options.rect.y) - region.y,
      rectWidth: Math.round(options.rect.width),
      rectHeight: Math.round(options.rect.height),
      mode: options.mode ?? 0,
      opacity: 1,
    },
  }).catch((error: unknown) => {
    // Tauri 把 Rust 的 Err(String) 直接当 reject 值抛出来，不是 Error 实例。
    const reason = typeof error === 'string' ? error : (error as Error)?.message
    throw new Error(reason || '后台没有响应')
  })

  context.putImageData(
    new ImageData(base64ToBytes(output.pixelsBase64), region.width, region.height),
    region.x,
    region.y,
  )
  return { base64: canvas.toDataURL('image/png').split(',')[1] || '', mime: 'image/png' }
}
