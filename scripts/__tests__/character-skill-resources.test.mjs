import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('../../public/skills/jc-juese-sheji/', import.meta.url))

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}

test('the character package bundles all four physiognomy references and both prompt suffix resources', () => {
  const index = JSON.parse(readFileSync(join(root, '..', 'index.json'), 'utf8'))
  const skill = index.find(item => item.id === 'jc-juese-sheji')
  const required = ['guxiang.md', 'mianxiang.md', 'tixiang.md', 'shouxiang.md', 'portrait-beauty.md', 'deai-and-detail.md', 'random-words.md']
  for (const name of required) assert.ok(skill.files.includes(`references/${name}`), name)
  const actual = files(root).map(path => relative(root, path).split(sep).join('/')).sort()
  assert.deepEqual(skill.files, actual)
  assert.deepEqual(skill.package.files.map(file => file.path), actual)
  assert.ok(skill.package.files.filter(file => file.path.startsWith('references/')).every(file => file.kind === 'reference'))
})

test('every character reference is reachable locally without personal skill directories', () => {
  const resources = new Set(files(root).filter(file => file.endsWith('.md')))
  const visited = new Set()
  const pending = [join(root, 'SKILL.md')]
  while (pending.length) {
    const path = pending.pop()
    if (visited.has(path)) continue
    assert.ok(resources.has(path), `missing local resource: ${path}`)
    visited.add(path)
    for (const match of readFileSync(path, 'utf8').matchAll(/\[[^\]\n]+\]\(([^)]+\.md)\)/g)) {
      const target = resolve(dirname(path), match[1])
      if (target.startsWith(root)) pending.push(target)
      else assert.equal(target, resolve(root, '../jc-juese-geshi/SKILL.md'), 'unexpected external resource')
    }
  }
  assert.deepEqual([...visited].sort(), [...resources].sort())
})
