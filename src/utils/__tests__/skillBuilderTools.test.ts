import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ALL_SKILL_BUILDER_TOOLS,
  executeSkillBuilderToolCall,
  getSkillBuilderDraft,
} from '../skillBuilderTools'

test('ALL_SKILL_BUILDER_TOOLS exposes text builder before test/save tools', () => {
  assert.deepEqual(
    ALL_SKILL_BUILDER_TOOLS.map(tool => tool.function.name),
    ['build_skill_from_text', 'local_extract_attachment', 'document_to_markdown', 'run_skill_tests', 'save_skill', 'compile_skill_materials'],
  )
})

test('executeSkillBuilderToolCall builds a Skill package draft from text', async () => {
  const result = await executeSkillBuilderToolCall({
    function: {
      name: 'build_skill_from_text',
      arguments: JSON.stringify({
        name: '短剧爽点拆解',
        description: '把短剧方法论整理为创作执行 Skill',
        source_title: '短剧教程.md',
        source_text: '前三秒必须有冲突，第一集必须出现强钩子。',
      }),
    },
  })

  assert.ok(result)
  const parsed = JSON.parse(result!)
  assert.equal(parsed.status, 'ok')
  assert.match(parsed.skill_md, /^---\nname: 短剧爽点拆解\n/m)
  assert.equal(parsed.references[0].path, 'references/source.md')
  assert.equal(parsed.quality.hardGatePassed, true)
  assert.match(parsed.draft_id, /^draft_/)
  const stored = getSkillBuilderDraft(parsed.draft_id, 'unsaved-session')
  assert.equal(stored?.skillMd, parsed.skill_md)
  assert.equal(stored?.references[0].content.includes('前三秒必须有冲突'), true)
})

test('executeSkillBuilderToolCall stores draft ids under the active session', async () => {
  const result = await executeSkillBuilderToolCall({
    function: {
      name: 'build_skill_from_text',
      arguments: JSON.stringify({
        name: '资料整理Skill',
        description: '整理资料',
        source_text: 'A'.repeat(12000),
      }),
    },
  }, { sessionId: 'session_builder_draft' })

  const parsed = JSON.parse(result!)
  assert.match(parsed.draft_id, /^draft_/)
  assert.equal(getSkillBuilderDraft(parsed.draft_id, 'session_builder_draft')?.references[0].content.includes('A'.repeat(12000)), true)
  assert.equal(getSkillBuilderDraft(parsed.draft_id, 'other_session'), null)
})

test('executeSkillBuilderToolCall ignores unrelated tools', async () => {
  const result = await executeSkillBuilderToolCall({
    function: {
      name: 'save_skill',
      arguments: '{}',
    },
  })

  assert.equal(result, null)
})
