---
name: jc-new-user-guide
description: Use when a user asks how to use Jiucaihezi's Memory Workbench (韭菜盒子/记忆工作台), including first-use guidance, product features, platform differences, download or installation, project files, synchronization, attachments, or model selection. Only trigger for Jiucaihezi-specific requests; do not trigger for generic beginner help, generic tutorials, coding questions, document conversion, or support for another app. Trigger on 韭菜盒子新手、韭菜盒子怎么用、韭菜盒子入门、韭菜盒子使用教程、韭菜盒子功能、韭菜盒子下载、韭菜盒子同步、韭菜盒子附件、韭菜盒子文件、韭菜盒子记忆工作台怎么用、韭菜盒子记忆工作台新手、jc-new-user-guide.
allowed-tools:
  - read
---

# 韭菜盒子记忆工作台新手指引

## 核心事实

- 当前产品只有通用记忆工作台：项目、对话、普通文件和附件。
- 点击“新建记忆空间”只创建项目所需的普通文件和目录；不预建业务目录，也没有每轮自动读取的隐藏文件。
- 每次发送都会自动带入当前对话最近最多三个完整问答轮次（受模型上下文上限约束），不因是否选择 Skill 或工具而消失；新建对话不读取其他对话。
- 用户选中的具体 Skill 会在当前对话后续轮次继续生效，直到点击移除或新建对话；新建对话不继承上一对话的 Skill。
- 记忆分四层：最近轮次是工作记忆；当前对话 Raw 与 `.raw/记忆索引` 是情节记忆；`wiki/` 普通文件是语义记忆；Skill 包是程序记忆。
- 右上角有两个独立开关：“记忆”控制回答完成后的自动索引，“查询”控制下一轮是否预取当前对话的 `memory_search`；新建对话默认都开启，互不影响。
- 自动索引写入 `.raw/记忆索引`，不是 `wiki/`；索引失败不会丢回答，可在消息旁点击“记录对话”重试。
- `wiki-memory` 用于 Wiki 的组织、查询、写入和检查；当前对话的历史召回由原生 `memory_search` 完成，旧 `jc-jiyi` 不再使用。
- DOCX、PDF、XLSX、PPTX 上传后保留原件并生成 Markdown 可读副本，模型读取 Markdown；原件不会被替换。
- `上传并覆盖云端` 用本地文字快照覆盖云端，`下载并覆盖本地` 用云端文字快照覆盖本地；两者都不合并、不产生冲突副本。
- 同步只处理允许的文字资料；媒体二进制、原始附件、空目录、凭据、设置、Skill、MCP、Provider、Session 和 `.raw/.sync` 不参与同步。
- Desktop 保留完整本机能力。
- Web / Mobile 保留项目内读写、附件、文档转换、云媒体、`.canvas` 和 `.jccanvas`；不提供 `.jcscene`、Three.js、FFmpeg、Terminal、本地模型或自定义 MCP。
- 在“我的 Skill”点击“修改”会自动选择 Skill Creator，并填入 Skill ID 与中央 Skill 路径；Skill Creator 先按 ID 读取真实内容，用户确认安装卡后覆盖原 Skill。
- 桌面三平台发布由版本 `v*` tag 触发 GitHub Actions；`main` 推送只更新源码，不直接生成安装包。

## 回答流程

1. 判断用户当前想完成什么，以及正在使用 Desktop、Web 还是 Mobile；只有平台会改变答案时才追问。
2. 读取最相关的一份 Reference，不要一次加载全部资料。
3. 直接给出可执行步骤，用新手能理解的语言解释必要概念。
4. 涉及版本、价格、模型列表、下载或发布状态时，以当前界面、正式网站或真实 Release 为准；无法核实时明确说明，不猜测。
5. 不自动上传用户问题、回答、文件或隐私数据，不静默调用外部接口；需要 Wiki 时明确选择 `@Wiki`，需要方法规则时选择具体 Skill。

## Reference 导航

| 用户问题 | 读取 |
| --- | --- |
| 项目文件、索引与长期资料 | `references/1-Wiki使用.md`（文件名保留兼容） |
| Skill | `references/3-Skill科普.md` |
| 产品功能、平台差异 | `references/4-产品功能.md` |
| 模型、API、价格 | `references/5-模型科普.md` |
| 附件、办公、格式转换 | `references/8-办公.md` |

## 记忆开关速查

- **记忆**：开启后，成功回答在 Raw 保存完成后自动生成 `summary + keywords` 并记录到当前对话索引；关闭只停止后续自动记录，不删除已有 Raw 或索引。
- **查询**：开启后，下一轮发送前自动查询当前对话的索引；关闭不查询历史索引，但最近三轮工作记忆仍然保留。
- 两个开关彼此独立，状态属于当前对话；发送开始时锁定本轮状态，途中切换从下一轮生效。
- 这两个开关都不等于 Wiki 开关，也不会自动把回答写进 `wiki/`。需要长期沉淀时，使用“保存到文件”并选择 Wiki 内的目标文件。

## 表达标准

- 直接回答当前问题，不强制发送 GIF、欢迎语或菜单。
- 不让用户去读 Reference；把结论组织成人话。
- 不承诺当前平台没有的能力。
- 用户卡住时只给最短的下一步。
