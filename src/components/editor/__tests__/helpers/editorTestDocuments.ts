/**
 * 编辑器测试文档生成器（Phase 0 辅助工具）
 *
 * 用途：
 * - 为 smoke test、localDocx v2 测试、PDF 打印测试提供可复用的富文档 JSON
 * - 集中管理“包含所有 P0 关键节点”的标准测试用例
 *
 * 对应 TDD 附录 C：测试数据生成器
 */

import type { JSONContent } from '@tiptap/core'

export interface BuildComplexDocOptions {
  /** 是否包含图片（dataURL） */
  includeImages?: boolean
  /** 是否包含 WikiLink */
  includeWikiLinks?: boolean
  /** 表格尺寸 */
  tableSize?: { rows: number; cols: number }
  /** 是否包含任务列表 */
  includeTaskList?: boolean
}

/**
 * 构建包含 TDD 定义的所有 P0 关键节点的复杂文档
 * 用于 generateHTML smoke test、DOCX 保真度测试等
 */
export function buildComplexDocWithAllP0Elements(
  options: BuildComplexDocOptions = {}
): JSONContent {
  const {
    includeImages = true,
    includeWikiLinks = true,
    tableSize = { rows: 3, cols: 3 },
    includeTaskList = true,
  } = options

  const content: JSONContent[] = []

  // H1
  content.push({
    type: 'heading',
    attrs: { level: 1 },
    content: [{ type: 'text', text: 'Phase 0 完整保真度测试文档' }],
  })

  // 带多种 marks 的段落
  content.push({
    type: 'paragraph',
    content: [
      { type: 'text', marks: [{ type: 'bold' }], text: '加粗文本' },
      { type: 'text', text: '、' },
      { type: 'text', marks: [{ type: 'italic' }], text: '斜体文本' },
      { type: 'text', text: '、' },
      { type: 'text', marks: [{ type: 'underline' }], text: '下划线' },
      { type: 'text', text: '、' },
      { type: 'text', marks: [{ type: 'strike' }], text: '删除线' },
      { type: 'text', text: '、' },
      {
        type: 'text',
        marks: [{ type: 'highlight', attrs: { color: '#ffeb3b' } }],
        text: '高亮文本',
      },
    ],
  })

  // WikiLink
  if (includeWikiLinks) {
    content.push({
      type: 'wikiLink',
      attrs: { id: 'file-001', label: '需求规格说明书' },
    })
    content.push({
      type: 'wikiLink',
      attrs: { id: 'file-002', label: '技术架构文档' },
    })
  }

  // 表格
  content.push(buildSampleTable(tableSize.rows, tableSize.cols))

  // 任务列表
  if (includeTaskList) {
    content.push({
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: '已完成的需求评审' }],
            },
          ],
        },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: '待完成的开发任务' }],
            },
          ],
        },
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: '嵌套子任务示例' }],
            },
          ],
        },
      ],
    })
  }

  // 图片（使用极小的有效 PNG dataURL，便于测试）
  if (includeImages) {
    content.push({
      type: 'paragraph',
      content: [{ type: 'text', text: '以下是嵌入图片：' }],
    })

    content.push({
      type: 'image',
      attrs: {
        src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
        alt: '测试小图片 1',
        title: '小尺寸测试图',
      },
    })

    content.push({
      type: 'image',
      attrs: {
        src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/8A',
        alt: '测试 JPEG 图片',
        title: '中等尺寸测试图',
      },
    })
  }

  // 引用块
  content.push({
    type: 'blockquote',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '这是一个引用块，用于测试导出中的引用格式保留。' }],
      },
    ],
  })

  // 水平线
  content.push({ type: 'horizontalRule' })

  // 代码块
  content.push({
    type: 'codeBlock',
    attrs: { language: 'typescript' },
    content: [
      {
        type: 'text',
        text: 'const x: number = 42;\nconsole.log("Phase 0 smoke test");',
      },
    ],
  })

  return {
    type: 'doc',
    content,
  }
}

/** 构建一个简单的测试表格 */
export function buildSampleTable(rows = 3, cols = 3): JSONContent {
  const headerRow: JSONContent = {
    type: 'tableRow',
    content: Array.from({ length: cols }, (_, i) => ({
      type: 'tableHeader',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `列${i + 1}` }],
        },
      ],
    })),
  }

  const dataRows: JSONContent[] = Array.from({ length: rows - 1 }, (_, rowIndex) => ({
    type: 'tableRow',
    content: Array.from({ length: cols }, (_, colIndex) => ({
      type: 'tableCell',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: `R${rowIndex + 1}C${colIndex + 1}` }],
        },
      ],
    })),
  }))

  return {
    type: 'table',
    content: [headerRow, ...dataRows],
  }
}

/**
 * 构建一个超长文档（用于性能测试）
 * @param paragraphCount 段落数量
 */
export function buildLargeDocument(paragraphCount = 50): JSONContent {
  const paragraphs: JSONContent[] = []

  for (let i = 0; i < paragraphCount; i++) {
    paragraphs.push({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: `这是第 ${i + 1} 个段落。用于测试长文档导出性能与分页表现。包含一些**加粗**和*斜体*文本。`,
        },
      ],
    })
  }

  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: '大型文档性能测试' }],
      },
      ...paragraphs,
    ],
  }
}

/**
 * 构建仅包含图片的文档（用于图片嵌入专项测试）
 */
export function buildDocumentWithImages(count = 3): JSONContent {
  const images = Array.from({ length: count }, (_, i) => ({
    type: 'image',
    attrs: {
      src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      alt: `测试图片 ${i + 1}`,
    },
  }))

  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '图片导出专项测试' }] },
      ...images,
    ],
  }
}