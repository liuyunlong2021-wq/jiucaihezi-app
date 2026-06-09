import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildFixedSkillSystemInstruction, buildSkillPermissionScope } from '../skillScope'

test('empty Skill selection leaves OpenCode free to auto-select skills', () => {
  assert.equal(buildSkillPermissionScope({ skillName: '' }), undefined)
  assert.equal(buildSkillPermissionScope({ skillName: null }), undefined)
})

test('fixed Skill selection denies all skills before allowing the selected skill', () => {
  assert.deepEqual(buildSkillPermissionScope({ skillName: '剧本 Skill' }), [
    { permission: 'skill', pattern: '*', action: 'deny' },
    { permission: 'skill', pattern: '剧本 Skill', action: 'allow' },
  ])
})

test('fixed Skill scope relies on OpenCode last-match permission evaluation', () => {
  const rules = buildSkillPermissionScope({ skillName: '剧本 Skill' })!
  const match = rules.findLast(rule => rule.permission === 'skill' && (rule.pattern === '*' || rule.pattern === '剧本 Skill'))

  assert.equal(match?.action, 'allow')
  assert.equal(match?.pattern, '剧本 Skill')
})

test('fixed Skill mode explicitly instructs OpenCode to load the selected skill tool', () => {
  const instruction = buildFixedSkillSystemInstruction('manhua-script-agent')

  assert.match(instruction, /必须先调用 OpenCode 官方 skill 工具/)
  assert.match(instruction, /\{"name":"manhua-script-agent"\}/)
})
