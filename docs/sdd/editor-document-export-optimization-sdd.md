# 编辑区（EditorPanel）文档导出能力与工作台化优化 SDD

> 日期: 2026-06-02 (基于详细 review 修订 v2)
> 状态: 设计阶段 / 待评审 & 实施
> **修订说明**: 已纳入 review 反馈——明确 generateHTML v3 需 smoke test 验证、补全自定义 EditorTable 同名冲突矩阵、补充 OOXML 5+ 命名空间 + 最小 drawing 模板、锁定 PDF 技术路线为 window.print() + print CSS、调优 Phase 1 时间估算至 7-10 天、补充导出诊断报告设计与打印 CSS 要点、增加 Table 扩展 tradeoff 讨论。
> 目标: 将编辑区从“可用富文本笔记工具”升级为“本地优先、专业级文档工作台”，核心是实现从 TipTap 富结构内容**高保真导出多种文档格式**（优先 .docx Word，其次 PDF/HTML），同时保持/增强现有 wiki 链接、AI 辅助、资产管理、文件集成等能力。
> 产品约束: 本地优先（默认不走线上 Office API）、零或极低新增依赖、与 fileStore / Vault / 知识库深度集成、不破坏现有 5 列布局与手动工作流、所有导出必须可追溯到编辑区快照 (tiptapJson + assets + metadata)。
> 参考基准: /Users/by3/Documents/tiptap 官方 monorepo（尤其是 packages/html、static-renderer、markdown 以及 demos 中的复杂扩展与导出模式）。
> 相关现有 SDD/文档: CLAUDE.md（审查清单中的 localDocx.ts、officeTools.ts）、docs/sdd/ 系列（统一上下文引擎风格）、src/utils/localDocx.ts 现状。

---

## 1. 一句话定案

