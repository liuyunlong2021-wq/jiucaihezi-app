const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

export function createDocxFromText(input: {
  title?: string
  content: string
}): Uint8Array {
  const title = sanitizeText(input.title || extractTitle(input.content) || '文档')
  const documentXml = buildDocumentXml(title, input.content)
  return createZip([
    {
      name: '[Content_Types].xml',
      data: encodeText(`${XML_DECLARATION}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
    },
    {
      name: '_rels/.rels',
      data: encodeText(`${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    },
    {
      name: 'word/document.xml',
      data: encodeText(documentXml),
    },
  ])
}

function buildDocumentXml(title: string, content: string): string {
  const blocks = normalizeBlocks(content)
  const paragraphs = [
    paragraphXml(title, { bold: true, size: 32 }),
    ...blocks.map(block => paragraphXml(block.text, block)),
  ].join('')

  return `${XML_DECLARATION}
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`
}

function normalizeBlocks(content: string): Array<{ text: string; bold?: boolean; size?: number }> {
  const normalized = String(content || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean)
  return normalized.length
    ? normalized.flatMap(block => blockToParagraphs(block))
    : [{ text: ' ' }]
}

function blockToParagraphs(block: string): Array<{ text: string; bold?: boolean; size?: number }> {
  const lines = block.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length <= 1) return [lineToParagraph(lines[0] || block)]
  return lines.map(lineToParagraph)
}

function lineToParagraph(line: string): { text: string; bold?: boolean; size?: number } {
  const heading = line.match(/^(#{1,3})\s+(.+)$/)
  if (heading) {
    return {
      text: stripMarkdownInline(heading[2]),
      bold: true,
      size: heading[1].length === 1 ? 30 : heading[1].length === 2 ? 26 : 24,
    }
  }
  return { text: stripMarkdownInline(line.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '')) }
}

function paragraphXml(text: string, options: { bold?: boolean; size?: number } = {}): string {
  const runProps = [
    options.bold ? '<w:b/>' : '',
    options.size ? `<w:sz w:val="${Math.max(16, options.size)}"/>` : '',
  ].filter(Boolean).join('')
  return `<w:p><w:r>${runProps ? `<w:rPr>${runProps}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text || ' ')}</w:t></w:r></w:p>`
}

function stripMarkdownInline(text: string): string {
  return String(text || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim()
}

function extractTitle(content: string): string {
  return stripMarkdownInline(String(content || '').match(/^#{1,3}\s+(.+)$/m)?.[1] || '')
    || stripMarkdownInline(String(content || '').split(/\n+/).find(Boolean) || '')
}

function sanitizeText(text: string): string {
  return String(text || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim()
}

function escapeXml(text: string): string {
  return sanitizeText(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

interface ZipEntryInput {
  name: string
  data: Uint8Array
}

function createZip(entries: ZipEntryInput[]): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encodeText(entry.name)
    const crc = crc32(entry.data)
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      entry.data,
    ])
    localParts.push(local)

    centralParts.push(concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]))
    offset += local.length
  }

  const centralOffset = offset
  const central = concat(centralParts)
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(central.length),
    u32(centralOffset),
    u16(0),
  ])
  return concat([...localParts, central, end])
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff])
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ])
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    table[i] = c >>> 0
  }
  return table
})()
