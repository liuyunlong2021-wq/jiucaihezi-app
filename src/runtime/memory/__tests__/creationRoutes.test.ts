import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import { CREATION_ROUTES, creationSkillNames, selectCreationRoute, resolveCreationSkillPath } from '../creationRoutes'
import { createConversationTranscript, parseConversationTranscript } from '../conversationTranscript'
import { loadWebSkillByName } from '@/utils/skillContentResolver'

test('three modes share a single mutually exclusive selection and preserve custom Skills', () => {
  const selected = selectCreationRoute(['custom', 'jc-novel'], 'jc-duanju')
  assert.deepEqual(selected, ['custom', 'jc-duanju'])
  assert.deepEqual(selectCreationRoute(selected, 'jc-duanju'), ['custom'])
  assert.equal(CREATION_ROUTES.length, 3)
})

test('composer selection persists before a first turn and old Raw remains readable', () => {
  const path = '.raw/对话记录/c.md'
  const raw = createConversationTranscript('c', '新对话', '2026-10-15', { memoryEnabled: true, memoryQueryEnabled: true, composerSkills: ['jc-novel'] })
  assert.deepEqual(parseConversationTranscript(path, raw)?.composerSkills, ['jc-novel'])
  assert.equal(parseConversationTranscript(path, createConversationTranscript('c'))?.composerSkills, undefined)
})

test('route resource paths are whitelisted and traversal cannot escape a package', () => {
  const names = creationSkillNames(['jc-manju-zhizuo'])
  assert.deepEqual(resolveCreationSkillPath('../jc-gongchengjuben/references/shot-visibility.md', names), { name: 'jc-gongchengjuben', path: 'references/shot-visibility.md' })
  assert.deepEqual(resolveCreationSkillPath('skill://jc-novel/references/写作工作流.md', ['jc-novel']), { name: 'jc-novel', path: 'references/写作工作流.md' })
  assert.equal(resolveCreationSkillPath('../jc-novel/SKILL.md', names), null)
  assert.equal(resolveCreationSkillPath('skill://jc-novel/../../secret', ['jc-novel']), null)
  assert.ok(creationSkillNames(['jc-gongchengjuben']).includes('jc-manju-brainstorm'))
})

test('all three bundled routes and their references are readable through Web package APIs', async () => {
  const catalog = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  const fetcher = (async (url: string) => {
    const path = `public${decodeURIComponent(url)}`
    return existsSync(path) ? new Response(readFileSync(path), { headers: { 'content-type': path.endsWith('.json') ? 'application/json' : 'text/markdown' } }) : new Response('', { status: 404 })
  }) as typeof fetch
  for (const route of CREATION_ROUTES) {
    const skill = await loadWebSkillByName(route.name, fetcher)
    assert.ok(skill.content.trim())
    for (const name of creationSkillNames([route.name])) {
      const entry = catalog.find((item: { name: string }) => item.name === name)
      assert.ok(entry, name)
      for (const file of entry.files) assert.ok(existsSync(`public/skills/${entry.id}/${file}`), `${name}/${file}`)
    }
  }
})
