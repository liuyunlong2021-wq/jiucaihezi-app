# 编辑区文档导出能力优化 TDD（测试设计文档）

> **关联 SDD**: `docs/sdd/editor-document-export-optimization-sdd.md`（v2，2026-06-02 修订版）
> **日期**: 2026-06-02（TDD v2，根据 DeepSeek review 补充）
> **状态**: 待评审
> **本次修订要点**：
> - 为 Phase 0 generateHTML smoke test 增加逐节点通过判定矩阵（DeepSeek 建议 #1）
> - 3.5 集成测试补充 EditorExportService 关键行为伪代码用例（DeepSeek 建议 #2）
> - 新增 Phase 0 硬阻断暂停条件（DeepSeek 建议 #3）
> **目标**: 为 SDD 中定义的“编辑区 → 高保真 .docx / PDF 导出”能力提供完整、可执行的测试设计，确保 Phase 0~2 交付物达到 SDD 验收标准，尤其覆盖 OOXML 图片嵌入复杂性、多软件兼容性、打印 CSS 分页效果和诊断报告。
> **范围**: 仅覆盖本 SDD 范围内的导出能力（EditorPanel 导出菜单、localDocx v2、PDF 打印路径、诊断报告、相关工具集成）。不包含 LLM 工具调用侧的端到端业务流程测试（另行覆盖）。

---

## 1. 测试目标与成功标准

### 1.1 核心成功标准（直接来自 SDD 第 8 节，必须 100% 通过）
1. 用编辑区创建一个**包含以下全部元素**的文档并导出 .docx：
   - H1 / H2 标题
   - 粗体 + 斜体 + 下划线 + 删除线 + 高亮
   - 3 级嵌套列表（无序 + 有序 + 任务列表，含 checked 状态）
   - 2×4 表格（含表头、合并单元格基础场景）
   - 2 张本地上传图片（至少 1 张 > 1MB）
   - 2 个 [[WikiLink]]（指向已存在文件）
2. 在以下 4+ 软件中打开无结构损坏、无崩溃、图片可见、表格对齐、格式基本保留：
   - Microsoft Word（Windows + macOS 最新版）
   - WPS Office（最新版）
   - LibreOffice Writer
   - Apple Pages（macOS）
3. PDF 导出（window.print() 路径）在 A4 下分页合理、中文不乱码、图片不溢出、代码块/表格不被截断。
4. 导出诊断报告内容完整、展示位置正确、失败时自动展开。
5. 零回归：原有编辑功能（AI 工具、WikiLink 跳转、自动保存、Cmd+S 等）全部正常。
6. 所有新增代码通过 `pnpm run test:focused`。

### 1.2 量化指标
- DOCX 结构保真度：核心节点类型覆盖率 ≥ 95%（见 4.1 矩阵）
- 兼容性通过率：4 款软件 × 核心场景 全部通过
- PDF 分页问题：A4 页面内容溢出 / 截断 case 数 = 0（人工视觉检查）
- 诊断报告：关键字段准确率 100%

---

## 2. 测试策略

### 2.1 测试分层
| 层级 | 占比 | 工具/方式 | 负责阶段 | 备注 |
|------|------|-----------|----------|------|
| **Unit** | 40% | Vitest / Node test | Phase 0-1 | localDocx v2 纯函数、序列化器、命名空间生成、诊断报告构建 |
| **Integration** | 30% | 组件测试 + 真实 Editor 实例 | Phase 1 | EditorExportService + EditorPanel 导出流程、文件 metadata 写入 |
| **Compatibility (Manual)** | 20% | 真实 Office 软件 | Phase 1-2 | DOCX 在 4 款软件的视觉 + 结构检查（最重要） |
| **E2E / Print** | 10% | 浏览器打印 + 人工 | Phase 1 | PDF 分页、打印 CSS 效果 |

### 2.2 自动化 vs 手工
- **自动化优先**：localDocx v2 的所有节点渲染、ZIP 结构、诊断 JSON 生成、Markdown/HTML 序列化。
- **手工必做**（无法自动化）：
  - 多 Office 软件打开后的**视觉保真度 + 结构完整性**
  - PDF 实际分页效果（浏览器打印对话框 + “另存为 PDF”）
  - 大图片内存 / 性能表现
  - WikiLink 在导出后的可读性

