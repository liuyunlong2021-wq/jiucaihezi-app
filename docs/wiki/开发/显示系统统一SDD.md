# 显示系统统一 SDD

> 状态：共享代码已实施；Web/Mac 真实检查与 iOS 模拟器启动通过；Windows、iPhone/iPad 真机及移动内容流程待验收
> 范围：Web、Mac、Windows、iPhone、iPad（Android 恢复后复用同一实现补验收）
> 原则：显示只由变量驱动。不新增渲染库、不动 `renderMessageMarkdown` 渲染合同、不动虚拟列表与滚动、不动保存与同步逻辑。

## 1. 目标

把“主题 / 字号 / Markdown 排版”收敛成一套由 CSS 变量驱动的显示系统，使对话显示、文件阅读、Markdown 编辑三处视觉一致，并在四个主题 × 三个字号的任意组合下都保持正确的层级。

本 SDD 不做多语言（见 §7），不引入编辑器框架（CodeMirror/Monaco），不重新设计设置面板的交互，不改动任何业务合同。

## 2. 现状问题

| 编号 | 问题 | 根因位置 | 影响 | 优先级 |
| --- | --- | --- | --- | --- |
| D0-1 | 对话段落间距约为应有值的两倍 | `MemoryWorkbench.vue:1693` `.memory-message-text { white-space: pre-wrap }` 覆盖 `markdown.css` 的 `.markdown-body { white-space: normal }` | 渲染后 HTML 标签间的换行符被当作真实空白呈现，段落、列表项之间多出整行空隙 | P0 |
| D0-2 | 切换“大字/特大”时 Markdown 不跟随 | `markdown.css` 有 43 处硬编码 px，不读 `--font-base` | 正文变大而标题、表格、代码块不变，字号层级反转 | P0 |
| D1-1 | 正文出现成排红色边框小块 | `markdown.css` 行内代码使用 `--hl-keyword`（代码高亮的关键字红）+ 边框 | 古文引用被模型包成行内代码后，观感接近报错提示 | P1 |
| D1-2 | 阅读态标题层级弱 | 标题为 20/17/15px 纯 `--ink1`，无分隔线 | 与正文拉不开层级，长文档缺少结构感 | P1 |
| D1-3 | 排版规则存在两份 | `MessageBubble.vue:1125-1153` scoped 内重复定义标题/段落/列表/引用排版 | 同一份 Markdown 在主对话与记忆工作台排版不一致；改一处不生效 | P1 |
| D2-1 | 编辑态字号不跟随全局字号 | `markdown.css` `.memory-markdown-editor` 写死 13px | 特大字号下编辑态仍是小字 | P2 |
| D2-2 | 未来 RTL 语言需返工 | 新增样式若使用 `left/right` 物理方向属性 | 阿拉伯文/希伯来文版本需逐条重写方向属性 | P2 |

现存正确部分，不改动：

- 四主题机制（`design-tokens.css` + `useTheme.ts` 的 `data-theme` 切换）架构正确。
- 代码高亮已按主题提供四套 `--hl-*` 变量（`highlight-theme.css`）。
- 字号机制（`--font-base` + `main.ts` 启动注入 + `MemorySettings.vue` 写入）链路完整，仅消费端未接入。
- 移动端输入控件 16px 下限（`base.css:126`）用于阻止 iOS 聚焦缩放，保留。

## 3. 设计决断

### 3.1 显示系统三层合同

```
设置面板（主题 4 选 1 / 字号 3 选 1）
        ↓ 只写变量，不写样式
第 1 层  变量层   design-tokens.css（颜色）· --font-base（字号基准）· highlight-theme.css（高亮色）
        ↓ 只读变量，不写死值
第 2 层  排版层   markdown.css —— 全 App Markdown 排版唯一真源
        ↓ 同时服务
第 3 层  消费层   对话显示 · 文件阅读 · Markdown 编辑 · 代码块
```

三条纪律：

1. **颜色只用变量。** 排版层不出现任何十六进制色值，一律引用 `--ink*` / `--olive*` / `--line` / `--surface*` / `--hl-*`。切主题即全部适配，无需为主题写分支。
2. **字号只用相对单位。** 排版层字号一律以 `em` 表达对 `--font-base` 的倍率，不写 px。切字号时标题、表格、代码块、编辑器同比例缩放，层级恒定。
3. **方向只用逻辑属性。** 新增或改写的样式使用 `margin-inline-start` / `padding-inline-start` / `border-inline-start` / `text-align: start`，不使用 `left` / `right`。中文表现完全不变，RTL 语言自动镜像。

### 3.2 排版层唯一真源

`markdown.css` 是 Markdown 排版的唯一真源。组件 scoped 样式只允许定义“容器”关注点（外边距、最大宽度、背景、气泡内边距），不得定义标题字号、段落间距、列表缩进、引用样式。

