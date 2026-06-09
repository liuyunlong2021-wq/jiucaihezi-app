import type { OfficialPublisher, RecommendedSkill, SkillTag } from '@/data/officialSources'
import type { SkillRegistry } from '@/types/skillsManage'

function matchesQuery(values: Array<string | null | undefined>, query: string): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return values
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(normalized))
}

export function filterRecommendedSkills(
  skills: RecommendedSkill[],
  input: { query: string; tag: SkillTag | null }
): RecommendedSkill[] {
  return skills.filter((skill) =>
    (!input.tag || skill.tags.includes(input.tag)) &&
    matchesQuery([
      skill.name,
      skill.description,
      skill.publisher,
      skill.repoFullName,
      ...skill.tags,
    ], input.query)
  )
}

export function filterOfficialPublishers(
  publishers: OfficialPublisher[],
  query: string
): OfficialPublisher[] {
  return publishers.filter((publisher) =>
    matchesQuery([
      publisher.name,
      publisher.slug,
      ...publisher.repos.flatMap((repo) => [repo.fullName, repo.url, repo.description]),
    ], query)
  )
}

function normalizeRegistryUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase()
}

export function findDuplicateRegistries(registries: SkillRegistry[]): SkillRegistry[][] {
  const groups = registries.reduce<Map<string, SkillRegistry[]>>((acc, registry) => {
    const normalized = normalizeRegistryUrl(registry.url)
    const group = acc.get(normalized) || []
    group.push(registry)
    acc.set(normalized, group)
    return acc
  }, new Map())

  return Array.from(groups.values()).filter((group) => group.length > 1)
}
