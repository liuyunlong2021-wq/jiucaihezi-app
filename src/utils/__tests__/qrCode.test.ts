import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import { buildQrCodeSvgDataUrl } from '../qrCode'

/** 真实的配对信息（186 字节，落在二维码第 8 版）。 */
const OFFER = JSON.stringify({
  version: 1,
  address: '192.168.1.16:51796',
  desktopPublicKey: 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cX',
  offerId: '0d3ccc5-b092-4e9c-9314-fb5ef1a7c428',
  expiresAt: 1790512760357,
})

/**
 * 从我们自己的 SVG 里读回矩阵（深色模块坐标 + 尺寸，去掉 4 模块静区）。
 * 读 SVG 而不是调内部函数：生成 → 渲染 → 上屏这条链路才是真机上被扫的东西。
 */
function matrix(payload: string) {
  const svg = decodeURIComponent(
    buildQrCodeSvgDataUrl(payload).replace('data:image/svg+xml;charset=utf-8,', ''),
  )
  const size = Number(/viewBox="0 0 (\d+)/.exec(svg)?.[1]) - 8
  const dark = [...svg.matchAll(/M(\d+),(\d+)h1v1h-1z/g)]
    .map(match => `${Number(match[1]) - 4},${Number(match[2]) - 4}`)
    .sort()
  return { size, dark, set: new Set(dark) }
}

test('定位框边缘不能被定时图形挖掉', () => {
  // 2026-09-27 真机扫码一直没有反应的真因之一：先画定位图形、又用定时图形覆盖它，
  // 把三个定位框边缘挖掉 12 个模块（就是下面这些坐标），整张码任何解码器都读不出来。
  const { size, set } = matrix(OFFER)
  assert.equal(size, 49, '186 字节应落在第 8 版（49×49）')

  for (const key of [
    '6,1', '6,3', '6,5',
    '1,6', '3,6', '5,6',
    '43,6', '45,6', '47,6',
    '6,43', '6,45', '6,47',
  ]) {
    assert.ok(set.has(key), `定位框边缘 (${key}) 应为深色`)
  }
})

test('校正图形按标准表落位（8 版为 6/24/42）', () => {
  // 真因之二：旧公式算出的步长把校正图形放到 22，中心整体错位，同样让整张码失效。
  const { set } = matrix(OFFER)
  for (const key of ['24,24', '22,24', '26,24', '24,22', '24,26']) {
    assert.ok(set.has(key), `校正图形 (${key}) 应为深色`)
  }
  for (const key of ['23,24', '25,24', '24,23', '24,25']) {
    assert.ok(!set.has(key), `校正图形 (${key}) 应为浅色`)
  }
})

test('矩阵与参考实现逐位一致（golden）', () => {
  // 基准值来自 Nayuki 参考实现（同 payload、纠错 L、mask 0）逐位比对，
  // 并经严格解码器（jsQR）实测可解；任何一处改动都会让哈希变化。
  const digest = (payload: string) =>
    createHash('sha256').update(matrix(payload).dark.join(';')).digest('hex')

  assert.equal(
    digest(OFFER),
    '4ce9eedafc0684abc2b87df1c76f47b8b0fc901241e06d89c73cffd78b7b8622',
  )
  assert.equal(
    digest('x'.repeat(700)),
    'd8ee94aeecd8ff4085074d99d8167c11cbe36df53c8c575c0f22b9ce126701b9',
  )
})

test('buildQrCodeSvgDataUrl creates local SVG data URLs without external QR service', () => {
  const url = buildQrCodeSvgDataUrl('alipays://platformapi/startapp?order=123')

  assert.equal(url.startsWith('data:image/svg+xml;charset=utf-8,'), true)
  assert.equal(url.includes('api.qrserver.com'), false)
  assert.match(decodeURIComponent(url), /<svg[^>]+viewBox=/)
  assert.match(decodeURIComponent(url), /<path fill="#211b0f"/)
})

test('buildQrCodeSvgDataUrl returns empty string for empty payment content', () => {
  assert.equal(buildQrCodeSvgDataUrl('   '), '')
})
