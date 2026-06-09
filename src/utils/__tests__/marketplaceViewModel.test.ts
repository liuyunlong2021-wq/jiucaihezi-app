import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  findDuplicateRegistries,
  filterOfficialPublishers,
  filterRecommendedSkills,
} from '../marketplaceViewModel'
import type { RecommendedSkill, OfficialPublisher } from '../../data/officialSources'
import type { SkillRegistry } from '../../types/skillsManage'

function recommendedSkill(patch: Partial<RecommendedSkill>): RecommendedSkill {
  return {
    name: 'frontend-design',
    description: 'Create distinctive frontend interfaces',
    publisher: 'Anthropic',
    repoFullName: 'anthropics/skills',
    tags: ['frontend'],
    downloadUrl: 'https://raw.githubusercontent.com/anthropics/skills/main/frontend-design/SKILL.md',
    ...patch,
  }
}

function publisher(patch: Partial<OfficialPublisher>): OfficialPublisher {
  return {
    name: 'Anthropic',
    slug: 'anthropics',
    totalSkills: 18,
    repos: [{ fullName: 'anthropics/skills', url: 'https://github.com/anthropics/skills', skillCount: 18 }],
    ...patch,
  }
}

function registry(patch: Partial<SkillRegistry>): SkillRegistry {
  return {
    id: 'anthropic',
    name: 'Anthropic',
    source_type: 'github',
    url: 'https://github.com/anthropics/skills',
    is_builtin: true,
    is_enabled: true,
    last_sync_status: 'never',
    created_at: '2026-06-08T00:00:00Z',
    ...patch,
  }
}

test('filterRecommendedSkills supports tag filter and publisher/name search', () => {
  const skills = [
    recommendedSkill({ name: 'frontend-design', publisher: 'Anthropic', tags: ['frontend'] }),
    recommendedSkill({ name: 'stripe-integration', publisher: 'Stripe', tags: ['ecommerce'] }),
  ]

  assert.deepEqual(filterRecommendedSkills(skills, { query: '', tag: 'frontend' }).map(item => item.name), [
    'frontend-design',
  ])
  assert.deepEqual(filterRecommendedSkills(skills, { query: 'stripe', tag: null }).map(item => item.name), [
    'stripe-integration',
  ])
})

test('filterOfficialPublishers searches publisher and repo names', () => {
  const publishers = [
    publisher({ name: 'Anthropic', repos: [{ fullName: 'anthropics/skills', url: 'https://github.com/anthropics/skills', skillCount: 18 }] }),
    publisher({ name: 'Cloudflare', slug: 'cloudflare', repos: [{ fullName: 'cloudflare/skills', url: 'https://github.com/cloudflare/skills', skillCount: 59 }] }),
  ]

  assert.deepEqual(filterOfficialPublishers(publishers, 'cloudflare').map(item => item.name), ['Cloudflare'])
  assert.deepEqual(filterOfficialPublishers(publishers, 'anthropics/skills').map(item => item.name), ['Anthropic'])
})

test('findDuplicateRegistries detects duplicate Registry URLs after normalization', () => {
  const registries = [
    registry({ id: 'anthropic-a', url: 'https://github.com/anthropics/skills' }),
    registry({ id: 'anthropic-b', url: 'https://github.com/anthropics/skills/' }),
    registry({ id: 'cloudflare', url: 'https://github.com/cloudflare/skills' }),
  ]

  assert.deepEqual(findDuplicateRegistries(registries).map(group => group.map(item => item.id)), [
    ['anthropic-a', 'anthropic-b'],
  ])
})
