const ECC_CODEWORDS_PER_BLOCK_LOW = [
  0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28,
  28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
]

const NUM_ERROR_CORRECTION_BLOCKS_LOW = [
  0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8,
  8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
]

export function buildQrCodeSvgDataUrl(text: string): string {
  const clean = String(text || '').trim()
  if (!clean) return ''
  const modules = encodeQrCode(clean)
  const svg = renderQrSvg(modules)
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function encodeQrCode(text: string): boolean[][] {
  const data = new TextEncoder().encode(text)
  const version = findVersion(data.length)
  const size = version * 4 + 17
  const modules = makeMatrix(size, false)
  const isFunction = makeMatrix(size, false)

  drawFunctionPatterns(modules, isFunction, version)
  const dataCodewords = encodeDataCodewords(data, version)
  const allCodewords = addErrorCorrectionAndInterleave(dataCodewords, version)
  drawCodewords(modules, isFunction, allCodewords)
  applyMask(modules, isFunction)
  drawFormatBits(modules, isFunction)
  return modules
}

function findVersion(byteLength: number): number {
  for (let version = 1; version <= 40; version += 1) {
    const countBits = version < 10 ? 8 : 16
    const neededBits = 4 + countBits + byteLength * 8
    if (neededBits <= getNumDataCodewords(version) * 8) return version
  }
  throw new Error('支付链接过长，无法生成二维码')
}

function encodeDataCodewords(data: Uint8Array, version: number): number[] {
  const capacityBits = getNumDataCodewords(version) * 8
  const bits: number[] = []
  appendBits(bits, 0x4, 4)
  appendBits(bits, data.length, version < 10 ? 8 : 16)
  for (const byte of data) appendBits(bits, byte, 8)
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length))
  while (bits.length % 8 !== 0) bits.push(0)

  const result: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j]
    result.push(value)
  }
  for (let pad = 0xec; result.length < getNumDataCodewords(version); pad ^= 0xfd) result.push(pad)
  return result
}

function addErrorCorrectionAndInterleave(dataCodewords: number[], version: number): number[] {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS_LOW[version]
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK_LOW[version]
  const rawCodewords = getNumRawDataCodewords(version)
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)
  const divisor = reedSolomonComputeDivisor(blockEccLen)
  const blocks: number[][] = []
  let offset = 0

  for (let i = 0; i < numBlocks; i += 1) {
    const dataLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1)
    const data = dataCodewords.slice(offset, offset + dataLen)
    offset += dataLen
    const ecc = reedSolomonComputeRemainder(data, divisor)
    if (i < numShortBlocks) data.push(0)
    blocks.push(data.concat(ecc))
  }

  const result: number[] = []
  for (let i = 0; i < blocks[0].length; i += 1) {
    for (let j = 0; j < blocks.length; j += 1) {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(blocks[j][i])
    }
  }
  return result
}

function drawFunctionPatterns(modules: boolean[][], isFunction: boolean[][], version: number): void {
  const size = modules.length
  drawFinderPattern(modules, isFunction, 3, 3)
  drawFinderPattern(modules, isFunction, size - 4, 3)
  drawFinderPattern(modules, isFunction, 3, size - 4)

  for (let i = 0; i < size; i += 1) {
    setFunctionModule(modules, isFunction, 6, i, i % 2 === 0)
    setFunctionModule(modules, isFunction, i, 6, i % 2 === 0)
  }

  const align = getAlignmentPatternPositions(version)
  for (let i = 0; i < align.length; i += 1) {
    for (let j = 0; j < align.length; j += 1) {
      const overlapsFinder = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)
      if (!overlapsFinder) drawAlignmentPattern(modules, isFunction, align[i], align[j])
    }
  }

  drawFormatBits(modules, isFunction)
  if (version >= 7) drawVersionBits(modules, isFunction, version)
}

function drawFinderPattern(modules: boolean[][], isFunction: boolean[][], centerX: number, centerY: number): void {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const x = centerX + dx
      const y = centerY + dy
      if (x < 0 || y < 0 || x >= modules.length || y >= modules.length) continue
      const dist = Math.max(Math.abs(dx), Math.abs(dy))
      setFunctionModule(modules, isFunction, x, y, dist !== 2 && dist !== 4)
    }
  }
}

function drawAlignmentPattern(modules: boolean[][], isFunction: boolean[][], centerX: number, centerY: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy))
      setFunctionModule(modules, isFunction, centerX + dx, centerY + dy, dist !== 1)
    }
  }
}

