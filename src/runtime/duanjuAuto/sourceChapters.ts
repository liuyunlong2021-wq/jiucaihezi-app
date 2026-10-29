/**
 * 原文里的章标题清单：全自动改编的「章节范围」下拉要能选到全书，而不是上一批登记过的那几章。
 *
 * 程序生成原文节点时会写 front-matter（`title` 是章标题，`order` 是正文顺序）。章号与顺序并不一致
 * （实测第 2 个节点的标题是「第3章」），所以只能按 `order` 排。正文里的「第N章」是台词或叙述，
 * 不能当标题，因此只认文件头。
 */

export interface SourceNodeIo {
  /** 该目录的直接子项；不是目录时应抛错或返回空。 */
  listDirectory(path: string): Promise<Array<{ path: string; isDirectory?: boolean }>>
  /** 读文本；不存在时应抛错或返回 undefined。 */
  readText(path: string): Promise<string | undefined>
}

export interface SourceNodeHead {
  title: string
  order: number
}

/** 只解析文件头 12 行里的 title/order，缺任一即视为不可用。 */
export function parseNodeTitle(text: string | undefined): SourceNodeHead | undefined {
  if (!text) return undefined
  const head = text.split(/\r?\n/).slice(0, 12).join('\n')
  const title = /^title:\s*"(.+)"\s*$/m.exec(head)?.[1]?.trim()
  const order = Number(/^order:\s*(\d+)\s*$/m.exec(head)?.[1])
  if (!title || !Number.isFinite(order)) return undefined
  return { title, order }
}

/**
 * 原文的章节清单：来源是目录时逐个读节点文件头，按 order 排序并去重；来源是单文件时读它自己的头。
 * 一处标题都拿不到（老库、外部导入的原文）才回落到已登记的章，避免下拉变成空的。
 */
export async function readSourceChapters(sourcePaths: string[], io: SourceNodeIo, fallback: string[] = []): Promise<string[]> {
  const found: SourceNodeHead[] = []
  for (const path of sourcePaths) {
    const entries = await io.listDirectory(path).catch(() => [] as Array<{ path: string; isDirectory?: boolean }>)
    const files = entries.filter(entry => !entry.isDirectory && /\.md$/i.test(entry.path) && !/\/index\.md$/i.test(entry.path))
    if (!files.length) {
      const own = parseNodeTitle(await io.readText(path).catch(() => undefined))
      if (own) found.push(own)
      continue
    }
    const heads = await Promise.all(files.map(entry => io.readText(entry.path).catch(() => undefined)))
    for (const text of heads) {
      const own = parseNodeTitle(text)
      if (own) found.push(own)
    }
  }
  const chapters = [...new Map(found.map(item => [item.title, item])).values()]
    .sort((a, b) => a.order - b.order)
    .map(item => item.title)
  return chapters.length ? chapters : fallback
}
