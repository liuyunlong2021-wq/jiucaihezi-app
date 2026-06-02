/**
 * Phase 0 Smoke Test: @tiptap/html generateHTML 兼容性验证
 *
 * 目的：
 *   验证在当前项目使用的自定义节点（WikiLink + EditorTable*）环境下，
 *   @tiptap/html 的 generateHTML 是否能正确保留结构。
 *
 * 运行方式（临时）：
 *   pnpm add -D @tiptap/html
 *   npx tsx src/utils/__tests__/smoke/tiptap-generate-html-smoke.ts
 *
 * 输出：
 *   - 生成的 HTML 片段
 *   - 逐节点判定矩阵结果（通过 / 需兜底）
 */

import { EditorTable, EditorTableRow, EditorTableCell, EditorTableHeader } from '../../../components/editor/editorTableExtensions'
import { WikiLinkExtension } from '../../../components/editor/WikiLinkExtension'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import { Color } from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'

import { buildComplexDocWithAllP0Elements } from '../helpers/editorTestDocuments'

async function runSmokeTest() {
  console.log('=== Phase 0: @tiptap/html Smoke Test ===\n')

  // 1. 构建与 EditorPanel 完全一致的 extensions 列表
  const extensions = [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      link: false,
      underline: false,
    }),
    Underline,
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TextStyle,
    Color,
    EditorTable,
    EditorTableRow,
    EditorTableHeader,
    EditorTableCell,
    WikiLinkExtension,
  ]

  // 2. 使用集中测试数据生成器构造文档（推荐做法）
  const testDoc = buildComplexDocWithAllP0Elements({
    includeImages: true,
    includeWikiLinks: true,
    tableSize: { rows: 3, cols: 3 },
    includeTaskList: true,
  })

  // 3. 尝试加载 @tiptap/html
  let generateHTML: any = null
  let htmlOutput = ''

  try {
    const htmlModule = await import('@tiptap/html')
    generateHTML = htmlModule.generateHTML
    console.log('✅ 成功加载 @tiptap/html')
  } catch (e) {
    console.log('❌ 未找到 @tiptap/html 包')
    console.log('   请先执行：pnpm add -D @tiptap/html')
    console.log('   然后重新运行本脚本\n')
    process.exit(1)
  }

  // 4. 执行生成
  try {
    htmlOutput = generateHTML(testDoc, extensions)
    console.log('\n=== 生成的 HTML 输出 ===\n')
    console.log(htmlOutput)
    console.log('\n========================\n')
  } catch (err: any) {
    console.error('❌ generateHTML 执行失败:', err.message)
    console.error(err.stack)
    process.exit(1)
  }

  // 5. 按 TDD 定义的矩阵进行逐节点判定
  console.log('=== 逐节点判定结果（Phase 0 决策依据）===\n')

  const results = [
    {
      node: 'WikiLink',
      passed: htmlOutput.includes('data-wiki-link') && htmlOutput.includes('[[需求文档]]'),
      passCriteria: '包含 data-wiki-link 属性 + [[标签]] 文本',
      fallback: '必须走自定义序列化器兜底',
    },
    {
      node: 'EditorTable*',
      passed: htmlOutput.includes('<table') && htmlOutput.includes('<thead') && htmlOutput.includes('<tbody'),
      passCriteria: '包含 <table> + <thead>/<tbody> 结构',
      fallback: '评估迁移官方 Table 或为自定义 Table 写专属 DOCX 适配器',
    },
    {
      node: 'TaskItem (checked)',
      passed: htmlOutput.includes('data-checked') || htmlOutput.includes('checked'),
      passCriteria: '包含 checked 相关语义标记',
      fallback: '走自定义序列化器兜底',
    },
    {
      node: 'Image (dataURL)',
      passed: htmlOutput.includes('data:image/png;base64'),
      passCriteria: '完整保留 data: URL',
      fallback: '图片降级为纯文本占位符',
    },
  ]

  let allDecided = true

  results.forEach((r) => {
    const status = r.passed ? '✅ 通过（可走 generateHTML）' : '⚠️  未通过'
    console.log(`${r.node}: ${status}`)
    console.log(`   通过标准: ${r.passCriteria}`)
    if (!r.passed) {
      console.log(`   → 推荐策略: ${r.fallback}`)
      allDecided = false
    }
    console.log('')
  })

  console.log('=== Phase 0 结论 ===\n')
  if (allDecided) {
    console.log('✅ 所有关键自定义节点均被 generateHTML 正确处理。')
    console.log('   可以安全引入 @tiptap/html 作为主要序列化器。')
  } else {
    console.log('⚠️  存在节点无法被 generateHTML 正确处理。')
    console.log('   必须在后续实现中为这些节点准备自定义兜底序列化逻辑。')
  }

  console.log('\n建议：将以上输出保存为 Phase 0 Smoke Test 报告，提交评审后决定是否进入 Phase 1。')
}

runSmokeTest().catch(console.error)