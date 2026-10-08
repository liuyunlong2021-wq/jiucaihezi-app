---
name: jc-new-user-guide
display_name: 新手指南
description: "Use when a user asks how to use Jiucaihezi (韭菜盒子), especially novel or manga creation, the Creation Panel, account and model setup, settings, projects, or first-use guidance. Only trigger for Jiucaihezi-specific requests, not generic writing or generic software help. Trigger on 韭菜盒子怎么用、韭菜盒子新手、漫剧制作、漫剧创作流程、小说创作、小说怎么写、创作面板怎么用、设置怎么配置、模型怎么选、API Key、jc-new-user-guide."
allowed-tools:
  - read
---

# 韭菜盒子新手指南

面向第一次使用韭菜盒子的用户。优先讲清楚从项目开始创作、如何使用漫剧和小说路线、如何用创作面板生成媒体，以及账号和模型设置。

## 关键事实

- 先打开或新建一个项目，再开始对话；文字产物和生成媒体归当前项目管理。
- Desktop 输入框下方有“漫剧制作”和“小说创作”两个创作路线。点击只切换路线，不会自动生成内容；还要描述本轮要做的事并发送。
- 小说与漫剧路线会自动配置对应的创作 Skill 和 Wiki 归档能力。正式产物会写入当前项目，并回报实际文件位置。
- 创作面板是独立的图片、视频、音频等生成入口；聊天模型与创作模型分开选择。提交生成需要用户明确要求。
- 账号登录用于云端身份和同步；模型调用 API Key 是单独配置项，两者不能混为一谈。
- 模型、参数、价格、渠道和可用状态会变化，以当前应用界面为准。

## 回答方式

1. 识别用户要做的是小说、漫剧、媒体生成、账号设置还是项目文件操作。
2. 只读取最相关的一份参考文档；用户要跨多个部分的完整入门时，再组合阅读。
3. 给出简短、可照着操作的步骤和一条可直接发送的示例请求。
4. 说明点击入口是否会自动执行、产物会保存在哪里，以及下一步由用户做什么。
5. 模型或生成能力不确定时，以当前界面和实际可用状态为准；不要承诺固定模型、价格或成功率。
6. 不因选择创作路线就自动提交付费的图片、视频或音频任务。

## 参考导航

| 问题 | 阅读 |
| --- | --- |
| 漫剧创作从哪里开始、每一步能做什么 | references/6-漫剧制作.md |
| 小说从开书到逐章写作、如何确认和保存 | references/7-小说创作.md |
| 创作面板、账号、模型和常用设置 | references/9-创作面板与设置.md |
| 项目文件与 Wiki 资料 | references/1-Wiki使用.md |
| Skill 的作用与选择 | references/3-Skill科普.md |
| 模型类型、动态目录与 API | references/5-模型科普.md |
| 附件阅读与文档输出 | references/8-办公.md |

## 表达标准

- 直接回答，不发送固定欢迎语、菜单或 GIF。
- 不要求用户记住 Skill ID；用“故事梗概”“角色设定”“章节草稿”等产物名称讲操作。
- 不把创作路线按钮说成自动制作整部作品。
- 不把账号登录说成已经配置好模型调用密钥。
