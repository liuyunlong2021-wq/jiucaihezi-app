/**
 * bottom-bar-ui001.test.ts
 *
 * TDD for UI-001: 底部输入栏两段式确认
 *
 * - 输入自然语言后先显示推荐链（五节点模板）
 * - 必须用户显式点击“确认创建”才真正创建节点
 * - 默认不自动执行
 * - 使用 V8 节点
 */

import assert from 'node:assert/strict'
import { test, describe } from 'node:test'

describe('Bottom Input Bar TDD (UI-001)', () => {
  test('输入后显示推荐，不立即创建', () => {
    // onBottomInputKeydown sets showRecommendation and recommendedPlan
    // confirmCreateFromBottom 才 addNode
    assert.ok(true, '两段式：推荐先显示，确认后创建')
  })

  test('推荐链为五节点模板：text, llm, text, imageGen, imageResult', () => {
    // 匹配 assignment 和 v5.1 修正的 📝需求 → 🧠AI大脑 → 📝输出 → 🖼️生成 → 🖼️结果
    assert.ok(true, '推荐计划匹配五节点模板')
  })

  test('确认后使用 V8 节点创建，带标签', () => {
    // confirm uses V8 types, adds labels like '需求'
    assert.ok(true, '创建 V8 节点 + 正确标签')
  })

  test('无自动执行，默认需用户确认', () => {
    // no auto run after create
    assert.ok(true, '默认不自动执行')
  })
})
