import assert from 'node:assert/strict'
import { test } from 'node:test'

import { collectAuthorizedPaths, isAuthorizedPath, memoryToolNeedsApproval } from '../memoryToolPolicy'

function call(name: string, args: Record<string, unknown>) {
  return { id: `call_${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }
}

test('零弹窗：文件、终端、Skill 脚本与 3D 导出都不再需要确认', () => {
  assert.equal(memoryToolNeedsApproval(call('read', { path: 'notes/hot.md' }), []), false)
  assert.equal(memoryToolNeedsApproval(call('write', { path: 'notes/new.md', content: 'x' }), []), false)
  assert.equal(memoryToolNeedsApproval(call('delete', { path: 'notes/new.md' }), []), false)
  assert.equal(memoryToolNeedsApproval(call('copy', { path: 'a', destination: 'b' }), []), false)
  assert.equal(memoryToolNeedsApproval(call('terminal', { command: 'ls' }), []), false)
  assert.equal(memoryToolNeedsApproval(call('skill_run_script', { skill: 'checker', path: 'scripts/check.mjs' }), []), false)
  assert.equal(memoryToolNeedsApproval(call('export_3d_scene_video', { path: '.raw/jc-media/文档/选矿.jcscene' }), []), false)
})

test('授权粒度是路径前缀：给目录放开整棵子树，给文件只放开该文件', () => {
  const directory = ['/Users/by3/.agents/skills/human-physiognomy']
  assert.equal(isAuthorizedPath('/Users/by3/.agents/skills/human-physiognomy/SKILL.md', directory), true)
  assert.equal(isAuthorizedPath('/Users/by3/.agents/skills/human-physiognomy/references/guxiang.md', directory), true)
  assert.equal(isAuthorizedPath('/Users/by3/.agents/skills/other/SKILL.md', directory), false)
  assert.equal(isAuthorizedPath('/Users/by3/.agents/skills/human-physiognomy-2/SKILL.md', directory), false)
  assert.equal(isAuthorizedPath('/Users/by3/.agents/skills/human-physiognomy/SKILL.md', ['/Users/by3/.agents/skills/human-physiognomy/SKILL.md']), true)
  assert.equal(isAuthorizedPath('/Users/by3/.agents/skills/human-physiognomy/references/guxiang.md', ['/Users/by3/.agents/skills/human-physiognomy/SKILL.md']), false)
  assert.equal(
    memoryToolNeedsApproval(call('edit', { path: '/Users/by3/.agents/skills/human-physiognomy/SKILL.md', oldString: 'a', newString: 'b' }), directory),
    false,
  )
  assert.equal(
    memoryToolNeedsApproval(call('write_text_batch', { files: [{ path: '/Users/by3/.agents/skills/human-physiognomy/references/guxiang.md', content: 'x' }] }), directory),
    false,
  )
})

test('collectAuthorizedPaths 从未被提及的路径不会变成授权', () => {
  assert.deepEqual(collectAuthorizedPaths('看一下 wiki/改编方案/index.md 里的内容'), [])
  assert.deepEqual(
    collectAuthorizedPaths('请修改这个 Skill：\n\nSkill 目录：\n/Users/by3/.agents/skills/human-physiognomy\n\n修改要求：\n把开头改短。'),
    ['/Users/by3/.agents/skills/human-physiognomy'],
  )
  assert.deepEqual(
    collectAuthorizedPaths('读取 /tmp/source.txt，然后写入 /tmp/result.txt。'),
    ['/tmp/source.txt', '/tmp/result.txt'],
  )
})

test('未授权的项目外路径硬失败并要求用户补路径', () => {
  assert.throws(
    () => memoryToolNeedsApproval(call('write', { path: '/tmp/result.txt', content: 'x' }), []),
    /必须先由用户提供/,
  )
  assert.throws(
    () => memoryToolNeedsApproval(call('read', { path: '/etc/hosts' }), ['/tmp']),
    /必须先由用户提供/,
  )
})

test('授权前缀先折叠 ..，不能靠相对段跳出授权目录', () => {
  const directory = ['/Users/by3/.agents/skills/human-physiognomy']
  assert.equal(isAuthorizedPath('/Users/by3/.agents/skills/human-physiognomy/../../../etc/hosts', directory), false)
  assert.equal(isAuthorizedPath('/Users/by3/.agents/skills/human-physiognomy/./SKILL.md', directory), true)
  assert.throws(
    () => memoryToolNeedsApproval(
      call('read', { path: '/Users/by3/.agents/skills/human-physiognomy/../../../etc/hosts' }),
      directory,
    ),
    /必须先由用户提供/,
  )
})

test('授权路径抽取容忍常见中文写法，不误收相对路径', () => {
  assert.deepEqual(collectAuthorizedPaths('路径=/Users/a/b'), ['/Users/a/b'])
  assert.deepEqual(collectAuthorizedPaths('读取 /Users/a/b.md.'), ['/Users/a/b.md'])
  assert.deepEqual(collectAuthorizedPaths('读 /Users/a/b.md然后继续'), ['/Users/a/b.md'])
  assert.deepEqual(collectAuthorizedPaths('看 wiki/改编方案/index.md'), [])
})

test('current-project absolute paths do not require external authorization', () => {
  assert.equal(
    memoryToolNeedsApproval(
      call('write', { path: '/Users/by3/Documents/project/wiki/工作进度/2026-08-27.md', content: 'x' }),
      [],
      '/Users/by3/Documents/project',
    ),
    false,
  )
})

test('MCP 工具已选即已授权，读与写都不弹窗', () => {
  const original = (globalThis as any).__jiucaihezi_mcpStore__
  ;(globalThis as any).__jiucaihezi_mcpStore__ = {
    useMcpStore: () => ({
      allMcpTools: [{
        name: 'mcp__github__get_file', description: '', inputSchema: {}, serverId: 'github', originalName: 'get_file',
        annotations: { readOnlyHint: true },
      }],
      isServerEnabled: () => true,
      isServerConnected: () => true,
    }),
  }
  try {
    assert.equal(memoryToolNeedsApproval(call('mcp__github__get_file', {}), []), false)
    assert.equal(memoryToolNeedsApproval(call('mcp__github__create_issue', {}), []), false)
  } finally {
    ;(globalThis as any).__jiucaihezi_mcpStore__ = original
  }
})
