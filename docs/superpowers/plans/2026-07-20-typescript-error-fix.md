# 全仓 TypeScript 错误修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清除当前 `vue-tsc -b` 的 16 个错误，保持现有产品行为不变。

**Architecture:** 错误来自运行时数据和 TypeScript 声明不同步。修改仅在数据边界处恢复正确的类型信息：复制二进制数据以获得标准 `ArrayBuffer`、收窄已验证的值、补齐穷尽映射。不会引入新状态、网络请求或存储路径。

**Tech Stack:** Vue 3、TypeScript 6、Pinia、Tauri 2、Node test。

---

### Task 1: 修复创作面板二进制与动态字段类型

**Files:**

- Modify: `src/components/creation/CreationPanel.vue:271,396-435,722`
- Test: `src/components/__tests__/creationPanelContractUi.test.ts`

- [x] 将项目二进制数据复制进新的 `Uint8Array`，再把 `bytes.buffer` 传入 `Blob`；两个 Web 预览路径均使用相同的安全复制方式。
- [x] 将 `pickAiAppMediaFile` 参数声明为 `CreationFieldSpec`，使用 Tauri 单选对话框返回的字符串路径。
- [x] Run: `pnpm exec vue-tsc -b`
- [x] Expected: 这五处 CreationPanel 类型错误消失。

### Task 2: 修复文件树异步空值与生命周期事件类型

**Files:**

- Modify: `src/components/filetree/ProjectFileTree.vue:371-384,488-505`
- Test: `src/components/filetree/__tests__/projectFileTreeCanvas.test.ts`

- [x] 在每次异步目录加载前保存当前节点的非空引用，再从该引用寻找子节点。
- [x] 将批量画布生命周期事件标注为 `'canvas:before-rename' | 'canvas:before-delete'`。
- [x] Run: `pnpm exec vue-tsc -b`
- [x] Expected: 文件树的五处类型错误消失，现有画布生命周期合同仍通过。

### Task 3: 补齐创作模型的 ZX 标签

**Files:**

- Modify: `src/runtime/creation/creationMediaPlan.ts:19-28`
- Modify: `src/runtime/creation/creationModelRegistry.ts:501-528`
- Test: `src/runtime/creation/__tests__/creationMediaPlan.test.ts`

- [x] 在提交摘要、面板摘要和徽标的现有标签表中加入 `zx: 'ZX'`。
- [x] Run: `pnpm exec vue-tsc -b`
- [x] Expected: `CreationUpstreamFamily` 的三个穷尽映射恢复完整，ZX 模型的显示文本不为空。

### Task 4: 修复项目服务与插件 Store 的数据契约

**Files:**

- Modify: `src/services/projectFileService.ts:401-405,494-504`
- Modify: `src/stores/pluginStore.ts:57-67`
- Test: `src/services/__tests__/projectFileService.test.ts`
- Test: `src/stores/__tests__/pluginStore.test.ts`

- [x] 将批量冲突过滤收窄为 `ProjectBatchConflict` 的非空 `target` 交集，不改变冲突筛选条件。
- [x] 在 Web 二进制导入时复制到标准 `ArrayBuffer` 后创建 Blob。
- [x] 将只读的目录 `tags` 复制为 Store 所需的可变数组。
- [x] Run: `pnpm exec vue-tsc -b`
- [x] Expected: 项目服务和插件 Store 的三处类型错误消失。

### Task 5: 完整验证

**Files:**

- Modify: `docs/wiki/开发/全仓TypeScript错误修复方案-2026-07-20.md`

- [x] 运行关联 focused tests。
- [x] 运行 `pnpm exec vue-tsc -b`，预期退出码 0。
- [x] 运行 `pnpm exec oxfmt --check`、`pnpm exec oxlint` 和 `git diff --check`，只报告与本次无关的既有警告。
- [x] 将验证结果补入 Wiki 方案文档。
