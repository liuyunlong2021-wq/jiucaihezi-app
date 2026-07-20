# 创模式 Raw 账本与对话 Wiki 移除 SDD

> 日期：2026-07-20
> 状态：已完成；完整构建仍受既有 19 条源码合同测试失败阻断，详见第 6 节
> 决策：项目资料只读取真实来源，不自动复制对话到项目目录。

## 1. 根因与决策

`8b30a82d` 曾为不使用 OpenCode 的创模式建立 `.raw/sessions/jcses_*.jsonl` 账本。每轮用户消息、工具调用、工具结果、最终回复和创作媒体结果都会被自动追加到当前项目；`jc-chat-wiki` 再读取该副本转 Wiki。

这与当前数据边界冲突：Raw 必须停留在真实来源，不能为了后续 Wiki 转换而由 App 自动复制或搬运。项目目录不应因聊天产生 `.raw` 文件，也不应让 Git 看到会话数据改动。

删除范围仅限自动账本与依赖它的 `jc-chat-wiki`。创模式按模型容量装配当前 UI 会话、按需读取项目 `CLAUDE.md` 与 `wiki/hot.md` 的能力保留，因为它们只读项目既有资料。

## 2. 当前链路

```text
Desktop ChatPanel -> useCreativeChat -> createCreativeMemoryRecorder -> .raw/sessions
Web chatCloud -> createCreativeMemoryRecorder -> webProjectFiles .raw/sessions
创作媒体结果 -> ChatPanel appendCreativeMemoryEvent -> .raw/sessions
jc-chat-wiki -> 扫描 .raw/sessions -> 对话转 Wiki
```

## 3. 目标与验收

1. 删除 `public/skills/jc-chat-wiki/`，从 Skill 身份测试与生成索引中移除它。
2. 不保留 `creativeMemory` 的事件编码、session ID、append 或 recorder API；任何创模式生产路径均不调用项目写入来保存聊天副本。
3. Desktop/Web 创模式仍可读取 `CLAUDE.md`、`wiki/hot.md`，仍可发送消息、调用工具和处理创作媒体结果。
4. 生产源码、静态 Skill 目录和生成的 `public/skills/index.json` 均不再包含 `jc-chat-wiki`、`jcses_` 或 `.raw/sessions`。测试可保留禁止这些标识的负向断言。
5. `pnpm run test:focused`、`pnpm exec vue-tsc -b`、`pnpm run build`、`pnpm run build:desktop` 通过，或明确记录既有失败。

## 4. 实施步骤

1. 先更新创模式、Web 创模式和 ChatPanel 合同测试，使其要求只读项目热记忆且禁止 `createCreativeMemoryRecorder`、`appendCreativeMemoryEvent`、`.raw/sessions`；运行并确认因当前实现仍存在写入而失败。
2. 将 `creativeMemory.ts` 收敛为只读项目记忆与上下文装配：删除事件类型、编码、session 路径、append 和 recorder；其文件接口只保留 `read`。
3. 从 `creativeChat.ts`、`chatCloud.ts`、`ChatPanel.vue` 移除 recorder、项目 `.raw` 适配和媒体结果账本追加；保留 UI 会话持久化、工具回调、项目 `CLAUDE.md`/`wiki/hot.md` 读取和媒体任务正常写入 `jc-media`。
4. 删除 `public/skills/jc-chat-wiki/`，更新 Skill 身份测试和生成索引；删除专门测试 `.raw` 账本的测试，保留上下文容量与热记忆只读测试。
5. 搜索确认没有自动账本标识，再跑完整门禁。不要删除用户现有 `.raw` 文件，也不要添加 `.gitignore` 掩盖写入问题。

## 5. 验证命令

```bash
pnpm run test:focused:build
node --test \
  /private/tmp/jc-focused-tests/runtime/direct/__tests__/creativeMemory.test.js \
  /private/tmp/jc-focused-tests/components/__tests__/chatMessagePresentation.test.js \
  /private/tmp/jc-focused-tests/components/__tests__/desktopOpenCodeSyncCutover.test.js

pnpm run test:focused
pnpm exec vue-tsc -b
pnpm run build
pnpm run build:desktop
```

## 6. 执行结果

- 已删除 `public/skills/jc-chat-wiki/` 四个文件；重建后的 `public/skills/index.json` 为 29 个 Skill，已不含该 Skill。
- 已从 Desktop、Web 和创作媒体完成回调移除 `.raw/sessions` 写入链路；`creativeMemory.ts` 只保留项目 `CLAUDE.md`、`wiki/hot.md` 的读取与上下文装配。
- 生产源码审计只命中测试中的负向断言；生产代码、静态 Skill 和索引均无 `jc-chat-wiki`、`jcses_` 或 `.raw/sessions`。
- 通过：`pnpm exec vue-tsc -b`、创模式 raw 防回归 Node 测试（2/2）、Skill 身份测试（3/3）、`jc-raw-wiki` 契约测试（15/15）、`git diff --check`。
- `pnpm run build` 与 `pnpm run build:desktop` 均在其前置 `pnpm run test:focused` 被 19 条既有源码合同测试阻断。例如测试要求等价 CSS 写法 `opacity: .72`，当前实现是 `opacity: 0.72`。这些失败与本次删除账本无关，未为凑绿修改无关 UI 或 OpenCode 逻辑。
