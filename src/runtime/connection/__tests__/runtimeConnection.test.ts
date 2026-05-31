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
    'local-tools',
    'knowledge',
    'skill',
    'conversation-memory',
  ])
  assert.match(assembled.systemPrompt, /\[产品系统规则开始\]/)
  assert.match(assembled.systemPrompt, /当前用户输入是最高业务目标/)
  assert.match(assembled.systemPrompt, /系统安全 > 当前用户输入 > 最近上下文 > 用户显式开启的工具 > 用户显式选择的知识库 > 当前Skill > 对话长期记忆 > 联网搜索证据 > 模型常识/)
  assert.match(assembled.systemPrompt, /\[当前Skill开始\]/)
  assert.doesNotMatch(assembled.systemPrompt, /\[知识库证据开始\]/)
  assert.doesNotMatch(assembled.systemPrompt, /\[对话上下文开始\]/)
  assert.match(assembled.contextPrompt, /\[知识库证据开始\]/)
  assert.match(assembled.contextPrompt, /\[对话上下文开始\]/)
  assert.match(assembled.systemPrompt, /\[本地工具策略开始\]/)
  assert.equal(assembled.plan.sections.map(section => section.name).join(' > '), 'product-system > local-tools > knowledge > skill > conversation-memory')
})

test('assembleRuntimeConnectionPrompt keeps explicit Tool and Knowledge above selected Skill', () => {
  const runtime = buildRuntimeConnection({
    source: 'manual',
    userInput: '把上面的内容转成 Word 文档',
    skill: buildSkillConnection({
      id: 'skill_writer',
      selectedBy: 'user',
      skillMd,
    }),
    knowledge: buildKnowledgeConnection({
      mode: 'standard',
      citationMode: 'summary',
      primaryVaultId: 'vault_script',
      evidenceText: '影视剧本资料。',
    }),
    tools: buildToolConnection({
      enabled: true,
      source: 'global',
      tools: [{ function: { name: 'create_document' } }],
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
    conversationContextEvidencePrompt: '长期历史证据',
    conversationContext: {
      runtimeSegmentId: 'seg_1',
      loadLevel: 'standard',
      memoryHitCount: 1,
      degraded: false,
    },
    webSearchEvidencePrompt: 'Search evidence block',
    localToolInstruction: 'Tool policy block',
    contextMode: 'balanced',
  })

  assert.equal(
    assembled.sections.map(section => section.name).join(' > '),
    'product-system > local-tools > knowledge > skill > conversation-memory > web-search',
  )
  assert.ok(assembled.systemPrompt.indexOf('[本地工具策略开始]') < assembled.systemPrompt.indexOf('[当前Skill开始]'))
  assert.ok(assembled.contextPrompt.indexOf('[知识库证据开始]') < assembled.contextPrompt.indexOf('[对话上下文开始]'))
  assert.ok(assembled.contextPrompt.indexOf('[对话上下文开始]') < assembled.contextPrompt.indexOf('[联网搜索证据开始]'))
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

test('buildChatRuntimeConnection weakens selected Skill when current input is unrelated', async () => {
  const result = await buildChatRuntimeConnection({
    source: 'manual',
    userInput: '这个 dialog.confirm 报错是什么意思？',
    selectedSkill: {
      id: 'skill_writer',
      skillContent: skillMd,
    },
    selectedBy: 'user',
    knowledge: {
      mode: 'off',
      citationMode: 'none',
      recallKnowledge: async () => ({
        text: '',
        searched: false,
        staticKnowledgeInjected: false,
        hits: [],
      }),
    },
    tools: {
      enabled: false,
      source: 'global',
      getTools: () => [],
    },
    llm: {
      modelId: 'claude-sonnet-4-6',
      runtime: 'chat-completions',
      contextBudget: 200000,
    },
    prompt: {
      contextMode: 'balanced',
    },
  })

  assert.equal(result.runtime.trace.skillApplicability?.mode, 'reference-only')
  assert.match(result.systemPrompt, /\[当前Skill选择状态开始\]/)
  assert.match(result.systemPrompt, /本轮用户输入与该 Skill 不明显相关/)
  assert.doesNotMatch(result.systemPrompt, /Use the user brief and produce polished copy/)
})

test('buildChatRuntimeConnection keeps full selected Skill when current input matches Skill', async () => {
  const result = await buildChatRuntimeConnection({
    source: 'manual',
    userInput: '写一个介绍',
    selectedSkill: {
      id: 'skill_writer',
      skillContent: skillMd,
    },
    selectedBy: 'user',
    knowledge: {
      mode: 'off',
      citationMode: 'none',
      recallKnowledge: async () => ({
        text: '',
        searched: false,
        staticKnowledgeInjected: false,
        hits: [],
      }),
    },
    tools: {
      enabled: false,
      source: 'global',
      getTools: () => [],
    },
    llm: {
      modelId: 'claude-sonnet-4-6',
      runtime: 'chat-completions',
      contextBudget: 200000,
    },
    prompt: {
      contextMode: 'balanced',
    },
  })

  assert.equal(result.runtime.trace.skillApplicability?.mode, 'apply')
  assert.match(result.systemPrompt, /\[当前Skill开始\][\s\S]*Use the user brief and produce polished copy/)
})
