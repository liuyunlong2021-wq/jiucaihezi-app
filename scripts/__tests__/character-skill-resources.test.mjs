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
  const required = ['guxiang.md', 'mianxiang.md', 'tixiang.md', 'body-proportions.md', 'shouxiang.md', 'portrait-beauty.md', 'deai-and-detail.md', 'random-words.md']
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
    for (const layout of ['正面全身，无头', '背面全身，带头', '斜侧齐胸头部特写', '18% 中灰', 'shadowless frontal illumination']) {
      assert.ok(template.includes(layout), `${ratio}: ${layout}`)
    }
  }
})

test('character design checks a readable silhouette and shape language, keeping silhouette anchors across looks', () => {
  const skill = readFileSync(join(root, 'SKILL.md'), 'utf8')
  assert.match(skill, /\[剪影与形状语言\]\(references\/silhouette-shape\.md\)/)
  assert.match(skill, /剪影可辨/)
  const text = readFileSync(join(root, 'references', 'silhouette-shape.md'), 'utf8')
  for (const section of ['剪影辨识', '形状语言', '五官的形状组合', '姿态轮廓', '换装保留剪影锚点', '写进提示词']) {
    assert.match(text, new RegExp(`## .*${section}`), section)
  }
  assert.match(text, /圆[\s\S]*尖[\s\S]*方/)
  assert.match(text, /填黑/)
  assert.match(text, /不绑定善恶/)
  assert.doesNotMatch(text, /《[^》]+》/)
})
