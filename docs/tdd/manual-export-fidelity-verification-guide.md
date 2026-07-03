# Editor 导出保真度手工验证操作手册（TDD 剩余项）

**目的**：完成 TDD 1.1 核心成功标准 + Phase 1 退出条件中所有“手工必做”部分，使整个“编辑区文档导出优化”特性达到 TDD 定义的“全部完成”状态。

**当前状态（2026-06-02 最新）**：
- 代码、自动化测试、UI、门禁、准备工作：100% 已就位（含用户最新 "继续：" 7 大项 + 子项全部已解决：find/replace JSON+toast、DragHandle 防裁剪、按钮 isActive+图标统一、diag 无内联+abs 布局、chunk per-diag+pdf 状态、backlinks/versions/click-outside/table:false、小文档安全确认）
- 手工验证（4 软件视觉检查 + PDF 分页 + Smoke 报告）：尚未执行

执行完本手册后，即可将特性标记为 TDD 全部完成，并更新 CLAUDE.md。
**注意**：本轮 "继续" 清单为 UX/健壮/一致性批次，P0 保真度矩阵（表格/图片/wiki/marks/代码/Details/TOC 等）未变动，验证重点仍按 Part 1-5 执行。

---

## 准备工作（一次性）

```bash
cd /Users/by3/Documents/jiucaihezi-app

# 1. 确保依赖最新
pnpm install

# 2. （可选但推荐）启动桌面版，便于真实导出测试
pnpm tauri dev
```

**推荐**：同时打开一个终端用于跑 smoke 测试，另一个运行 `tauri dev` 用于手动验证。

---

## Part 1: Phase 0 Smoke Test（最先执行，5 分钟）

这是 TDD Phase 0 的硬性交付物，必须生成带结论的报告。

```bash
# 1. 安装临时依赖（验证完可删除）
pnpm add -D @tiptap/html

# 2. 运行 smoke 测试
npx tsx src/utils/__tests__/smoke/tiptap-generate-html-smoke.ts
```

**执行后操作**：
1. 完整复制终端输出。
2. 新建文件 `docs/tdd/phase0-generatehtml-smoke-report.md`，把输出完整粘贴进去。
3. 在文件末尾补充一句结论（脚本已自动给出）：
   - “✅ 所有关键节点可走 generateHTML” 或 “⚠️ 需为 WikiLink / Table 准备自定义兜底”。
4. 提交该报告作为 Phase 0 交付物。

---

## Part 2: 在真实 EditorPanel 中创建标准测试文档

目标文档必须包含 TDD 定义的所有 P0 元素（使用 `buildComplexDocWithAllP0Elements` 生成器定义的内容）。

### 推荐方式 A：手动快速构建（最可靠，无需改代码）

在正在运行的编辑器中按以下顺序依次插入：

1. **标题**：输入 `# Phase 0 完整保真度测试文档`（H1）
2. **Marks 段落**：输入一段文字，分别设置：
   - 加粗（**加粗文本**）
   - 斜体（*斜体文本*）
   - 下划线
   - 删除线
   - 高亮（黄色）
3. **WikiLink**（2 个）：
   - 输入 `[[需求规格说明书]]`
   - 输入 `[[技术架构文档]]`
4. **表格**：插入 3 列 3 行的表格，表头填“列1/列2/列3”，内容填 R1C1 等。
5. **任务列表**：
   - 插入任务列表
   - 第一项打勾（已完成的需求评审）
   - 第二项不打勾（待完成的开发任务）
   - 第三项做成嵌套子任务
6. **图片**（2 张）：
   - 上传或粘贴任意两张图片（至少一张 > 500KB，测试真实嵌入）
7. **引用块**：输入 `> 这是一个引用块，用于测试导出中的引用格式保留。`
8. **水平线**：输入 `---`
9. **代码块**：
   - 插入代码块，语言选 TypeScript
   - 内容：
     ```ts
     const x: number = 42;
     console.log("Phase 0 smoke test");
     ```

保存文档（Cmd/Ctrl + S），标题建议设为 `Phase0-保真度测试-完整版`。

### 推荐方式 B：控制台一键注入（开发者最快）

在 `tauri dev` 打开的编辑器页面，按 F12 打开 Console，粘贴执行以下代码：

```js
// 一键注入 TDD 标准完整测试文档（含图片、WikiLink、任务列表、表格等）
(async () => {
  const editorEl = document.querySelector('.ProseMirror');
  if (!editorEl) { alert('未找到编辑器'); return; }

  // 尝试通过 Vue 实例获取 editor（常见方式）
  const vueApp = document.querySelector('#app')?.__vue_app__;
  // 如果上面不行，手动在 EditorPanel 里临时加 window.__currentEditor = editor; 后再运行

  alert('请在 EditorPanel.vue 里临时暴露 editor 实例后再试，或使用手动构建方式');
})();
```

