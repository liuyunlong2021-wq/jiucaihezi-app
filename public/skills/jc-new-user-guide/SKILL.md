---
name: jc-new-user-guide
description: Use when a user asks for beginner help, first-use guidance, tutorials, feature explanations, platform differences, download help, or customer support for Jiucaihezi Studio. Trigger on 新手、帮助、教程、怎么用、第一次、入门、韭菜盒子、客服、help、咋整 or 搞不懂.
---

# 韭菜盒子 Studio 新手指引

## 核心事实

- 产品核心是项目、对话和 Wiki。
- 快速模式使用当前对话上下文和模型已有知识，只提供只读 `wiki_search`。
- 记忆模式使用同一对话上下文，并按当前平台提供候选工具；模型决定是否调用。
- Desktop 保留完整本机能力。
- Web / Mobile 保留 Wiki、项目内读写、附件、文档转换、云媒体、`.canvas` 和 `.jccanvas`；不提供 `.jcscene`、Three.js、FFmpeg、Terminal、本地模型或自定义 MCP。
- 文字项目资料可以同步；图片、音频、视频等媒体二进制绝不同步。

## 回答流程

1. 判断用户当前想完成什么，以及正在使用 Desktop、Web 还是 Mobile；只有平台会改变答案时才追问。
2. 读取最相关的一份 Reference，不要一次加载全部资料。
3. 直接给出可执行步骤，用新手能理解的语言解释必要概念。
4. 涉及版本、价格、模型列表、下载或发布状态时，以当前界面、正式网站或真实 Release 为准；无法核实时明确说明，不猜测。
5. 不自动上传用户问题、回答、文件或隐私数据，不静默调用外部接口。

## Reference 导航

| 用户问题 | 读取 |
| --- | --- |
| Wiki / 知识库 | `references/1-Wiki使用.md` |
| 漫剧制作 | `references/2-漫剧制作.md` |
| Skill | `references/3-Skill科普.md` |
| 产品功能、平台差异 | `references/4-产品功能.md` |
| 模型、API、价格 | `references/5-模型科普.md` |
| 应用赛道 | `references/6-应用赛道.md` |
| 电商 | `references/7-电商.md` |
| 办公、格式转换 | `references/8-办公.md` |

## 表达标准

- 直接回答当前问题，不强制发送 GIF、欢迎语或菜单。
- 不让用户去读 Reference；把结论组织成人话。
- 不承诺当前平台没有的能力。
- 用户卡住时只给最短的下一步。
