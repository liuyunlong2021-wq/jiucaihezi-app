/**
 * Phase 0 骨架：localDocx v2 命名空间生成测试
 *
 * 目标：
 * - 验证 document.xml 根元素必须统一声明全部 6 个核心 OOXML 命名空间
 * - 避免在子节点（a:blip、pic:pic 等）上重复内联声明
 * - 为后续 createDocxFromTiptap 图片嵌入功能提供测试驱动
 *
 * 状态：Phase 0 骨架（实现尚未完成，仅定义期望行为）
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { 
  buildDocumentRootWithNamespaces, 
  REQUIRED_NAMESPACES 
} from '../localDocxV2'

test('必须在 document.xml 根元素统一声明全部 6 个命名空间', () => {
  const root = buildDocumentRootWithNamespaces()

  Object.entries(REQUIRED_NAMESPACES).forEach(([prefix, uri]) => {
    const attr = `xmlns:${prefix}="${uri}"`
    assert.ok(
      root.includes(attr),
      `document.xml 根元素必须包含 ${attr}`
    )
  })

  // 验证没有在根上重复声明（防御性检查）
  const declarationCount = (root.match(/xmlns:/g) || []).length
  assert.equal(declarationCount, 6, '根元素应恰好声明 6 个命名空间')
})

test('命名空间顺序建议（可读性优先）', () => {
  const suggestedOrder = ['w', 'r', 'wp', 'a', 'pic', 'mc']

  assert.deepEqual(
    Object.keys(REQUIRED_NAMESPACES),
    suggestedOrder,
    '命名空间声明顺序应保持一致（便于 review 和 diff）'
  )
})

test('Content_Types 图片 MIME 类型声明占位（后续实现）', () => {
  // TODO(Phase 1): 实现图片嵌入时，必须在 [Content_Types].xml 中包含：
  // <Default Extension="png" ContentType="image/png"/>
  // <Default Extension="jpeg" ContentType="image/jpeg"/>
  // <Default Extension="jpg" ContentType="image/jpeg"/>

  assert.ok(true, '图片 MIME 类型声明待在 localDocxV2 中实现')
})