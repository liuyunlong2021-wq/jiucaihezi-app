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

test('both character format templates accept text without implying an attached image', () => {
  for (const ratio of ['9-16', '16-9']) {
    const template = readFileSync(join(root, '..', 'jc-juese-geshi', 'references', `${ratio}.md`), 'utf8')
    assert.match(template, /角色文字提示词或人物参考图/)
    assert.match(template, /只有文字时直接用于文生图，无需参考图/)
    assert.doesNotMatch(template, /所附参考图|参考图中人物/)
    for (const layout of ['正面全身，无头', '背面全身，带头', '齐胸大特写', '18% 中灰', 'shadowless frontal illumination']) {
      assert.ok(template.includes(layout), `${ratio}: ${layout}`)
    }
  }
})