> **提示**：如果想用方式 B，最简单是在 `EditorPanel.vue` 的 `onMounted` 里临时加一行：
> `window.__tiptapEditor = editor;`
> 然后刷新页面，用 `window.__tiptapEditor.commands.setContent(...)` 注入 `buildComplexDocWithAllP0Elements()` 的 JSON。

---

## Part 3: DOCX 导出 + 4 软件视觉保真度检查（核心）

### 导出步骤

1. 在刚创建的标准测试文档中，点击工具栏右上角 **下载图标**。
2. 选择 **Word (.docx)**。
3. 确认保存位置，导出成功后查看诊断报告（应自动出现彩色 pill，失败时自动展开）。

### 4 软件验证流程

分别用以下软件打开刚导出的 `.docx` 文件，逐项对照 **Appendix A 检查清单** 打勾：

**必须验证的 4 款软件**（TDD 明确要求）：
- Microsoft Word（推荐最新版 365，Windows + macOS 都最好各试一次）
- WPS Office（最新版）
- LibreOffice Writer（最新版）
- Apple Pages（macOS）

**每款软件重点检查点**（对应 Appendix A）：

| 检查项 | 具体看什么 | 通过标准 |
|--------|------------|----------|
| 标题层级 | H1/H2/H3 字号、加粗是否正确 | 层级清晰，字号递减 |
| Marks | 粗体/斜体/下划线/删除线/高亮 | 视觉效果明显、无丢失 |
| 列表 | 3 级嵌套缩进 + 序号 | 缩进正确，序号连续 |
| 任务列表 | checkbox 状态 | checked 的要显示打勾或选中状态 |
| 表格 | 3x3 表格、表头、边框 | 结构完整、无错位、无丢失单元格 |
| 图片 | 两张图片是否可见、比例正确 | 清晰嵌入，非外部链接或占位符 |
| WikiLink | [[需求规格说明书]] | 显示为可读的 [[文本]]，无红色错误 |
| 代码块 | 等宽字体 + 背景 | 保留代码格式 |
| 引用块 | 引用样式 | 有明显引用缩进或样式 |
| 整体排版 | 分页、间距、是否乱 | 无明显溢出、错位、内容丢失 |
| 损坏提示 | 是否有红色感叹号 | 无任何损坏提示 |
| 打开稳定性 | 能否正常打开保存 | 无崩溃、无“修复文档”提示 |

**记录方式**：
- 直接在 `docs/tdd/appendix-a-docx-compatibility-checklist.md` 表格里填写对应列（Word / WPS / LibreOffice / Pages）。
- 重要问题写在“备注”列。
- 最后填写测试人、日期、总体结论（通过 / 有问题）。

---

## Part 4: PDF 打印验证

1. 在同一个标准测试文档中，点击下载 → 选择 **PDF**。
2. 浏览器会弹出打印对话框。
3. **必须操作**：
   - 选择“另存为 PDF”（不要直接打印）
   - 纸张：A4
   - 边距：默认或自定义
4. 保存后用 PDF 阅读器打开，逐页检查：

**PDF 必须验证项**（TDD 要求）：
- 代码块、表格、图片是否被截断（应有 `page-break-inside: avoid` 保护）
- H1/H2 标题是否出现在页底被切断
- 中文是否乱码
- 图片是否溢出边界
- 整体是否清晰、高对比（尤其是暗色主题下）
- 页码是否正常（如果加了）

把问题记录在 `phase3-execution-log.md` 或单独的 PDF 验证笔记里。

---

## Part 5: 记录与归档（完成标志）

执行完以上所有步骤后，按顺序做：

1. **更新 Appendix A**：
   - 把所有 4 软件的检查结果填满表格
   - 填写测试人、日期、结论

2. **更新 Phase 3 执行日志**：
   ```bash
   # 编辑 docs/tdd/phase3-execution-log.md
   ```
   把 Item 5 状态从“准备就绪”改为：
   > ✅ **已解决**（人工验证完成）  
   > 日期：2026-xx-xx  
   > 4 软件全部通过 / 存在以下问题：...

3. **（可选但推荐）** 把 smoke 报告、Appendix A 填好的版本、PDF 截图等一起提交。

4. **通知**：完成后直接告诉我“我已完成手工验证”，我会帮你：
   - 最终更新 `phase3-execution-log.md` 结论
   - 更新 `CLAUDE.md`，正式记录该特性按 TDD 全部交付

---

## 完成后的标志

当以下全部满足时，即可认为“根据 TDD 全部完成”：

- [ ] Phase 0 Smoke Test 报告已生成并评审
- [ ] Appendix A 4 软件检查表格全部填写且有结论
- [ ] PDF 打印视觉检查已做，问题已记录
- [ ] `pnpm run test:focused` 持续通过
- [ ] 无 P0 回归

执行完上面 checklist 后，这个特性就真正达到了 TDD 要求的交付标准。

---

**需要我现在帮你做任何辅助吗？**
- 临时给 EditorPanel 加一个“一键加载 Phase0 测试文档”按钮？
- 生成一份更短的“打印版 checklist”？
- 其他任何执行辅助？

直接说即可。执行完后随时回来更新状态。