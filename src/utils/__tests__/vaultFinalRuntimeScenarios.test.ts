import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildVaultChunks } from '../vaultChunking'
import { inferVaultDomainSchema } from '../vaultDomainSchema'
import { buildVaultEvidencePlan } from '../vaultEvidencePlanner'
import { buildVaultIngestionPlan, flattenVaultIngestionPlanEntries, isVaultIngestionCompileTarget } from '../vaultIngestion'
import { buildVaultWikiPlan } from '../vaultWikiPlanner'

test('first-create vault material produces real source-traceable wiki pages', () => {
  const ingestion = buildVaultIngestionPlan({
    files: [{
      name: '第001章.txt',
      mimeType: 'text/plain',
      size: 512,
      sourceType: 'text',
      status: 'ready',
      extractedText: '# 第1章 初遇\n男主第一次见到女主，记住了她喜欢薄荷糖。',
    }],
  })
  const markdownEntry = flattenVaultIngestionPlanEntries(ingestion).find(isVaultIngestionCompileTarget)
  assert.ok(markdownEntry)

  const chunks = buildVaultChunks({
    vaultId: 'vault_first_create',
    rawFiles: [{
      id: 'raw_001',
      name: markdownEntry.name,
      content: markdownEntry.content,
      metadata: markdownEntry.metadata,
    }],
  })
  const wikiPlan = buildVaultWikiPlan({
    chunks,
    wikiFolders: ['人物', '关系', '事件线', '章节索引'],
  })

  assert.ok(wikiPlan.actions.length > 0)
  assert.ok(wikiPlan.actions.every(action => action.type === 'create'))
  assert.ok(wikiPlan.actions.every(action => action.content?.includes('## 关键事实')))
  assert.ok(wikiPlan.actions.every(action => action.content?.includes('sources:')))
  assert.ok(wikiPlan.actions.every(action => action.content?.includes('sourceChunks:')))
  assert.ok(wikiPlan.actions.every(action => action.sourceChunkIds?.length))
  assert.doesNotMatch(wikiPlan.actions.map(action => action.content).join('\n'), /待补充|占位|示例内容/)
})

test('novel vault scenario turns chapter material into retrievable relationship evidence', () => {
  const ingestion = buildVaultIngestionPlan({
    files: [{
      name: '第050章.pdf',
      mimeType: 'application/pdf',
      size: 1024,
      sourceType: 'rapidocr_chunked',
      originalDataUrl: 'data:application/pdf;base64,AAAA',
      status: 'ready',
      extractedText: [
        '# 第50章 山洞里的饼干',
        '男主和女主躲进小山洞，他们分吃了一块饼干。',
        '这件事成为两人感情线的重要回忆。',
      ].join('\n'),
    }],
  })
  const markdownEntry = flattenVaultIngestionPlanEntries(ingestion).find(isVaultIngestionCompileTarget)
  assert.ok(markdownEntry)

  const chunks = buildVaultChunks({
    vaultId: 'vault_novel',
    rawFiles: [{
      id: 'raw_50',
      name: markdownEntry.name,
      content: markdownEntry.content,
      metadata: markdownEntry.metadata,
    }],
  })
  const schema = inferVaultDomainSchema({
    name: '小说知识库',
    text: markdownEntry.content,
  })
  const evidence = buildVaultEvidencePlan({
    query: '继续写男主和女主的爱情故事，记得山洞饼干的回忆',
    wikiFiles: [
      { id: 'male', path: 'wiki/人物/男主.md', name: '男主.md', content: '男主性格克制，珍惜女主。' },
      { id: 'female', path: 'wiki/人物/女主.md', name: '女主.md', content: '女主外冷内热。' },
      { id: 'rel', path: 'wiki/关系/男主-女主.md', name: '男主-女主.md', content: '两人的关键回忆是山洞饼干。' },
      { id: 'line', path: 'wiki/事件线/感情线.md', name: '感情线.md', content: '第50章共同经历山洞事件。' },
    ],
    chunks,
  })

  assert.equal(schema.domain, 'novel')
  assert.ok(schema.wikiFolders.includes('人物'))
  assert.ok(schema.wikiFolders.includes('关系'))
  assert.ok(schema.wikiFolders.includes('章节索引'))
  assert.match(evidence.evidenceText, /男主性格克制/)
  assert.match(evidence.evidenceText, /分吃了一块饼干/)
})

test('legal vault scenario retrieves similar case and pleading template evidence', () => {
  const ingestion = buildVaultIngestionPlan({
    files: [{
      name: '故意伤害案材料.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 2048,
      sourceType: 'markitdown',
      originalDataUrl: 'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,AAAA',
      status: 'ready',
      extractedText: [
        '# （2024）京0101刑初123号 故意伤害案',
        '案由：故意伤害罪。',
        '## 起诉状',
        '本案起诉状采用事实经过、证据、诉讼请求结构。',
      ].join('\n'),
    }],
  })
  const markdownEntry = flattenVaultIngestionPlanEntries(ingestion).find(isVaultIngestionCompileTarget)
  assert.ok(markdownEntry)

  const chunks = buildVaultChunks({
    vaultId: 'vault_law',
    rawFiles: [{
      id: 'raw_case',
      name: markdownEntry.name,
      content: markdownEntry.content,
      metadata: markdownEntry.metadata,
    }],
  })
  const schema = inferVaultDomainSchema({
    name: '律师案例库',
    text: markdownEntry.content,
  })
  const evidence = buildVaultEvidencePlan({
    query: '有没有和这个故意伤害案类似的案子，参照之前案子写起诉状',
    wikiFiles: [
      { id: 'cause', path: 'wiki/案由/故意伤害.md', name: '故意伤害.md', content: '故意伤害罪证据要点。' },
      { id: 'case', path: 'wiki/案件/（2024）京0101刑初123号.md', name: '（2024）京0101刑初123号.md', content: '相似案件处理结果。' },
      { id: 'tpl', path: 'wiki/文书模板/起诉状.md', name: '起诉状.md', content: '起诉状模板。' },
      { id: 'strategy', path: 'wiki/办案策略/轻伤二级.md', name: '轻伤二级.md', content: '办案策略。' },
    ],
    chunks,
  })

  assert.equal(schema.domain, 'legal')
  assert.ok(schema.wikiFolders.includes('案由'))
  assert.ok(schema.wikiFolders.includes('文书模板'))
  assert.ok(chunks.some(chunk => chunk.metadata.caseNumber === '（2024）京0101刑初123号'))
  assert.match(evidence.evidenceText, /相似案件处理结果/)
  assert.match(evidence.evidenceText, /起诉状模板/)
})
