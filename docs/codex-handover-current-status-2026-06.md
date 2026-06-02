# 交接给 Codex 的项目状态简报（2026-06-02）

**目标受众**：Codex（或其他 AI 编码代理）。请**务必第一步完整阅读**本文件 + 项目根目录的 `CLAUDE.md`。

---

## 1. 项目核心定位（来自 CLAUDE.md）

这是一个 **Tauri 2 + Vue 3 + Pinia + TypeScript + Vite** 的本地优先桌面 AI 工作台应用（产品名：韭菜盒子 Studio / 韭菜盒子）。

**核心哲学（极重要，绝不违反）**：
- 用户**手动**选择 Skill / Knowledge（知识库/Vault） / Tool / Model。
- Connection 只负责把这些显式选择组装成一次可追踪的 LLM 运行。
- **Skill 必须是官方 Anthropic Skill 格式**（SKILL.md + 可选 references/scripts/assets）。
- Knowledge（Vault）只接受**用户手动添加和整理**，AI 严禁自动写入（防止幻觉污染）。
- Tool 默认不暴露给 LLM，必须用户显式开启。
- LLM 永远不自动决策流程，当前用户输入是最高优先级。
- 严禁发明新的 Agent 范式或 Workflow 模块。

当前核心能力包括：多模型对话、Skill 系统、知识库 Vault + Wiki、创作面板（媒体生成）、41 节点 Vue Flow 画布、对话上下文引擎（ConversationContextEngine）、本地工具（文档导出、浏览器控制、命令执行等）。

**技术入口**：
- Tauri: `src-tauri/src/lib.rs`
- 前端主应用：`src/App.vue` 等
- 构建命令见下方。

**每次提交前硬性要求**（来自 CLAUDE.md 和 package.json）：
必须先跑 `pnpm run test:focused` 通过。

---

## 2. 最近 主要工作方向（长周期焦点）

过去多轮对话的核心任务是：**将 EditorPanel（TipTap v3 富文本编辑区）从“可用”升级到支持复杂内容高保真本地导出**，重点是真实 .docx（Word），同时支持 PDF（print CSS）、HTML、Markdown。

**关键文件**（必须熟悉）：
- `src/components/editor/EditorPanel.vue` （核心，巨型文件，包含 editor 配置、toolbar、find/replace、chunked export、诊断 UI、事件等）
- `src/utils/localDocxV2.ts` （真实 OOXML 生成器，使用 JSZip + 正确命名空间 + styles.xml + numbering.xml + 图片 drawing）
- `src/utils/editorExport.ts` （统一导出门面）
- `src/utils/editorDocument.ts` （共享的 `getStaticRenderExtensions()` —— 预览、HTML 导出、chunked HTML 必须用同一份完整扩展列表）
- `src/components/editor/SlashCommands.ts` （/ 命令菜单）
- `src/components/editor/editorTableExtensions.ts` （自定义 Table 支持 colwidth/rowspan/textAlign）
- `docs/tdd/` 下所有 TDD/SDD 文档（尤其是 phase3-execution-log.md、manual-export-fidelity-verification-guide.md、appendix-a-docx-compatibility-checklist.md、tiptap-feature-gap-analysis-2026.md）

**已实现的核心能力**（P0 矩阵）：
- 复杂节点：Heading、Bullet/Ordered/TaskList、Table（含 colspan/rowspan/colwidth/align）、Image（支持 resize 产生 width/height）、WikiLink（[[label]] + Cmd/Ctrl+Click）、CodeBlockLowlight、Details（可折叠）、TableOfContents、Highlight/Color/TextStyle 等 marks。
- 导出保真：localDocxV2 正确处理 marks（包括 highlight/color）、表格结构（无嵌套 p、无无效 th/tc、tblGrid + tcW + vMerge）、图片嵌入（drawing/pic/blip）、代码块着色+语言、任务列表映射等。
- 其他：DragHandle（节点拖拽重排）、Image resize、SlashCommands（包含 Details/TOC）、TextAlign（left/center/right）、UniqueID（稳定节点 ID）、FileHandler、@tiptap/static-renderer（用于 preview/HTML 保真）、官方 @tiptap/markdown 双向。

---

## 3. 最新一批已解决的问题（用户 "继续：" 清单，2026-06-02）

