import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildVaultIngestionPlan,
  buildVaultIngestionReport,
  flattenVaultIngestionPlanEntries,
  isConvertedMarkdownRawFile,
  isMeaningfulExtractedText,
  isVaultIngestionCompileTarget,
  normalizeMarkdownFilename,
} from '../vaultIngestion'

test('normalizes converted markdown filenames without double md extension', () => {
  assert.equal(normalizeMarkdownFilename('小红书工具书.pdf'), '小红书工具书.md')
  assert.equal(normalizeMarkdownFilename('运营手册.md'), '运营手册.md')
  assert.equal(normalizeMarkdownFilename('a/b:测试?.docx'), 'a_b_测试_.md')
})

test('buildVaultIngestionPlan preserves original files and converted markdown under raw folders', () => {
  const plan = buildVaultIngestionPlan({
    files: [
      {
        name: '小红书工具书.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        extractedText: '# 第一章\n账号定位',
        originalDataUrl: 'data:application/pdf;base64,AAAA',
        sourceType: 'rapidocr_chunked',
        status: 'ready',
      },
    ],
  })

  assert.equal(plan.items.length, 1)
  assert.equal(plan.items[0].original?.folderPath, 'raw/原始文件')
  assert.equal(plan.items[0].original?.name, '小红书工具书.pdf')
  assert.equal(plan.items[0].markdown.folderPath, 'raw/转换后的MD')
  assert.equal(plan.items[0].markdown.name, '小红书工具书.md')
  assert.equal(plan.items[0].meta.folderPath, 'raw/转换后的MD')
  assert.equal(plan.items[0].meta.name, '小红书工具书.meta.json')
  assert.equal(typeof plan.items[0].markdown.metadata.sourceHash, 'string')
  assert.equal(typeof plan.items[0].original?.metadata.sourceHash, 'string')
  assert.equal(plan.items[0].meta.metadata.kind, 'converted-markdown-meta')
  assert.match(plan.items[0].markdown.content, /sourceName: "小红书工具书.pdf"/)
  assert.match(plan.items[0].markdown.content, /sourceHash:/)
  assert.match(plan.items[0].markdown.content, /---\n\n# 第一章/)
  assert.match(plan.items[0].markdown.content, /# 第一章/)
  assert.match(plan.items[0].meta.content, /sourceAnchors/)
  assert.equal(plan.items[0].markdown.metadata.conversionEngine, 'rapidocr_chunked')
  assert.equal(plan.items[0].original?.indexed, false)
  assert.equal(plan.summary.ready, 1)
  assert.equal(plan.summary.failed, 0)
  assert.equal(plan.summary.meta, 1)
})

test('buildVaultIngestionPlan de-dupes converted markdown, metadata and original filenames', () => {
  const plan = buildVaultIngestionPlan({
    files: [
      {
        name: 'a:b.pdf',
        mimeType: 'application/pdf',
        size: 1,
        extractedText: '# A\n内容',
        originalDataUrl: 'data:application/pdf;base64,AAAA',
        sourceType: 'rapidocr',
        status: 'ready',
      },
      {
        name: 'a/b.pdf',
        mimeType: 'application/pdf',
        size: 2,
        extractedText: '# B\n内容',
        originalDataUrl: 'data:application/pdf;base64,BBBB',
        sourceType: 'rapidocr',
        status: 'ready',
      },
    ],
  })

  assert.deepEqual(plan.items.map(item => item.markdown.name), ['a_b.md', 'a_b_2.md'])
  assert.deepEqual(plan.items.map(item => item.meta.name), ['a_b.meta.json', 'a_b_2.meta.json'])
  assert.deepEqual(plan.items.map(item => item.original?.name), ['a_b.pdf', 'a_b_2.pdf'])
  assert.match(plan.items[1].meta.content, /raw\/转换后的MD\/a_b_2.md/)
})

test('isMeaningfulExtractedText rejects page-number-only extraction output', () => {
  assert.equal(isMeaningfulExtractedText('[第23页]\n\n[第24页]\n\n[第25页]'), false)
  assert.equal(isMeaningfulExtractedText('[第23页]\n真实正文内容'), true)
})

test('buildVaultIngestionPlan records ready files with empty extracted text as failures', () => {
  const plan = buildVaultIngestionPlan({
    files: [
      {
        name: '空白扫描.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        extractedText: '[第1页]\n\n[第2页]\n',
        originalDataUrl: 'data:application/pdf;base64,AAAA',
        sourceType: 'pdf',
        status: 'ready',
      },
    ],
  })

  assert.equal(plan.items.length, 0)
  assert.equal(plan.failures.length, 1)
  assert.match(plan.failures[0].error, /没有提取到有效正文/)
  assert.equal(plan.summary.ready, 0)
  assert.equal(plan.summary.failed, 1)
})

test('buildVaultIngestionReport records successes and failures', () => {
  const plan = buildVaultIngestionPlan({
    files: [
      {
        name: 'ok.md',
        mimeType: 'text/markdown',
        size: 12,
        extractedText: '# OK',
        sourceType: 'text',
        status: 'ready',
      },
      {
        name: 'broken.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 20,
        sourceType: 'office',
        status: 'error',
        error: '文档解析失败',
      },
    ],
  })
  const report = buildVaultIngestionReport('测试知识库', plan)

  assert.match(report, /# 测试知识库 资料导入报告/)
  assert.match(report, /成功转换：1/)
  assert.match(report, /元数据文件：1/)
  assert.match(report, /失败：1/)
  assert.match(report, /broken.docx：文档解析失败/)
})

test('flattenVaultIngestionPlanEntries returns a single raw write protocol for originals, markdown and metadata', () => {
  const plan = buildVaultIngestionPlan({
    files: [
      {
        name: '案件材料.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 2048,
        extractedText: '# 故意伤害案\n事实经过明确',
        originalDataUrl: 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,AAAA',
        sourceType: 'markitdown',
        status: 'ready',
      },
    ],
  })

  const entries = flattenVaultIngestionPlanEntries(plan)

  assert.deepEqual(entries.map(entry => entry.name), [
    '案件材料.docx',
    '案件材料.md',
    '案件材料.meta.json',
  ])
  assert.deepEqual(entries.map(entry => entry.folderPath), [
    'raw/原始文件',
    'raw/转换后的MD',
    'raw/转换后的MD',
  ])
  assert.deepEqual(entries.map(entry => entry.kind), ['raw', 'raw', 'raw'])
  assert.deepEqual(entries.map(entry => entry.indexed), [false, false, true])
  assert.equal(entries[1].metadata.kind, 'converted-markdown')
  assert.equal(entries[2].metadata.kind, 'converted-markdown-meta')
})

test('isVaultIngestionCompileTarget only marks converted markdown raw entries for wiki organize', () => {
  const plan = buildVaultIngestionPlan({
    files: [{
      name: '小说第50章.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      extractedText: '# 第50章\n山洞里的饼干',
      originalDataUrl: 'data:application/pdf;base64,AAAA',
      sourceType: 'rapidocr_chunked',
      status: 'ready',
    }],
  })

  const entries = flattenVaultIngestionPlanEntries(plan)
  assert.deepEqual(entries.map(isVaultIngestionCompileTarget), [false, true, false])
})

test('isConvertedMarkdownRawFile rejects original and metadata raw files as compiler targets', () => {
  assert.equal(isConvertedMarkdownRawFile({
    category: 'knowledge',
    mimeType: 'text/markdown',
    kind: 'raw',
    indexed: false,
    metadata: { vaultFolder: 'raw', kind: 'converted-markdown' },
  }), true)
  assert.equal(isConvertedMarkdownRawFile({
    category: 'knowledge',
    mimeType: 'application/pdf',
    kind: 'raw',
    indexed: false,
    metadata: { vaultFolder: 'raw', kind: 'original-file' },
  }), false)
  assert.equal(isConvertedMarkdownRawFile({
    category: 'knowledge',
    mimeType: 'application/json',
    kind: 'raw',
    indexed: true,
    metadata: { vaultFolder: 'raw', kind: 'converted-markdown-meta' },
  }), false)
  assert.equal(isConvertedMarkdownRawFile({
    category: 'knowledge',
    mimeType: 'folder',
    kind: 'raw',
    indexed: false,
    metadata: { vaultFolder: 'raw', kind: 'converted-markdown' },
  }), false)
})
