import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildBrainSuggestionsFromWikiPages } from '../brainSuggestions'

test('buildBrainSuggestionsFromWikiPages extracts trigger rule and example suggestions from wiki pages', () => {
  const suggestions = buildBrainSuggestionsFromWikiPages({
    skills: [{ id: 'novel', name: '小说搭子' }],
    pages: [{
      id: 'page-1',
      skillId: 'novel',
      title: '长篇小说工作流.md',
      content: [
        '# 长篇小说工作流',
        '',
        '## 触发场景',
        '当用户要求写章节、改文风、补角色心理时，优先调用小说搭子。',
        '',
        '## 工作规则',
        '必须保持既有人设和世界观一致。不要忽略前文伏笔。',
        '',
        '## 示例',
        '用户：写第三章。',
        '输出：先检索角色和世界观，再生成章节正文。',
      ].join('\n'),
    }],
  })

  assert.deepEqual(suggestions.map(item => item.type).sort(), ['example', 'rule', 'trigger'])
  assert.ok(suggestions.every(item => item.skillId === 'novel'))
  assert.ok(suggestions.every(item => item.skillName === '小说搭子'))
  assert.match(suggestions.find(item => item.type === 'rule')?.content || '', /必须保持既有人设/)
})
