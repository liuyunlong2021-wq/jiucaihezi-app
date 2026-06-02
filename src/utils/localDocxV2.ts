/**
 * localDocxV2.ts
 *
 * Phase 1 实现：从 TipTap JSON 生成高质量 .docx 的新版本
 *
 * 当前阶段：Stage 1 - 文本基础能力（heading / paragraph / 基础 marks）
 */

import type { JSONContent } from '@tiptap/core'

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

// 推荐的 6 个核心命名空间（根元素统一声明）
const DOCX_NAMESPACES = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
} as const

export const REQUIRED_NAMESPACES = DOCX_NAMESPACES

/**
 * 生成带完整命名空间的 document.xml 根元素开始标签
 */
export function buildDocumentRootWithNamespaces(): string {
  const attrs = Object.entries(DOCX_NAMESPACES)
    .map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`)
    .join('\n  ')

  return `<w:document\n  ${attrs}>`
}

// ==================== Stage 1: 文本基础渲染 ====================

interface Mark {
  type: string
  attrs?: Record<string, any>
}

function escapeXml(text: string): string {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildRun(text: string, marks: Mark[] = []): string {
  const rPr: string[] = []

  for (const mark of marks) {
    if (mark.type === 'bold') rPr.push('<w:b/>')
    if (mark.type === 'italic') rPr.push('<w:i/>')
    if (mark.type === 'underline') rPr.push('<w:u w:val="single"/>')
    if (mark.type === 'strike') rPr.push('<w:strike/>')
    if (mark.type === 'highlight') {
      const color = (mark.attrs?.color || 'yellow').replace('#', '')
      rPr.push(`<w:highlight w:val="${color}"/>`)
    }
    if (mark.type === 'color' || mark.type === 'textStyle') {
      const color = mark.attrs?.color || mark.attrs?.['color']
      if (color) rPr.push(`<w:color w:val="${String(color).replace('#', '')}"/>`)
    }
  }

  const rPrTag = rPr.length > 0 ? `<w:rPr>${rPr.join('')}</w:rPr>` : ''

  return `<w:r>${rPrTag}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`
}

// 注意：renderNode / buildDocumentXml / createSimpleDocx 已删除（死代码）。
// 唯一活跃的渲染器是 renderDocumentWithImages()，它处理所有节点类型 + 图片嵌入。

// ==================== Stage 4: 图片嵌入 + 完整 ZIP ====================

interface ImageAsset {
  id: string
  data: Uint8Array
  extension: string
}

// Phase 2: 图片处理增强 - 压缩 + 格式容错
async function processImageForExport(src: string, options: { maxWidth?: number; quality?: number } = {}): Promise<{ data: Uint8Array; extension: string }> {
  const { maxWidth = 1600, quality = 0.85 } = options

  if (!src.startsWith('data:')) {
    // 非 dataURL，尝试原样处理（简单情况）
    const match = src.match(/^data:image\/(png|jpeg|jpg|webp|svg\+xml);base64,(.+)$/)
    if (match) {
      const ext = match[1].includes('png') ? 'png' : 'jpg'
      const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))
      return { data: bytes, extension: ext }
    }
    throw new Error('Unsupported image source')
  }

  // 使用 Canvas 进行格式转换 + 压缩
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let width = img.width
      let height = img.height

      if (width > maxWidth) {
        height = Math.round(height * (maxWidth / width))
        width = maxWidth
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d', { alpha: true })!
      ctx.drawImage(img, 0, 0, width, height)

      // 优先输出 PNG（无损），如果原图是照片类可考虑 JPEG
      // 这里为了简单统一输出 PNG（质量好，兼容性强）
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Canvas toBlob failed'))
        blob.arrayBuffer().then(buffer => {
          resolve({
            data: new Uint8Array(buffer),
            extension: 'png'
          })
        })
      }, 'image/png', quality)
    }
    img.onerror = () => reject(new Error('Image load failed for compression'))
    img.src = src
  })
}

function extractImages(json: JSONContent, assets: any[] = []): ImageAsset[] {
  const images: ImageAsset[] = []

  function traverse(node: JSONContent) {
    if (node.type === 'image' && node.attrs?.src) {
      const src = node.attrs.src
      // 占位，后续在 createDocxFromTiptap 中异步处理
      images.push({
        id: `image-${images.length}`,
        data: new Uint8Array(), // 占位，实际处理在外部
        extension: 'png',
        originalSrc: src
      } as any)
    }
    if (node.content) node.content.forEach(traverse)
  }

  traverse(json)
  return images
}

// 新的导出图片处理入口（支持压缩和格式转换）
export async function processImagesForDocx(imagesWithSrc: any[], options: { maxWidth?: number; quality?: number } = {}) {
  const processed: ImageAsset[] = []
  for (let i = 0; i < imagesWithSrc.length; i++) {
    const img = imagesWithSrc[i]
    try {
      const result = await processImageForExport(img.originalSrc || img.src, options)
      processed.push({
        id: img.id,
        data: result.data,
        extension: result.extension
      })
    } catch (e) {
      console.warn('图片处理失败，跳过:', e)
    }
  }
  return processed
}

// 生成单个图片的 drawing XML（真实嵌入）
function buildDrawingXml(rId: string, width = 3200000, height = 2400000): string {
  return `<w:drawing>
  <wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="${width}" cy="${height}"/>
    <wp:docPr id="1" name="图片"/>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr>
            <pic:cNvPr id="0" name="图片"/>
            <pic:cNvPicPr/>
          </pic:nvPicPr>
          <pic:blipFill>
            <a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
            <a:stretch><a:fillRect/></a:stretch>
          </pic:blipFill>
          <pic:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>
          </pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing>`
}

// 注意：createRenderer 已删除（第三份重复渲染器），唯一活跃的是下面的 renderDocumentWithImages。

// ==================== 统一渲染器（唯一活跃的渲染器） ====================

function renderDocumentWithImages(json: JSONContent, images: ImageAsset[]) {
  // 建立 src -> rId 映射（使用 originalSrc 保持一致性）
  const srcToRId = new Map<string, string>()
  const imageRels: string[] = []

  images.forEach((img, index) => {
    const rId = `rId${index + 2}`
    const key = (img as any).originalSrc || `idx-${index}`
    srcToRId.set(key, rId)
    imageRels.push(`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${index}.${img.extension}"/>`)
  })

  const renderNode = (node: JSONContent): string => {
    if (!node) return ''

    // 图片真实嵌入
    if (node.type === 'image' && node.attrs?.src) {
      const src = node.attrs.src
      const key = src
      const rId = srcToRId.get(key) || srcToRId.get(`idx-0`)

      if (rId) {
        const width = node.attrs.width ? Math.round(Number(node.attrs.width) * 9525) : 3200000
        const height = node.attrs.height ? Math.round(Number(node.attrs.height) * 9525) : 2400000
        return `<w:p><w:r>${buildDrawingXml(rId, width, height)}</w:r></w:p>`
      } else {
        return `<w:p><w:r><w:t xml:space="preserve">[图片]</w:t></w:r></w:p>`
      }
    }

    switch (node.type) {
      case 'text': {
        const text = node.text || ''
        const marks = node.marks || []
        return buildRun(text, marks)
      }
      case 'paragraph': {
        const inner = (node.content || []).map(renderNode).join('')
        const align = node.attrs?.textAlign
        const jc = align ? `<w:jc w:val="${align === 'center' ? 'center' : align === 'right' ? 'right' : 'left'}"/>` : ''
        return `<w:p>${jc ? `<w:pPr>${jc}</w:pPr>` : ''}${inner || '<w:r><w:t xml:space="preserve"> </w:t></w:r>'}</w:p>`
      }
      case 'heading': {
        const level = Math.min(Math.max(node.attrs?.level || 1, 1), 3)
        const size = level === 1 ? 32 : level === 2 ? 26 : 22
        const inner = (node.content || []).map(renderNode).join('')
        const align = node.attrs?.textAlign
        const jc = align ? `<w:jc w:val="${align === 'center' ? 'center' : align === 'right' ? 'right' : 'left'}"/>` : ''
        return `<w:p>
          <w:pPr>
            <w:pStyle w:val="Heading${level}"/>
            <w:rPr><w:sz w:val="${size}"/><w:b/></w:rPr>
            ${jc}
          </w:pPr>
          ${inner || '<w:r><w:t> </w:t></w:r>'}
        </w:p>`
      }
      case 'bulletList':
      case 'orderedList': {
        const isOrdered = node.type === 'orderedList'
        return (node.content || []).map((item) => {
          const inner = (item.content || []).map(renderNode).join('')
          const numPr = isOrdered 
            ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>` 
            : ''
          return `<w:p>
            <w:pPr>
              ${numPr}
              <w:pStyle w:val="${isOrdered ? 'ListNumber' : 'ListBullet'}"/>
            </w:pPr>
            ${inner}
          </w:p>`
        }).join('\n')
      }
      case 'taskList': {
        return (node.content || []).map(item => {
          const isChecked = !!item.attrs?.checked
          const symbol = isChecked ? '☑' : '☐'
          const color = isChecked ? '2E7D32' : '666666'
          const inner = (item.content || []).map(renderNode).join('')
          return `<w:p>
            <w:pPr><w:pStyle w:val="ListBullet"/></w:pPr>
            <w:r>
              <w:rPr><w:color w:val="${color}"/></w:rPr>
              <w:t xml:space="preserve">${symbol} </w:t>
            </w:r>
            ${inner}
          </w:p>`
        }).join('\n')
      }
      case 'wikiLink': {
        const label = node.attrs?.label || '链接'
        return `<w:r><w:t xml:space="preserve">[[${label}]]</w:t></w:r>`
      }
      case 'codeBlock': {
        const lang = node.attrs?.language || ''
        const codeText = (node.content || []).map(renderNode).join('')
        // Render as shaded paragraph with monospace (full pre in styles.xml would be better)
        return `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="Courier New"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${escapeXml(lang ? `[${lang}]\n` : '')}${codeText}</w:t></w:r></w:p>`
      }
      case 'table': {
        // Collect col widths from first row for tblGrid (if any cells specify colwidth)
        const firstRow = (node.content || [])[0]
        let tblGrid = ''
        if (firstRow) {
          const colWidths = (firstRow.content || []).map((cellNode: any) => {
            const w = cellNode.attrs?.colwidth ? parseInt(String(cellNode.attrs.colwidth)) || 2000 : 2000
            return `<w:gridCol w:w="${w}" w:type="dxa"/>`
          }).join('')
          if (colWidths) tblGrid = `<w:tblGrid>${colWidths}</w:tblGrid>`
        }

        const rows = (node.content || []).map(rowNode => {
          const cells = (rowNode.content || []).map(cellNode => {
            const isHeader = cellNode.type === 'tableHeader'
            // Always use w:tc + optional tblHeader in tcPr (standard OOXML, no invalid th)
            const colspanValue = Number(cellNode.attrs?.colspan || 1)
            const rowspanValue = Number(cellNode.attrs?.rowspan || 1)
            const colspan = colspanValue > 1 ? `<w:gridSpan w:val="${colspanValue}"/>` : ''
            const rowspan = rowspanValue > 1 ? `<w:vMerge w:val="restart"/>` : ''
            const colwidth = cellNode.attrs?.colwidth
            const tcW = colwidth ? `<w:tcW w:w="${parseInt(String(colwidth)) || 2000}" w:type="dxa"/>` : ''
            const tcPr = (colspan || rowspan || tcW) ? `<w:tcPr>${tcW}${colspan}${rowspan}${isHeader ? '<w:tblHeader/>' : ''}</w:tcPr>` : (isHeader ? '<w:tcPr><w:tblHeader/></w:tcPr>' : '')
            const inner = (cellNode.content || []).map(renderNode).join('')
            // inner from cell blocks (paras) already produce <w:p>, no extra wrapper to avoid "nested p"
            return `<w:tc>${tcPr}${inner}</w:tc>`
          }).join('')
          return `<w:tr>${cells}</w:tr>`
        }).join('\n')

        return `<w:tbl>
          <w:tblPr>
            <w:tblW w:w="0" w:type="auto"/>
            <w:tblBorders>
              <w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>
              <w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>
              <w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>
              <w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>
              <w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>
              <w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>
            </w:tblBorders>
            ${tblGrid}
          </w:tblPr>
          ${rows}
        </w:tbl>`
      }
      case 'details': {
        // Render as indented block or special para for DOCX (collapsible not native in OOXML, so flatten with marker)
        const summary = node.content?.find((c: any) => c.type === 'detailsSummary') || { content: [] }
        const detailContent = (node.content || []).filter((c: any) => c.type !== 'detailsSummary')
        const summaryText = (summary.content || []).map(renderNode).join('')
        const inner = detailContent.map(renderNode).join('\n')
        return `<w:p><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">▶ ${summaryText}</w:t></w:r></w:p>${inner}`
      }
      case 'detailsSummary':
      case 'detailsContent':
        // handled by parent details
        return (node.content || []).map(renderNode).join('')
      case 'tableOfContents':
        // Simple render as placeholder; full TOC field in DOCX is advanced
        return `<w:p><w:r><w:t xml:space="preserve">[目录 / Table of Contents]</w:t></w:r></w:p>`
      default: {
        if (node.content) {
          return node.content.map(renderNode).join('')
        }
        return ''
      }
    }
  }

  const bodyContent = (json.content || []).map(renderNode).join('\n    ')

  const documentXml = `${XML_DECLARATION}
${buildDocumentRootWithNamespaces()}
  <w:body>
    ${bodyContent || '<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>'}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`

  return {
    documentXml,
    imageRels: imageRels.join('\n  ')
  }
}

// ==================== 完整 ZIP 创建逻辑（从旧 localDocx.ts 完整迁移） ====================

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

// 注意：createRealDocx 已删除（与 createRealDocxWithImages 重复），统一使用后者。
// ==================== 真实 DOCX ZIP 生成（唯一活跃的 ZIP 函数） ====================
function createRealDocxWithImages(
  documentXml: string, 
  images: ImageAsset[] = [],
  extraImageRels: string = ''
): Uint8Array {
  const encoder = new TextEncoder()
  const entries: ZipEntryInput[] = []

  // [Content_Types]
  let contentTypes = `${XML_DECLARATION}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
`
  images.forEach(img => {
    const ct = img.extension === 'png' ? 'image/png' : 'image/jpeg'
    contentTypes += `  <Default Extension="${img.extension}" ContentType="${ct}"/>\n`
  })
  contentTypes += `</Types>`
  entries.push({ name: '[Content_Types].xml', data: encoder.encode(contentTypes) })

  // _rels/.rels
  entries.push({
    name: '_rels/.rels',
    data: encoder.encode(`${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
  })

  // document.xml
  entries.push({ name: 'word/document.xml', data: encoder.encode(documentXml) })

  // 图片文件
  images.forEach((img, i) => {
    entries.push({
      name: `word/media/image${i}.${img.extension}`,
      data: img.data
    })
  })

  // document.xml.rels （包含图片关系 + styles + numbering for fidelity）
  const baseRels = `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`
  if (images.length > 0) {
    entries.push({
      name: 'word/_rels/document.xml.rels',
      data: encoder.encode(`${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${baseRels}
${extraImageRels}
</Relationships>`),
    })
  } else {
    entries.push({
      name: 'word/_rels/document.xml.rels',
      data: encoder.encode(`${XML_DECLARATION}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${baseRels}
</Relationships>`),
    })
  }

  // Basic styles.xml for headings, lists, code (improves fidelity across Word/WPS/Libre/Pages)
  const stylesXml = `${XML_DECLARATION}
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
    </w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="Heading1"/><w:pPr><w:pStyle w:val="Heading1"/><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="Heading2"/><w:pPr><w:pStyle w:val="Heading2"/><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:link w:val="Heading3"/><w:pPr><w:pStyle w:val="Heading3"/><w:keepNext/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/><w:pPr><w:pStyle w:val="ListNumber"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/><w:spacing w:before="60" w:after="60"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="18"/></w:rPr></w:style>
</w:styles>`
  entries.push({ name: 'word/styles.xml', data: encoder.encode(stylesXml) })

  // Basic numbering.xml for lists (bullet + number)
  const numberingXml = `${XML_DECLARATION}
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`
  entries.push({ name: 'word/numbering.xml', data: encoder.encode(numberingXml) })

  // Update content types for styles/numbering
  // (already has xml default, but to be explicit)
  return createZip(entries)
}

export async function createDocxFromTiptap(input: {
  title?: string
  json: JSONContent
  assets?: any[]
  compressImages?: boolean
  maxImageWidth?: number
}): Promise<Uint8Array> {
  const title = input.title || '未命名文档'
  const rawImages = extractImages(input.json, input.assets || [])

  let finalImages: ImageAsset[] = []

  if (input.compressImages !== false && rawImages.length > 0) {
    // Phase 2: 应用压缩和格式转换
    finalImages = await processImagesForDocx(rawImages, {
      maxWidth: input.maxImageWidth || 1600,
      quality: 0.85,
    })
  } else {
    // 简单回退（不推荐用于生产）
    finalImages = rawImages
  }

  // 使用统一渲染器 + 图片上下文
  const renderResult = renderDocumentWithImages(input.json, finalImages)
  const documentXml = renderResult.documentXml
  const imageRels = renderResult.imageRels

  return createRealDocxWithImages(documentXml, finalImages, imageRels)
}