### 2.3 风险驱动测试
重点风险区域（按优先级）：
1. **OOXML 图片嵌入**（命名空间、rels、media 文件、drawing 结构）—— 历史 localDocx 完全缺失
2. **自定义 Table 节点** 在 generateHTML / DOCX 中的表现（同名冲突）
3. **PDF @media print 分页控制**（中文、表格、代码块、图片）
4. **长文档 + 多图片** 的性能与体积
5. **WikiLink 自定义节点** 在各序列化器中的降级策略

---

## 3. Phase 对齐的测试计划

### Phase 0（准备与验证）—— 2-3 天
**目标**：在动手写生产代码前，验证技术可行性，降低后续返工风险。

**必须产出物**：
- [ ] **Smoke Test 报告**（`src/utils/__tests__/smoke/tiptap-generate-html-smoke.ts` + 输出 markdown）
  - 使用项目完整 extensions（含 WikiLinkExtension + 4 个 EditorTable*）
  - 输入：包含 wikiLink + table + image(dataURL) + taskList(checked) + heading 的真实 JSON
  - **关键：按节点给出明确通过/降级判定矩阵**（见下表），而非笼统的“是否保留结构”

    | 输入节点          | 通过标准（可走 generateHTML）                          | 不通过则的推荐策略                  |
    |-------------------|-------------------------------------------------------|-------------------------------------|
    | WikiLink          | 输出 HTML 保留 `data-wiki-link` 属性 + `[[标签]]` 文本 | 走自定义序列化器兜底               |
    | EditorTable*      | 输出包含完整 `<table><thead><tbody>` 结构              | 评估迁移官方 Table 或写专属适配器   |
    | TaskItem (checked)| 包含 `data-checked="true"` 或等效语义标记              | 走自定义序列化器兜底               |
    | Image (dataURL)   | 完整保留 `src="data:image/..."`                        | 图片降级为纯文本占位 `[图片]`      |

  - 结论：**逐节点决策**哪些走官方序列化器、哪些必须自定义兜底，而非简单的“引入/不引入”。

- [ ] **EditorTable 同名冲突矩阵报告**（放入 TDD 附录或独立 md）
  - 对比自定义 vs 官方 extension-table 的 attributes、content、parse/renderHTML
  - 明确推荐方案（A 或 B）

- [ ] localDocx v2 命名空间生成单元测试骨架（至少覆盖 6 个命名空间的声明）

**入口条件**：Phase 0 所有产出（含逐节点判定矩阵 + Table 冲突矩阵 + 命名空间测试骨架）评审通过，且未触发 Phase 0 硬阻断暂停条件后，方可进入 Phase 1 编码。

### Phase 1（核心能力交付）—— 7-10 天
**重点测试区域**：

#### 3.1 DOCX 结构保真度测试矩阵（最高优先级）

| 节点类型 | 最小测试 case | 保真要求 | 验证方式 | 优先级 |
|----------|---------------|----------|----------|--------|
| heading (1-3) | H1 带样式 | 字号/加粗 | 4 软件打开 | P0 |
| paragraph + marks | bold + italic + underline + strike + highlight + color | 格式保留 | 4 软件 | P0 |
| bulletList / orderedList | 3 级嵌套 | 缩进 + 序号 | 4 软件 | P0 |
| taskList (TaskItem) | checked + unchecked | 复选框状态 | Word/WPS/Libre | P0 |
| table (自定义 EditorTable) | 2x4 + 表头 + 简单合并 | 行列对齐、无丢失 | 4 软件 | P0 |
| image (dataURL PNG/JPEG) | 2 张不同尺寸 | 嵌入可见、不外部链接 | 4 软件 | P0 |
| horizontalRule | 1 条 | 正确渲染 | 4 软件 | P1 |
| blockquote | 带嵌套 | 引用样式 | 4 软件 | P1 |
| codeBlock | 多行 + 语言 | 等宽字体 | 4 软件 | P1 |
| WikiLink | 2 个 | 转为 [[文本]] + 可选注释 | 所有软件 | P0 |

