import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const css = readFileSync('src/styles/design-tokens.css', 'utf8')

function blockFor(theme: string) {
  const selector = theme === 'light' ? ':root {' : `:root[data-theme="${theme}"], [data-theme="${theme}"] {`
  const start = css.indexOf(selector)
  assert.notEqual(start, -1, `missing theme block: ${theme}`)
  const end = css.indexOf('\n}', start)
  return css.slice(start, end)
}

function value(block: string, name: string): string {
  return block.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})\\s*;`))?.[1] || ''
}

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)!.map(channel => parseInt(channel, 16) / 255).map(channel =>
    channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4,
  )
  return .2126 * channels[0]! + .7152 * channels[1]! + .0722 * channels[2]!
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((left, right) => right - left)
  return (lighter + .05) / (darker! + .05)
}

test('default workbench tokens use a quiet branded light surface', () => {
  const block = blockFor('light')
  assert.equal(value(block, '--jc-surface'), '#FAFAFA')
  assert.equal(value(block, '--jc-surface-container-lowest'), '#FFFFFF')
  assert.equal(value(block, '--jc-primary'), '#4A5D23')
  assert.match(block, /--jc-text-primary:\s*var\(--jc-on-surface\)/)
  assert.match(block, /--ink1:\s*var\(--jc-text-primary\)/)
  assert.match(block, /--paper:\s*var\(--jc-surface-container-lowest\)/)
})

test('every retained theme keeps readable primary text and accent links', () => {
  for (const theme of ['light', 'white', 'dark', 'green', 'nord', 'dracula']) {
    const block = blockFor(theme)
    const surface = value(block, '--jc-surface')
    const text = value(block, '--jc-on-surface')
    const accent = value(block, '--jc-primary')
    assert.ok(surface && text && accent, `${theme} defines its semantic colors`)
    assert.ok(contrast(text, surface) >= 4.5, `${theme} primary text contrast`)
    assert.ok(contrast(accent, surface) >= 4.5, `${theme} accent contrast`)
  }
})
