import assert from 'node:assert/strict'
import { test } from 'node:test'

import { selectMemoryTools } from '../memoryChat'

const tools = ['skill', 'wiki_search', 'wiki', 'read', 'glob', 'grep', 'write', 'edit', 'mkdir', 'terminal', 'create_document', 'create_3d_scene', 'mcp__demo__run']
  .map(name => ({ function: { name } }))

test('Wiki query exposes only native Wiki read tools', () => {
  assert.deepEqual(selectMemoryTools('查询 Wiki 中的角色设定', tools).map(tool => tool.function.name), ['wiki_search', 'wiki', 'read', 'glob', 'grep'])
})

test('Wiki writing exposes read and write tools without media or terminal', () => {
  assert.deepEqual(selectMemoryTools('根据 Wiki 设定写入小说第三章文件', tools).map(tool => tool.function.name), ['wiki_search', 'wiki', 'read', 'glob', 'grep', 'write', 'edit', 'mkdir'])
})

test('ordinary conversation exposes no project tools', () => {
  assert.deepEqual(selectMemoryTools('请帮我想一个故事开头', tools), [])
})

test('explicit MCP keeps only the selected MCP tools', () => {
  assert.deepEqual(selectMemoryTools('调用 MCP 查询数据', tools).map(tool => tool.function.name), ['mcp__demo__run'])
})

test('attached document plus an add-to-scope instruction exposes write tools', () => {
  assert.deepEqual(selectMemoryTools('查看文档，然后把这个规则合理的添加到规范范围', tools, [], true).map(tool => tool.function.name), ['read', 'glob', 'grep', 'write', 'edit', 'mkdir'])
})
