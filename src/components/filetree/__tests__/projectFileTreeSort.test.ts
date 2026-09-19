import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

test('file tree sorts at display time by the mode the user picked', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')

  // 排序模式持久化在本地；非法值（版本变更、手改）回默认，不抛错。
  assert.match(tree, /const FILE_SORT_STORAGE_KEY = 'jcFileTreeSortMode'/)
  assert.match(tree, /return isFileSortMode\(stored\) \? stored : DEFAULT_FILE_SORT_MODE/)
  assert.match(tree, /localStorage\.setItem\(FILE_SORT_STORAGE_KEY, mode\)/)

  // 屏幕顺序的唯一真源：目录永远优先，同级按当前模式。
  assert.match(tree, /function sortedChildren\(children: TreeNode\[\], mode: FileSortMode\): TreeNode\[\]/)
  assert.match(
    tree,
    /if \(a\.isDir !== b\.isDir\) return a\.isDir \? -1 : 1\s*\n\s*return compareFileEntries\(a, b, mode\)/,
  )
  // 两个展开入口（根目录 + 已展开的子目录）都走它；排序放在展开这一步，换排序不用重读目录。
  assert.match(tree, /for \(const child of sortedChildren\(root\.children, mode\)\) walk\(child\)/)
  assert.match(
    tree,
    /if \(node\.expanded && node\.isDir\) for \(const child of sortedChildren\(node\.children, mode\)\) walk\(child\)/,
  )

  // 菜单项直接来自 FILE_SORT_OPTIONS，不另建映射表。
  assert.match(tree, /v-for="option in FILE_SORT_OPTIONS"/)
  assert.match(tree, /@click="setFileSortMode\(option\.mode\)"/)
  assert.match(tree, /:title="`排序：\$\{fileSortLabel\(fileSortMode\)\}`"/)
})

test('file tree locate scrolls the target into view and explains a miss', () => {
  const tree = source('src/components/filetree/ProjectFileTree.vue')
  const store = source('src/stores/mediaTaskStore.ts')

  // 列表是虚拟滚动的：只设选中不滚动，目标就落在屏幕外，用户看不到「定位」发生过。
  assert.match(tree, /fileTreeVirtualizer\.value\.scrollToIndex\(index, \{ align: 'center' \}\)/)
  // 用户点的那次要说话；结果自动定位失败不能留下赶不走的提示。
  assert.match(tree, /if \(!quiet\) statusMsg\.value = `文件树里没有 \$\{path\}`/)
  // 筛选开着时目标会被过滤掉，定位前先摘掉筛选，否则看起来又像没反应。
  assert.match(
    tree,
    /if \(filterQuery\.value\.trim\(\) && !visibleNodes\.value\.some\(entry => entry\.node\.path === path\)\) filterQuery\.value = ''/,
  )
  // 别的项目的路径不碰这棵树，也不抱怨。
  assert.match(tree, /if \(owner && projectKey\.value && owner !== projectKey\.value\) return/)
  assert.match(tree, /void locateProjectResource\(String\(path\), Boolean\(payload\?\.quiet\)\)/)

  // 生成物落进项目后自动定位：三条落盘路径（Web 导入、桌面直写、桌面下载）都调它。
  assert.match(store, /function revealMediaResultInFileTree\(task: MediaTask\)/)
  assert.match(store, /quiet: true,/)
  assert.equal((store.match(/revealMediaResultInFileTree\(task\)/g) || []).length, 3)
})
