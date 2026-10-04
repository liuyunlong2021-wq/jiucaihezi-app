import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { pinManjuSkills } from '../../src-tauri/resources/deepseek-harness/manju-skills.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'jc-manju-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'manju-route.json'), JSON.stringify({ router: 'jc-manju-zhizuo', skills: ['jc-manju-zhizuo', 'h3-prompt-writing', 'jc-seedance'] }))
  for (const name of ['jc-manju-zhizuo', 'h3-prompt-writing', 'jc-seedance']) {
    mkdirSync(join(root, name))
    writeFileSync(join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: "test ${name}"\n---\n\n# ${name}\n`)
  }
  const registered = new Map()
  const rec = { handle: { agent: { ctx: { skills: { register(skill) {
    registered.set(skill.name, skill)
    return () => registered.delete(skill.name)
  } } } } } }
  return { root, rec, registered }
}

test('production pins exact bundled sources in the agent scope, with both video branches available', async t => {
  const { root, rec, registered } = fixture(t)
  const dispose = await pinManjuSkills(rec, ['jc-manju-zhizuo'], root)
  assert.deepEqual([...registered.keys()], ['jc-manju-zhizuo', 'h3-prompt-writing', 'jc-seedance'])
  assert.equal(registered.get('jc-seedance').resourceBase.path, join(root, 'jc-seedance'))
  assert.match(registered.get('jc-seedance').content, /# jc-seedance/)
  await dispose()
  assert.equal(registered.size, 0)
})

test('missing packages and incompatible pinned skills fail before changing the agent scope', async t => {
  const { root, rec, registered } = fixture(t)
  await assert.rejects(pinManjuSkills(rec, ['jc-manju-zhizuo', 'wiki-memory'], root), /漫剧制作.*wiki-memory/)
  assert.equal(registered.size, 0)
  rmSync(join(root, 'jc-seedance'), { recursive: true })
  await assert.rejects(pinManjuSkills(rec, ['jc-manju-zhizuo'], root), /jc-seedance/)
  assert.equal(registered.size, 0)
})

test('ordinary skill selection does not pin production packages', async t => {
  const { root, rec, registered } = fixture(t)
  await (await pinManjuSkills(rec, ['wiki-memory'], root))()
  assert.equal(registered.size, 0)
})

test('the real Harness registry prefers scoped bundled definitions and releases them on exit', async t => {
  const vendor = '../../src-tauri/resources/deepseek-harness/node_modules/@deepseek-ai/'
  if (!existsSync(new URL(`${vendor}dsh-skill/lib/index.js`, import.meta.url))) return t.skip('Harness SDK not installed')
  const { Context } = await import(`${vendor}cordis/lib/index.js`)
  const { default: SkillRegistry } = await import(`${vendor}dsh-skill/lib/index.js`)
  const { createScope } = await import(`${vendor}dsh-scope/lib/index.js`)
  const { root } = fixture(t)
  const ctx = new Context()
  const service = await ctx.plugin(SkillRegistry)
  let checked = false
  const consumer = await ctx.plugin({ name: 'manju-registry-test', inject: ['skills'], async apply(c) {
    const localDispose = c.skills.register({ name: 'jc-seedance', source: 'user', description: 'local', content: 'LOCAL VERSION' })
    const agent = {}
    const scope = createScope(c, agent)
    agent.ctx = scope.ctx
    const dispose = await pinManjuSkills({ handle: { agent } }, ['jc-manju-zhizuo'], root)
    const lookup = { scope: agent, signal: new AbortController().signal }
    const loaded = await c.skills.get('jc-seedance', lookup)
    assert.equal(loaded.source, 'bundled')
    assert.equal(loaded.resourceBase.path, join(root, 'jc-seedance'))
    assert.equal((await c.skills.get('jc-seedance', { signal: lookup.signal })).content, 'LOCAL VERSION')
    await dispose()
    assert.equal((await c.skills.get('jc-seedance', lookup)).content, 'LOCAL VERSION')
    checked = true
    await scope.dispose()
    await localDispose()
  } })
  await consumer.dispose()
  await service.dispose()
  assert.ok(checked)
})
