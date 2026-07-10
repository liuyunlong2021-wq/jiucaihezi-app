/**
 * skillSearch.ts — 统一 Skill 搜索引擎
 *
 * ponytail: 用于 SkillPickerBar / CentralSkillsPanel / WebSkillPanel 三处，
 * 替换各自手写的 toLowerCase().includes()。
 *
 * 能力：
 * - fuzzysort 模糊搜索（拼写容错、子串匹配、乱序匹配）
 * - 拼音搜索（打 "juese" 找到「角色设计」，打 "js" 找到「角色设计」）
 * - 多字段覆盖：name > label > description > location
 */

import fuzzysort from 'fuzzysort'
import { pinyin } from 'pinyin-pro'

export interface SkillSearchItem {
  id?: string
  name?: string
  label?: string
  description?: string | null
  location?: string
}

const pinyinCache = new Map<string, string>()

function getPinyinAugment(item: SkillSearchItem): string {
  const cacheKey = item.id || item.name || ''
  const cached = pinyinCache.get(cacheKey)
  if (cached !== undefined) return cached

  const name = item.name || ''
  // 全拼（无声调）：角色设计 → jiaosesheji
  const namePy = pinyin(name, { toneType: 'none', type: 'array' }).join('')
  // 首字母：角色设计 → jssj
  const nameInitial = pinyin(name, { pattern: 'first', toneType: 'none', type: 'array' }).join('')

  const result = `${namePy} ${nameInitial}`
  pinyinCache.set(cacheKey, result)
  return result
}

/**
 * 搜索 skills，支持：
 * - 中文直接匹配（模糊容错）
 * - 英文子串/拼写容错
 * - 拼音全拼/首字母搜索
 *
 * @param query 用户输入的搜索词
 * @param items 待搜索的 skill 列表
 * @returns 按匹配度排序的结果
 */
export function searchSkills<T extends SkillSearchItem>(
  query: string,
  items: T[],
): T[] {
  const q = query.trim()
  if (!q) return items

  // 构建每项的搜索文本：原始字段 + 拼音增强
  const prepared = items.map((item) => {
    const parts: string[] = []
    if (item.name) parts.push(item.name)
    if (item.label) parts.push(item.label)
    if (item.description) parts.push(item.description)
    if (item.location) parts.push(item.location)

    let searchText = parts.join(' ')

    // ASCII 查询时追加拼音，让 "juese" 能匹配「角色设计」
    if (/^[a-zA-Z]+$/.test(q)) {
      searchText += ' ' + getPinyinAugment(item)
    }

    return { obj: item, searchText }
  })

  // fuzzysort 模糊搜索：自带拼写容错 + 子串匹配 + 相关性排序
  // ponytail: fuzzysort v3 类型定义不够精确，用 any 绕过
  const results = fuzzysort.go(q, prepared, { key: 'searchText' }) as any as Array<{ obj: typeof prepared[number] }>

  return results.map((r) => r.obj.obj)
}
