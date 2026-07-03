# Codex 交接文档：Skill 范围漂移后的恢复说明

日期：2026-06-04

## 目的

这份文档交给后续接手的 Codex / 开发者使用。当前仓库出现了范围漂移：原本用户要求重点处理 Skill，但实现过程中把 Skill、知识库、创作面板、工具运行层、RunningHub、主页等内容混在一起修改和提交。

后续恢复时不要直接 `reset --hard`，也不要盲目整体 revert。应先保护用户真实数据，再按模块拆分审查。

## 必须先做的事

1. 先备份用户真实应用数据，尤其是 SQLite：
   - `~/Library/Application Support/com.jiucaihezi.desktop/data/jiucaihezi.db`
2. 不要先运行迁移、不要先启动 App 做写入测试。
3. 先审查代码 diff，再决定是否恢复知识库相关文件。

## 范围漂移提交

主要风险提交：

- `74da554 feat: stabilize core studio runtime`

这个提交不是单纯 Skill 提交，包含以下范围：

- Skill Creator / Skill Builder / Skill Material Compiler
- 本地工具 runtime：`src/runtime/tools/*`
- 对话上下文：`src/runtime/conversationContext/*`
- 知识库链路：`vault*`、`useBrain.ts`、`useVaultCompiler.ts`
- 创作面板 / 媒体生成：`media-generation.ts`、`creationModels.ts`、`CreationPanel.vue`
- RunningHub / rh-adapter / gateway
- 主页 landing / DMG / logo 相关文件
- 画布、设置、文件树、编辑器等 UI/运行层文件

文档提交：

- `61bf7c4 docs: update studio handoff state`

这个提交只更新 `CLAUDE.md`。

## 用户认可的知识库目标架构

恢复知识库时应以用户明确认可的这套架构为准：

```text
用户手动上传/添加资料
→ raw source layer
  原文件进 raw/原始文件/
  ToMD 后进 raw/转换后的MD/

→ corpus index layer
  buildVaultChunks()
  生成 chunkId / chunkHash / sourcePath / anchor / headingPath

→ wiki knowledge layer
  buildVaultWikiPlan() / compileRawToWiki()
  生成有正文、有 sources、有 sourceChunks 的 Wiki

→ retrieval planning layer
  buildVaultEvidencePlan()
  识别本轮意图，先选 Wiki，再顺着 sourceChunks 回查 raw chunk

→ runtime evidence layer
  recallKnowledgeWithTrace()
  注入 user-side evidence/context，模型只读使用，不自动写 Vault
```

硬原则：

- 知识库只接受用户手动添加。
- LLM 不自动写入 Vault。
- runtime 只能只读召回 evidence/context。
- 不新增“作品文档”或自动沉淀层。
- 不改变现有 UI，除非用户明确要求。

## 知识库相关高风险文件

这些文件在范围漂移提交中被修改过，恢复时优先审查：

- `src/composables/useBrain.ts`
- `src/composables/useVaultCompiler.ts`
- `src/components/brain/BrainPanel.vue`
- `src/utils/vaultEvidencePlanner.ts`
- `src/utils/vaultHealth.ts`
- `src/utils/vaultIngestion.ts`
- `src/utils/vaultOrganizeActions.ts`
- `src/utils/vaultRecallTrace.ts`
- `src/utils/__tests__/vaultEvidencePlanner.test.ts`
- `src/utils/__tests__/vaultHealth.test.ts`
- `src/utils/__tests__/vaultIngestion.test.ts`
- `src/utils/__tests__/vaultOrganizeActions.test.ts`
- `src/utils/__tests__/vaultRecallTrace.test.ts`

当前工作区还出现过这些可能影响知识库入口/显示的文件：

- `src/components/filetree/FileTreePanel.vue`
- `src/components/editor/EditorPanel.vue`
- `src/layouts/WorkspaceLayout.vue`

## 建议恢复策略

### 方案 A：精准恢复知识库代码

适合用户希望保留 Skill 工作，但恢复知识库稳定性的情况。

做法：

1. 对比 `74da554^` 与当前版本的知识库文件。
2. 逐文件判断：
   - 是否破坏用户认可的五层知识库架构。
   - 是否引入自动写入 Vault。
   - 是否改变 raw / wiki / chunk / evidence 的边界。
3. 只恢复知识库相关文件，不动 Skill Creator / Skill Builder。
4. 恢复后运行知识库相关测试。

### 方案 B：新建恢复分支

适合需要彻底隔离风险的情况。

做法：

1. 从 `74da554^` 新建恢复分支。
2. 只 cherry-pick Skill 相关文件。
3. 不 cherry-pick 知识库、创作面板、画布、主页、RunningHub 代码。
4. 验证 Skill 后，再单独合并。

### 方案 C：整体 revert 风险提交

不建议作为第一选择。`74da554` 混入了太多模块，整体 revert 会同时打掉 Skill、工具 runtime、创作面板、RunningHub 等改动，可能造成二次混乱。

## Skill 相关可考虑保留的范围

如果目标是保留 Skill 工作，应优先审查这些文件：

- `src/runtime/tools/skillCreatorRuntime.ts`
- `src/runtime/tools/skillBuilderRuntime.ts`
- `src/utils/skillBuilderTools.ts`
- `src/utils/skillCreatorScriptRunner.ts`
- `src/utils/skillCreatorWorkspace.ts`
- `src/utils/skillMaterialCompiler.ts`
- `src/utils/skillMaterialNormalizer.ts`
- `src/utils/skillMaterialRuntime.ts`
- `src/utils/skillPackageStorage.ts`
- `src/utils/skillTestRunner.ts`
- `src/utils/skillTextBuilder.ts`
- `src/utils/skillWarehouseMenu.ts`
- `src/stores/agentStore.ts`
- `src/types/skill.ts`
- `public/skills/skill-builder/SKILL.md`

注意：即使这些文件属于 Skill，也要确认没有反向依赖知识库新逻辑。

## 接手者注意事项

- 当前问题不是单点 bug，而是提交范围失控。
- 不要默认信任 `74da554` 的模块边界。
- 不要为了修 Skill 再继续改知识库。
- 每次恢复只处理一个模块，并单独提交。
- 用户最关心知识库不被污染、不自动写入、不丢失原文和来源链路。

