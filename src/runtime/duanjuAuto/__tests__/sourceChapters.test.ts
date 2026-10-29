import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseNodeTitle, readSourceChapters, type SourceNodeIo } from '@/runtime/duanjuAuto/sourceChapters'

/** 假的原生文件口：directory 里放的是节点文件全文。 */
function ioOf(files: Record<string, string>): SourceNodeIo {
  return {
    async listDirectory(path) {
      const prefix = `${path}/`
      return Object.keys(files)
        .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
        .map(key => ({ path: key, isDirectory: false }))
    },
    async readText(path) {
      return files[path]
    },
  }
}

const head = (title: string, order: number) => `---\ntype: story-source-node\ntitle: "${title}"\norder: ${order}\n---\n\n正文。\n`

test('原文节点目录里的全部章按 order 排，不被执行进度登记的切片限制', async () => {
  // 实测现场：执行进度只登记了本批 10 章，而原文节点目录有 20 章；章号与顺序并不一致。
  const files: Record<string, string> = {
    'wiki/原文/节点/0001_a.md': head('第0章 设定', 1),
    'wiki/原文/节点/0002_b.md': head('第3章 风向标', 2),
    'wiki/原文/节点/0003_c.md': head('第2章 树洞', 3),
    'wiki/原文/节点/index.md': '# 索引\n',
  }
  const registered = ['第0章 设定']
  assert.deepEqual(await readSourceChapters(['wiki/原文/节点'], ioOf(files), registered), ['第0章 设定', '第3章 风向标', '第2章 树洞'])
})

test('缺 title 或 order 的节点、重名的节点都不进章节范围', async () => {
  const files: Record<string, string> = {
    'wiki/原文/节点/0001_a.md': head('第1章 开头', 1),
    'wiki/原文/节点/0002_b.md': head('第1章 开头', 2),
    'wiki/原文/节点/0003_c.md': '---\ntype: story-source-node\norder: 3\n---\n正文\n',
    'wiki/原文/节点/0004_d.md': '---\ntype: story-source-node\ntitle: "第4章 无顺序"\n---\n正文\n',
    'wiki/原文/节点/0005_e.md': head('第5章 结尾', 5),
  }
  assert.deepEqual(await readSourceChapters(['wiki/原文/节点'], ioOf(files)), ['第1章 开头', '第5章 结尾'])
})

test('正文里的“第N章”不算章标题，只认文件头', async () => {
  const files: Record<string, string> = {
    'wiki/原文/节点/0001_a.md': '---\ntype: story-source-node\ntitle: "第1章 开头"\norder: 1\n---\n\n第99章 正文里的句子\n',
  }
  assert.deepEqual(parseNodeTitle(files['wiki/原文/节点/0001_a.md']), { title: '第1章 开头', order: 1 })
  assert.equal(parseNodeTitle('第99章 正文里的句子\n'), undefined)
})

test('目录读不到时按单文件读，再读不到才回落到已登记的章', async () => {
  const single = ioOf({ 'wiki/原文/短篇.md': head('全文', 1) })
  assert.deepEqual(await readSourceChapters(['wiki/原文/短篇.md'], single, ['旧']), ['全文'])
  const empty: SourceNodeIo = { async listDirectory() { return [] }, async readText() { return undefined } }
  assert.deepEqual(await readSourceChapters(['wiki/原文/缺失.md'], empty, ['第1章 旧登记']), ['第1章 旧登记'])
  assert.deepEqual(await readSourceChapters(['wiki/原文/缺失.md'], empty), [])
})
