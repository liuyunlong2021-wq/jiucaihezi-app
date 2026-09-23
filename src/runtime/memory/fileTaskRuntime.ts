import type { DirectToolCall, DirectToolExecutor, DirectToolResult } from '@/runtime/direct/directTypes'
import type { ProjectFileService } from '@/services/projectFileService'
import { MEMORY_FILE_TASK_DIRECTORY } from '@/utils/memoryProjectPaths'

type FileTaskAction = {
  id: string
  signature: string
  kind: 'write' | 'edit'
  path: string
  before?: string
  after: string
  status: 'committing' | 'verified' | 'blocked'
  verified: boolean
  error?: string
}

export type FileTaskManifest = {
  schemaVersion: 1
  runId: string
  taskFingerprint: string
  status: 'committing' | 'completed' | 'blocked'
  mode: 'fast' | 'exhaustive'
  scope: string[]
  units: []
  actions: FileTaskAction[]
  updatedAt: string
}

type ProposedTextMutation = {
  id: string
  signature: string
  kind: 'write' | 'edit'
  path: string
  before?: string
  content: string
}

export function fileTaskRunId(conversationId: string, turnId: string): string {
  const value = `${conversationId}-${turnId}`
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
  return `file-${value || 'unsaved'}`
}

export function fileTaskManifestPath(runId: string): string {
  return `${MEMORY_FILE_TASK_DIRECTORY}/${runId}/manifest.json`
}

export function isProjectTextMutationCall(call: DirectToolCall): boolean {
  try {
    const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
    if (call.function.name === 'write' || call.function.name === 'edit') {
      return isProjectRelativePath(String(args.path || ''))
    }
    if (call.function.name !== 'write_text_batch' || !Array.isArray(args.files)) return false
    return args.files.length > 0 && args.files.every(file =>
      isProjectRelativePath(String((file as Record<string, unknown>)?.path || '')),
    )
  } catch {
    return false
  }
}

export async function fileTaskFingerprint(value: string): Promise<string> {
  return await sha256(value)
}

export async function cleanupCompletedFileTask(
  files: ProjectFileService,
  owner: string,
  runId: string,
): Promise<boolean> {
  const manifest = await readManifest(files, owner, runId)
  if (manifest?.status !== 'completed') return false
  const directory = `${MEMORY_FILE_TASK_DIRECTORY}/${runId}`
  const resources = await files.list(owner)
  const target =
    resources.find(resource => resource.isDirectory && resource.path === directory) ||
    resources.find(resource => !resource.isDirectory && resource.path === fileTaskManifestPath(runId))
  if (target) await files.remove(target)
  return true
}

