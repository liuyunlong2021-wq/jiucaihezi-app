---
name: jc-new-user-guide
display_name: 新手指南
description: "Use when a user asks how to use Jiucaihezi (韭菜盒子), especially what each @ entry does (@Office / @影音 / @3D / @MCP / Skill / Wiki Memory), short-drama, novel or manga creation, the Creation Panel, media generation, account and model setup, settings, projects, or first-use guidance. Only trigger for Jiucaihezi-specific requests, not generic writing or generic software help. Trigger on 韭菜盒子怎么用、韭菜盒子新手、@Office、@影音、@3D、@MCP、@的作用、芯片、导出Word、导出表格、导出PPT、生成图片视频、短剧写作、短剧改编、漫剧制作、漫剧创作流程、小说创作、小说怎么写、创作面板怎么用、设置怎么配置、模型怎么选、API Key、jc-new-user-guide."
allowed-tools:
  - read
---

# 韭菜盒子新手指南

面向第一次使用韭菜盒子的用户。先讲清楚输入框里每个 `@` 是干什么的，再讲从项目开始创作、三条文字路线、创作面板出图出片，以及账号和模型设置。

## 关键事实

- 输入框敲 `@` 会弹出能力菜单：**Wiki Memory、Skill、Office、影音、3D、MCP、会话**。每个 `@` 是「本轮启用这类能力」的开关，不是提示词的一部分。
- `@Office` 负责把已有内容落成文件：Word、Markdown、TXT、CSV、PPTX、PDF、网页、PNG 长图。表格走 CSV，Excel 能直接打开。
- `@影音` 负责生成图片、视频、音频，是**唯一会扣费**的入口；先给媒体计划卡片、经用户确认才提交。它和创作面板共用同一套模型与参数，面板上的「复制参数」可以粘回输入框接着写提示词。
- `@3D` 创建、检查、编辑 3D 场景并导出视频；`@MCP` 调用已连接的 MCP 工具；`@会话` 引用本项目其他对话；`@` 加文件名引用项目里的具体文件。
- `@文件` 芯片已下线：本机读写、终端与 Skill 脚本由输入框左下角的「权限」档控制。
- 没有选 Skill 时按官方语义「自动选」，模型可自行挑一个 Skill；一旦选了具体 Skill，本轮就不能再加载别的 Skill。选了哪个 `@` 就只拿到那个 `@` 的能力，不会互相串。
- Desktop 输入框下方还有「漫剧制作」「短剧写作」「小说创作」三条文字路线。点击只切换路线，不会自动生成内容；还要描述本轮要做的事并发送。
- 创作面板是独立的图片、视频、音频生成入口；聊天模型与创作模型分开选择。
- 账号登录用于云端身份和同步；模型调用 API Key 是单独配置项，两者不能混为一谈。
- 模型、参数、价格、渠道和可用状态会变化，以当前应用界面为准。

## 回答方式

1. 先判断用户问的是「哪个 `@` / 芯片」（读 references/2）还是具体创作路线、创作面板、设置。
2. 只读取最相关的一份参考文档；用户要跨多个部分的完整入门时，再组合阅读。
3. 给出简短、可照着操作的步骤和一条可直接发送的示例请求，示例里带上该用的 `@`。
4. 说明点击入口是否会自动执行、产物会保存在哪里、会不会扣费，以及下一步由用户做什么。
5. 模型或生成能力不确定时，以当前界面和实际可用状态为准；不要承诺固定模型、价格或成功率。
6. 不因选择创作路线或 `@` 芯片就自动提交付费的图片、视频或音频任务。

## 参考导航

| 问题 | 阅读 |
| --- | --- |
| `@` 菜单有哪些、各自干什么、哪个会扣费、怎么组合 | references/2-输入框的@能力.md |
| 漫剧创作从哪里开始、每一步能做什么 | references/6-漫剧制作.md |
| 原创短剧、小说改编方向或逐集剧本怎么写 | references/10-短剧写作.md |
| 小说从开书到逐章写作、如何确认和保存 | references/7-小说创作.md |
| 创作面板、账号、模型和常用设置（含复制参数） | references/9-创作面板与设置.md |
| 项目文件与 Wiki 资料 | references/1-Wiki使用.md |
| Skill 的作用、选择与隔离规则 | references/3-Skill科普.md |
| 模型类型、动态目录与 API | references/5-模型科普.md |
| 附件阅读与文档输出（Word / CSV / PPT / 网页 / 长图） | references/8-办公.md |
| 产品有哪些入口、三条路线和平台差异 | references/4-产品功能.md |

## 表达标准

- 直接回答，不发送固定欢迎语、菜单或 GIF。
- 不要求用户记住 Skill ID 或模型 ID；用「故事梗概」「角色设定」「Word 文件」等产物名称讲操作。
- 不把创作路线按钮说成自动制作整部作品，也不把 `@` 芯片说成已经提交任务。
- 不把账号登录说成已经配置好模型调用密钥。
- 提到 `@` 时用现在界面上的名字：`@Office`、`@影音`、`@3D`、`@MCP`、`@Skill`。旧文档里的「@排版」「@文件」分别对应现在的 `@Office` 和「权限」档。
