# 小说创作入口与 Skill 接入合同

> 更新：2026-10-08
> 当前实现：`jc-novel` 内置包、`MemoryWorkbench.vue` 小说创作入口、`wiki-memory` 原生 Wiki 链路。

## 用户入口

- Desktop 输入框中「小说创作」紧邻「漫剧制作」右侧。
- 点击按钮只切换模式，不自动读取项目或生成内容；小说 Skill 的 A/B/C 首轮启动闸门保持原样。
- 小说模式自动选择 `jc-novel` 与其必需依赖 `wiki-memory`；若用户此前手动选择了 `wiki-memory`，退出时保留它，否则移除自动加入的依赖。
- 漫剧与小说路由互斥。会话目录分别记录现有 `manju` 偏好和新增 `novel` 偏好；读取旧会话时仍按既有漫剧偏好恢复。
- 小说模式的 Skill 选择器只展示 `jc-novel`、`wiki-memory`；用户通过两个模式按钮切换路由。

## Skill 与文件树

- 完整来源目录 `/Users/by3/.agents/skills/jc-novel` 原样打包到 `public/skills/jc-novel`，包含全部 references/engines；`public/skills/index.json` 登记整个包。
- 小说写作规则、Wiki 目录规则由 `jc-novel` 与 `wiki-memory` 分工；不复用漫剧专用 `manju_save_artifact`。
- Wiki 写入路径以运行时注入的 Wiki 索引为准。正文追加到 Skill 规定的来源材料，故事拆分与章节分析沿用原生工具，不手工创建 source node 或 source hash。
- 项目 Wiki 的创作规划页、角色/场景/道具资产页、原文与拆分章节继续由现有文件工具和故事运行时写入，显示在当前项目文件树。

## 变更边界与验收状态

- 本合同不更改 `jc-novel` 的创作流程，不绕过其阶段确认与逐章确认。
- 本轮已核对 Skill 包与来源目录一致，索引列出 107 个文件。
- 未运行测试。`pnpm exec vue-tsc -b` 仍被未修改的 `src/services/deepSeekHarness.ts:1482–1483` 两处隐式 `any` 阻断；尚未人工点击验收按钮与会话恢复。
