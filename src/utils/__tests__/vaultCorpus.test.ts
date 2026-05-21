import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildCorpusMapMarkdown, scanMarkdownCorpus } from '../vaultCorpus'

test('scanMarkdownCorpus extracts headings, chunks, anchors and source stats', () => {
  const scan = scanMarkdownCorpus({
    files: [
      {
        name: '编剧工具书.md',
        path: 'raw/转换后的MD/编剧工具书.md',
        content: [
          '# 编剧工具书',
          '## 人物动机',
          '角色必须有清晰目标。男主角要主动选择。',
          '## 三幕结构流程',
          '第一步建立目标。第二步制造阻碍。第三步完成反击。',
        ].join('\n\n'),
      },
    ],
  })

  assert.equal(scan.sources.length, 1)
  assert.equal(scan.sources[0].headingCount, 3)
  assert.ok(scan.headings.some(heading => heading.title === '人物动机' && heading.anchor.includes('#人物动机')))
  assert.ok(scan.chunks.some(chunk => chunk.title === '三幕结构流程' && chunk.sourceAnchor.includes('#三幕结构流程')))
  assert.ok(scan.candidateEntities.includes('人物动机'))
  assert.ok(scan.candidateProcesses.includes('三幕结构流程'))
  assert.ok(scan.stats.totalChars > 20)
})

test('buildCorpusMapMarkdown gives the model a compact architecture input', () => {
  const scan = scanMarkdownCorpus({
    files: [
      {
        name: '运营手册.md',
        path: 'raw/转换后的MD/运营手册.md',
        content: '# 运营手册\n\n## 选题流程\n\n第一步确定用户。第二步写标题。\n\n## 标题公式\n\n对象 + 场景 + 结果。',
      },
    ],
  })
  const markdown = buildCorpusMapMarkdown(scan, { maxHeadings: 4, maxChunks: 2 })

  assert.match(markdown, /# 资料扫描图谱/)
  assert.match(markdown, /运营手册.md/)
  assert.match(markdown, /选题流程/)
  assert.match(markdown, /标题公式/)
  assert.ok(markdown.length < 3000)
})
