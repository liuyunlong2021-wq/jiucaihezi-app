/**
 * generalSearch.ts — 通用模糊+拼音搜索引擎
 *
 * ponytail: 与 skillSearch.ts 共用 fuzzysort + pinyin-pro 引擎，
 * 但不限定 Skill 字段，接受任意 {name, ...extra} 对象。
 *
 * 能力：fuzzysort 模糊容错 + 拼音全拼/首字母搜索
 */

import fuzzysort from 'fuzzysort'
import { pinyin } from 'pinyin-pro'

export interface SearchableItem {
  name?: string
  [key: string]: unknown
}

const pinyinCache = new Map<string, string>()

function getPinyinAugment(text: string): string {
  const cached = pinyinCache.get(text)
  if (cached !== undefined) return cached
  const py = pinyin(text, { toneType: 'none', type: 'array' }).join('')
  const initials = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' }).join('')
  const result = `${py} ${initials}`
  pinyinCache.set(text, result)
  return result
}

/**
 * @param query  用户输入的搜索词
 * @param items  待搜索列表
 * @param getSearchText  将 item 转为搜索文本（默认取 item.name）
 */
export function searchItems<T>(
  query: string,
  items: T[],
  getSearchText?: (item: T) => string,
): T[] {
  const q = query.trim()
  if (!q) return items

  const prepared = items.map((item) => {
    const base = getSearchText ? getSearchText(item) : ((item as any).name || '')
    let searchText = base

    // ASCII 查询时追加拼音
    if (/^[a-zA-Z]+$/.test(q)) {
      searchText += ' ' + getPinyinAugment(base)
    }

    return { obj: item, searchText }
  })

  const results = fuzzysort.go(q, prepared, { key: 'searchText' }) as any as Array<{ obj: typeof prepared[number] }>
  return results.map((r) => r.obj.obj)
}
