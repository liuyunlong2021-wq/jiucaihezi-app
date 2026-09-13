/**
 * skillPickerOrder.ts — Skill 选择面板的排序
 *
 * 三个 Skill 永远置顶（新手入口、造 Skill 的、Wiki 记忆）；
 * 其余按用户实际选中次数降序，常用的自然浮上来。
 * 次数存 localStorage，写不进去就退化成固定顺序，不影响选 Skill。
 */

export const PINNED_SKILLS = ['jc-new-user-guide', 'skill-creator', 'wiki-memory']

export const SKILL_USE_COUNTS_KEY = 'jc_skill_use_counts'

export function readSkillUseCounts(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SKILL_USE_COUNTS_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, number>)
      : {}
  } catch {
    return {}
  }
}

/** 用户每选一次 Skill 记一次。 */
export function recordSkillUse(name: string): void {
  if (!name) return
  const counts = readSkillUseCounts()
  counts[name] = (counts[name] || 0) + 1
  try {
    localStorage.setItem(SKILL_USE_COUNTS_KEY, JSON.stringify(counts))
  } catch {
    // 存储不可用时放弃计数
  }
}

/**
 * 置顶三个 → 其余按使用次数降序 → 同次数保持原顺序。
 * `counts` 可注入，方便测试；默认读 localStorage。
 */
export function sortSkillsForPicker<T extends { name: string }>(
  list: T[],
  counts: Record<string, number> = readSkillUseCounts(),
): T[] {
  const pinned = new Map(PINNED_SKILLS.map((name, index) => [name, index]))
  return [...list].sort((a, b) => {
    const left = pinned.get(a.name)
    const right = pinned.get(b.name)
    if (left !== undefined || right !== undefined) {
      if (left === undefined) return 1
      if (right === undefined) return -1
      return left - right
    }
    return (counts[b.name] || 0) - (counts[a.name] || 0)
  })
}
