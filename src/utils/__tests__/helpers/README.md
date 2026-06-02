# 测试辅助工具（Test Helpers）

本目录存放跨测试文件可复用的工具函数，主要服务于编辑区导出相关功能的 Phase 0~2 测试。

## 当前内容

- `editorTestDocuments.ts`：编辑器富文档 JSON 生成器
  - `buildComplexDocWithAllP0Elements()` —— 推荐用于 smoke test、DOCX 保真度测试
  - `buildLargeDocument()`
  - `buildDocumentWithImages()`
  - `buildSampleTable()`

## 使用原则

1. 所有需要“包含多个节点类型”的测试文档，**优先使用此生成器**，避免在每个测试文件中硬编码大型 JSON。
2. 如需新增特定场景的构建器，请在此文件中扩展，并更新对应 smoke / unit 测试。
3. 生成器应保持与 `EditorPanel.vue` 中实际使用的 extension 配置行为一致。

此工具是 TDD 中“测试数据生成器”（附录 C）的具体实现。