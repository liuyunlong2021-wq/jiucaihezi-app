# 附录 A：多软件 DOCX 视觉保真度手工检查清单

**测试文档**：包含 H1/H2/H3、各种 marks、3级列表、任务列表、表格、图片、WikiLink、代码块的复杂文档。

**测试软件**：Word 365 / WPS / LibreOffice / Pages

| 检查项 | 描述 | Word | WPS | LibreOffice | Pages | 备注 |
|--------|------|------|-----|-------------|-------|------|
| 1 | 标题层级正确（字号、加粗） |  |  |  |  |  |
| 2 | 粗体/斜体/下划线/删除线显示正常 |  |  |  |  |  |
| 3 | 无序列表层级正确 |  |  |  |  |  |
| 4 | 有序列表序号正确 |  |  |  |  |  |
| 5 | 任务列表 checked 状态可见 |  |  |  |  |  |
| 6 | 表格结构完整（边框、表头） |  |  |  |  |  |
| 7 | 图片正常嵌入并显示 |  |  |  |  |  |
| 8 | WikiLink 降级为 [[文本]] 可读 |  |  |  |  |  |
| 9 | 代码块等宽字体 + 背景 |  |  |  |  |  |
| 10 | 引用块样式保留 |  |  |  |  |  |
| 11 | 整体排版不乱（分页、缩进） |  |  |  |  |  |
| 12 | 无红色感叹号或损坏提示 |  |  |  |  |  |

**测试人**：___________  
**日期**：___________  
**结论**：□ 通过 □ 有问题（记录在备注）

**额外检查项（Phase 3 增强）**：
- WikiLink 是否清晰显示为 [[文本]]
- 任务列表 checkbox 视觉是否明显
- 大文档导出是否成功（无崩溃）
- 压缩图片是否正常嵌入

**2026-06-02 追加 UX/健壮性批次说明（用户“继续：”7项清单）**：
本轮变更不改核心 DOCX 渲染逻辑（localDocxV2 / static-renderer / 表格结构 / marks 等 P0 矩阵保持），纯属编辑交互 + 导出 UX + 诊断 + 健壮性修复：
- find/replace 确认 JSON-only 安全路径 + toast 反馈一致性
- DragHandle 防窄屏/滚动裁剪
- 按钮 isActive + mso 图标统一（TextAlign/TOC/Details 现激活态可见）
- 诊断报告零内联 + absolute 展开不推布局
- Chunked per-chunk 进度/diag + pdf 状态明确非误导
- Backlinks 优化扫描、Versions 去 window 全局、dropdown + slash 菜单加 click-outside、StarterKit table 显式 false 加强
- 小文档 find/replace 路径安全确认 + 注释
所有变更已通过 type-check + focused tests；fidelity 矩阵（tables/images/wiki/marks/code/details 等）未受影响。
待执行 manual-export-fidelity-verification-guide.md 完整手工（含 4 软件填表）后，本 appendix 表格 + phase3-log 再最终 sign-off。

---

**Phase 3 进度**：清单已创建并扩展。

**执行指引**：请严格按照 `docs/tdd/manual-export-fidelity-verification-guide.md` 中的 Part 3 操作流程进行验证并回填本表格。