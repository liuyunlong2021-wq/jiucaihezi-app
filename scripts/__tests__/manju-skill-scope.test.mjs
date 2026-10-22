import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const groups = JSON.parse(readFileSync('public/skills/production-skills.json', 'utf8'))
test('production scopes are plain business allowlists with no executable router', () => {
  assert.deepEqual(Object.keys(groups), ['manju', 'short-drama', 'novel'])
  assert.equal(groups.manju.length, 14)
  assert.equal(groups['short-drama'].length, 4)
  assert.deepEqual(groups.novel, ['jc-novel'])
  for (const list of Object.values(groups)) {
    assert.equal(list.length, new Set(list).size)
    for (const name of list) {
      assert.ok(!['jc-manju-zhizuo', 'jc-duanju'].includes(name))
      const file = resolve('public/skills', name, 'SKILL.md')
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/\]\(([^)]+\.md)\)/g)) assert.ok(existsSync(resolve(dirname(file), match[1])), match[1])
    }
  }
  for (const name of ['jc-manju-zhizuo', 'jc-duanju']) assert.equal(existsSync(`public/skills/${name}/SKILL.md`), false)
  const index = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  assert.ok(!index.some(skill => ['jc-manju-zhizuo', 'jc-duanju'].includes(skill.name)))
})
