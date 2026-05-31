import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildKnowledgeConnection } from '../knowledgeConnection'
import { buildRuntimeConnection } from '../runtimeConnection'
import { buildSkillConnection } from '../skillConnection'
import { buildToolConnection } from '../toolConnection'
import {
  assembleRuntimeConnectionPrompt,
  buildChatRuntimeConnection,
} from '../chatRuntimeConnection'
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

test('buildRuntimeConnection composes skill knowledge tools and llm into one traceable run', () => {
  const runtime = buildRuntimeConnection({
    source: 'manual',
    userInput: '写一个介绍',
    skill: buildSkillConnection({
      id: 'skill_writer',
      selectedBy: 'user',
      skillMd,
    }),
    knowledge: buildKnowledgeConnection({
      mode: 'standard',
      citationMode: 'summary',
      primaryVaultId: 'vault_brand',
      evidenceText: '品牌语气：清晰、有温度。',
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
  assert.equal(runtime.knowledge.primaryVaultId, 'vault_brand')
  assert.deepEqual(runtime.tools.availableToolNames, ['document_to_markdown'])
  assert.equal(runtime.llm.modelId, 'claude-sonnet-4-6')
  assert.equal(runtime.trace.userInput, '写一个介绍')
  assert.equal(runtime.trace.sectionNames.join(' > '), 'skill > knowledge > tools')
})

test('assembleRuntimeConnectionPrompt renders deterministic chat context sections', () => {
  const runtime = buildRuntimeConnection({
    source: 'manual',
    userInput: '写一个介绍',
    skill: buildSkillConnection({
      id: 'skill_writer',
      selectedBy: 'user',
      skillMd,
    }),
    knowledge: buildKnowledgeConnection({
      mode: 'standard',
      citationMode: 'summary',
      primaryVaultId: 'vault_brand',
      evidenceText: '品牌语气：清晰、有温度。',
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

  const assembled = assembleRuntimeConnectionPrompt({
    runtime,
    knowledgeEvidencePrompt: 'Knowledge evidence block',
    conversationContextEvidencePrompt: '用户之前确认采用冷静克制的风格。',
    conversationContext: {
      runtimeSegmentId: 'seg_1',
      loadLevel: 'standard',
      memoryHitCount: 1,
      degraded: false,
    },
    localToolInstruction: 'Tool policy block',
    contextMode: 'balanced',
  })

  assert.deepEqual(assembled.sections.map(section => section.name), [
    'product-system',
    'skill',
    'knowledge',
    'conversation-memory',
    'local-tools',
  ])
  assert.match(assembled.systemPrompt, /\[产品系统规则开始\]/)
  assert.match(assembled.systemPrompt, /\[当前Skill开始\]/)
  assert.doesNotMatch(assembled.systemPrompt, /\[知识库证据开始\]/)
  assert.doesNotMatch(assembled.systemPrompt, /\[对话上下文开始\]/)
  assert.match(assembled.contextPrompt, /\[知识库证据开始\]/)
  assert.match(assembled.contextPrompt, /\[对话上下文开始\]/)
  assert.match(assembled.systemPrompt, /\[本地工具策略开始\]/)
  assert.equal(assembled.plan.sections.map(section => section.name).join(' > '), 'product-system > skill > knowledge > conversation-memory > local-tools')
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

test('buildChatRuntimeConnection is the single entry for Skill Knowledge Tool and prompt assembly', async () => {
  const result = await buildChatRuntimeConnection({
    source: 'manual',
    userInput: '写一个介绍',
    selectedSkill: {
      id: 'skill_writer',
      skillContent: skillMd,
    },
    selectedBy: 'user',
    knowledge: {
      mode: 'standard',
      citationMode: 'summary',
      primaryVaultId: 'vault_brand',
      recallKnowledge: async (userInput, opts) => ({
        text: `召回：${userInput} / ${opts.vaultId}`,
        searched: true,
        staticKnowledgeInjected: false,
        hits: [{ id: 'hit_1', title: '品牌语气', snippet: '清晰' }],
      }),
    },
    tools: {
      enabled: true,
      source: 'global',
      getTools: () => [{ function: { name: 'document_to_markdown' } }],
    },
    llm: {
      modelId: 'claude-sonnet-4-6',
      runtime: 'chat-completions',
      contextBudget: 200000,
    },
    prompt: {
      contextMode: 'balanced',
      localToolInstruction: 'Tool policy block',
    },
  })

  assert.equal(result.runtime.skill?.id, 'skill_writer')
  assert.equal(result.runtime.knowledge.primaryVaultId, 'vault_brand')
  assert.deepEqual(result.runtime.tools.availableToolNames, ['document_to_markdown'])
  assert.equal(result.tools.length, 1)
  assert.equal(result.knowledge.recall.searched, true)
  assert.match(result.systemPrompt, /\[当前Skill开始\][\s\S]*Use the user brief/)
  assert.doesNotMatch(result.systemPrompt, /\[Knowledge Evidence Start\]/)
  assert.match(result.contextPrompt, /\[Knowledge Evidence Start\][\s\S]*召回：写一个介绍 \/ vault_brand/)
})
