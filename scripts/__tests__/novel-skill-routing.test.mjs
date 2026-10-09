import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../../public/skills/jc-novel/', import.meta.url))

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : []
  })
}

function resourceLinks(path) {
  const text = readFileSync(path, 'utf8')
  return [...text.matchAll(/\[[^\]\n]+\]\(([^)\s]+)\)/g)].flatMap(match => {
    const target = match[1].split('#')[0]
    return !target || /^[a-z][a-z\d+.-]*:/i.test(target)
      ? []
      : [resolve(dirname(path), decodeURIComponent(target))]
  })
}

test('novel reference links resolve to real files inside the bundled package', () => {
  const files = markdownFiles(root)
  const fileSet = new Set(files)
  const broken = []
  for (const file of files) {
    for (const target of resourceLinks(file)) {
      if (!target.startsWith(root) || !fileSet.has(target))
        broken.push(`${relative(root, file)} -> ${relative(root, target)}`)
    }
  }
  assert.deepEqual(broken, [])
})

test('every novel reference is reachable from SKILL.md through explicit resource links', () => {
  const files = new Set(markdownFiles(root))
  const visited = new Set()
  const pending = [join(root, 'SKILL.md')]
  while (pending.length) {
    const file = pending.pop()
    if (visited.has(file) || !files.has(file)) continue
    visited.add(file)
    pending.push(...resourceLinks(file))
  }
  const references = markdownFiles(join(root, 'references'))
  const unreachable = references.filter(file => !visited.has(file)).map(file => relative(root, file))
  assert.equal(unreachable.length, 0, `${unreachable.length} unreachable references: ${unreachable.slice(0, 8).join(', ')}`)
})

test('the engine router links every engine file without inventing missing engines', () => {
  const directory = join(root, 'references', 'engines')
  const index = join(directory, 'index.md')
  const expected = markdownFiles(directory).filter(file => file !== index).sort()
  const actual = [...new Set(resourceLinks(index).filter(file => file.startsWith(directory + sep)))].sort()
  assert.equal(actual.length, expected.length)
  assert.deepEqual(actual, expected)
})

test('the App index contains the complete canonical novel package', () => {
  const index = JSON.parse(readFileSync(join(root, '..', 'index.json'), 'utf8'))
  const skill = index.find(item => item.id === 'jc-novel')
  const files = markdownFiles(root).map(file => relative(root, file).split(sep).join('/')).sort()
  assert.ok(skill)
  assert.equal(skill.package.entry, 'SKILL.md')
  assert.deepEqual(skill.files, files)
  assert.deepEqual(skill.package.files.map(file => file.path), files)
  assert.ok(skill.package.files.every(file => file.kind === (file.path === 'SKILL.md' ? 'instruction' : 'reference')))
})
