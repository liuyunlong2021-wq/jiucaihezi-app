import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ProjectFileService } from '@/services/projectFileService'
import type { ProjectResource } from '@/utils/projectResource'
import { commitStoryAnalysis, prepareStoryAnalysis } from '../storyAnalysis'
import { applyStoryImportPlan, buildStoryImportPlan } from '../storyImport'

function memoryFiles(initial: Record<string, string> = {}) {
  const entries = new Map(
    Object.entries(initial).map(([path, content]) => [path, { content, revision: 1 }]),
  )
  const writes: string[] = []
  const resource = (owner: string, path: string, content: string): ProjectResource => ({
    runtime: 'web',
    owner,
    path,
    name: path.split('/').at(-1) || path,
    isDirectory: false,
    kind: 'document',
    size: content.length,
  })
  const read = async (path: string) => {
    const value = entries.get(path)
    if (!value) throw new Error('文件不存在')
    return {
      content: value.content,
      size: value.content.length,
      truncated: false,
      revision: { value: String(value.revision), size: value.content.length },
    }
  }
  const files = {
    async list(owner: string) {
      return [...entries].map(([path, value]) => resource(owner, path, value.content))
    },
    async readTextAt(_owner: string, path: string) {
      return await read(path)
    },
    async readText(item: ProjectResource) {
      return await read(item.path)
    },
    async createText(owner: string, path: string, content: string) {
      if (entries.has(path)) throw new Error(`文件已存在: ${path}`)
      entries.set(path, { content, revision: 1 })
      writes.push(path)
      return resource(owner, path, content)
    },
    async writeText(item: ProjectResource, content: string, expected: { value: string }) {
      const value = entries.get(item.path)
      if (!value) return { status: 'missing' as const }
      if (String(value.revision) !== expected.value)
        return { status: 'conflict' as const, current: await read(item.path) }
      value.content = content
      value.revision += 1
      writes.push(item.path)
      return {
        status: 'saved' as const,
        revision: { value: String(value.revision), size: content.length },
      }
    },
  } as unknown as ProjectFileService
  return { entries, files, writes }
}

async function importedStory() {
  const content = '第一章\n刘备走进桃园，见到关羽。\n第二章\n张飞端来酒碗。'
  const plan = await buildStoryImportPlan({ content, title: '三结义', originalName: '三结义.md' })
  const state = memoryFiles({ 'wiki/index.md': '# Wiki\n' })
  await applyStoryImportPlan(plan, content, state.files, 'project')
  state.writes.length = 0
  return { plan, state }
}

test('runtime prepares only unfinished story nodes and commits a grounded analysis last', async () => {
  const { plan, state } = await importedStory()
  const prepared = await prepareStoryAnalysis(
    { workDirectory: plan.workDirectory, limit: 1 },
    state.files,
    'project',
  )
  assert.equal(prepared.nodes.length, 1)
  assert.equal(prepared.nodes[0]?.sourceContent.includes('刘备走进桃园'), true)

  const result = await commitStoryAnalysis(
    {
      workDirectory: plan.workDirectory,
      analyses: [
        {
          node_id: prepared.nodes[0]!.nodeId,
          source_hash: prepared.nodes[0]!.sourceHash,
          summary: '刘备在桃园遇见关羽。',
          scenes: [
            {
              name: '桃园',
              description: '刘备与关羽相遇的地点。',
              evidence: ['刘备走进桃园，见到关羽。'],
            },
          ],
          characters: [
            { name: '刘备', description: '走进桃园。', evidence: ['刘备走进桃园，见到关羽。'] },
            { name: '关羽', description: '在桃园出现。', evidence: ['刘备走进桃园，见到关羽。'] },
          ],
          props: [],
          relations: [],
          evidence: ['刘备走进桃园，见到关羽。'],
          needs_review: [],
        },
      ],
    },
    state.files,
    'project',
  )

  const analysisPath = `${plan.workDirectory}/节点分析/0001.md`
  assert.deepEqual(result.committed, [prepared.nodes[0]!.nodeId])
  assert.equal(state.writes.at(-1), analysisPath)
  assert.match(state.entries.get(analysisPath)?.content || '', /analysis_status: complete/)
  assert.match(
    state.entries.get(analysisPath)?.content || '',
    /\[\[wiki\/资产\/人物\/刘备\|刘备\]\]/,
  )
  assert.match(state.entries.get('wiki/资产/人物/刘备.md')?.content || '', /刘备走进桃园/)

  const next = await prepareStoryAnalysis(
    { workDirectory: plan.workDirectory, limit: 10 },
    state.files,
    'project',
  )
  assert.equal(
    next.nodes.some(node => node.nodeId === prepared.nodes[0]!.nodeId),
    false,
  )
  assert.equal(next.nodes.length, 1)
})

test('runtime rejects invented evidence before writing any semantic file', async () => {
  const { plan, state } = await importedStory()
  const [node] = (
    await prepareStoryAnalysis({ workDirectory: plan.workDirectory }, state.files, 'project')
  ).nodes
  await assert.rejects(
    () =>
      commitStoryAnalysis(
        {
          workDirectory: plan.workDirectory,
          analyses: [
            {
              node_id: node!.nodeId,
              source_hash: node!.sourceHash,
              summary: '虚构摘要',
              scenes: [],
              characters: [],
              props: [],
              relations: [],
              evidence: ['原文没有这句话'],
              needs_review: [],
            },
          ],
        },
        state.files,
        'project',
      ),
    /摘要证据不在原文节点中/,
  )
  assert.equal(state.writes.length, 0)
  assert.equal(state.entries.has(`${plan.workDirectory}/节点分析/0001.md`), false)
})