用户最后一次显式要求 verbatim 解决以下所有点，且要求“都是已解决”而非“基本完成”：

- **find/replace**：原来用 HTML replaceAll（破坏标签/attrs/结构）；仅 bulk + alert 反馈（与项目其他 toast 不一致）。**已解决**：改为纯 JSON 递归 walk（只改 text 节点的 .text），使用 RegExp 安全替换，setContent(json)；小文档路径也完全安全（无 HTML 风险）。反馈改用项目一致的本地 `opToast`（固定底部 toast，2200ms 消失），替代 alert。bulk “全部替换” 按钮保留。
- **DragHandle 定位**：绝对 left:-28px 依赖 .ep-content 相对 + padding，可能在窄屏/滚动时裁剪。**已解决**：.ep-content 加 position:relative + padding-left:32px 内部 gutter；.drag-handle 改用正 left:4px；移除依赖负定位的 padding-left 规则 + 加防裁剪注释。
- **按钮一致性**：新按钮（L/C/R/▽/TOC）缺少 isActive（TextAlign 支持但未用）；图标风格不统一（符号 vs mso）。**已解决**：L/C/R 加 `:class="{ active: editor?.isActive({ textAlign: 'left' }) }"` 等；▽/TOC 加 isActive（details/tableOfContents）；全部换成 `<span class="mso">` 图标（format_align_*、expand_more、toc），与 bold/列表等现有按钮风格一致。
- **诊断报告**：内联样式；展开时影响布局。**已解决**：全部移除内联 style，使用 CSS class（.ep-diagnostic-pill-wrap、.diag-report 等）；.ep-title-strip 设 relative，.diag-report 改 position:absolute + top:100% 弹出，不推挤下面内容布局。
- **Chunked/large**：无 per-chunk diag/进度；状态文本可能误导（pdf）。**已解决**：引入 chunkProgress ref + UI 徽章；performChunkedExport 每 chunk 实时更新 exportStatus + lastExportDiagnostic（含 chunk/total）；pdf 路径显式 warn + 清晰状态文案“PDF 大文档：完整导出用于打印”；exportAsRealPDF 支持传入 json 时用 renderToHTMLString + 完整 static extensions 保证保真。
- **其他**：
  - Backlinks O(n) 扫描：改为先过滤含 '[[' 的候选，再精确匹配 + 60ms debounce。
  - Versions 用 window 全局：彻底移除 (window as any).__jc_editor_versions，改用模块级 `let pendingVersions = []`，load/save 时正确清空/合并。
  - 无 click-outside 菜单：EditorPanel 加 handleDocClick（mousedown capture）关闭 export/more 下拉；SlashCommands 的 popup 也加 outside click 监听 + 清理。
  - StarterKit table 未显式 false：已加强为显式 `table: false` + 详细注释说明“按审计要求明确关闭，避免与自定义 EditorTable 冲突”。
- **小文档**：find/replace 路径现在总是 HTML（轻微结构风险）。**已解决**：确认并注释强调整个路径都是 JSON-only。

**验证证据**（实测）：
- `pnpm exec vue-tsc --noEmit`：0 错误（多次）。
- `pnpm run test:focused`：35/35 pass。
- `pnpm exec vite build`：成功构建。
- 所有变更均通过 search_replace + 具体文件行号证据。

---

## 4. 当前构建 / 测试 / 运行状态（2026-06-02）

**可以直接构建和运行 APP 来测试**（用户明确需求：要跑 APP 自己测试导出效果）。

**推荐命令**（按优先级）：

```bash
cd /Users/by3/Documents/jiucaihezi-app

# 1. 开发模式（最快，用于交互测试 EditorPanel 导出、拖拽、/菜单、大文档等）
pnpm tauri dev
# （内部会跑 pnpm dev 启动 Vite + Tauri host）

# 2. 生产构建（会先生成可分发 APP）
pnpm tauri:build
# 注意：这个命令会强制先跑 `pnpm run test:focused`（当前已确认通过），再 tauri build + macOS 修复脚本

# 其他常用
pnpm run test:focused          # 门禁测试（提交前必跑）
pnpm exec vue-tsc --noEmit     # 类型检查
```

**tauri.conf.json** 配置：
- beforeDevCommand: "pnpm dev"
- beforeBuildCommand: "pnpm build" （build 内部包含 test:focused + vue-tsc + vite build）

