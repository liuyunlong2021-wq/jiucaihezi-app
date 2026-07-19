const credentials = new Map<string, unknown>()

export function getMcpOAuthCredentialCache<T>(serverId: string): T | undefined {
  return credentials.get(serverId) as T | undefined
}

export function setMcpOAuthCredentialCache<T>(serverId: string, credential: T): void {
  credentials.set(serverId, credential)
}

export function clearMcpOAuthCredentialCache(serverId: string): void {
  credentials.delete(serverId)
}
