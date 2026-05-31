import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveSkillApplicability } from '../skillApplicability'

const writerSkill = {
  id: 'skill_writer',
  name: '爆款短剧编剧',
  description: '负责短剧、剧本、爽点、分集创作',
  triggers: ['短剧', '剧本', '爽点', '分集'],
  skillContent: '## 工作流\n根据角色、冲突、爽点生成短剧分集剧本。',
}

test('resolveSkillApplicability applies selected Skill for matching domain tasks', () => {
  const result = resolveSkillApplicability({
    userInput: '帮我写一个短剧第一集剧本，强化爽点',
    selectedSkill: writerSkill,
  })

  assert.equal(result.mode, 'apply')
  assert.equal(result.reason, 'skill-match')
})

test('resolveSkillApplicability applies selected Skill for current-skill meta questions', () => {
  const result = resolveSkillApplicability({
    userInput: '我现在选中的是什么Skill？',
    selectedSkill: writerSkill,
  })

  assert.equal(result.mode, 'apply')
  assert.equal(result.reason, 'current-skill-question')
})

test('resolveSkillApplicability weakens selected Skill for unrelated document export tasks', () => {
  const result = resolveSkillApplicability({
    userInput: '把上面的知识库内容转成 Word 文档',
    selectedSkill: writerSkill,
  })

  assert.equal(result.mode, 'reference-only')
  assert.equal(result.reason, 'current-context-transform')
})

test('resolveSkillApplicability weakens selected Skill for unrelated debugging questions', () => {
  const result = resolveSkillApplicability({
    userInput: '这个 dialog.confirm 报错是什么意思？',
    selectedSkill: writerSkill,
  })

  assert.equal(result.mode, 'reference-only')
  assert.equal(result.reason, 'general-support-request')
})

test('resolveSkillApplicability returns off when no Skill is selected', () => {
  const result = resolveSkillApplicability({
    userInput: '写一个介绍',
    selectedSkill: null,
  })

  assert.equal(result.mode, 'off')
  assert.equal(result.reason, 'no-skill')
})
