# Phase 0 交付物：EditorTable 同名节点冲突矩阵报告

> **关联**：SDD v2 + TDD v2  
> **日期**: 2026-06-02  
> **状态**: 待评审  
> **目的**：对比当前自研 `EditorTable*` 节点与官方 `@tiptap/extension-table`，评估引入 `@tiptap/html` / `@tiptap/markdown` 后的兼容性风险，并给出明确的技术决策建议。

---

## 1. 背景

项目当前使用完全自定义的表格节点（`src/components/editor/editorTableExtensions.ts`）：

- `EditorTable` (name: `'table'`)
- `EditorTableRow` (name: `'tableRow'`)
- `EditorTableCell` (name: `'tableCell'`)
- `EditorTableHeader` (name: `'tableHeader'`)

这些节点 **名称与官方 `@tiptap/extension-table` 完全相同**。

在 Phase 0 smoke test 中，如果决定引入 `@tiptap/html` 或 `@tiptap/markdown`，官方包内部很可能对这些标准节点名有特殊处理逻辑，这会带来兼容性风险。

---

## 2. 对比矩阵

| 维度                    | 当前自研 EditorTable*                                                                 | 官方 @tiptap/extension-table (v3)                                                                 | 冲突风险等级 | 对 generateHTML 的影响 | 对 DOCX 导出的影响 | 编辑 UX 影响 |
|-------------------------|---------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|--------------|------------------------|--------------------|--------------|
| **节点名称**            | `'table'`, `'tableRow'`, `'tableCell'`, `'tableHeader'`                              | 完全相同                                                                                          | **高**       | 中高                   | 高                 | - |
| **content 规则**        | `table`: `tableRow+`<br>`tableRow`: `(tableCell\|tableHeader)*`<br>`cell`: `block+` | 更严格，通常要求 `tableRow` 必须包含至少一个 cell，且对 header/cell 有更明确的结构约束             | 中           | 高（可能导致 HTML 结构不标准） | 高（DOCX 序列化器需适配） | 低 |
| **addAttributes**       | 仅 `colspan` / `rowspan`（简单 parseHTML）                                           | 额外包含 `colwidth`（数组，用于列宽拖拽）、`backgroundColor` 等                                   | 高           | 高                     | 中（colwidth 在 DOCX 中可映射为列宽） | **高**（官方支持列宽拖拽） |
| **parseHTML**           | 基础 tag 匹配 + 简单属性解析                                                         | 更完善的表格结构解析，支持 colgroup、colgroup 宽度等                                              | 中           | 中                     | 中                 | 中 |
| **renderHTML**          | 简单输出 `<table class="editor-table"><tbody>...</tbody></table>`                   | 默认输出更标准的 HTML 结构（可能包含 `<colgroup>`、特定 class、style）                             | 中           | **高**（直接影响 HTML 保真度） | 中                 | 中 |
| **isolating**           | 全部设为 `true`                                                                       | 官方实现中 table 通常也是 isolating，但内部处理更复杂                                             | 低           | 低                     | 低                 | 低 |
| **额外能力**            | 无                                                                                    | 支持列宽拖拽、右键菜单增删行列、单元格合并/拆分（需配合 Table extension 的 commands）             | -            | -                      | -                  | **高**（当前编辑器表格功能极弱） |
| **与 StarterKit 的关系**| 完全绕过 StarterKit 的 table 配置                                                     | 官方推荐通过 `StarterKit.configure({ table: false })` 后手动注册官方 Table 扩展                     | 中           | 高                     | 高                 | 高 |

---

## 3. 关键风险点总结

1. **generateHTML 兼容性风险最高**  
   官方 `@tiptap/html` 的 `generateHTML` 在处理标准节点名时，可能会使用内部注册的 `Table` 扩展的 `renderHTML` 逻辑，而不是我们自定义的版本。这可能导致：
   - 自定义的 `class="editor-table"` 丢失
   - tbody 结构被改变
   - 属性处理不一致

2. **DOCX 导出适配成本**  
   如果未来要用官方 HTML 作为 DOCX 导出的中间格式，自定义表格的 renderHTML 输出结构必须和官方保持一致，否则需要为自定义表格单独写一套 DOCX 序列化逻辑。

3. **长期编辑体验债务**  
   当前表格功能非常基础（仅能通过 toolbar 插入 3x3）。如果一直用自定义节点，很难享受官方 Table 扩展带来的列宽拖拽、合并单元格等成熟能力。

---

## 4. 推荐方案（Phase 0 决策建议）

**推荐采用方案 B（迁移官方 Table 扩展）**，理由如下：

**优点**：
- 最大化利用 `@tiptap/html` 和 `@tiptap/markdown` 的能力，减少自定义序列化器维护成本。
- 一次性解决表格在 generateHTML 中的不确定性。
- 为未来编辑器表格功能升级（列宽、合并等）铺路。
- 官方 Table 在 v3 中已经相当成熟且维护良好。

**缺点与迁移成本**：
- 需要修改所有已有文档的 `tiptapJson`（历史数据迁移）。
- 需要更新 `EditorTable*` 的注册方式（从自定义 Node 改为官方扩展）。
- 需要更新样式（`.editor-table` class 可能需要保留或映射）。
- 需要为旧 JSON 提供兼容层或一次性迁移脚本。

**备选方案 A（保持自定义 + 专属适配器）**：
- 短期风险最低，零破坏现有文档。
- 但会永久背负“自定义表格序列化器”这个技术债务，未来每当想用官方 HTML/Markdown 能力时都要额外适配。

**建议决策**：
在完成 `generateHTML` smoke test 后，如果 smoke test 显示自定义表格节点在官方 generateHTML 中表现不佳，则**直接选择方案 B**，并在 Phase 1 早期规划迁移策略和数据兼容方案。

---

## 5. 仍需验证的点（待 smoke test 后补充）

- [ ] 临时安装 `@tiptap/extension-table` 后，实际运行 `generateHTML` 对当前自定义 table JSON 的输出效果。
- [ ] 官方 Table 的默认 renderHTML 输出结构是什么样的（是否包含 colgroup 等）。
- [ ] 官方 Table 是否也使用 `tableRow` / `tableCell` / `tableHeader` 这些子节点名（确认是否会产生名称冲突）。

---

## 6. 下一步行动

1. 运行 `tiptap-generate-html-smoke.ts`（已就绪）。
2. 根据 smoke test 实际输出结果，更新本矩阵的「实际表现」列。
3. 团队评审后正式确定采用方案 A 还是方案 B。
4. 将最终决策写入 SDD / TDD 修订版。

---

**报告负责人**：（待填写）  
**评审日期**：（待填写）  
**最终决策**：方案 A / 方案 B（待圈选）