export async function executeVerifiedFileMutation(input: {
  owner: string
  runId: string
  taskFingerprint: string
  call: DirectToolCall
  files: ProjectFileService
  execute: DirectToolExecutor
  signal?: AbortSignal
}): Promise<DirectToolResult> {
  if (!isProjectTextMutationCall(input.call)) return await input.execute(input.call, input.signal)
  let manifest = await readManifest(input.files, input.owner, input.runId)
  if (manifest && manifest.taskFingerprint !== input.taskFingerprint) {
    return { content: '文件任务账本与当前任务不一致，已停止写入。', status: 'failed' }
  }
  const proposals = await proposedMutations(input.call, input.files, input.owner, manifest)
  manifest ||= {
    schemaVersion: 1,
    runId: input.runId,
    taskFingerprint: input.taskFingerprint,
    status: 'committing',
    mode: proposals.length > 1 ? 'exhaustive' : 'fast',
    scope: [],
    units: [],
    actions: [],
    updatedAt: new Date().toISOString(),
  }

  const pending: ProposedTextMutation[] = []
  for (const proposal of proposals) {
    const duplicate = manifest.actions.find(action =>
      action.signature === proposal.signature,
    )
    if (duplicate?.verified && (await readTextOrNull(input.files, input.owner, proposal.path)) === proposal.content) continue
    if (duplicate) {
      duplicate.status = 'committing'
      duplicate.verified = false
      delete duplicate.error
    } else {
      manifest.actions.push({
        id: `${input.call.id}-${manifest.actions.length + 1}`,
        signature: proposal.signature,
        kind: proposal.kind,
        path: proposal.path,
        before: proposal.before,
        after: proposal.id,
        status: 'committing',
        verified: false,
      })
    }
    pending.push(proposal)
  }
  manifest.scope = [...new Set([...manifest.scope, ...proposals.map(item => item.path)])]
  manifest.status = 'committing'
  manifest.updatedAt = new Date().toISOString()
  await writeManifest(input.files, input.owner, manifest)

  try {
    if (pending.length) await input.execute(input.call, input.signal)
    for (const proposal of proposals) {
      const action = manifest.actions.find(item =>
        item.signature === proposal.signature,
      )!
      const actual = await readTextOrNull(input.files, input.owner, proposal.path)
      if (actual !== proposal.content) throw new Error(`写后读回不一致: ${proposal.path}`)
      action.status = 'verified'
      action.verified = true
      delete action.error
    }
    const unverified = manifest.actions.filter(action => !action.verified)
    manifest.status = unverified.length ? 'blocked' : 'completed'
    manifest.updatedAt = new Date().toISOString()
    await writeManifest(input.files, input.owner, manifest)
    const verified = manifest.actions.filter(action => action.verified)
    if (unverified.length) {
      return {
        content: `Runtime 已验证 ${verified.length} 个文件动作，仍有 ${unverified.length} 个动作未通过：${unverified.map(action => action.path).join('、')}`,
        status: 'failed',
        details: { runId: input.runId, status: 'blocked' },
      }
    }
    return {
      content: `Runtime 已验证 ${verified.length} 个文件动作：${verified.map(action => action.path).join('、')}`,
      status: 'succeeded',
      details: {
        runId: input.runId,
        status: 'completed',
        manifestPath: fileTaskManifestPath(input.runId),
        targets: verified.map(action => ({
          path: action.path,
          operation: action.kind,
          before: action.before,
          after: action.after,
          verified: true,
        })),
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    manifest.status = 'blocked'
    for (const action of manifest.actions.filter(action => !action.verified)) {
      action.status = 'blocked'
      action.error = message
    }
    manifest.updatedAt = new Date().toISOString()
    await writeManifest(input.files, input.owner, manifest)
    return { content: message, status: 'failed', details: { runId: input.runId, status: 'blocked' } }
  }
}

async function proposedMutations(
  call: DirectToolCall,
  files: ProjectFileService,
  owner: string,
  manifest: FileTaskManifest | null,
): Promise<ProposedTextMutation[]> {
  const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
  if (call.function.name === 'write_text_batch') {
    return await Promise.all((args.files as Array<Record<string, unknown>>).map(async file => {
      const path = String(file.path || '')
      const content = String(file.content ?? '')
      const before = await readTextOrNull(files, owner, path)
      return {
        id: await sha256(content),
        signature: await mutationSignature('write', path, content),
        kind: 'write' as const,
        path,
        before: before === null ? undefined : await sha256(before),
        content,
      }
    }))
  }
  const path = String(args.path || '')
  const before = await readTextOrNull(files, owner, path)
  if (call.function.name === 'write') {
    const content = String(args.content ?? '')
    return [{
      id: await sha256(content),
      signature: await mutationSignature('write', path, content),
      kind: 'write',
      path,
      before: before === null ? undefined : await sha256(before),
      content,
    }]
  }
  if (before === null) throw new Error(`找不到要编辑的文件: ${path}`)
  const oldString = String(args.oldString ?? '')
  const newString = String(args.newString ?? '')
  if (!oldString) throw new Error('edit.oldString 不能为空')
  const signature = await mutationSignature(
    'edit',
    path,
    JSON.stringify([oldString, newString, args.replaceAll === true]),
  )
  const matches = before.split(oldString).length - 1
  if (!matches) {
    const previous = manifest?.actions.find(action => action.signature === signature && action.verified)
    if (previous && (await sha256(before)) === previous.after) {
      return [{
        id: previous.after,
        signature,
        kind: 'edit',
        path,
        before: previous.before,
        content: before,
      }]
    }
    throw new Error(`编辑目标内容不存在: ${path}`)
  }
  if (matches > 1 && args.replaceAll !== true) throw new Error(`编辑目标出现 ${matches} 次，请明确 replaceAll: ${path}`)
  const content = args.replaceAll === true
    ? before.split(oldString).join(newString)
    : before.replace(oldString, newString)
  return [{
    id: await sha256(content),
    signature,
    kind: 'edit',
    path,
    before: await sha256(before),
    content,
  }]
}

async function readManifest(
  files: ProjectFileService,
  owner: string,
  runId: string,
): Promise<FileTaskManifest | null> {
  try {
    return JSON.parse((await files.readTextAt(owner, fileTaskManifestPath(runId))).content) as FileTaskManifest
  } catch (error) {
    if (/不存在|not found|missing/i.test(error instanceof Error ? error.message : String(error))) return null
    throw error
  }
}

async function writeManifest(
  files: ProjectFileService,
  owner: string,
  manifest: FileTaskManifest,
): Promise<void> {
  const path = fileTaskManifestPath(manifest.runId)
  const content = `${JSON.stringify(manifest, null, 2)}\n`
  const resource = (await files.list(owner)).find(item => !item.isDirectory && item.path === path)
  if (!resource) {
    await files.createText(owner, path, content)
    return
  }
  const current = await files.readText(resource)
  const result = await files.writeText(resource, content, current.revision)
  if (result.status !== 'saved') throw new Error(`文件任务账本写入冲突: ${path}`)
}

async function readTextOrNull(
  files: ProjectFileService,
  owner: string,
  path: string,
): Promise<string | null> {
  try {
    return (await files.readTextAt(owner, path)).content
  } catch (error) {
    if (/不存在|not found|missing/i.test(error instanceof Error ? error.message : String(error))) return null
    throw error
  }
}

function isProjectRelativePath(path: string): boolean {
  return Boolean(path) && !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(path) && !path.split(/[\\/]/).includes('..')
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

async function mutationSignature(kind: 'write' | 'edit', path: string, proposal: string) {
  return await sha256(`${kind}\u0000${path}\u0000${proposal}`)
}
