# 交接 bianji 支线 — 编辑区读写磁盘文件 + 变更审查当文件树

> **日期**：2026-06-26
> **交接给**：`bianji` 支线（编辑区 & 变更审查官方对齐）
> **来源**：`gongju` 支线（知识库内循环）
> **关联 SDD**：`docs/sdd/bianji-editor-diff-full-alignment.md`（bianji 主 SDD）、`docs/sdd/knowledge-base-inner-loop-sdd.md`（gongju 知识库 SDD）

---

## 0. 一句话

bianji 支线要做"diff 行 → 编辑区定位"，但有一个**隐藏前提没被发现**：当前编辑区只能打开 SQLite `documents` 表里的文档，**打不开磁盘上的 `.md` 文件**。而知识库（vault）全是磁盘文件。所以"diff → 编辑区"对磁盘 vault 文件是断的。这座桥必须补，且应并进 bianji 支线，因为它正是 bianji 目标 3 的真正前提。

---

## 1. 核心架构漏洞（必须先理解）

### 1.1 当前是"两个世界"

```
claude-obsidian / OpenCode 写 → 磁盘 vault/*.md      ┐
                                                       ├─ 不互通
编辑区 EditorPanel 读/写       → SQLite documents 表  ┘
变更审查 ReviewPanel diff      → 磁盘文件（OpenCode git/snapshot）
```

### 1.2 证据

| 事实 | 位置 |
|------|------|
| 编辑区文件来自 SQLite | `src/composables/useFileStore.ts` 注释："统一文件存储层（IndexedDB documents store）"，`STORE = 'documents'` |
| `open-in-editor` 只认 `fileId`（SQLite 主键） | `src/components/editor/EditorPanel.vue:403-436`，收到 `payload.fileId` → `fileStore.getFile(fileId)` → 取 `metadata.tiptapJson` |
| 反向链接也只在 documents 表找候选 | `EditorPanel.vue:142 refreshBacklinks()` |
| 变更审查 diff 读磁盘真实路径 | `ReviewPanel.vue:62 resolveDiffFilePath()`，点行 emit `open-diff-in-editor` 带 `filePath`（磁盘路径） |

### 1.3 后果

- AI 在磁盘 vault 建了 `角色/萧炎.md`，用户想在编辑区改 → **打不开**（编辑区不认磁盘路径）。
- 变更审查能看到 diff（读磁盘），但点 diff 行 emit 的 `open-diff-in-editor` 带的是磁盘 `filePath`，而 `open-in-editor` 处理逻辑只认 `fileId` → **跳转落空 / 串到错误文档**。

---

## 2. 要补的桥（bianji 支线任务）

让编辑区获得"**读写磁盘任意 `.md` 文件**"的能力。三件事：

### 任务 A：`open-in-editor` / `open-diff-in-editor` 支持磁盘路径

`EditorPanel.vue:403` 的 `open-in-editor` handler 增加分支：

```
if (payload.filePath) {
  // 磁盘文件路径分支（新）
  const raw = await readTextFileFromDisk(payload.filePath)   // Rust invoke 或 plugin-fs
  const doc = markdownToTiptapDoc(raw)                        // 复用已装的 @tiptap markdown 扩展
  editor.value.commands.setContent(doc)
  currentFilePath.value = payload.filePath                    // ★ 新增：记录磁盘来源
  currentFileId.value = null                                  // 不是 SQLite 文档
} else if (payload.fileId) {
  // 现有 SQLite 分支（保持不变）
}
```

注意：`ReviewPanel.vue:179` 已经在 emit `open-diff-in-editor` 时带了 `filePath` / `lineNumber`，bianji 的"diff 行 → 编辑区定位"应统一走这个磁盘路径分支，并用 `lineNumber` 滚动定位。

### 任务 B：保存时按来源写回

编辑区保存逻辑要分流：

```
if (currentFilePath.value) {
  // 磁盘来源 → tiptap 转 markdown → 写回磁盘那个路径
  const md = tiptapDocToMarkdown(editor.value.getJSON())
  await writeTextFileToDisk(currentFilePath.value, md)
} else if (currentFileId.value) {
  // SQLite 来源 → 现有逻辑（saveExistingEditorFile）
}
```

这样改完即落盘，vault 文件始终是磁盘上的真相，不复制进 SQLite。

### 任务 C（可选，本期可不做）：磁盘 vault 文件树

真正的"像 Obsidian 一样浏览整个 vault 目录树"。当前文件树（`src/components/filetree/`）读的是 `documents` 表的 category，不是磁盘 vault。这个工作量较大，**第一版可以不做**——gongju 支线决定先用"变更审查当文件树"兜底（见 §3）。bianji 若有余力可顺手做一个磁盘目录树面板。

---

## 3. gongju 支线的临时决定：变更审查当文件树

在任务 C（磁盘文件树）落地前，gongju 支线决定**用变更审查面板（ReviewPanel）代替文件树**。

- **能力边界**：ReviewPanel 只显示"变更过的文件"（`turnDiffs` 本轮 + `vcsDiffs` Git），**不显示 vault 全部文件**。
- **为什么够用**：知识库日常 90% 是"AI 刚写了东西 → 去看/改它"，正好命中变更审查场景。
- **依赖**：点变更审查里的文件 → 编辑区要能从磁盘打开 → **依赖任务 A**。所以任务 A 是 gongju 内循环闭合的硬依赖，优先级最高。

---

## 4. 验收标准

1. 在变更审查（或任意地方）点一个磁盘 `.md` 文件 → 编辑区能正确加载其 markdown 内容。
2. 在编辑区改这个磁盘文件 → 保存 → 磁盘上该 `.md` 文件内容真的变了（不是写进 SQLite）。
3. 点 diff 某一行 → 编辑区打开该磁盘文件并滚动到对应行。
4. 不破坏现有 SQLite 文档（`category: 'text'/'canvas'` 等）的打开/保存。

---

## 5. 验证命令

```bash
pnpm exec vue-tsc -b
pnpm exec vite build
pnpm run test:focused:run
```

涉及 Rust 读写磁盘命令时：

```bash
cd src-tauri && cargo check
```

---

## 6. 关键文件清单

| 文件 | 改什么 |
|------|------|
| `src/components/editor/EditorPanel.vue` | `open-in-editor` handler 加磁盘路径分支；保存逻辑按 `currentFilePath` vs `currentFileId` 分流 |
| `src/components/chat/ReviewPanel.vue` | 已 emit `open-diff-in-editor` 带 filePath/lineNumber，确认对齐磁盘分支 |
| `src-tauri/src/lib.rs` | 若无现成命令，加 `read_text_file` / `write_text_file`（限制在 vault/项目目录 scope 内） |
| `src-tauri/capabilities/default.json` | 确认 `fs:allow-read-text-file` / `fs:allow-write-text-file` 已放行 vault 路径 scope |

---

## 7. 安全边界

- 磁盘读写必须校验路径，限制在当前 vault / project directory 语义内，禁止路径穿越。
- 不要把磁盘文件内容再镜像进 SQLite documents 表（避免回到"两个世界"，也避免 1.34GB OOM 债务复发）。