`MessageBubble.vue` 中 `.layout-assistant-prose` 的标题/段落/列表/引用规则整块删除；其容器级规则（`max-width: 820px`、透明背景）保留。

判定标准：调整任一 Markdown 排版数值时，只需修改 `markdown.css` 一个文件，三处显示同时生效。

### 3.3 字号倍率表

以 `--font-base`（14/16/18px）为 1em 基准：

| 元素 | 倍率 | 14px 下实际值 |
| --- | --- | --- |
| 正文 / 列表 | 1em | 14px |
| h1 | 1.5em | 21px |
| h2 | 1.28em | ~18px |
| h3 | 1.1em | ~15px |
| h4–h6 | 1em（靠字重与颜色区分） | 14px |
| 表格单元格 | .95em | ~13px |
| 代码块 / 编辑器 | .92em | ~13px |
| 行内代码 | .92em | ~13px |

代码块与编辑器保持 `.92em`，因等宽字体同字号视觉偏大；该倍率仍随全局字号缩放。

### 3.4 标题与行内代码配色

- h1 / h2：颜色 `--olive`，并加 `border-block-end: 1px solid --line`（对齐 VS Code Markdown 预览与 GitHub 的章节分隔）。h1 字重 700，h2 字重 650。
- h3–h6：颜色 `--ink1`，字重 650，无分隔线。
- 行内代码：背景 `--surface-alt`、文字 `--ink1`、去掉边框，只保留圆角。放弃 `--hl-keyword` 红色——该变量语义是“代码中的关键字”，用于正文行内代码属误用，是 D1-1 的直接根因。

四主题下 `--olive` 分别为：浅色 `#268BD2`（Solarized 蓝）、白色 `#005FB8`（VS Code 蓝）、黑夜 `#D5C787`（暖金）、护眼 `#5a9e60`（绿）。无需为主题写任何分支。

### 3.5 密度基线

对齐 VS Code Markdown 预览密度，在 D0-1 修复的基础上收紧：

| 项 | 现值 | 目标 |
| --- | --- | --- |
| 正文行高 | 1.7 | 1.7（不变） |
| 段落间距 | .45em | .5em（D0-1 修复后不再叠加空行） |
| 标题上间距 | 1.1em | h1 1.6em / h2 1.4em / h3 1.15em |
| 列表项间距 | .16em | .2em |
| 列表缩进 | 22px | 1.5em（随字号） |

`MemoryWorkbench.vue` 与 `MessageBubble.vue` 中重复的 `line-height` / `font-size` 声明同步删除，行高只由 `.markdown-body` 定义一次。

### 3.6 编辑态与阅读态度量一致

`.memory-markdown-editor` 的 `pre`（高亮层）与 `textarea`（输入层）必须共享完全一致的 `font`、`line-height`、`padding`、`white-space`、`tab-size`，否则光标与高亮文字错位。改字号时两者同时改，作为一条不可拆分的约束。

移动端 `@media (max-width: 760px)` 现有 16px 下限保留（iOS 聚焦防缩放），但改为 `max(16px, .92em)` 形式，使特大字号下不被 16px 反向压小。

## 4. 实施顺序

### Task A：修复间距根因

- 删除 `MemoryWorkbench.vue:1693` 的 `white-space: pre-wrap` 与该行冗余的 `font-size` / `line-height`；保留 `overflow-wrap: anywhere`。
- 确认用户消息不受影响：用户消息走 `renderMessageMarkdown(content, 'user')` 的 `escapeHtml + <br>` 路径，换行由 `<br>` 标签承载，不依赖 `pre-wrap`。

验收：同一条含多段落与列表的助手消息，段落间距由约两行收敛为一行；用户输入的手动换行仍然保留。

### Task B：markdown.css 接入变量系统

- 43 处硬编码 px 按 §3.3 倍率表改为 em。
- 标题与行内代码按 §3.4 改配色与分隔线。
- 密度按 §3.5 调整。
- 三处物理方向属性改为逻辑属性；新增样式一律使用逻辑属性。

验收：四主题 × 三字号共 12 种组合下，标题始终大于正文、颜色随主题变化、无对比度不足；恶意 HTML 仍不执行（沿用既有 XSS 测试）。

### Task C：编辑态对齐

- `.memory-markdown-editor` 的 `pre` 与 `textarea` 字号改为 `.92em`，行高与阅读态对齐。
- 移动端下限改为 `max(16px, .92em)`。
- Markdown 源码标记符（`#`、`-`、`>`、`[[]]`）配色沿用 `highlight-theme.css:145-174` 已定义的 `.memory-markdown-editor .hljs-*` 规则，不新增变量。

