import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseSkillInstallPlan, stripSkillInstallBlock } from '../skillInstall'
import { registerSkillBuilderDraft } from '@/utils/skillBuilderTools'

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

test('parses a confirmed single-file Skill install block', async () => {
  const plan = await parseSkillInstallPlan(reply)

  assert.equal(plan.id, 'concise-writer')
  assert.equal(plan.description, '把长文压缩成清晰短文')
  assert.deepEqual(plan.triggers, ['精简文章', '压缩长文'])
  assert.match(plan.skillMd, /# 工作流/)
  assert.equal(stripSkillInstallBlock(reply), 'Skill 已准备好，请确认安装。')
})

test('parses a V2 install token and rejects stale revisions', async () => {
  const draft = await registerSkillBuilderDraft({
    skillMd: reply.match(/```jc-skill-install\s*\n([\s\S]*?)\n```/)![1],
    references: [{ path: 'references/guide.md', title: 'Guide', content: '# Guide', mimeType: 'text/markdown' }],
    manifest: { kind: 'skill-package-draft', schemaVersion: '2026-06-03.v1', sourceType: 'manual', createdAt: new Date(0).toISOString(), entry: 'SKILL.md', references: [], quality: { hardGatePassed: true, errors: [], warnings: [] } },
    sessionId: 'install-session',
  })
  const token = { schemaVersion: 2, draftId: draft.draftId, sessionId: draft.sessionId, revision: draft.revision, contentHash: draft.contentHash, targetSkillId: 'concise-writer' }
  const content = `Skill 已准备好。\n\n\`\`\`jc-skill-install-v2\n${JSON.stringify(token)}\n\`\`\``
  const plan = await parseSkillInstallPlan(content)
  assert.equal(plan.token?.draftId, draft.draftId)
  assert.deepEqual(plan.files, ['SKILL.md', 'references/guide.md'])

  await assert.rejects(() => parseSkillInstallPlan(content.replace('"revision":1', '"revision":2')), /版本已变化/)
})

test('rejects invalid or incomplete install blocks', async () => {
  await assert.rejects(() => parseSkillInstallPlan('普通回复'), /没有可安装/)
  await assert.rejects(() => parseSkillInstallPlan(reply.replace('concise-writer', '中文名称')), /名称必须/)
  await assert.rejects(() => parseSkillInstallPlan(reply.replace('description: "把长文压缩成清晰短文"\n', '')), /description/)
})
