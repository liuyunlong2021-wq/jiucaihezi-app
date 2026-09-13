import assert from 'node:assert/strict'
import { test } from 'node:test'

import { PINNED_SKILLS, sortSkillsForPicker } from '../skillPickerOrder'

const item = (name: string) => ({ name })

test('三个置顶 Skill 永远在最前，顺序固定且不看使用次数', () => {
  const list = [
    item('jc-duanju'),
    item('wiki-memory'),
    item('jc-juese'),
    item('skill-creator'),
    item('jc-new-user-guide'),
  ]
  assert.deepEqual(
    sortSkillsForPicker(list, {}).map(skill => skill.name),
    ['jc-new-user-guide', 'skill-creator', 'wiki-memory', 'jc-duanju', 'jc-juese'],
  )
  // 就算别的 Skill 被用得再多，也挤不掉置顶的三个
  assert.deepEqual(
    sortSkillsForPicker(list, { 'jc-duanju': 99, 'jc-juese': 50 }).map(skill => skill.name),
    ['jc-new-user-guide', 'skill-creator', 'wiki-memory', 'jc-duanju', 'jc-juese'],
  )
})

test('其余按使用次数降序，常用的浮到前面', () => {
  const list = [item('a'), item('b'), item('c'), item('d')]
  assert.deepEqual(
    sortSkillsForPicker(list, { c: 5, d: 2, a: 1 }).map(skill => skill.name),
    ['c', 'd', 'a', 'b'],
  )
})

test('次数相同时保持原有相对顺序', () => {
  const list = [item('a'), item('b'), item('c')]
  assert.deepEqual(
    sortSkillsForPicker(list, { b: 3, a: 3, c: 3 }).map(skill => skill.name),
    ['a', 'b', 'c'],
  )
  // 没被记过次数的 Skill 也不能被打乱
  assert.deepEqual(
    sortSkillsForPicker(list, {}).map(skill => skill.name),
    ['a', 'b', 'c'],
  )
})

test('不修改传入的数组', () => {
  const list = [item('b'), item('a')]
  sortSkillsForPicker(list, { a: 1 })
  assert.deepEqual(list.map(skill => skill.name), ['b', 'a'])
})

test('置顶名单就是约定的三个', () => {
  assert.deepEqual(PINNED_SKILLS, ['jc-new-user-guide', 'skill-creator', 'wiki-memory'])
})
