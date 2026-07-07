import { ref, computed, watch, type Ref, shallowRef } from 'vue'
import fuzzysort from 'fuzzysort'

export interface FilteredListProps<T> {
  items: T[] | ((filter: string) => T[] | Promise<T[]>)
  key: (item: T) => string
  filterKeys?: string[]
  current?: T
  groupBy?: (x: T) => string
  sortBy?: (a: T, b: T) => number
  sortGroupsBy?: (a: { category: string; items: T[] }, b: { category: string; items: T[] }) => number
  skipFilter?: (item: T) => boolean
  onSelect?: (value: T | undefined, index: number) => void
  noInitialSelection?: boolean
}

interface Group<T> { category: string; items: T[] }

export function useFilteredList<T>(props: FilteredListProps<T>) {
  const filter = ref('')
  const grouped = ref<Group<T>[]>([]) as Ref<Group<T>[]>
  const activeKey = ref('')
  // ponytail: 版本号防止 stale async 覆盖
  let reloadVersion = 0

  async function reload() {
    const version = ++reloadVersion
    const query = filter.value
    const needle = query.toLowerCase()
    const raw = typeof props.items === 'function'
      ? await Promise.resolve(props.items(query))
      : props.items
    const all = raw || []

    // ponytail: 如果已有更新的 reload 启动，丢弃本次结果
    if (reloadVersion !== version) return

    let result = all
      if (needle) {
        const skipFilter = props.skipFilter
        const filterable = skipFilter ? result.filter((item) => !skipFilter(item)) : result
        const skipped = skipFilter ? result.filter(skipFilter) : []

        let filtered: T[]
        if (!props.filterKeys && Array.isArray(filterable) && filterable.every((e) => typeof e === 'string')) {
          filtered = fuzzysort.go(needle, filterable as unknown as string[]).map((x) => x.target) as unknown as T[]
        } else {
          filtered = fuzzysort.go(needle, filterable as unknown as Fuzzysort.Prepared[], { keys: props.filterKeys! }).map((x) => x.obj) as unknown as T[]
        }
        result = skipped.length ? [...filtered, ...skipped] : filtered
      }

      // groupBy
      const map = new Map<string, T[]>()
      for (const item of result) {
        const k = props.groupBy ? props.groupBy(item) : ''
        if (!map.has(k)) map.set(k, [])
        map.get(k)!.push(item)
      }

      const groups: Group<T>[] = []
      for (const [category, items] of map) {
        if (props.sortBy) items.sort(props.sortBy)
        groups.push({ category, items })
      }
      if (props.sortGroupsBy) groups.sort(props.sortGroupsBy)

    if (reloadVersion !== version) return // ponytail: 再次检查，防止 async 间隙中新一轮已启动
    grouped.value = groups
  }

  const flat = shallowRef<T[]>([])

  function updateFlat() {
    const result: T[] = []
    for (const g of grouped.value) result.push(...g.items)
    flat.value = result
  }

  watch(grouped, updateFlat, { deep: true })

  function initialActive(): string {
    if (props.noInitialSelection) return ''
    if (props.current) return props.key(props.current)
    const items = flat.value
    if (items.length === 0) return ''
    return props.key(items[0])
  }

  function reset() {
    if (props.noInitialSelection) { activeKey.value = ''; return }
    const all = flat.value
    if (all.length === 0) return
    activeKey.value = props.key(all[0])
  }

  function onKeyDown(event: KeyboardEvent) {
    const items = flat.value
    if (items.length === 0) return

    const idx = items.findIndex((x) => props.key(x) === activeKey.value)

    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault()
      const item = items[idx]
      if (item) props.onSelect?.(item, idx)
      return
    }

    if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      if (event.key === 'n' || event.key === 'p') {
        event.preventDefault()
        const dir = event.key === 'n' ? 1 : -1
        const next = (idx + dir + items.length) % items.length
        activeKey.value = props.key(items[next])
        return
      }
    }

    if (event.altKey || event.metaKey) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      const next = idx < 0 ? 0 : (idx + 1) % items.length
      activeKey.value = props.key(items[next])
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      const next = idx <= 0 ? items.length - 1 : idx - 1
      activeKey.value = props.key(items[next])
    }
  }

  function onInput(value: string) {
    filter.value = value
    void reload()
  }

  // ponytail: trigger initial load and reset on filter change
  void reload()
  watch(grouped, () => reset(), { deep: true })

  return {
    grouped,
    filter,
    flat,
    reset,
    refetch: reload,
    clear: () => { filter.value = ''; void reload() },
    onKeyDown,
    onInput,
    active: activeKey,
    setActive: (id: string) => { activeKey.value = id },
  }
}
