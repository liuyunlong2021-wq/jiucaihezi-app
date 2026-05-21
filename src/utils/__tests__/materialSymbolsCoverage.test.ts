import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

function walkFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      walkFiles(path, acc)
    } else if (/\.(vue|ts)$/.test(name)) {
      acc.push(path)
    }
  }
  return acc
}

function collectProjectIconNames(root: string): Map<string, Set<string>> {
  const icons = new Map<string, Set<string>>()
  const add = (name: string, source: string) => {
    if (!/^[a-z][a-z0-9_]*$/.test(name)) return
    if (!icons.has(name)) icons.set(name, new Set())
    icons.get(name)!.add(source)
  }

  for (const path of walkFiles(resolve(root, 'src'))) {
    const rel = relative(root, path)
    const text = readFileSync(path, 'utf8')
    for (const match of text.matchAll(/<span[^>]*class="[^"]*\bmso\b[^"]*"[^>]*>\s*([a-z][a-z0-9_]*)\s*<\/span>/g)) {
      add(match[1], `${rel}:literal-mso`)
    }
    for (const match of text.matchAll(/\bicon\s*:\s*['"]([a-z][a-z0-9_]*)['"]/g)) {
      add(match[1], `${rel}:icon-field`)
    }
    for (const match of text.matchAll(/<span[^>]*class="[^"]*\bmso\b[^"]*"[^>]*>([\s\S]{0,180}?)<\/span>/g)) {
      for (const nested of match[1].matchAll(/['"]([a-z][a-z0-9_]*)['"]/g)) {
        add(nested[1], `${rel}:mso-expression`)
      }
    }
  }

  return icons
}

function readMaterialSymbolGlyphs(root: string): Set<string> {
  const script = `
from fontTools.ttLib import TTFont
font = TTFont('${resolve(root, 'src/assets/fonts/material-symbols-outlined.woff2').replace(/\\/g, '\\\\')}')
glyphs = set(font.getGlyphOrder())
for glyph in list(glyphs):
    if glyph.endswith('.fill'):
        glyphs.add(glyph[:-5])
print('\\n'.join(sorted(glyphs)))
`
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return new Set(result.stdout.split('\n').map(line => line.trim()).filter(Boolean))
}

test('project Material Symbols icon names exist in the bundled local font', () => {
  const root = process.cwd()
  const icons = collectProjectIconNames(root)
  const supported = readMaterialSymbolGlyphs(root)

  const ignored = new Set([
    // These words appear in non-icon ternary labels inside mso spans.
    'knowledge',
    'result',
    'skill',
    'tool',
    'user',
  ])
  const missing = Array.from(icons.keys())
    .filter(name => !ignored.has(name) && !supported.has(name))
    .sort()

  assert.deepEqual(
    missing.map(name => `${name}: ${Array.from(icons.get(name) || []).sort().join(', ')}`),
    [],
  )
})
