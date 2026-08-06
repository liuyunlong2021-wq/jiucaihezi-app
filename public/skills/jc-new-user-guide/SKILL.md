---
name: jc-new-user-guide
description: Use when a user asks how to use Jiucaihezi's Memory Workbench (韭菜盒子/记忆工作台), including first-use guidance, product features, platform differences, download or installation, Wiki, synchronization, attachments, or model selection. Only trigger for Jiucaihezi-specific requests; do not trigger for generic beginner help, generic tutorials, coding questions, document conversion, or support for another app. Trigger on 韭菜盒子新手、韭菜盒子怎么用、韭菜盒子入门、韭菜盒子使用教程、韭菜盒子功能、韭菜盒子下载、韭菜盒子同步、韭菜盒子附件、韭菜盒子 Wiki、韭菜盒子记忆工作台怎么用、韭菜盒子记忆工作台新手、jc-new-user-guide.
---

# 韭菜盒子记忆工作台新手指引

## 核心事实

- 当前产品只有通用记忆工作台：项目、对话、Wiki、普通文件和附件。
- 点击“新建记忆空间”只创建 `wiki/index.md`、`hot.md`、`log.md` 和 `来源索引.md`；不预建业务目录，也没有每轮自动读取的 Wiki 文件。
- 快速模式使用当前对话上下文和模型已有知识，只提供只读 `wiki_search`。
- 记忆模式使用同一对话上下文，并按当前平台提供候选工具；模型决定是否调用。
- DOCX、PDF、XLSX、PPTX 上传后保留原件并生成 Markdown 可读副本，模型读取 Markdown；原件不会被替换。
- `上传并覆盖云端` 用本地文字快照覆盖云端，`下载并覆盖本地` 用云端文字快照覆盖本地；两者都不合并、不产生冲突副本。
- 同步只处理允许的文字资料；媒体二进制、原始附件、空目录、凭据、设置、Skill、MCP、Provider、Session 和 `.raw/.sync` 不参与同步。
- Desktop 保留完整本机能力。
- Web / Mobile 保留 Wiki、项目内读写、附件、文档转换、云媒体、`.canvas` 和 `.jccanvas`；不提供 `.jcscene`、Three.js、FFmpeg、Terminal、本地模型或自定义 MCP。

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
| Skill | `references/3-Skill科普.md` |
| 产品功能、平台差异 | `references/4-产品功能.md` |
| 模型、API、价格 | `references/5-模型科普.md` |
| 附件、办公、格式转换 | `references/8-办公.md` |

## 表达标准

- 直接回答当前问题，不强制发送 GIF、欢迎语或菜单。
- 不让用户去读 Reference；把结论组织成人话。
- 不承诺当前平台没有的能力。
- 用户卡住时只给最短的下一步。
