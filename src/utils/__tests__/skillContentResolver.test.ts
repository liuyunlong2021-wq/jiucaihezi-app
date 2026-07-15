import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  buildWebSkillCatalogPrompt,
  loadWebSkillByName,
  loadWebSkillCatalog,
} from '../skillContentResolver'

const catalog = [{
  id: 'JC-短剧-世界模型',
  name: 'JC-duanju-shijiemoxing',
  description: '短剧世界模型',
  triggers: ['短剧'],
  commands: [],
  files: ['SKILL.md', 'references/建制阶段.md'],
}, {
  id: 'JC-manju-skills/JC-manju-fengge',
  name: 'JC-manju-fengge',
  description: '确定全片风格',
  triggers: ['风格'],
  commands: [],
  files: ['SKILL.md'],
}]

function fetcher(url: string | URL | Request): Promise<Response> {
  const path = String(url)
  if (path === '/skills/index.json') return Promise.resolve(Response.json(catalog))
  if (path === '/skills/JC-%E7%9F%AD%E5%89%A7-%E4%B8%96%E7%95%8C%E6%A8%A1%E5%9E%8B/SKILL.md') {
    return Promise.resolve(new Response('---\nname: JC-duanju-shijiemoxing\ndescription: 短剧世界模型\n---\n# 工作流'))
  }
  if (path === '/skills/JC-manju-skills/JC-manju-fengge/SKILL.md') {
    return Promise.resolve(new Response('---\nname: JC-manju-fengge\ndescription: 确定全片风格\n---\n# 风格'))
  }
  return Promise.resolve(new Response('not found', { status: 404 }))
}

test('web skill catalog exposes only routing metadata to the first model turn', async () => {
  const entries = await loadWebSkillCatalog(fetcher as typeof fetch)
  const prompt = buildWebSkillCatalogPrompt(entries)

  assert.match(prompt, /JC-duanju-shijiemoxing/)
  assert.match(prompt, /短剧世界模型/)
  assert.doesNotMatch(prompt, /# 工作流/)
})

test('web skill loader resolves frontmatter name to the packaged SKILL.md', async () => {
  const skill = await loadWebSkillByName('JC-duanju-shijiemoxing', fetcher as typeof fetch)

  assert.equal(skill.id, 'JC-短剧-世界模型')
  assert.equal(skill.baseDirectory, '/skills/JC-%E7%9F%AD%E5%89%A7-%E4%B8%96%E7%95%8C%E6%A8%A1%E5%9E%8B')
  assert.match(skill.content, /# 工作流/)
  assert.deepEqual(skill.files, ['SKILL.md', 'references/建制阶段.md'])

  await assert.rejects(() => loadWebSkillByName('missing', fetcher as typeof fetch), /不存在/)
})

test('web skill loader preserves nested package path segments', async () => {
  const skill = await loadWebSkillByName('JC-manju-fengge', fetcher as typeof fetch)
  assert.equal(skill.baseDirectory, '/skills/JC-manju-skills/JC-manju-fengge')
  assert.match(skill.content, /# 风格/)
})

test('generated Web Skill catalog contains only packages with a standard SKILL.md entry', () => {
  const entries = JSON.parse(readFileSync(join(process.cwd(), 'public/skills/index.json'), 'utf8')) as Array<{ id: string }>
  for (const entry of entries) {
    assert.equal(readdirSync(join(process.cwd(), 'public/skills', entry.id)).includes('SKILL.md'), true, entry.id)
  }
})

test('default Web Skill catalog retries after a temporary request failure', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch
  let attempts = 0
  globalThis.fetch = (async () => {
    attempts += 1
    if (attempts === 1) return new Response('temporary failure', { status: 503 })
    return Response.json(catalog)
  }) as typeof fetch

  try {
    await assert.rejects(() => loadWebSkillCatalog(), /HTTP 503/)
    assert.equal((await loadWebSkillCatalog()).length, catalog.length)
    assert.equal(attempts, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})
