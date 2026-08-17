const IMAGE_SIZE_LIMITS = {
  '1k': { longEdge: 1536, shortEdge: 1024, maxPixels: Number.POSITIVE_INFINITY },
  '2k': { longEdge: 2048, shortEdge: 2048, maxPixels: Number.POSITIVE_INFINITY },
  '4k': { longEdge: 3840, shortEdge: 3840, maxPixels: 8_294_400 },
} as const

export function sizeFromRatioResolution(ratio: string, resolution?: string): string {
  const explicit = /^(\d+)x(\d+)$/.exec(ratio)
  if (explicit) return `${explicit[1]}x${explicit[2]}`

  const match = /^(\d+):(\d+)$/.exec(ratio)
  if (!match) return '1024x1024'

  const ratioWidth = Number(match[1])
  const ratioHeight = Number(match[2])
  if (!ratioWidth || !ratioHeight) return '1024x1024'

  const tier = resolution === '2k' || resolution === '4k' ? resolution : '1k'
  const limits = IMAGE_SIZE_LIMITS[tier]
  const divisor = greatestCommonDivisor(ratioWidth, ratioHeight)
  const widthStep = (ratioWidth / divisor) * 16
  const heightStep = (ratioHeight / divisor) * 16
  const square = ratioWidth === ratioHeight
  const widthLimit = square
    ? limits.shortEdge
    : ratioWidth > ratioHeight
      ? limits.longEdge
      : limits.shortEdge
  const heightLimit = square
    ? limits.shortEdge
    : ratioHeight > ratioWidth
      ? limits.longEdge
      : limits.shortEdge
  const edgeScale = Math.floor(Math.min(widthLimit / widthStep, heightLimit / heightStep))
  const pixelScale = Math.floor(Math.sqrt(limits.maxPixels / (widthStep * heightStep)))
  const scale = Math.max(1, Math.min(edgeScale, pixelScale))

  return `${widthStep * scale}x${heightStep * scale}`
}

export function detectImageMimeFromBytes(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'image/png'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
    return 'image/gif'
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp'
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return 'image/webp'
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  )
    return 'image/tiff'
  if (String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...bytes.slice(8, 12))
    if (['heic', 'heix', 'hevc', 'hevx'].includes(brand)) return 'image/heic'
    if (['mif1', 'msf1'].includes(brand)) return 'image/heif'
  }
  return undefined
}

function greatestCommonDivisor(left: number, right: number): number {
  while (right) [left, right] = [right, left % right]
  return left
}
