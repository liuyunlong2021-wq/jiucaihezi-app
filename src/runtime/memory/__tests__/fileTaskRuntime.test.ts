import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { DirectToolCall } from '@/runtime/direct/directTypes'
import {
  createProjectFileService,
  type ProjectFileAdapter,
  type ProjectFileEntry,
} from '@/services/projectFileService'
import {
  cleanupCompletedFileTask,
  executeVerifiedFileMutation,
  fileTaskManifestPath,
  fileTaskRunId,
} from '../fileTaskRuntime'

function call(name: string, args: Record<string, unknown>): DirectToolCall {
  return {
    id: `call_${name}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

function projectFiles(initial: Record<string, string> = {}) {
  const entries = new Map<string, ProjectFileEntry>(
    Object.entries(initial).map(([path, content]) => [
      path,
      { path, content, size: content.length, isDirectory: false, mimeType: 'text/markdown' },
    ]),
  )
  let revision = 0
  const adapter: ProjectFileAdapter = {
    runtime: 'web',
    async list() { return [...entries.values()] },
    async readText(_owner, path) {
      const entry = entries.get(path)
      if (!entry || entry.isDirectory) throw new Error(`文件不存在: ${path}`)
      const content = String(entry.content || '')
      return {
        content,
        size: content.length,
        truncated: false,
        revision: { value: `${path}:${revision}`, size: content.length },
      }
    },
    async createText(_owner, path, content) {
      const entry = { path, content, size: content.length, isDirectory: false, mimeType: 'text/markdown' }
      entries.set(path, entry)
      revision += 1
      return entry
    },
    async writeText(_owner, path, content) {
      const entry = entries.get(path)
      if (!entry) return { status: 'missing' as const }
      entries.set(path, { ...entry, content, size: content.length })
      revision += 1
      return {
        status: 'saved' as const,
        revision: { value: `${path}:${revision}`, size: content.length },
      }
    },
    async createFolder() { throw new Error('not used') },
    async rename() { throw new Error('not used') },
    async remove(_owner, path) {
      for (const key of entries.keys()) {
        if (key === path || key.startsWith(`${path}/`)) entries.delete(key)
      }
    },
  }
  return { entries, files: createProjectFileService(adapter) }
}

test('文件 Runtime 在副作用前记账，写后逐字读回并直接返回累计回执', async () => {
  const { entries, files } = projectFiles({ '资料/a.md': '旧内容' })
  const runId = fileTaskRunId('conversation-1', 'turn-1')
  const manifestPath = fileTaskManifestPath(runId)
  const result = await executeVerifiedFileMutation({
    owner: 'project',
    runId,
    taskFingerprint: 'task-hash',
    call: call('write', { path: '资料/a.md', content: '新内容' }),
    files,
    execute: async () => {
      const before = JSON.parse(String(entries.get(manifestPath)?.content || '{}'))
      assert.equal(before.status, 'committing')
      const [resource] = (await files.list('project')).filter(item => item.path === '资料/a.md')
      const current = await files.readText(resource)
      await files.writeText(resource, '新内容', current.revision)
      return { content: 'raw success' }
    },
  })

  assert.equal(result.status, 'succeeded')
  assert.match(result.content, /已验证 1 个文件动作/)
  const manifest = JSON.parse(String(entries.get(manifestPath)?.content || '{}'))
  assert.equal(manifest.status, 'completed')
  assert.equal(manifest.actions[0].status, 'verified')
  assert.equal(manifest.actions[0].verified, true)
})

test('文件 Runtime 读回不一致时保留 blocked 账本且不宣称成功', async () => {
  const { entries, files } = projectFiles({ '资料/a.md': '旧内容' })
  const runId = fileTaskRunId('conversation-2', 'turn-2')
  const result = await executeVerifiedFileMutation({
    owner: 'project',
    runId,
    taskFingerprint: 'task-hash',
    call: call('write', { path: '资料/a.md', content: '目标内容' }),
    files,
    execute: async () => ({ content: '工具误报成功' }),
  })

  assert.equal(result.status, 'failed')
  assert.match(result.content, /读回不一致/)
  const manifest = JSON.parse(String(entries.get(fileTaskManifestPath(runId))?.content || '{}'))
  assert.equal(manifest.status, 'blocked')
  assert.equal(manifest.actions[0].verified, false)
})

test('同一 run-id 的后续批次保留已经验证的动作', async () => {
  const { entries, files } = projectFiles()
  const runId = fileTaskRunId('conversation-3', 'turn-3')
  const commit = async (toolCall: DirectToolCall) =>
    await executeVerifiedFileMutation({
      owner: 'project',
      runId,
      taskFingerprint: 'task-hash',
      call: toolCall,
      files,
      execute: async () => {
        const args = JSON.parse(toolCall.function.arguments)
        await files.createText('project', args.path, args.content)
        return { content: 'raw success' }
      },
    })

  await commit(call('write', { path: '资料/a.md', content: 'A' }))
  const second = await commit(call('write', { path: '资料/b.md', content: 'B' }))

  assert.match(second.content, /已验证 2 个文件动作/)
  const manifest = JSON.parse(String(entries.get(fileTaskManifestPath(runId))?.content || '{}'))
  assert.deepEqual(manifest.actions.map((action: { path: string }) => action.path), ['资料/a.md', '资料/b.md'])
})

test('恢复时已验证的 edit 不会因为 oldString 已消失而重复执行', async () => {
  const { files } = projectFiles({ '资料/a.md': '旧段落' })
  const runId = fileTaskRunId('conversation-4', 'turn-4')
  const editCall = call('edit', {
    path: '资料/a.md',
    oldString: '旧段落',
    newString: '新段落',
  })
  let executions = 0
  const execute = async () => {
    executions += 1
    const [resource] = (await files.list('project')).filter(item => item.path === '资料/a.md')
    const current = await files.readText(resource)
    await files.writeText(resource, '新段落', current.revision)
    return { content: 'raw success' }
  }
  const input = {
    owner: 'project',
    runId,
    taskFingerprint: 'task-hash',
    call: editCall,
    files,
    execute,
  }

  await executeVerifiedFileMutation(input)
  const resumed = await executeVerifiedFileMutation(input)

  assert.equal(executions, 1)
  assert.equal(resumed.status, 'succeeded')
  assert.match(resumed.content, /已验证 1 个文件动作/)
})

test('整个任务完成并返回回执后清理临时账本，blocked 账本保留', async () => {
  const completed = projectFiles()
  const completedRunId = fileTaskRunId('conversation-5', 'turn-5')
  const writeCall = call('write', { path: '资料/a.md', content: 'A' })
  await executeVerifiedFileMutation({
    owner: 'project',
    runId: completedRunId,
    taskFingerprint: 'task-hash',
    call: writeCall,
    files: completed.files,
    execute: async () => {
      await completed.files.createText('project', '资料/a.md', 'A')
      return { content: 'raw success' }
    },
  })
  assert.equal(await cleanupCompletedFileTask(completed.files, 'project', completedRunId), true)
  assert.equal(completed.entries.has(fileTaskManifestPath(completedRunId)), false)

  const blocked = projectFiles({ '资料/a.md': '旧内容' })
  const blockedRunId = fileTaskRunId('conversation-6', 'turn-6')
  await executeVerifiedFileMutation({
    owner: 'project',
    runId: blockedRunId,
    taskFingerprint: 'task-hash',
    call: call('write', { path: '资料/a.md', content: '目标内容' }),
    files: blocked.files,
    execute: async () => ({ content: '误报成功' }),
  })
  assert.equal(await cleanupCompletedFileTask(blocked.files, 'project', blockedRunId), false)
  assert.equal(blocked.entries.has(fileTaskManifestPath(blockedRunId)), true)
})

test('同一任务有旧 blocked 动作时，后续成功不能把整个任务误报 completed', async () => {
  const { entries, files } = projectFiles({ '资料/a.md': '旧A', '资料/b.md': '旧B' })
  const runId = fileTaskRunId('conversation-7', 'turn-7')
  const common = { owner: 'project', runId, taskFingerprint: 'task-hash', files }

  await executeVerifiedFileMutation({
    ...common,
    call: call('write', { path: '资料/a.md', content: '新A' }),
    execute: async () => ({ content: '误报成功' }),
  })
  const second = await executeVerifiedFileMutation({
    ...common,
    call: call('write', { path: '资料/b.md', content: '新B' }),
    execute: async () => {
      const resource = (await files.list('project')).find(item => item.path === '资料/b.md')!
      const current = await files.readText(resource)
      await files.writeText(resource, '新B', current.revision)
      return { content: 'raw success' }
    },
  })

  assert.equal(second.status, 'failed')
  const manifest = JSON.parse(String(entries.get(fileTaskManifestPath(runId))?.content || '{}'))
  assert.equal(manifest.status, 'blocked')
  assert.equal(manifest.actions.filter((action: { verified: boolean }) => action.verified).length, 1)
})