验收：编辑态与阅读态字号视觉连续；光标位置与高亮文字在长文、中英混排、缩进列表下均不错位；三档字号各验一次。

### Task D：收编重复定义

- 删除 `MessageBubble.vue:1125-1153` 的标题/段落/列表/引用排版规则，保留容器级规则。
- 删除 `.msg.layout-assistant-prose .msg-bubble` 中的 `font-size: 14px` 与 `line-height: 1.76`，改由 `.markdown-body` 统一提供。

验收：同一份 Markdown 在主对话与记忆工作台排版一致；修改 `markdown.css` 单个数值后，三处显示同时变化（即真源唯一性证明）。

### Task E：跨端与组合回归

- focused 测试、TypeScript、Web/Desktop 串行构建与产物审计。
- 用长文档（含标题、表格、引用、代码块、双链、中英混排）在对话 / 阅读 / 编辑三态各截图。
- 12 种主题 × 字号组合切换验证，重点看白色与黑夜主题下 h1/h2 分隔线与行内代码底色的对比度。
- Web、Mac、Windows、iPhone、iPad 核心矩阵；Android 恢复后补做。

验收：三态视觉一致、12 组合无层级反转、跨端截图齐备后，本 SDD 方可标记完成。

## 5. 影响文件

| 文件 | 改动性质 |
| --- | --- |
| `src/styles/markdown.css` | 主要改动：接入变量、配色、密度、逻辑属性 |
| `src/components/memory/MemoryWorkbench.vue` | 删除 `white-space: pre-wrap` 及冗余字号/行高（约 1 行） |
| `src/components/chat/MessageBubble.vue` | 删除重复排版规则（约 30 行） |
| `src/styles/highlight-theme.css` | 仅在需要时微调，不新增变量 |

不改动：`markdownDisplayPolicy.ts`、`highlight.ts`、`design-tokens.css`、`useTheme.ts`、`MemorySettings.vue`、`main.ts`、`base.css`（除移动端下限一行）。

## 6. 不做事项

- 不新增 Markdown 渲染库或替换 `marked`。
- 不引入 CodeMirror/Monaco 等编辑器框架。
- 不新增第五个主题或第四档字号。
- 不为主题写颜色分支——主题差异只允许存在于 `design-tokens.css`。
- 不在组件 scoped 样式中重新定义 Markdown 排版。
- 不因为本次改造调整虚拟列表、滚动锚点、保存或同步逻辑。

## 7. 多语言的边界（本轮不做，仅预埋）

多语言属于“语言系统”，与本 SDD 的“显示系统”是两套关注点，不应混入本轮：

| 系统 | 管什么 | 机制 | 本轮 |
| --- | --- | --- | --- |
| 显示系统 | 长什么样 | CSS 变量 | 本 SDD 收口 |
| 语言系统 | 说什么话 | 文案词条表 + 语言包 | 单独立项 |

语言系统需要把界面中文文案抽为词条、引入 i18n 运行时、处理复数与日期格式、准备各语种字体回退——工程量与本轮不在同一量级，须另写 SDD。当前仓库尚未引入任何 i18n 依赖。

本轮零成本预埋两项：

1. §3.1 纪律三的逻辑属性，使 RTL（阿拉伯文、希伯来文）版本无需重写方向属性。
2. §3.3 相对单位，使不同语种字体的字宽差异可由单一 `--font-base` 吸收，无需逐语种改排版。

预埋不等于支持。未做 RTL 真机验证前，不得宣称支持任何 RTL 语言。

## 8. 完成标准

1. 对话段落间距正常，用户消息换行不丢。
2. 对话、文件阅读、Markdown 编辑三处 Markdown 视觉一致。
3. 四主题任意切换，Markdown 配色随之变化且对比度可读。
4. 三档字号任意切换，标题、表格、代码块、编辑器同比例缩放，层级不反转。
5. Markdown 排版数值在 `markdown.css` 单点可改，三处同时生效。
6. Web、Mac、Windows、iPhone、iPad 截图证据齐备。

以上全部满足，本 SDD 方可标记完成；不得以“构建成功”或单平台通过替代跨端证据。

## 9. AI 接手说明

本文件是 Markdown 显示系统的唯一规范和交接入口。后续任何 AI 工具处理 Markdown 显示问题，先完整阅读本文件，再阅读：

1. `AGENTS.md`：仓库级开发边界与最小修改原则。
2. `docs/wiki/CLAUDE.md`：知识库入口与文档真源规则。
3. `docs/wiki/hot.md`：当前阶段、已完成验证和未完成验收。

接手时先检查 `git status`，确认当前工作区是否包含未提交改动；不要假定本 SDD 已完成。先复现并定位问题，再按本文件的“唯一真源”原则修改 `src/styles/markdown.css`。除非有新的 SDD 明确授权，不新增 Markdown 库、编辑器框架、第二套渲染合同或业务逻辑改动。