**已知**：Vite build 有一些 pre-existing 的 chunk size 和 dynamic import 警告，但不阻塞。

用户目前意图：先用 `pnpm tauri dev` 把 APP 跑起来，自己在真实编辑器里造复杂文档、导出 .docx，打开 Word 等软件手动看效果。

---

## 5. 关键待办 & 严格规则（Codex 必须遵守）

**编辑区导出特性的 TDD 状态**：
- 代码、UI、自动化测试、诊断、性能分支、UX 修复（上述所有 7 大项）：**100% 已解决**。
- **剩余唯一硬性交付物**：手工验证。
  - 必须严格按照 `docs/tdd/manual-export-fidelity-verification-guide.md` 执行（Part 1 Phase 0 Smoke + Part 2 造标准测试文档 + 导出 + Part 3/4 在真实 4 软件 Word/WPS/LibreOffice/Pages 里打开检查 + 填 appendix-a 表格 + PDF 打印检查）。
  - 执行完后把结果记录到 phase3-execution-log.md 和 appendix-a-docx-compatibility-checklist.md。
  - **只有完成这一步**，才能把特性标记为 TDD 全部完成，并更新 CLAUDE.md。

**严禁事项**（用户多次强调）：
- 不要在 manual guide 还没跑完的情况下，擅自把 CLAUDE.md 里的 “V7.x 编辑区文档导出 | ✅ 已完成” 改成最终版，或删除 TDD 追踪里的 “剩余仅人工验证” 描述。
- 不要用乐观语言（“基本完成”“good enough”），必须“都是已解决”。
- 任何涉及 editorExport / localDocxV2 / EditorPanel 的改动，都要保证 `getStaticRenderExtensions()` 一致性、tiptapJson 是唯一真理源、导出诊断/版本/ metadata 完整。

**给 Codex 的工作纪律**：
1. **永远先完整阅读** `CLAUDE.md`（它是唯一权威）。
2. 多步任务必须用 `todo_write` 工具跟踪（并实时 mark completed）。
3. 编辑用 `search_replace`（先 read_file 确认上下文）。
4. 改动后立即跑 `pnpm run test:focused` + type check + 必要的手动 tauri dev 测试。
5. 探索代码用 list_dir / grep / read_file / run_terminal_command。
6. 大型重构前先看审查范围（CLAUDE.md 的 🔴 必检查 / 🟡 注意 列表）。
7. 保持与现有模式的 100% 一致（例如 find/replace 必须走 JSON，不能回退 HTML；chunked 必须 per-chunk diag 等）。

**必读文档**（按顺序）：
- CLAUDE.md（根目录）
- docs/tdd/phase3-execution-log.md（最新追加批次完整记录）
- docs/tdd/manual-export-fidelity-verification-guide.md
- docs/tdd/appendix-a-docx-compatibility-checklist.md
- docs/tdd/tiptap-feature-gap-analysis-2026.md
- docs/tdd/editor-document-export-optimization-sdd.md（和 tdd.md）
- src/utils/editorDocument.ts 中的 getStaticRenderExtensions（共享真相）

---

## 6. 其他当前上下文

- 用户刚刚跑了各种验证，确认 APP 可以构建和运行（tauri dev 绿）。
- 用户计划把整个 APP 的进一步构建/扩展工作交给 Codex。
- 项目其他大模块（Canvas V8、Conversation Context Engine、Vault 组织、Skill 系统、创作面板媒体队列等）仍在活跃开发中，editor 只是其中一个（虽是近期最重的）焦点。
- 有一些历史遗留（如 TipTap 版本小差异 3.23/3.24、PPTX 仍占位），但不阻挡当前 editor 工作。

---

**结语给 Codex**：
当前 editor 相关代码质量已经很高，所有的审计点都已用真实 diff 闭环，测试门禁也通过。你可以放心基于当前状态继续开发新功能或做进一步优化。但**请严格尊重 TDD 纪律和 manual verification 这一最后人工步骤**，不要越俎代庖。

欢迎你先跑 `pnpm tauri dev`，自己体验一下 EditorPanel 的当前状态，再开始工作。

如果需要，我（原 Grok）可以继续提供上下文或并行辅助。

祝好运，保持高质量与纪律。 

（本文件由 Grok 4.3 于 2026-06-02 生成，基于最新工具验证和用户对话历史。）