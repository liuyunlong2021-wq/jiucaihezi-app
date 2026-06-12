import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildRuntimeConnection } from '../runtimeConnection'
import { buildSkillConnection } from '../skillConnection'
import { buildToolConnection } from '../toolConnection'
import {
  buildSuperpowerConnection,
  resolveRuntimeConnectionSource,
} from '../superpowerConnection'

const skillMd = [
  '---',
  'name: Writer',
  'description: Write with a clear style.',
  '---',
  '',
  'Use the user brief and produce polished copy.',
].join('\n')

test('buildRuntimeConnection composes skill tools and llm into one traceable run', () => {
  const runtime = buildRuntimeConnection({
    source: 'manual',
    userInput: '写一个介绍',
    skill: buildSkillConnection({
      id: 'skill_writer',
      selectedBy: 'user',
      skillMd,
    }),
    tools: buildToolConnection({
      enabled: true,
      source: 'global',
      tools: [{ function: { name: 'document_to_markdown' } }],
    }),
    llm: {
      modelId: 'claude-sonnet-4-6',
      runtime: 'chat-completions',
      contextBudget: 200000,
    },
  })

  assert.equal(runtime.source, 'manual')
  assert.equal(runtime.skill?.name, 'Writer')
  assert.deepEqual(runtime.tools.availableToolNames, ['document_to_markdown'])
  assert.equal(runtime.llm.modelId, 'claude-sonnet-4-6')
  assert.equal(runtime.trace.userInput, '写一个介绍')
  assert.equal(runtime.trace.sectionNames.join(' > '), 'skill > tools')
})

test('SuperpowerConnection is advisory and never becomes runtime execution source', () => {
  const connection = buildSuperpowerConnection({
    enabled: true,
    userInput: '我不知道该选哪个Skill',
    selectedSkillId: 'preset_research',
    prompt: 'Recommend the most suitable official Skill.',
  })

  assert.equal(connection.enabled, true)
  assert.equal(connection.source, 'configuration-advisor')
  assert.equal(connection.selectedSkillId, 'preset_research')
  assert.equal(connection.requiresUserConfirmation, true)
  assert.equal(resolveRuntimeConnectionSource({ advisorRequested: true, selectedSkillId: 'preset_research' }), 'manual')
  assert.equal(resolveRuntimeConnectionSource({ advisorRequested: false, selectedSkillId: 'preset_research' }), 'manual')
  assert.equal(resolveRuntimeConnectionSource({ advisorRequested: false }), 'plain')
})
