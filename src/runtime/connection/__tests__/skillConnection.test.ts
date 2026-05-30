import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildSkillConnection,
  parseSkillFrontmatter,
} from '../skillConnection'
import {
  buildSkillRetrievalHint,
  resolveSelectedSkillCandidate,
  resolveSkillConnection,
} from '../skillConnectionAdapter'

const skillMd = [
  '---',
  'name: "Research Assistant"',
  'description: "Use when the user needs research help."',
  '---',
  '',
  '# Research Assistant',
  '',
  'Follow the official Skill instructions.',
].join('\n')

test('parseSkillFrontmatter reads official Skill metadata without changing the body', () => {
  const parsed = parseSkillFrontmatter(skillMd)

  assert.equal(parsed.name, 'Research Assistant')
  assert.equal(parsed.description, 'Use when the user needs research help.')
  assert.equal(parsed.body, '# Research Assistant\n\nFollow the official Skill instructions.')
  assert.equal(parsed.fullSkillMd, skillMd)
})

test('buildSkillConnection preserves official Skill shape and records progressive resources', () => {
  const connection = buildSkillConnection({
    id: 'preset_research',
    selectedBy: 'user',
    skillMd,
    resources: [
      { kind: 'references', path: 'references/method.md' },
      { kind: 'scripts', path: 'scripts/fetch.py' },
      { kind: 'assets', path: 'assets/template.docx' },
    ],
  })

  assert.equal(connection.id, 'preset_research')
  assert.equal(connection.name, 'Research Assistant')
  assert.equal(connection.selectedBy, 'user')
  assert.equal(connection.fullSkillMd, skillMd)
  assert.deepEqual(connection.resources.map(resource => resource.kind), ['references', 'scripts', 'assets'])
})

test('resolveSkillConnection builds a connection from inline official SKILL.md content', async () => {
  const result = await resolveSkillConnection({
    selectedBy: 'user',
    skill: {
      id: 'preset_research',
      skillContent: skillMd,
    },
  })

  assert.equal(result.error, undefined)
  assert.equal(result.connection?.id, 'preset_research')
  assert.equal(result.connection?.name, 'Research Assistant')
  assert.equal(result.connection?.selectedBy, 'user')
  assert.equal(result.connection?.fullSkillMd, skillMd)
})

test('resolveSkillConnection loads skill:// references through an injected official Skill loader', async () => {
  const calls: string[] = []
  const result = await resolveSkillConnection({
    selectedBy: 'user',
    skill: {
      id: 'skill_creator',
      skillContent: 'skill://skill-creator',
    },
    loadSkillContent: async uri => {
      calls.push(uri)
      return skillMd
    },
  })

  assert.deepEqual(calls, ['skill://skill-creator'])
  assert.equal(result.error, undefined)
  assert.equal(result.connection?.id, 'skill_creator')
  assert.equal(result.connection?.selectedBy, 'user')
  assert.equal(result.connection?.body, '# Research Assistant\n\nFollow the official Skill instructions.')
})

test('resolveSkillConnection reports selected Skills that do not provide official SKILL.md content', async () => {
  const result = await resolveSkillConnection({
    selectedBy: 'user',
    skill: {
      id: 'broken_skill',
      skillContent: '',
    },
  })

  assert.equal(result.connection, undefined)
  assert.match(result.error || '', /missing SKILL.md content/)
})

test('resolveSelectedSkillCandidate ignores explicit system prompts as Skill sources', () => {
  const result = resolveSelectedSkillCandidate({
    explicitSystemPrompt: skillMd,
  })

  assert.equal(result.skill, undefined)
  assert.equal(result.skillHint, '')
})

test('resolveSelectedSkillCandidate reads selected Skill metadata and retrieval hint outside useChat', () => {
  const result = resolveSelectedSkillCandidate({
    agentId: 'skill_writer',
    agents: [{
      id: 'skill_writer',
      name: '写作搭子',
      description: '负责写作',
      triggers: ['写作', '润色'],
      skillContent: skillMd,
    }],
  })

  assert.equal(result.skill?.id, 'skill_writer')
  assert.equal(result.skill?.skillContent, skillMd)
  assert.match(result.skillHint, /写作搭子/)
  assert.match(result.skillHint, /触发词：写作、润色/)
})

test('resolveSkillConnection appends product runtime additions after loading skill:// content', async () => {
  const result = await resolveSkillConnection({
    selectedBy: 'user',
    skill: {
      id: 'preset_skill-creator',
      skillContent: 'skill://skill-creator',
      appendSkillMd: '\n\n## Product Runtime\nUse save_skill.',
    },
    loadSkillContent: async () => skillMd,
  })

  assert.match(result.connection?.fullSkillMd || '', /Follow the official Skill instructions/)
  assert.match(result.connection?.fullSkillMd || '', /Product Runtime/)
})

test('buildSkillRetrievalHint is capped and includes user-facing trigger metadata', () => {
  const hint = buildSkillRetrievalHint({
    name: '研究搭子',
    description: '负责研究',
    triggers: ['调研'],
  })

  assert.equal(hint, '研究搭子\n负责研究\n触发词：调研')
})