**自动化部分**：
- `localDocx.test.ts` 新增 `describe('createDocxFromTiptap')` 大量用例
- 使用 `JSZip` 读取生成文件，断言 XML 结构 + 关系文件 + media 目录

**手工部分**（必做 checklist）：
- 见附录 A「多软件视觉保真度检查清单」

#### 3.2 图片嵌入专项测试（OOXML 难点）
- 命名空间声明位置（推荐在 document.xml 根统一声明 6 个 xmlns，避免子节点重复）
- 多种图片格式（PNG、JPEG；SVG 降级为 PNG）
- 大图片（>5MB）+ 多图片（>10 张）
- 图片后紧跟表格/列表的布局
- 损坏 dataURL 容错

#### 3.3 PDF 打印路径专项
- 必须使用真实浏览器打印（Chrome/Firefox/Safari）
- `@media print` 规则逐条验证：
  - 代码块、表格、图片 `page-break-inside: avoid`
  - H1/H2 标题不被截断在页底
  - 页眉页脚内容正确
  - A4 边距 + 中文不溢出
- 长文档（>20 页）分页稳定性
- 暗色主题下打印仍为高对比浅色

#### 3.4 导出诊断报告测试
- 成功导出时：手动点击“显示诊断” → 字段完整、格式友好
- 失败场景（模拟图片嵌入失败）：自动展开 + 错误信息清晰
- 诊断数据持久化到文件 metadata `lastExportDiagnostics`
- 性能数据（耗时、节点数）准确

#### 3.5 集成与回归（EditorExportService 核心）
必须覆盖新建服务层的关键行为：

**推荐集成测试用例（伪代码方向）**：
```ts
// src/utils/__tests__/editorExport.test.ts
it('exportDocx() 成功后写入 metadata.lastExportedAt 和 exportHistory', async () => {
  const before = await fileStore.getFile(fileId)
  const result = await editorExport.exportDocx(fileId, { format: 'docx', embedImages: true })

  const after = await fileStore.getFile(fileId)
  expect(after.metadata.lastExportedAt).toBeGreaterThan(before.updatedAt)
  expect(after.metadata.exportHistory).toHaveLength((before.metadata.exportHistory?.length || 0) + 1)
  expect(result.status).toBe('success')
})

it('导出失败时正确产出 diagnostics 并不会污染原文件', async () => {
  // 模拟 localDocx v2 抛出图片嵌入异常
  const result = await editorExport.exportDocx(fileId, { corruptAssets: true })

  expect(result.status).toBe('failed')
  expect(result.diagnostics).toBeDefined()
  expect(result.diagnostics.errors).toContain('image-embed-failed')

  // 确保原文件 metadata 未被污染
  const after = await fileStore.getFile(fileId)
  expect(after.metadata.lastExportedAt).toBeUndefined()
})
```

**手工回归点**（保持原有）：
- EditorPanel 导出菜单（所有 4 种格式）行为正常
- Cmd+S / 自动保存后导出内容一致性
- 现有 WikiLink 点击跳转、反向链接面板不受影响

**目标**：确保核心导出服务不破坏文件元数据一致性，且失败时有清晰可诊断的输出。

### Phase 2（保真度深化） ✅ 已完成
- ✅ 完整图片格式容错 + 压缩策略（Canvas 自动转 PNG + 最大宽度压缩）
- ✅ 任务列表 checked 状态在 DOCX 中的视觉映射（带颜色 checkbox）
- ✅ 导出预览面板（HTML 快照 + 打印样式 Modal，已支持直接从预览导出）
- ✅ “导出为模板”功能 + 模板加载机制（.jctemplate.json）
- ✅ 大文档简单性能预警（>15万字符提示）

**备注**：完整 static-renderer 预览和 OOXML 标准 checkbox 可在 Phase 3 作为增强项。

---

## 4. 详细测试用例设计（示例）