test('needs-review nodes wait until explicitly included and carry their revision', async () => {
  const { plan, state } = await importedStory()
  const [node] = (
    await prepareStoryAnalysis({ workDirectory: plan.workDirectory }, state.files, 'project')
  ).nodes
  await commitStoryAnalysis(
    {
      workDirectory: plan.workDirectory,
      analyses: [
        {
          node_id: node!.nodeId,
          source_hash: node!.sourceHash,
          summary: '人物身份待确认。',
          scenes: [],
          characters: [],
          props: [],
          relations: [],
          evidence: ['刘备走进桃园，见到关羽。'],
          needs_review: ['关羽是否为同名人物'],
        },
      ],
    },
    state.files,
    'project',
  )
  const ordinary = await prepareStoryAnalysis(
    { workDirectory: plan.workDirectory, limit: 1 },
    state.files,
    'project',
  )
  assert.notEqual(ordinary.nodes[0]?.nodeId, node!.nodeId)
  const review = await prepareStoryAnalysis(
    { workDirectory: plan.workDirectory, limit: 1, includeNeedsReview: true },
    state.files,
    'project',
  )
  assert.equal(review.nodes[0]?.nodeId, node!.nodeId)
  assert.ok(review.nodes[0]?.expectedAnalysisRevision)
})

test('semantic commit links but never rewrites a user-maintained canonical asset', async () => {
  const { plan, state } = await importedStory()
  const canonical = '---\ntype: character\ntitle: "刘备"\n---\n\n# 刘备\n\n用户确认的人物资料。\n'
  state.entries.set('wiki/资产/人物/刘备.md', { content: canonical, revision: 1 })
  const [node] = (
    await prepareStoryAnalysis({ workDirectory: plan.workDirectory }, state.files, 'project')
  ).nodes
  const result = await commitStoryAnalysis(
    {
      workDirectory: plan.workDirectory,
      analyses: [
        {
          node_id: node!.nodeId,
          source_hash: node!.sourceHash,
          summary: '刘备走进桃园。',
          scenes: [],
          characters: [
            { name: '刘备', description: '本章走进桃园。', evidence: ['刘备走进桃园，见到关羽。'] },
          ],
          props: [],
          relations: [],
          evidence: ['刘备走进桃园，见到关羽。'],
          needs_review: [],
        },
      ],
    },
    state.files,
    'project',
  )
  assert.equal(state.entries.get('wiki/资产/人物/刘备.md')?.content, canonical)
  assert.equal(result.affected_paths.includes('wiki/资产/人物/刘备.md'), false)
  assert.match(
    state.entries.get(`${plan.workDirectory}/节点分析/0001.md`)?.content || '',
    /wiki\/资产\/人物\/刘备/,
  )
})

test('ambiguous canonical assets stay unresolved and cannot become complete', async () => {
  const { plan, state } = await importedStory()
  state.entries.set('wiki/资产/人物/玄德.md', {
    content: '---\ntype: character\ntitle: "玄德"\naliases: ["刘备"]\n---\n\n# 玄德\n',
    revision: 1,
  })
  state.entries.set('wiki/资产/人物/刘皇叔.md', {
    content: '---\ntype: character\ntitle: "刘皇叔"\naliases: ["刘备"]\n---\n\n# 刘皇叔\n',
    revision: 1,
  })
  const [node] = (
    await prepareStoryAnalysis({ workDirectory: plan.workDirectory }, state.files, 'project')
  ).nodes
  const result = await commitStoryAnalysis(
    {
      workDirectory: plan.workDirectory,
      analyses: [
        {
          node_id: node!.nodeId,
          source_hash: node!.sourceHash,
          summary: '刘备进入桃园。',
          scenes: [],
          characters: [
            { name: '刘备', description: '进入桃园。', evidence: ['刘备走进桃园，见到关羽。'] },
          ],
          props: [],
          relations: [],
          evidence: ['刘备走进桃园，见到关羽。'],
          needs_review: [],
        },
      ],
    },
    state.files,
    'project',
  )

  const analysis = state.entries.get(`${plan.workDirectory}/节点分析/0001.md`)?.content || ''
  assert.deepEqual(result.needs_review, [node!.nodeId])
  assert.equal(result.conflicts.length, 1)
  assert.match(analysis, /analysis_status: needs_review/)
  assert.doesNotMatch(analysis, /\[\[wiki\/资产\/人物\/(?:玄德|刘皇叔)/)
  assert.equal(state.entries.has('wiki/资产/人物/刘备.md'), false)
})

test('semantic commit rejects a changed source hash before writing', async () => {
  const { plan, state } = await importedStory()
  const [node] = (
    await prepareStoryAnalysis({ workDirectory: plan.workDirectory }, state.files, 'project')
  ).nodes
  await assert.rejects(
    () =>
      commitStoryAnalysis(
        {
          workDirectory: plan.workDirectory,
          analyses: [
            {
              node_id: node!.nodeId,
              source_hash: 'changed',
              summary: '摘要',
              scenes: [],
              characters: [],
              props: [],
              relations: [],
              evidence: ['刘备走进桃园，见到关羽。'],
              needs_review: [],
            },
          ],
        },
        state.files,
        'project',
      ),
    /原文节点已变化/,
  )
  assert.equal(state.writes.length, 0)
})
