import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCandidateAcceptancePatch,
  buildCandidateIgnorePatch,
  isPendingWikiCandidate,
} from '../vaultCandidate'

const baseCandidate = {
  id: 'candidate_1',
  category: 'knowledge',
  name: '文风要求.md',
  content: '# 文风要求',
  mimeType: 'text/markdown',
  size: 10,
  createdAt: 1,
  updatedAt: 1,
  vaultId: 'vault_1',
  kind: 'page',
  indexed: false,
  metadata: {
    vaultFolder: 'wiki',
    kind: 'organize-candidate',
    status: 'pending',
    folderPath: 'wiki/风格',
  },
} as const

test('isPendingWikiCandidate only matches pending wiki writeback or organize candidates', () => {
  assert.equal(isPendingWikiCandidate(baseCandidate as any), true)
  assert.equal(isPendingWikiCandidate({
    ...baseCandidate,
    metadata: { ...baseCandidate.metadata, kind: 'writeback-candidate' },
  } as any), true)
  assert.equal(isPendingWikiCandidate({
    ...baseCandidate,
    metadata: { ...baseCandidate.metadata, status: 'accepted' },
  } as any), false)
  assert.equal(isPendingWikiCandidate({
    ...baseCandidate,
    kind: 'raw',
    indexed: false,
    metadata: { vaultFolder: 'raw', kind: 'conversation-log', status: 'pending' },
  } as any), false)
})

test('isPendingWikiCandidate matches legacy pending candidates without indexed flag', () => {
  const legacyCandidate = {
    ...baseCandidate,
    indexed: undefined,
    metadata: {
      ...baseCandidate.metadata,
      kind: 'writeback-candidate',
      status: 'pending',
    },
  }

  assert.equal(isPendingWikiCandidate(legacyCandidate as any), true)
})

test('buildCandidateAcceptancePatch marks candidate as accepted indexed wiki page', () => {
  const patch = buildCandidateAcceptancePatch(baseCandidate as any, 1234)

  assert.equal(patch.indexed, true)
  assert.equal(patch.kind, 'page')
  assert.equal(patch.metadata?.kind, 'wiki-page')
  assert.equal(patch.metadata?.status, 'accepted')
  assert.equal(patch.metadata?.reviewedAt, 1234)
  assert.equal(patch.metadata?.candidateKind, 'organize-candidate')
})

test('buildCandidateIgnorePatch keeps candidate unindexed and records ignored status', () => {
  const patch = buildCandidateIgnorePatch(baseCandidate as any, 5678)

  assert.equal(patch.indexed, false)
  assert.equal(patch.metadata?.kind, 'organize-candidate')
  assert.equal(patch.metadata?.status, 'ignored')
  assert.equal(patch.metadata?.reviewedAt, 5678)
})