**把编辑区打造成韭菜盒子 Studio 的“本地文档中枢”**：用户在右栏用 TipTap 写出带标题、列表、表格、图片、任务、[[双向链接]] 的富文档后，能一键导出**结构完整、图片嵌入、专业排版**的 .docx（Word 打开即用），同时支持 PDF（打印级保真）和 HTML。所有导出走纯本地链路（增强 localDocx + 官方 TipTap 序列化器 + Tauri save），不依赖已禁用的线上 /office/*，并与现有文件树、知识库、AI 工具形成闭环。

不是“再加一个导出按钮”，而是**编辑区能力向文档工作台的系统性升级**（保真度、UX、集成、可扩展性）。

---

## 2. 当前状态与差距分析（对照 tiptap + 项目实际）

### 2.1 当前编辑区亮点（已强于普通笔记）
- 完整 TipTap v3 + Vue3 集成（StarterKit + Underline/Link/Image/Highlight/Typography/TaskList/Color + 自定义 Table + WikiLinkExtension）。
- **结构化持久化**：每次 onUpdate 保存 tiptapJson + html + markdown + editorAssets 到 fileStore metadata（buildEditorDocumentMetadata），支持精确恢复 wiki 链接等。
- AI 悬浮工具条（选区润色/扩写/续写等）+ Cmd/Ctrl+Click 跳转 [[ ]] + 反向链接面板 + 自动保存 + Cmd+S。
- 导入：支持 Office/PDF/文本 -> textContent -> textToTiptapDoc（editorContent.ts）。
- 导出菜单骨架已存在（C2 注释），但仅 Markdown 完整实现。
- 与 fileStore、事件总线、useNotebook 迁移逻辑深度集成。
- 本地文档工具链已存在：localDocx.ts（纯 JS 最小 DOCX ZIP/XML 写出器）、exportSave.ts（Tauri save + 浏览器降级）、officeTools.ts（LLM create_document 工具已走 localDocx）。

### 2.2 核心差距（为什么“仅仅是好用能用”）
- **导出严重残缺**：
  - exportDoc() 中 `if (format !== 'md') { exportStatus.value = '线上 Office 导出已关闭，请先保存 Markdown。' }` —— 直接 stub。
  - localDocx.ts 仅支持**纯文本段落 + 简单标题/列表解析**（从 markdown 字符串出发），**完全不支持**：
    - TipTap 表格（EditorTable 节点）
    - 图片嵌入（仅 markdown ![alt](data:...) 链接）
    - 复杂 marks（下划线、颜色、高亮、任务列表状态）
    - WikiLink 自定义节点
    - 任务列表（TaskItem）
  - Markdown 序列化器 (tiptapJsonToMarkdown in editorDocument.ts) 是**手写 100+ 行**，覆盖不全、易丢失格式（marks 只在 text 节点部分处理，表格转 pipe 表但结构脆弱）。
  - Markdown 解析器 (editorContent.ts) 同样手写，支持基础表格/列表/引用，但与渲染器不完全对称。
- **保真度低**：导出 .docx 后在 Word/WPS 中丢失表格、图片、层级、样式。
- **UX 断层**：导出菜单只有 MD 可用；无选项（是否嵌入图片、页设置、元数据）；无预览；无“导出后打开所在文件夹”或“另存为模板”。
- **集成弱**：编辑区内容虽已存为 file（category:text），但 LLM 工具 (create_document) 目前主要消费对话文本，而非“当前编辑区打开的文档”。导出后不能一键“整理进 Vault wiki”。
- **无官方序列化加持**：项目未使用 tiptap 官方的 `@tiptap/html` (generateHTML) / `@tiptap/markdown` / static-renderer，导致重复造轮子且保真度天花板低。

### 2.3 tiptap 参考库关键启发（必须对照采用）
- `packages/html` + `src/server/generateHTML.ts`：**在 Tiptap v3 中 `generateHTML` 的实际签名与行为需在 Phase 0 通过 smoke test 严格验证**（可能需要 Editor 实例而非裸 JSON+extensions；自定义节点 renderHTML 是否被调用取决于注册方式）。一旦验证通过，可用**与编辑器完全相同的 extension 列表**得到高保真、可样式化的 HTML 字符串（有 DOM 和无 DOM 两种路径）。完美作为 PDF（print CSS）和 DOCX（HTML 结构映射或直接消费）的 pivot。
- `packages/static-renderer`：更轻量的 JSON -> HTML / Markdown 渲染器，无需实例化 Editor，适合导出管道、缩略预览、后台任务。
- `packages/markdown`：生产级 bidirectional Markdown <-> JSON，支持自定义 extension（WikiLink 可注册为 custom node）、task lists、嵌套等。**强烈建议替换/包装当前手写 parser/renderer**，显著降低维护负担和 bug。
- Demos/Examples 中的高级模式：
  - DragHandle + FileHandler 扩展：更好的图片/资产拖拽管理（当前靠 paste/drop 手写 + fileStore）。
  - TableOfContents 扩展：长文档自动大纲（可作为反向链接面板的结构化升级）。
  - Mathematics、Details、Emoji 等可选，按需为“专业文档”场景加。
- 经验：所有自定义节点（WikiLink、EditorTable*）必须提供一致的 `renderHTML` / `parseHTML`，才能被官方序列化器正确处理。

**结论**：引入 1-2 个轻量官方包（体积可控，已有大量 @tiptap 依赖），把“手写脆弱转换”升级为“官方 + 自定义扩展注册”的可靠管道，是最高 ROI 的第一步。但**一切以 Phase 0 smoke test 实测结果为准**。

### 2.4 自定义 EditorTable 节点与官方 @tiptap/extension-table 同名冲突风险（必须在 Phase 0 解决）
项目当前使用自研 `EditorTable` / `EditorTableRow` / `EditorTableCell` / `EditorTableHeader`（`editorTableExtensions.ts`），节点 `name` 分别为 `'table'` / `'tableRow'` / `'tableCell'` / `'tableHeader'`——与官方 `@tiptap/extension-table` **完全同名**。

如果引入 `@tiptap/html` 或 `@tiptap/markdown`，官方内部可能对这些标准节点名做特殊处理（尤其是 markdown table 序列化、HTML 生成时的结构假设）。

**Phase 0 硬性任务**：输出“同名节点兼容性对照矩阵”：

| 维度              | 项目自定义 EditorTable*                          | 官方 @tiptap/extension-table                  | 冲突风险 & 影响 |
|-------------------|--------------------------------------------------|-----------------------------------------------|-----------------|
| `addAttributes`   | 仅 colspan/rowspan（简单 parseHTML）            | 更完整（colwidth 等拖拽相关）                 | 高（generateHTML 可能期望官方属性） |
| `content` 规则    | `(tableCell\|tableHeader)*` 等                   | 更严格的 table 结构约束                       | 中（序列化时可能多余/缺失 wrapper） |
| `parseHTML`/`renderHTML` | 自定义 class="editor-table" + tbody            | 标准 table 结构 + 可能依赖 TableRow 等子节点  | 高（HTML 保真度和 markdown 往返） |
| 表格编辑 UX       | 基础（当前 toolbar 仅 insert）                   | 成熟（列宽拖拽、右键菜单增删行列、合并单元格）| 中（长期 UX 债务） |

**决策点**（Phase 0 必须给出结论）：
- 方案 A：保持自定义 Table + 为它单独写 DOCX/ generateHTML 适配器（工作量大，但零破坏）。
- 方案 B：迁移到官方 Table 扩展（获得免费的 generateHTML 支持 + 更好编辑 UX），但需迁移已有文档的 tiptapJson，并处理历史兼容。
- 推荐在 Phase 1 之前明确选择并在 SDD v3 中更新。

---

## 3. 第一性原则与硬约束

### 3.1 本地优先 + 隐私
- 默认导出链路**完全本地**（JS ZIP + Tauri FS + 可选用户启用的本地二进制如 pandoc）。
- 禁止默认把编辑区富内容发到 api.jiucaihezi.studio /office/*（当前已禁用，保持）。
- 只有用户显式选择“使用云端转换”时才走远程（极少场景）。

### 3.2 唯一事实源
- 编辑区导出必须基于**已持久化的 file metadata**（tiptapJson + editorAssets + html + markdown），而非仅 live editor state。
- 导出记录可回溯（建议在 metadata 里加 lastExportedAt / exportHistory 数组）。

### 3.3 保真度铁律
- .docx 导出必须保留：
  - 标题层级 (H1-H3)
  - 段落 + 粗体/斜体/下划线/删除线/高亮/颜色
  - 无序/有序/任务列表（支持 checked 状态）
  - 表格（行列、表头、合并单元格基础支持）
  - 图片（本地 dataURL 资产嵌入为真实媒体，非外部链接）
  - 水平线、引用块、代码块（作为带格式文本或占位）
  - [[WikiLink]] → 转为可读文本 + 可选脚注/超链接注释
- **PDF 技术路线已明确锁定为 `window.print()` + 专用 `@media print` CSS**（零依赖）：
  - 理由：浏览器原生中文排版与分页处理最佳；用户可通过系统打印对话框选择“另存为 PDF”或真实打印机；完全符合产品“本地手动控制”北极星；避免引入 jsPDF / puppeteer 等新依赖。
  - 必须产出完整的打印样式规则（见 4.1 打印 CSS 设计要点）。其他方案（html-to-image+jsPDF、Tauri 原生打印）仅作为未来备选，不在本 SDD Phase 1-2 范围内。

### 3.4 零/低依赖 + 可降级
- 优先纯 JS（增强 localDocx）。
- 可选引入 `@tiptap/html` + `@tiptap/markdown`（评估后决定，预计 <100KB gz）。
- 不强制用户安装 pandoc/LibreOffice；通过 LocalCapabilitySetup 框架做“发现并启用”。

### 3.5 与现有系统零破坏
- 保持 5 列布局、现有 toolbar/bubble/AI 功能、文件自动保存、Cmd+S、事件总线。
- 新导出功能必须通过 review 清单（新增文件若涉及安全/存储需加入 🔴 必检查）。
- 导出不自动写入 Vault（除非用户后续手动“整理”）。

### 3.6 可测试 & 可诊断
- 所有导出路径必须有单元测试（localDocx 已有测试传统）+ 手动 checklist（多平台 Word 打开验证）。
- **导出诊断报告设计**（必须在 Phase 1 实现）：
  - **包含内容**（结构化 JSON + 可读摘要）：
    - 文档元：标题、字数、节点统计（`{paragraph: 87, heading: {1:3,2:7}, table: 2, image: 3, wikiLink: 5, taskItem: {total:12, checked:4}}`）
    - 资产：图片数量/总大小/嵌入策略
    - 序列化中间：使用的 serializer 版本、generateHTML 是否启用、任何降级警告
    - 导出参数：格式、是否嵌入图片、目标文件名
    - 耗时与结果：成功/失败 + 错误堆栈（脱敏）
  - **展示位置**：
    - 导出对话框内可折叠的“诊断信息”区域（默认收起，失败时自动展开）
    - 成功导出后在状态提示中提供“查看诊断”按钮（写入临时文件或内存）
  - **触发条件**：任何导出失败时自动弹出；成功导出时用户可主动点击“显示诊断”；长期保存在文件 metadata 的 `lastExportDiagnostics` 字段（便于问题复现）。
  - 目的：让用户/开发者在不打开开发者工具的情况下快速定位“为什么这张图片没导出来”或“表格结构异常”。

---

## 4. 目标架构

```
┌─────────────────────────────────────────────────────────────┐
│                    EditorPanel.vue (现有)                    │
│  - 实时编辑 + AI bubble + WikiLink + 资产上传 + 自动保存       │
│  - 触发导出 → EditorExportService                          │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│              EditorDocumentService (新建/增强)               │
│  - getCurrentSnapshot() : { tiptapJson, html, md, assets, title, fileId } │
│  - ensureAssetsResolved()                                     │
│  - buildExportMetadata()                                      │
└────────────────────────────┬────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  MarkdownExport │  │   DocxExport    │  │   PdfExport     │
│  (已有，增强)    │  │  (核心重做)      │  │  (新增)          │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                    │
         │ 官方 markdown pkg? │  localDocxV2.ts   │  锁定为 window.print()
         │                    │  (tiptapJson →   │  + 专用 @media print
         │                    │   OOXML + 嵌入)   │  CSS（零依赖）
         ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                    exportSave.ts (增强)                      │
│  - normalize + Tauri save dialog + Rust write (base64)       │
│  - 导出后 emit 'editor-exported' 事件（供其他模块监听）        │
└─────────────────────────────────────────────────────────────┘
```

**关键新模块**：
- `src/utils/editorExport.ts`：统一入口 + 策略注册。
- `src/utils/localDocx.ts` 重命名为 v2 或内部升级（保持向后兼容 createDocxFromText）。
- 可选：`src/utils/editorHtml.ts` 包装 generateHTML + 所有扩展（包括自定义）。

**图片嵌入策略**（DOCX 难点，代码量最大、最易出 bug 的部分）：
- dataURL → Uint8Array（已有的 fileToDataUrl 反向）。
- 生成 `word/media/image-{id}.png`（仅支持 PNG/JPEG 起步）。
- **必须完整处理至少 6 个命名空间**（当前 localDocx 只声明了 `w:`，这是严重遗漏）：

| 前缀 | 命名空间 URL                                      | 用途 |
|------|---------------------------------------------------|------|
| `w`  | http://schemas.openxmlformats.org/wordprocessingml/2006/main | 主文档结构 |
| `r`  | http://schemas.openxmlformats.org/officeDocument/2006/relationships | 关系 ID（r:embed） |
| `wp` | http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing | 内联图片容器 wp:inline / wp:anchor |
| `a`  | http://schemas.openxmlformats.org/drawingml/2006/main | 图形属性、a:blip / a:graphic |
| `pic`| http://schemas.openxmlformats.org/drawingml/2006/picture | pic:pic / pic:nvPicPr / pic:blipFill |
| `mc` | http://schemas.openxmlformats.org/markup-compatibility/2006 | 兼容性标记（可选但推荐） |

**最小可工作 <w:drawing> 模板片段**（必须在 localDocx v2 中硬编码生成）：
```xml
<w:drawing>
  <wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="3200000" cy="2400000"/>
    <wp:docPr id="1" name="图片"/>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr>
            <pic:cNvPr id="0" name="图片"/>
            <pic:cNvPicPr/>
          </pic:nvPicPr>
          <pic:blipFill>
            <a:blip r:embed="rIdX" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
            <a:stretch><a:fillRect/></a:stretch>
          </pic:blipFill>
          <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3200000" cy="2400000"/></a:xfrm></pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing>
```
同时需同步更新 `[Content_Types].xml`（增加 Default Extension="png" ...）和 `word/_rels/document.xml.rels`（添加 Relationship Type=".../image" Target="media/xxx.png"）。

**WikiLink 处理**：
- 导出时解析 data-wiki-link 或自定义节点 → 纯文本 “[[标题]]” + 可选尾注 “（知识库条目）”。

### 4.1 打印 CSS 设计要点（PDF 路线锁定后必须产出）
因为 PDF 选定 `window.print()`，必须在 Phase 1 交付一套完整的、可独立维护的打印样式（建议放在 `src/styles/print.css` 或 EditorPanel 内部 `<style>` + 动态注入）：

- **页面基础**：`@page { size: A4; margin: 1.5cm 1.5cm; }`；`body` 在打印模式下使用 11-12pt 衬线或无衬线字体（优先系统默认以保证中文）。
- **排版**：
  - 正文 `font-size: 11pt; line-height: 1.6;`
  - H1 18pt bold，H2 14pt，H3 12pt
  - 代码块 `font-family: ui-monospace, monospace; font-size: 9pt; white-space: pre-wrap; page-break-inside: avoid;`
- **分页控制**（核心）：
  - `table, pre, img, .ep-bubble-menu, blockquote { page-break-inside: avoid; }`
  - `h1, h2, h3 { page-break-after: avoid; }`
  - 长表格内部行可允许分页，但表头在每页重复（通过 thead + CSS 规则）。
- **图片**：`img { max-width: 100%; height: auto; page-break-inside: avoid; }`；大图前自动加软分页提示。
- **页眉页脚**（通过 `@page` + `running elements` 或 JS 辅助）：
  - 左上：文档标题（截断）
  - 右下：`第 {page} 页 / 共 {total} 页`
  - 底部细线 + “韭菜盒子 Studio 导出”
- **隐藏非内容元素**：toolbar、bubble menu、反向链接侧栏、AI loading 等在 `@media print` 下 `display: none`。
- **主题适配**：打印时强制使用高对比浅色（无论当前是 dark/护眼模式），避免深色背景。
- **测试**：必须在 Chrome/Firefox/Safari + 实际“另存为 PDF”验证分页与中文不乱码。

此样式同时可复用于“打印预览”功能（未来增强）。

---

## 5. 实施路线图（分阶段，可独立 PR）

### Phase 0：准备与评估（2-3 天，硬性前置）
- [ ] 在 CLAUDE.md 审查清单中新增“编辑区导出相关”条目。
- [ ] **关键：生成 HTML smoke test**（20 行脚本）——用项目完整 extensions 列表（含 WikiLinkExtension + 4 个自定义 EditorTable*） + 一段包含 wikiLink + table + image + taskList 的真实 tiptapJson，调用 `@tiptap/html` 的 generateHTML（或其 server 变体），验证输出是否保留结构和自定义节点。输出报告 + 决策是否引入官方包。
- [ ] **同名节点兼容性对照矩阵**（见 2.4）：对比 EditorTable* 与官方 @tiptap/extension-table，产出迁移 vs 适配决策。
- [ ] 补充现有 localDocx.test.ts 更多边界 case（尤其是 OOXML 命名空间）。
- [ ] 冻结当前 exportDoc 行为（仅 MD）。

### Phase 1：基础结构化导出 + 菜单修复（P0，核心目标）（7-10 天）
> **时间说明**：图片嵌入的完整 OOXML DrawingML + 5+ 命名空间 + rels + Content_Types 处理是最大变量；若无 OOXML 实战经验，单此子任务 3-4 天正常。诊断报告 + 打印 CSS 也需真实分页验证。
- [ ] 重构 EditorPanel.vue 导出部分：
  - 完善 exportDoc 支持 'docx' | 'pdf' | 'html' | 'md'
  - 新建轻量 ExportOptions 面板（或 Modal）：格式选择、是否嵌入图片、页眉页脚简易配置、文件名预览。
  - 导出成功后支持 “打开文件” / “打开所在文件夹”（Tauri shell.open 或 reveal）。
- [ ] 实现 `editorExport.ts` 统一服务。
- [ ] **localDocx v2 核心**：
  - 新增 `createDocxFromTiptap(input: { title, json: any, assets?: EditorAssetRef[] })`
  - 支持节点：doc/paragraph/heading/bulletList/orderedList/taskList/table/image/hardBreak/horizontalRule/blockquote/codeBlock。
  - 基础 marks 映射（bold/italic/underline/strike/link/highlight）。
  - 图片：仅 PNG/JPEG dataURL 嵌入（先做最常用格式）。
- [ ] **PDF 技术路线已锁定为方案 A（window.print() + 专用打印 CSS）**（理由见 3.3 / 4.1）：零新增依赖、中文与分页表现最佳、完全符合“用户手动控制”北极星。Phase 1 必须产出完整的 `@media print` 样式规则（见补充的“打印 CSS 设计要点”）。
- [ ] 用官方 generateHTML（若 Phase 0 验证通过）或增强现有 html snapshot 作为 PDF 打印源。
- [ ] 更新 officeTools.ts 中 create_document 描述，指向“支持编辑区富内容”。
- [ ] 实现“导出诊断报告”（见 3.6 详细设计）并集成到导出对话框。
- [ ] 交付完整 `@media print` 样式 + 打印预览验证（见 4.1 设计要点）。
- [ ] 写 3-5 个 focused test + 手动 checklist（Word 2016+/WPS/LibreOffice/Pages 打开验证结构+图片；另存为 PDF 分页验证）。

### Phase 2：保真度与 UX 深化（P1）
- [ ] 完整图片嵌入测试 + 多格式容错（SVG 转 PNG？）。
- [ ] WikiLink 智能降级（导出为带注释的文本或可点击书签）。
- [ ] 任务列表 checked 状态在 DOCX 中映射为 todo checkbox（OOXML 有支持）。
- [ ] 导出预览面板（用 static-renderer 轻量渲染缩略图）。
- [ ] “导出为模板”功能（存为 public/skills/ 或 vault 模板）。
- [ ] 增强反向链接面板 → “文档大纲 + 反向链接” 组合侧栏（参考 tiptap TableOfContents）。
- [ ] 拖拽手柄 / 更好资产管理（可选引入 tiptap 扩展）。

### Phase 3：生态集成与高级能力（P2+）
- [ ] LLM 工具增强：新增或升级 `export_editor_document` 工具（当编辑区有活跃文档时暴露），让 Skill 可以“把当前编辑内容导出为 Word 并保存到指定路径”。
- [ ] 一键“导出 + 整理进当前 Vault wiki”（生成带元数据的 wiki 页 + 原始 docx 附件）。
- [ ] 更多格式试点：.pptx（参考项目已有 pptx skill 模式）、.xlsx 表格专用导出。
- [ ] 版本历史：编辑区文档的轻量快照（每次重大导出打 tag）。
- [ ] 主题化导出样式（跟随 app 4 个主题，或独立“学术/商务/简洁”模板）。
- [ ] 性能：超长文档（>50k 字）分片导出 + 进度。

---

## 6. 关键文件变更清单（必须审查项标 🔴）

### 🔴 必仔细审查
| 文件 | 变更类型 | 风险点 |
|------|----------|--------|
| `src/components/editor/EditorPanel.vue` | 大幅修改导出逻辑 + 新 UI | 事件泄漏、状态竞态、样式破坏 |
| `src/utils/localDocx.ts` (或新建 localDocxV2.ts + 兼容层) | 核心 OOXML 增强 | ZIP 格式错误、XML 转义、图片二进制损坏、Word 兼容性 |
| `src/utils/editorExport.ts` (新建) | 新服务层 | 必须通过 architecture guard |
| `src/utils/editorDocument.ts` | 增强快照/辅助函数 | 影响所有已存文件 metadata |
| `src/composables/officeTools.ts` | 工具描述/执行路径更新 | LLM 工具行为变化 |
| `package.json` | 可选新增 1-2 个 @tiptap 包 | 构建体积、类型、license |
| `src-tauri/src/lib.rs` | 可能微调（若需额外 binary 能力） | 权限最小化 |

### 🟡 注意
- `src/utils/exportSave.ts`：增强 filter、post-export hook。
- `src/components/editor/WikiLinkExtension.ts` & `editorTableExtensions.ts`：确保 renderHTML 完整（供 generateHTML 使用）。
- `src/utils/editorContent.ts`：逐步迁移到官方 markdown pkg。
- `CLAUDE.md`：更新审查清单 + 已知问题。
- `docs/` 用户手册或技能文档：新增“编辑区导出指南”。

### 🟢 可快速迭代
- 新组件 `ExportDialog.vue` / `ExportOptions.vue`（放 editor/ 下）。
- 测试文件：`src/utils/__tests__/localDocx.test.ts` 扩展、`editorExport.test.ts`。
- 样式：新增打印 CSS（`@media print`）。

---

## 7. 风险、回滚与缓解

- **DOCX 兼容性爆炸 + OOXML 命名空间复杂度**：Word 严格验证，图片嵌入需正确处理 6 个命名空间 + drawing/pic/graphic 结构（当前 localDocx 完全缺失）。缓解：最小可工作 drawing 模板起步 + 每新增一种图片格式都必须在 4+ 软件实测；提供“纯文本降级 + Markdown 导出”按钮作为安全网。
- **图片体积/性能**：嵌入大图导致 docx 几十 MB。缓解：导出选项“压缩图片”“仅链接（不嵌入）”“最大分辨率限制”。
- **自定义节点序列化失败**（WikiLink）：generateHTML 可能丢节点。缓解：先实现 JSON 直出自定义序列化器作为兜底；WikiLink 节点必须实现可靠 toMarkdown / toHTML。
- **引入新包后的 bundle 增长**：评估后决定；若拒绝，可继续手写但必须把现有 parser/renderer 彻底重写并加大量 test。
- **与 LLM 工具循环冲突**：create_document 目前走对话内容。缓解：保持独立，未来通过事件或 store 暴露“当前编辑区文档 ID”。
- **回滚**：Phase 1 完成后打 tag；localDocx 保持旧 `createDocxFromText` 函数不变。

---

## 8. 成功标准与验收 Checklist

**必须通过**（发版前）：
- [ ] 用编辑区创建一个包含 H1/H2 + 粗斜体 + 3 级列表 + 2x4 表格 + 2 张本地上传图片 + 2 个 [[WikiLink]] 的文档，导出 .docx。
- [ ] 在 Windows/macOS + Word / WPS / LibreOffice / Pages 中打开，**结构完整、无崩溃、图片可见、表格对齐**。
- [ ] PDF 导出在 A4/打印预览中排版合理（无内容溢出、图片不被裁）。
- [ ] 所有原有编辑功能（AI 工具、自动保存、wiki 跳转、Cmd+S）零回归。
- [ ] 新增代码通过 `pnpm run test:focused`（含新增 export test）。
- [ ] 导出内容不走任何未授权网络请求（抓包验证）。
- [ ] 大文档（>10000 字 + 10 张图）导出耗时 < 8s（桌面端）。

**期望**：
- 导出后自动在文件树中高亮对应条目。
- 支持“导出历史”快速重导。
- 用户可在设置中配置默认导出格式/图片策略。

---

## 9. 后续演进建议（不在本 SDD 范围但相关）

- 编辑区 + 画布节点打通（“文本节点”可直接 push 到编辑区，或反向）。
- 基于编辑区的“长文写作 Skill”专用模板（小说、报告、剧本等，参考 novel-writing-pipeline.md）。
- 真·所见即所得 PDF 引擎（未来考虑集成 headless 渲染 if 需求强烈）。
- 协作标记（多用户评论层，不改底层内容）。

---

## 10. 参考资料

- 项目：`CLAUDE.md`（架构、审查、localDocx 现状）、`src/components/editor/EditorPanel.vue`（当前实现）、`src/utils/localDocx.ts`（ZIP 基础）、`editorDocument.ts` / `editorContent.ts`。
- tiptap 官方（本地副本）：`packages/html`、`packages/markdown`、`packages/static-renderer`、demos 中 Table / Image / DragHandle 示例。
- OOXML 最小参考：当前 localDocx.ts 的 ZIP/CRC/关系结构 + 标准 ECMA-376 片段（paragraph、tbl、drawing、blip）。
- 现有测试：`src/utils/__tests__/localDocx.test.ts`、`exportSave.test.ts`。

---

**本 SDD 完成后下一步**：
1. 团队评审（重点：Phase 0 smoke test generateHTML 实测结果 + EditorTable 同名冲突决策；localDocx v2 完整 OOXML 命名空间实现复杂度；PDF window.print() + 打印 CSS 方案接受度；诊断报告设计是否满足运维需求）。
2. 拆分为 2-3 个可独立 review 的 PR（Phase 0 smoke test + 矩阵产出 优先；Phase 1 localDocx v2 + 打印 CSS + 诊断报告）。
3. 更新 CLAUDE.md 审查清单（把 localDocx.ts、editorTableExtensions.ts、未来 editorExport.ts 明确标为 🔴）。
4. 编写用户-facing “编辑区导出指南”（放 docs/ 或技能仓库）。

此方案既尊重“本地手动工作台”北极星，又把“导出各种文档”从“能用”变成“专业可用”，真正让编辑区成为用户内容生产的核心阵地。

---

## 附：修订后评分自检（对照 review 反馈）

| 维度 | 修订前评分 | 修订后评分 | 说明 |
|------|------------|------------|------|
| 结构完整性 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 补充了 2.4、4.1、诊断报告详细设计、打印 CSS 要点 |
| 现状诊断 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 保持 |
| 技术可行性 | ⭐⭐⭐ | ⭐⭐⭐⭐ | generateHTML 明确要求 smoke test；OOXML 命名空间 + 模板已补全；Table 冲突已列矩阵 |
| 实施可操作性 | ⭐⭐⭐ | ⭐⭐⭐⭐ | Phase 0/1 时间调整为 7-10 天；PDF 路线单一锁定；诊断与打印 CSS 设计要点具体化 |
| 风险覆盖 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | OOXML 复杂度、自定义节点、Table 迁移决策均已前置到 Phase 0 并给出 mitigation |