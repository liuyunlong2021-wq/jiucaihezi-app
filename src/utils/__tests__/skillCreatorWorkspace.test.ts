import assert from 'node:assert/strict'
import { test } from 'node:test'

import { persistSkillCreatorReviewWorkspace } from '../skillCreatorWorkspace'

test('persistSkillCreatorReviewWorkspace writes official review artifacts under a sanitized workspace', async () => {
  const writes = new Map<string, string>()
  const mkdirs: string[] = []

  const persisted = await persistSkillCreatorReviewWorkspace({
    skillName: '短剧 Skill/评审',
    workspaceId: 'skill creator run 01',
    reviewHtml: '<html>review</html>',
    results: [{ eval_id: 1, prompt: '测试', runs: [] }],
    benchmark: { run_summary: { with_skill: {}, without_skill: {}, delta: {} } },
    rootDir: '/tmp/jc-skill-workspaces',
  }, {
    mkdir: async (path: string) => { mkdirs.push(path) },
    writeTextFile: async (path: string, content: string) => { writes.set(path, content) },
  })

  assert.equal(persisted.workspacePath, '/tmp/jc-skill-workspaces/skill_creator_run_01')
  assert.deepEqual(mkdirs, ['/tmp/jc-skill-workspaces/skill_creator_run_01'])
  assert.equal(writes.get('/tmp/jc-skill-workspaces/skill_creator_run_01/eval-review.html'), '<html>review</html>')
  assert.match(writes.get('/tmp/jc-skill-workspaces/skill_creator_run_01/eval-results.json') || '', /"eval_id": 1/)
  assert.match(writes.get('/tmp/jc-skill-workspaces/skill_creator_run_01/benchmark.json') || '', /"run_summary"/)
  assert.equal(persisted.reviewHtmlPath, '/tmp/jc-skill-workspaces/skill_creator_run_01/eval-review.html')
  assert.equal(persisted.artifacts.map(artifact => artifact.path).join(','), 'eval-review.html,eval-results.json,benchmark.json')
})