## 10. 实施记录（2026-07-29）

已实施的共享代码：

- `src/styles/markdown.css` 收编对话、文件阅读和编辑态的 Markdown 排版；标题、表格、代码块和编辑器字号改为相对单位；颜色改用主题变量；方向属性使用逻辑属性。
- `MemoryWorkbench.vue` 删除 `pre-wrap`、重复字号/行高和重复 Markdown 排版规则，阅读消息与文件预览接入 `.markdown-body`。
- `MessageBubble.vue` 删除组件内重复 Markdown 排版规则，文本和 reasoning 渲染统一接入 `.markdown-body`。
- 编辑器高亮层与输入层共享字体、行高、内边距、换行和 tab 尺寸；复制按钮继续保留原始 Markdown 内容并使用主题变量。
- 代码块中的 `highlight.js` 节点改为继承 `.md-code pre` 的字体和行高，避免全局 `.hljs` 的固定 `13px` 覆盖三档字号。
- 真实 Web 检查发现并删除 `MemoryWorkbench.vue` 遗留的 `.memory-document pre`；它覆盖编辑器高亮层，造成 `pre` 与 `textarea` 字体/行高不一致。

自动验证证据：

- focused Node：`1386 passed / 0 failed / 8 skipped`。
- Tauri Rust：`400 passed / 0 failed / 1 ignored`。
- `vue-tsc -b`：通过。
- `pnpm run build:quick`：Web 构建与 `audit:web-dist` 通过。
- `pnpm run build:desktop:quick`：Desktop 构建与 `audit:desktop-dist` 通过。
- `pnpm run build:ios:quick`：前端构建、Desktop 产物审计和 iOS branding 步骤通过。
- 2026-07-29 追加修正后复验：focused `1386 passed / 0 failed / 8 skipped`、`vue-tsc -b`、`pnpm run build:quick`、`pnpm run build:desktop:quick`、`pnpm run build:ios:quick` 均通过；Web/Desktop 产物审计通过。
- Web 本地真实页面：已打开回归项目中的 Markdown 文件，阅读态标题/双链/表格与编辑态源码高亮可见；该证据只代表当前 Web 环境，不替代其他平台。
- Web 追加真实 DOM 样式核对：阅读态 h1 为主题 `--olive` 且 21px，表格单元格随基准字号缩放；编辑态 `pre` 与 `textarea` 的 font、line-height、padding、white-space、tab-size 完全一致。
- Mac Apple Silicon：最终 CSS 重新打入 `韭菜盒子.app` 与 `韭菜盒子_2.1.0_aarch64.dmg`；Developer ID 签名及 `codesign --verify --deep --strict` 通过。DMG SHA-256：`a4f417997af32ff3ee642a0a873659688c1157aab1ba8fb2c2d9f0080399fa78`。未执行 Apple notarization，安装后的用户功能仍待人工验收。
- Mac 最新重打包（2026-07-29）：项目产物位于 `src-tauri/target/release/bundle/macos/韭菜盒子.app`，DMG SHA-256：`46636725049c6897fa65662a38311d22cfcf831c395426f801af8b0b9bc5a666`；签名验证通过，`spctl` 仍因未公证拒绝。电脑中另有 `/Applications/韭菜盒子.app` 和 `/Volumes/韭菜盒子 3/韭菜盒子.app`，二者都不是本次项目产物。
- Mac 真实 UI：已在最终 `.app` 中打开对话长 Markdown、项目文件阅读态和编辑态；4 个主题 × 3 个字号共 12 组均成功切换，编辑器保持可用且窗口可正常截图；测试结束已恢复为护眼主题/标准字号。
- iPhone 17 Pro 模拟器：Tauri iOS 构建、安装和启动成功；项目中心、文件树、Markdown 阅读入口和编辑器布局可见，编辑器高亮层正常出现。最终 release `韭菜盒子.ipa` SHA-256 为 `f177f94ad25ffb8ad238a40f1009555dc9fd57954985924cb68afd1a4015a7e7`。模拟器键盘自动化无法可靠输入多行内容，因此不把内容保存/阅读流程记为通过。
- iPad Pro 11-inch 模拟器：Tauri iOS 构建产物安装并启动成功；横向双栏布局、项目中心入口和移动端工具栏可见。尚未导入项目文件，故不宣称 iPad Markdown 内容流程通过。

尚未完成的证据：Windows 真机、iPhone 真机、iPad 真机，以及 iPhone/iPad 模拟器的完整文件内容阅读/保存流程；Web/Mac 已有本地真实页面与组合证据。因此本 SDD 状态不能改为“完成”。Android 仍暂停。
