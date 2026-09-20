import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderSkillFiles, SKILL_FILES_RULE_PREFIX } from '@/runtime/skills/skillFileListing'

/** 把渲染结果还原成路径集合。完整路径形态与目录树形态都必须还原得一模一样。 */
function readBack(rendered: string): string[] {
  const paths: string[] = []
  let directory = ''
  for (const line of rendered.split('\n')) {
    if (line.startsWith('<') || line.startsWith(SKILL_FILES_RULE_PREFIX)) continue
    if (line.startsWith('  ')) {
      paths.push(directory + line.slice(2))
      continue
    }
    if (line.endsWith('/')) directory = line
    else paths.push(line)
  }
  return paths
}

function assertRoundTrip(paths: string[]): string {
  const rendered = renderSkillFiles(paths)
  assert.deepEqual(readBack(rendered), paths)
  return rendered
}

const many = (count: number) =>
  Array.from({ length: count }, (_, index) => `references/第${index + 1}章写作规范.md`)

/** 改动前的渲染方式，用来当收益与「不会变长」的基线。基线必须连外层标签一起算。 */
const previousRender = (paths: string[]) =>
  ['<skill_files>', ...paths.map(path => `<file>${path}</file>`), '</skill_files>'].join('\n')

test('文件少时列完整路径：每个路径原样出现，模型不用自己拼', () => {
  const paths = ['SKILL.md', 'references/style.md', 'scripts/build.py']
  const rendered = assertRoundTrip(paths)
  assert.doesNotMatch(rendered, /缩进行是文件名/)
  for (const path of paths) assert.ok(rendered.includes(path), `清单里缺少 ${path}`)
})

test('文件多时用目录树，并给出能照抄的真实 read() 路径', () => {
  // 形状照抄 jc-novel：一个 references/ 里堆几十个文件。
  const paths = ['SKILL.md', ...many(34)]
  const rendered = assertRoundTrip(paths)
  assert.match(rendered, /例：read\("references\/第1章写作规范\.md"\)/)
  assert.match(rendered, /\nreferences\/\n {2}第1章写作规范\.md\n/)
  assert.ok(rendered.length * 2 < previousRender(paths).length)
})

test('两种形态都不串路径：多层目录、根文件、同名文件各归各位', () => {
  assertRoundTrip([
    'SKILL.md',
    'references/动作专项.md',
    'references/sub/更深一层.md',
    'references/sub/又一层.md',
    'scripts/a.sh',
    'scripts/b.sh',
    'assets/x.png',
    'assets/y.png',
    'assets/z.png',
  ])
  assertRoundTrip(['SKILL.md', ...many(40)])
})

test('空清单与脏输入不炸也不产生假路径', () => {
  assert.equal(renderSkillFiles([]), '<skill_files>\n</skill_files>')
  assert.deepEqual(readBack(renderSkillFiles(['', '   ', 'SKILL.md'])), ['SKILL.md'])
})

test('永远不会比一行一个 <file> 更长——这是这次改动的底线', () => {
  for (const count of [0, 1, 2, 5, 8, 12, 20, 40, 107]) {
    const paths = ['SKILL.md', ...many(count)]
    const before = previousRender(paths).length
    const after = renderSkillFiles(paths).length
    assert.ok(after <= before, `${count} 个文件时反而变长了：${after} > ${before}`)
  }
  // 空清单两边渲染完全一致，不能多出空行或少了标签。
  assert.equal(renderSkillFiles([]), previousRender([]))
})
