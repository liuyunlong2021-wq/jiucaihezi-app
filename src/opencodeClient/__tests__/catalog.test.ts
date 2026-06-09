import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  computeOpenCodeContextUsage,
  getOpenCodeSessionContextUsage,
  invalidateOpenCodeSessionContextUsage,
  listOpenCodeAgents,
  listOpenCodeModels,
  listOpenCodeSkills,
  normalizeOpenCodeAgent,
  normalizeOpenCodeModel,
  normalizeOpenCodeSkill,
} from '../catalog'

test('normalizes official OpenCode v2 models into chat model entries', () => {
  assert.deepEqual(normalizeOpenCodeModel({
    id: 'claude-sonnet-4-6',
    providerID: 'anthropic',
    name: 'Claude Sonnet',
    enabled: true,
    status: 'active',
    capabilities: { input: ['text', 'image'], output: ['text'] },
    limit: { context: 200000 },
  }), {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet',
    providerId: 'anthropic',
    capability: 'text',
    contextWindow: 200000,
  })

  assert.equal(normalizeOpenCodeModel({ id: 'old', enabled: false }), null)
  assert.equal(normalizeOpenCodeModel({ id: 'old', status: 'deprecated' }), null)
})

test('lists official OpenCode models through v2 model.list', async () => {
  const calls: unknown[] = []
  const client = {
    v2: {
      model: {
        list: async (input: unknown) => {
          calls.push(input)
          return {
            data: {
              data: [{
                id: 'gpt-5.5',
                providerID: 'openai',
                name: 'GPT 5.5',
                enabled: true,
                capabilities: { input: ['text'], output: ['text'] },
                limit: { context: 128000 },
              }],
            },
          }
        },
      },
    },
  } as any

  const models = await listOpenCodeModels(client, { directory: '/tmp/project' })

  assert.deepEqual(calls, [{ location: { directory: '/tmp/project', workspace: undefined } }])
  assert.equal(models[0].id, 'gpt-5.5')
  assert.equal(models[0].contextWindow, 128000)
})

test('normalizes and lists official OpenCode agents', async () => {
  assert.deepEqual(normalizeOpenCodeAgent({
    id: 'build',
    description: 'Build code',
    mode: 'primary',
    hidden: false,
  }), {
    id: 'build',
    label: 'build',
    description: 'Build code',
    mode: 'primary',
    hidden: false,
    color: undefined,
    model: undefined,
  })
  assert.equal(normalizeOpenCodeAgent({ id: 'secret', hidden: true }), null)

  const client = {
    v2: {
      agent: {
        list: async () => ({
          data: {
            data: [
              { id: 'build', mode: 'primary', hidden: false },
              { id: 'hidden', mode: 'primary', hidden: true },
            ],
          },
        }),
      },
    },
  } as any

  const agents = await listOpenCodeAgents(client)
  assert.deepEqual(agents.map(agent => agent.id), ['build'])
})

test('normalizes and lists official OpenCode skills', async () => {
  assert.deepEqual(normalizeOpenCodeSkill({
    name: 'manhua-script-agent',
    description: 'Write short drama scripts',
    location: '/skills/manhua-script-agent/SKILL.md',
    content: '# Skill',
  }), {
    name: 'manhua-script-agent',
    label: 'manhua-script-agent',
    description: 'Write short drama scripts',
    location: '/skills/manhua-script-agent/SKILL.md',
    content: '# Skill',
  })
  assert.equal(normalizeOpenCodeSkill({ description: 'missing name' }), null)

  const calls: unknown[] = []
  const client = {
    v2: {
      skill: {
        list: async (input: unknown) => {
          calls.push(input)
          return {
            data: {
              data: [
                { name: 'frontend-design', description: 'Build frontend UI' },
                { description: 'invalid' },
              ],
            },
          }
        },
      },
    },
  } as any

  const skills = await listOpenCodeSkills(client, { directory: '/tmp/project' })
  assert.deepEqual(calls, [{ location: { directory: '/tmp/project', workspace: undefined } }])
  assert.deepEqual(skills.map(skill => skill.name), ['frontend-design'])
})

test('computes official context usage from v2 session.context messages', () => {
  const usage = computeOpenCodeContextUsage('ses_1', [
    { type: 'user', id: 'u1', text: 'hi', time: { created: 1 } },
    {
      type: 'assistant',
      id: 'a1',
      agent: 'build',
      model: { id: 'claude-sonnet-4-6', providerID: 'jiucaihezi' },
      content: [],
      time: { created: 2 },
      cost: 0.01,
      tokens: {
        input: 100,
        output: 50,
        reasoning: 25,
        cache: { read: 10, write: 5 },
      },
    },
  ] as any, [
    { id: 'claude-sonnet-4-6', label: 'Sonnet', providerId: 'jiucaihezi', capability: 'text', contextWindow: 200000 },
  ])

  assert.equal(usage.messageCount, 2)
  assert.equal(usage.userMessages, 1)
  assert.equal(usage.assistantMessages, 1)
  assert.equal(usage.total, 190)
  assert.equal(usage.limit, 200000)
  assert.equal(usage.modelLabel, 'Sonnet')
})

test('invalidates cached official context usage after session compaction', async () => {
  let callCount = 0
  const client = {
    v2: {
      session: {
        context: async () => {
          callCount += 1
          return {
            data: {
              data: callCount === 1
                ? [
                    {
                      type: 'assistant',
                      id: 'before',
                      tokens: { input: 100, output: 30 },
                    },
                  ]
                : [
                    {
                      type: 'assistant',
                      id: 'after',
                      tokens: { input: 10, output: 5 },
                    },
                  ],
            },
          }
        },
      },
    },
  } as any

  const before = await getOpenCodeSessionContextUsage(client, 'ses_cache')
  const cached = await getOpenCodeSessionContextUsage(client, 'ses_cache', [], { preferCache: true })
  invalidateOpenCodeSessionContextUsage('ses_cache')
  const after = await getOpenCodeSessionContextUsage(client, 'ses_cache', [], { preferCache: true })

  assert.equal(before.total, 130)
  assert.equal(cached.total, 130)
  assert.equal(after.total, 15)
  assert.equal(callCount, 2)
})

test('does not cache OpenCode context error payloads as empty usage', async () => {
  let callCount = 0
  const client = {
    v2: {
      session: {
        context: async () => {
          callCount += 1
          if (callCount === 1) return { error: { message: 'context failed' } }
          return {
            data: {
              data: [
                {
                  type: 'assistant',
                  id: 'after-error',
                  tokens: { input: 25, output: 5 },
                },
              ],
            },
          }
        },
      },
    },
  } as any

  await assert.rejects(
    getOpenCodeSessionContextUsage(client, 'ses_context_error'),
    /context failed/,
  )
  const usage = await getOpenCodeSessionContextUsage(client, 'ses_context_error', [], { preferCache: true })

  assert.equal(usage.total, 30)
  assert.equal(callCount, 2)
})