### 4.1 Unit Test 示例（localDocx v2）
```ts
// src/utils/__tests__/localDocx.test.ts
it('should embed two images with correct namespaces and relationships', async () => {
  const json = buildComplexDocWithTwoImages()
  const assets = [...] 
  const bytes = createDocxFromTiptap({ title: '图片测试', json, assets })

  const zip = await JSZip.loadAsync(bytes)
  expect(await zip.file('word/media/image-xxx.png').async('uint8array')).toBeDefined()
  const rels = await zip.file('word/_rels/document.xml.rels').async('string')
  expect(rels).toContain('Target="media/image-')
  expect(rels).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"')

  const docXml = await zip.file('word/document.xml').async('string')
  // 验证 6 个命名空间在根元素声明（或至少正确出现）
  expect(docXml).toContain('xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"')
  // ...
})
```

### 4.2 手工兼容性 Case（最高价值）
**Case ID**: DOCX-FIDELITY-001  
**前置**: 编辑区已打开复杂文档（含全部 P0 元素）  
**步骤**:
1. 点击导出 → DOCX → 保存
2. 分别用 Word / WPS / LibreOffice / Pages 打开
3. 逐项检查附录 A 清单

**预期**：全部 12 项检查点通过（无红色感叹号、无明显格式丢失、图片可见且比例正确）。

---

## 5. 测试环境矩阵

| 维度 | 必须覆盖 | 推荐 |
|------|----------|------|
| **操作系统** | macOS 15 (ARM), Windows 11 | Windows 10, macOS 14 |
| **Office** | Word 365 (Win+Mac), WPS 最新, LibreOffice 最新, Pages 最新 | Word 2019/2021, WPS 旧版 |
| **浏览器（PDF）** | Chrome 最新, Firefox 最新, Safari 最新 | Edge |
| **文档规模** | 小（<5k 字）、中（5-20k）、大（>50k + 20 图） | 极限（10 万字） |

---

## 6. 入口 / 退出 / 暂停准则

**Phase 1 入口**：Phase 0 smoke test + Table 冲突矩阵评审通过  
**Phase 1 退出**：
- 所有 P0 自动化测试通过
- 手工兼容性矩阵 4 软件全部绿
- PDF 打印视觉检查 0 严重分页问题
- 诊断报告功能完整
- 无 P0 回归

**暂停条件**：

- **Phase 0 硬阻断**：generateHTML smoke test 对 **WikiLink** 和 **EditorTable** 两个自定义节点输出均为空、结构丢失或被降级为纯文本，且 `@tiptap/markdown` 同样无法正确处理 → **立即暂停 Phase 1 编码**，重新评估是否放弃官方序列化器、改走全量自定义序列化方案。

- 发现 DOCX 在 2 款以上主流软件中出现结构损坏（表格错位 / 图片不显示 / 命名空间错误导致无法打开）
- PDF 打印出现大量内容溢出或中文乱码

---

## 7. 附录

### 附录 A：多软件 DOCX 视觉保真度手工检查清单（必须签字确认）
（表格形式，12-15 行检查项，包含“通过/失败/备注”列，由测试执行人填写）

### 附录 B：OOXML 命名空间推荐实现方式
用户建议（已纳入 TDD 参考）：
> 推荐在 `document.xml` 根元素统一声明全部 6 个命名空间，避免在 `<a:blip>`、`<pic:pic>` 等子节点上重复内联声明。

示例（推荐写法）：
```xml
<w:document 
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
  ...
</w:document>
```

### 附录 C：测试数据生成器
- `buildComplexDocWithTwoImages()`（包含所有 P0 元素）
- 大文档生成工具（随机长文本 + 图片占位）

---

**本 TDD 完成后下一步**：
1. Phase 0 smoke test 脚本 + Table 矩阵报告评审
2. 补充完整「附录 A 检查清单」表格
3. 在实际编码开始前，测试负责人与开发负责人共同 review 本 TDD 与 SDD 的 traceability

此 TDD 与修订版 SDD 完全对齐，重点强化了 review 指出的 OOXML 复杂性、自定义节点风险和 PDF 技术路线锁定。