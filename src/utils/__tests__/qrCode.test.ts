import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildQrCodeSvgDataUrl } from '../qrCode'

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
