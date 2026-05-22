export interface VaultCandidateFile {
  kind?: string
  indexed?: boolean
  metadata?: Record<string, unknown>
}

const PENDING_CANDIDATE_KINDS = new Set(['organize-candidate', 'writeback-candidate'])

export function isPendingWikiCandidate(file: VaultCandidateFile | null | undefined): boolean {
  if (!file) return false
  const metadata = file.metadata || {}
  const candidateKind = String(metadata.kind || '')
  const status = String(metadata.status || '')
  const vaultFolder = String(metadata.vaultFolder || '')
  const folderPath = String(metadata.folderPath || metadata.targetPath || '')

  return (
    PENDING_CANDIDATE_KINDS.has(candidateKind) &&
    status === 'pending' &&
    file.indexed !== true &&
    vaultFolder === 'wiki' &&
    (file.kind === 'page' || file.kind === 'entity' || folderPath.startsWith('wiki/'))
  )
}

export function buildCandidateAcceptancePatch(file: VaultCandidateFile, reviewedAt = Date.now()) {
  const metadata = file.metadata || {}
  return {
    kind: 'page' as const,
    indexed: true,
    metadata: {
      ...metadata,
      candidateKind: metadata.kind,
      kind: 'wiki-page',
      status: 'accepted',
      reviewedAt,
    },
  }
}

export function buildCandidateIgnorePatch(file: VaultCandidateFile, reviewedAt = Date.now()) {
  const metadata = file.metadata || {}
  return {
    indexed: false,
    metadata: {
      ...metadata,
      status: 'ignored',
      reviewedAt,
    },
  }
}
