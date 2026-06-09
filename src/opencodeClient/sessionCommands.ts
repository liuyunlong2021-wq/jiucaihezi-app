import type { OpencodeClient, SnapshotFileDiff } from '@opencode-ai/sdk/v2'

function unwrapData<T>(result: unknown): T {
  const value = result as { data?: T; error?: unknown }
  if (value && typeof value === 'object' && 'error' in value && value.error) {
    const error = value.error as { message?: string; detail?: string; code?: string }
    throw new Error(error.message || error.detail || error.code || 'OpenCode API returned an error')
  }
  if (value && typeof value === 'object' && 'data' in value) return value.data as T
  return result as T
}

export interface OpenCodeSessionCommandLocation {
  directory?: string
  workspace?: string
}

export interface OpenCodeSessionCommandInput extends OpenCodeSessionCommandLocation {
  sessionID: string
}

export async function forkOpenCodeSession(
  client: OpencodeClient,
  input: OpenCodeSessionCommandInput & { messageID?: string },
) {
  return unwrapData(await client.session.fork(input))
}

export async function compactOpenCodeSession(
  client: OpencodeClient,
  input: OpenCodeSessionCommandInput,
): Promise<void> {
  unwrapData(await (client as any).v2.session.compact({ sessionID: input.sessionID }))
}

export async function waitOpenCodeSessionIdle(
  client: OpencodeClient,
  input: OpenCodeSessionCommandInput,
): Promise<void> {
  unwrapData(await (client as any).v2.session.wait({ sessionID: input.sessionID }))
}

export async function shareOpenCodeSession(
  client: OpencodeClient,
  input: OpenCodeSessionCommandInput,
) {
  return unwrapData(await client.session.share(input))
}

export async function unshareOpenCodeSession(
  client: OpencodeClient,
  input: OpenCodeSessionCommandInput,
): Promise<void> {
  unwrapData(await client.session.unshare(input))
}

export async function archiveOpenCodeSession(
  client: OpencodeClient,
  input: OpenCodeSessionCommandInput & { archivedAt?: number },
) {
  return unwrapData(await client.session.update({
    sessionID: input.sessionID,
    directory: input.directory,
    workspace: input.workspace,
    time: { archived: input.archivedAt || Date.now() },
  }))
}

export async function deleteOpenCodeSession(
  client: OpencodeClient,
  input: OpenCodeSessionCommandInput,
): Promise<void> {
  unwrapData(await client.session.delete(input))
}

export async function listOpenCodeSessionDiff(
  client: OpencodeClient,
  input: OpenCodeSessionCommandInput & { messageID?: string },
): Promise<SnapshotFileDiff[]> {
  const response = unwrapData<any>(await client.session.diff(input))
  return Array.isArray(response) ? response : []
}

export async function revertOpenCodeSessionMessage(
  client: OpencodeClient,
  input: OpenCodeSessionCommandInput & { messageID: string; partID?: string },
) {
  return unwrapData(await client.session.revert(input))
}

export async function unrevertOpenCodeSession(
  client: OpencodeClient,
  input: OpenCodeSessionCommandInput,
) {
  return unwrapData(await client.session.unrevert(input))
}

export async function runOpenCodeSlashCommand(
  client: OpencodeClient,
  input: OpenCodeSessionCommandInput & {
    command: string
    arguments?: string
    agent?: string
    model?: string
  },
) {
  return unwrapData(await client.session.command(input))
}

export async function runOpenCodeShellCommand(
  client: OpencodeClient,
  input: OpenCodeSessionCommandInput & {
    command: string
    agent?: string
    model?: {
      providerID: string
      modelID: string
    }
  },
) {
  return unwrapData(await client.session.shell(input))
}
