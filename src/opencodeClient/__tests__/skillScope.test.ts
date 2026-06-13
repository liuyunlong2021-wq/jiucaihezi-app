import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CLAUDE_OBSIDIAN_SKILL_NAMES,
  buildFixedSkillSystemInstruction,
  buildSkillPermissionScope,
} from '../skillScope'

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

test('fixed Obsidian selection expands to the bundled claude-obsidian child skills', () => {
  const rules = buildSkillPermissionScope({ skillName: 'Obsidian' })!
  const allowed = rules.filter(rule => rule.action === 'allow').map(rule => rule.pattern)

  assert.equal(rules[0].pattern, '*')
  assert.equal(rules[0].action, 'deny')
  assert.deepEqual(allowed, [...CLAUDE_OBSIDIAN_SKILL_NAMES])
  assert.ok(allowed.includes('wiki'))
  assert.ok(allowed.includes('wiki-ingest'))
  assert.ok(allowed.includes('wiki-query'))
  assert.ok(allowed.includes('save'))
})

test('fixed Obsidian instruction keeps one user-facing name while allowing the suite', () => {
  const instruction = buildFixedSkillSystemInstruction('Obsidian')

  assert.match(instruction, /固定 Skill 已选择：Obsidian/)
  assert.match(instruction, /\{"name":"Obsidian"\}/)
  assert.match(instruction, /\{"name":"wiki"\}/)
  assert.match(instruction, /wiki-ingest/)
  assert.match(instruction, /对用户只说 Obsidian/)
})
