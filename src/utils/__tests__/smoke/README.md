# Phase 0 Smoke Tests

本目录存放 Phase 0（准备与验证阶段）的高风险前置验证脚本。

## 当前脚本

### tiptap-generate-html-smoke.ts

**目的**：验证 `@tiptap/html` 的 `generateHTML` 在本项目自定义节点（尤其是 `wikiLink` 和 `EditorTable*`）下的实际表现。

**运行步骤**：

```bash
# 1. 临时安装依赖（Phase 0 验证完成后可移除）
pnpm add -D @tiptap/html

# 2. 运行 smoke test
npx tsx src/utils/__tests__/smoke/tiptap-generate-html-smoke.ts
```

**输出内容**：
- 生成的 HTML 片段
- 逐节点判定矩阵（严格按照 TDD v2 定义的通过标准）
- 明确给出“可走官方序列化器”还是“必须自定义兜底”的结论

**重要性**：
此脚本的结论将直接决定后续是否引入 `@tiptap/html` / `@tiptap/markdown`，以及需要为哪些节点编写自定义序列化逻辑。

**评审要求**：
运行结果 + 分析结论必须在进入 Phase 1 编码前完成评审。

---

## 配套工具

### 测试文档生成器

位置：`src/utils/__tests__/helpers/editorTestDocuments.ts`

提供以下可复用函数：

- `buildComplexDocWithAllP0Elements()` — 生成包含 TDD 定义的所有 P0 关键节点（H1-3、各种 marks、WikiLink、Table、TaskList、Image 等）的标准测试文档。
- `buildLargeDocument(count)` — 用于性能/长文档测试。
- `buildDocumentWithImages(count)` — 图片嵌入专项测试。

**推荐**：所有 smoke test、localDocx v2 测试、PDF 测试都应尽量使用此生成器，避免硬编码 JSON。

运行后请将控制台完整输出保存为 `phase0-generatehtml-smoke-report.md`，作为 Phase 0 交付物之一。