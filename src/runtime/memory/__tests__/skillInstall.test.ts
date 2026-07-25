import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseSkillInstallPlan, stripSkillInstallBlock } from '../skillInstall'

const reply = [
  'Skill 已准备好，请确认安装。',
  '',
  '```jc-skill-install',
  '---',
  'name: concise-writer',
  'description: "把长文压缩成清晰短文"',
  'triggers:',
  '  - 精简文章',
  '  - 压缩长文',
  '---',
  '',
  '# 工作流',
  '',
  '保留事实，删除重复表达。',
  '```',
].join('\n')

test('parses a confirmed single-file Skill install block', () => {
  const plan = parseSkillInstallPlan(reply)

  assert.equal(plan.id, 'concise-writer')
  assert.equal(plan.description, '把长文压缩成清晰短文')
  assert.deepEqual(plan.triggers, ['精简文章', '压缩长文'])
  assert.match(plan.skillMd, /# 工作流/)
  assert.equal(stripSkillInstallBlock(reply), 'Skill 已准备好，请确认安装。')
})

test('rejects invalid or incomplete install blocks', () => {
  assert.throws(() => parseSkillInstallPlan('普通回复'), /没有可安装/)
  assert.throws(() => parseSkillInstallPlan(reply.replace('concise-writer', '中文名称')), /名称必须/)
  assert.throws(() => parseSkillInstallPlan(reply.replace('description: "把长文压缩成清晰短文"\n', '')), /description/)
})