function drawVersionBits(modules: boolean[][], isFunction: boolean[][], version: number): void {
  let rem = version
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ (((rem >>> 11) & 1) * 0x1f25)
  const bits = (version << 12) | rem
  const size = modules.length
  for (let i = 0; i < 18; i += 1) {
    const bit = ((bits >>> i) & 1) !== 0
    const a = size - 11 + (i % 3)
    const b = Math.floor(i / 3)
    setFunctionModule(modules, isFunction, a, b, bit)
    setFunctionModule(modules, isFunction, b, a, bit)
  }
}

function drawFormatBits(modules: boolean[][], isFunction: boolean[][]): void {
  const size = modules.length
  let data = 1 << 3 // Error correction level L, mask 0.
  let rem = data
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ (((rem >>> 9) & 1) * 0x537)
  data = ((data << 10) | rem) ^ 0x5412

  for (let i = 0; i <= 5; i += 1) setFunctionModule(modules, isFunction, 8, i, bitAt(data, i))
  setFunctionModule(modules, isFunction, 8, 7, bitAt(data, 6))
  setFunctionModule(modules, isFunction, 8, 8, bitAt(data, 7))
  setFunctionModule(modules, isFunction, 7, 8, bitAt(data, 8))
  for (let i = 9; i < 15; i += 1) setFunctionModule(modules, isFunction, 14 - i, 8, bitAt(data, i))
  for (let i = 0; i < 8; i += 1) setFunctionModule(modules, isFunction, size - 1 - i, 8, bitAt(data, i))
  for (let i = 8; i < 15; i += 1) setFunctionModule(modules, isFunction, 8, size - 15 + i, bitAt(data, i))
  setFunctionModule(modules, isFunction, 8, size - 8, true)
}

function drawCodewords(modules: boolean[][], isFunction: boolean[][], codewords: number[]): void {
  const size = modules.length
  let bitIndex = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (isFunction[y][x]) continue
        const bit = bitIndex < codewords.length * 8 && bitAt(codewords[bitIndex >>> 3], 7 - (bitIndex & 7))
        modules[y][x] = bit
        bitIndex += 1
      }
    }
  }
}

function applyMask(modules: boolean[][], isFunction: boolean[][]): void {
  for (let y = 0; y < modules.length; y += 1) {
    for (let x = 0; x < modules.length; x += 1) {
      if (!isFunction[y][x] && ((x + y) & 1) === 0) modules[y][x] = !modules[y][x]
    }
  }
}

function renderQrSvg(modules: boolean[][]): string {
  const border = 4
  const size = modules.length
  const commands: string[] = []
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y][x]) commands.push(`M${x + border},${y + border}h1v1h-1z`)
    }
  }
  const viewSize = size + border * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h${viewSize}v${viewSize}H0z"/><path fill="#211b0f" d="${commands.join('')}"/></svg>`
}

function getAlignmentPatternPositions(version: number): number[] {
  if (version === 1) return []
  const size = version * 4 + 17
  const count = Math.floor(version / 7) + 2
  const step = version === 32 ? 26 : Math.ceil((version * 4 + count * 2 + 1) / (count * 2 - 2)) * 2
  const result = [6]
  for (let pos = size - 7; result.length < count; pos -= step) result.splice(1, 0, pos)
  return result
}

function getNumRawDataCodewords(version: number): number {
  return Math.floor(getNumRawDataModules(version) / 8)
}

function getNumDataCodewords(version: number): number {
  return getNumRawDataCodewords(version) - ECC_CODEWORDS_PER_BLOCK_LOW[version] * NUM_ERROR_CORRECTION_BLOCKS_LOW[version]
}

function getNumRawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const count = Math.floor(version / 7) + 2
    result -= (25 * count - 10) * count - 55
    if (version >= 7) result -= 36
  }
  return result
}

function reedSolomonComputeDivisor(degree: number): number[] {
  const result = Array(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMultiply(root, 0x02)
  }
  return result
}

function reedSolomonComputeRemainder(data: number[], divisor: number[]): number[] {
  const result = Array(divisor.length).fill(0)
  for (const byte of data) {
    const factor = byte ^ result.shift()
    result.push(0)
    for (let i = 0; i < result.length; i += 1) result[i] ^= gfMultiply(divisor[i], factor)
  }
  return result
}

function gfMultiply(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function appendBits(result: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i -= 1) result.push((value >>> i) & 1)
}

function setFunctionModule(modules: boolean[][], isFunction: boolean[][], x: number, y: number, value: boolean): void {
  modules[y][x] = value
  isFunction[y][x] = true
}

function makeMatrix(size: number, value: boolean): boolean[][] {
  return Array.from({ length: size }, () => Array(size).fill(value))
}

function bitAt(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0
}
