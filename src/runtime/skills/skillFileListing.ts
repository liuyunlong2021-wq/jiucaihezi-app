/**
 * 渲染 Skill 包的文件清单。
 *
 * 原来是每个路径一行 `<file>…</file>`。jc-novel 有 107 个文件，套一层标签再加一遍完整
 * 目录前缀全是纯重复，而且这个清单每轮请求都要重发（见 memoryChat 的
 * buildSelectedSkillPrompt）。
 *
 * 两种形态都渲染，取短的那个：
 * - 完整路径：文件少时用它，模型直接照抄，不用自己拼。
 * - 目录树：文件多时把目录前缀提到目录行（jc-novel 实测 4551 -> 1551 字符），顺带让模型
 *   看见结构（references/ 有哪些、scripts/ 有哪些），更好决定该 read 哪个。
 *
 * 取短而不是设阈值：不会出现「某个 Skill 改完反而变长」这种回归，也不用维护一个随着
 * 文件数增长会过期的常数。
 *
 * 目录树的风险是「模型要自己拼路径」，拼错就白跑一次工具往返。所以规则行直接用本 Skill 里
 * 真实存在的第一个嵌套路径写出可照抄的 `read("…")` 示例，而不是占位符。
 * 两种形态都必须能从输出原样还原出每个路径，往返测试锁的就是这条。
 */
export const SKILL_FILES_RULE_PREFIX = '缩进行是文件名'

export function renderSkillFiles(paths: string[]): string {
  const normalized = paths.map(value => String(value || '').trim()).filter(Boolean)
  if (!normalized.length) return ['<skill_files>', '</skill_files>'].join('\n')

  const root: string[] = []
  const directories = new Map<string, string[]>()
  let example = ''
  for (const path of normalized) {
    const slash = path.lastIndexOf('/')
    if (slash < 0) {
      root.push(path)
      continue
    }
    const directory = path.slice(0, slash + 1)
    const file = path.slice(slash + 1)
    const group = directories.get(directory)
    if (group) group.push(file)
    else directories.set(directory, [file])
    if (!example) example = path
  }

  const flat = ['<skill_files>', ...normalized, '</skill_files>'].join('\n')
  if (!example) return flat

  const tree = [
    '<skill_files>',
    `${SKILL_FILES_RULE_PREFIX}，它的完整路径 = 上面最近一行目录 + 该文件名；不缩进的行本身就是完整相对路径。例：read("${example}")`,
    ...root,
    ...[...directories].flatMap(([directory, files]) => [
      directory,
      ...files.map(file => `  ${file}`),
    ]),
    '</skill_files>',
  ].join('\n')
  return tree.length < flat.length ? tree : flat
}
