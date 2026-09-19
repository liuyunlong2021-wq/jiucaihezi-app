import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseEvalReviewPath, parseSkillInstallPlan, stripSkillInstallBlock } from '../skillInstall'
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

test('finds the generated eval review report path in an assistant reply', () => {
  const macPath = '/Users/by3/Library/Application Support/com.jiucaihezi.desktop/skill-workspaces/conv_1_draft_1_iteration-2/eval-review.html'

  assert.equal(parseEvalReviewPath(`测试完成，报告在 ${macPath}`), macPath)
  // file:// 链接带 %20，不能留下多余斜杠，也要还原空格
  assert.equal(
    parseEvalReviewPath(`[查看测试结果](file:///Users/by3/Library/Application%20Support/com.jiucaihezi.desktop/skill-workspaces/conv_1_draft_1_iteration-1/eval-review.html)`),
    macPath.replace('iteration-2', 'iteration-1'),
  )
  // Windows 盘符同样要认
  assert.equal(
    parseEvalReviewPath('报告：C:/Users/by3/AppData/Roaming/com.jiucaihezi.desktop/skill-workspaces/c_d_iteration-1/eval-review.html'),
    'C:/Users/by3/AppData/Roaming/com.jiucaihezi.desktop/skill-workspaces/c_d_iteration-1/eval-review.html',
  )
  // 普通回复与项目内同名文件都不算评测报告
  assert.equal(parseEvalReviewPath('测试完成了。'), null)
  assert.equal(parseEvalReviewPath('看 wiki/eval-review.html'), null)
})
