/**
 * 文档转换格式的单一真源。
 *
 * 这份清单等于 AnyDoc 0.2.3 的 `Format::from_extension`（Rust 侧
 * `~/.cargo/registry/.../anydoc-0.2.3/src/lib.rs`）。三处消费者必须与它一致：
 *   1. `document-converter/src/converter.py` 的 `SUPPORTED_EXTENSIONS`（服务端闸门）
 *   2. `src/composables/useFileUpload.ts` 的附件分类
 *   3. 文件选择器的 accept 与文件夹批量导入的过滤
 * 不一致时会出现「UI 让选、服务端 415 拒」——`.epub` 就这样漏了很久。
 *
 * 不含 `csv`：它由前端文本链路直通处理（`SUPPORTED_TEXT_EXT`），再列入会多出一条
 * 互相竞争的转换路径。`html` 同理（当纯文本读）。
 */
export const DOCUMENT_EXTENSIONS = [
  // Word
  'doc',
  'docx',
  'docm',
  // PowerPoint
  'ppt',
  'pps',
  'pot',
  'pptx',
  'pptm',
  'ppsx',
  'ppsm',
  // Excel
  'xls',
  'xlsx',
  'xlsm',
  'xlsb',
  // OpenDocument
  'odt',
  'ods',
  'odp',
  // 其他
  'rtf',
  'pdf',
  'epub',
] as const

export const DOCUMENT_EXT = new RegExp(`\\.(?:${DOCUMENT_EXTENSIONS.join('|')})$`, 'i')

/** 文件选择器 `accept` 用的 `.docx,.pdf,...` 形式。 */
export const DOCUMENT_ACCEPT = DOCUMENT_EXTENSIONS.map(extension => `.${extension}`).join(',')

export function isConvertibleDocument(name: string): boolean {
  return DOCUMENT_EXT.test(String(name || ''))
}
