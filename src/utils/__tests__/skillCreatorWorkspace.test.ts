import assert from 'node:assert/strict'
import { test } from 'node:test'

import { appendSkillCreatorHistory, loadSkillCreatorFeedback, persistSkillCreatorFeedback, persistSkillCreatorReviewWorkspace, persistSkillCreatorWorkspaceArtifact } from '../skillCreatorWorkspace'

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

test('comparison artifacts and history use the isolated draft workspace', async () => {
  const files = new Map<string, string>()
  const fs = {
    mkdir: async () => {},
    writeTextFile: async (path: string, content: string) => { files.set(path, content) },
    readTextFile: async (path: string) => files.get(path) || Promise.reject(new Error('missing')),
  }
  const path = await persistSkillCreatorWorkspaceArtifact({ sessionId: 's', draftId: 'd', iteration: 2, fileName: 'comparison.json', value: { winner: 'A' }, rootDir: '/tmp/workspaces' }, fs)
  assert.equal(path, '/tmp/workspaces/s/d/iteration-2/comparison.json')
  await appendSkillCreatorHistory({ sessionId: 's', draftId: 'd', entry: { event: 'tested', revision: 2, iteration: 2, timestamp: 'now' }, rootDir: '/tmp/workspaces' }, fs)
  await appendSkillCreatorHistory({ sessionId: 's', draftId: 'd', entry: { event: 'feedback', revision: 2, iteration: 2, timestamp: 'later' }, rootDir: '/tmp/workspaces' }, fs)
  assert.match(files.get('/tmp/workspaces/s/d/history.json') || '', /"event": "tested"[\s\S]*"event": "feedback"/)
})

test('feedback persists by session, draft, and iteration including empty reviews', async () => {
  const files = new Map<string, string>()
  const fs = {
    mkdir: async () => {},
    writeTextFile: async (path: string, content: string) => { files.set(path, content) },
    readTextFile: async (path: string) => files.get(path) || Promise.reject(new Error('missing')),
  }
  await persistSkillCreatorFeedback({
    sessionId: 'session-a', draftId: 'draft-a', iteration: 1,
    reviews: [{ run_id: 'eval-1-with_skill', feedback: '', timestamp: '2026-09-06T00:00:00Z' }],
    rootDir: '/tmp/workspaces',
  }, fs)
  const feedback = await loadSkillCreatorFeedback({ sessionId: 'session-a', draftId: 'draft-a', iteration: 1, rootDir: '/tmp/workspaces' }, fs)
  assert.equal(feedback?.reviews.length, 1)
  assert.equal(feedback?.reviews[0].feedback, '')
  assert.equal(await loadSkillCreatorFeedback({ sessionId: 'session-b', draftId: 'draft-a', iteration: 1, rootDir: '/tmp/workspaces' }, fs), null)
})
