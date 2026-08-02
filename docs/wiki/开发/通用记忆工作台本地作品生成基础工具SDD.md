# 通用记忆工作台本地作品生成基础工具 SDD

> 日期：2026-08-01
> 状态：第一阶段与 Markdown 衍生能力扩展已实施；自动验证和浏览器本地验收完成，三平台人工打开矩阵待补
> 范围：通用记忆工作台 Web / Desktop 的 Markdown 显示、大纲导航及本地 PNG、文档、HTML、PDF、PPTX 导出；不改主 Studio 文武模式和 AI 媒体卡。

## 1. 目标

把产品已有的三个能力作为记忆模式常驻基础工具，和 `read / write / grep` 同级：

| 工具 | 输入 | 输出 |
| --- | --- | --- |
| `export_markdown_png` | 已有文字或 Markdown、标题和可选宽度 | `.raw/jc-media/图片/*.png` |
| `create_document` | Markdown/文本、标题和 `docx/md/txt` 格式 | `.raw/jc-media/文档/*` |
| `create_html` | 完整单文件 HTML 和标题；普通 Markdown 仅作基础兜底 | `.raw/jc-media/文档/*.html` |

它们不属于任何 Skill。模型可以直接调用，用户创建的任何 Skill 也可以自由组合调用。

## 2. 根因与最小方案

项目已经有 `html-to-image`、安全 Markdown 渲染、真实 DOCX 写出器、Web OPFS 和 Desktop 项目文件 IPC。缺口只是这些能力没有常驻进入记忆模式工具合同。

本轮只接线：

1. PNG 复用 `html-to-image` 和现有 Markdown 渲染。
2. Word 复用 `createDocxFromText`；HTML 复用同一安全 Markdown 正文。
3. Web 复用 `webProjectFiles`，Desktop 复用 Tauri IPC。
4. 同名保留两份，不覆盖用户已有作品。
5. 删除 `jc-bendi-media` 及其工具开关、触发词和显示映射。

## 3. 与 AI 媒体的边界

- `export_markdown_png` 只把已有文字或 Markdown 排版导出为 PNG，不创作照片、插画、产品图或其他新画面。
- 用户要求创作新画面时，继续走原有 AI 媒体卡。
- 不增加二选一弹窗、模式开关、主题、模板或额外路由。
- 输出路径由 App 决定，模型不能借生成工具写任意路径。
- PNG 第一期不增加 JPG、分页或多尺寸模板。
- HTML 原样保存完整网页；半截 HTML 明确失败，不再把标签转义后冒充成功。第一阶段不增加 PDF、PPTX、Playwright、FFmpeg 或 Whisper；已确认的 PDF/PPTX 第二阶段扩展见第 7 节。
- 只有真实文件写入成功才返回成功和项目相对路径。

## 4. 验收

1. Web 与 Desktop 记忆模式默认工具清单始终包含三个工具；快速模式和主 Studio 文武模式不包含。
2. 工具清单与 Skill 选择、Skill 触发词无关。
3. `export_markdown_png` 生成可读取的 PNG，进入 `.raw/jc-media/图片`。
4. `create_document` 生成真实 DOCX、MD 或 TXT。
5. `create_html` 生成包含完整文档结构和 UTF-8 声明的 HTML。
6. 同名作品保留两份；类型检查、定向测试及 Web/Desktop 构建通过。

## 5. 明确不做

- 不创建管理三个工具的内置 Skill。
- 不替用户设计工作流；高级编排交给用户自己的 Skill。
- 不修改现有 AI 媒体卡及其触发流程。

## 6. 实施结果

- `jc-bendi-media` 及其 Skill 门控已删除，公开 Skill 索引不再包含它。
- Web 与 Desktop 记忆模式常驻提供三个工具；图片工具已更名为 `export_markdown_png` 并明确排除新画面创作。
- 真实测试发现并修复两个基础工具缺陷：完整 HTML 不再被二次转义；PNG 截图节点不再继承离屏坐标，最终图片增加非空像素校验。
- TypeScript、focused（前端 1417/1417、Rust 402/402）、Web/Desktop quick build 与两端产物审计通过。

## 7. Markdown 衍生能力扩展（2026-08-02，已实施）

### 7.1 目标与最小边界

| 能力 | 输入 | 产品结果 | 最小实现 |
| --- | --- | --- | --- |
| Mermaid 图表 | Markdown 中的 `mermaid` 代码块 | 流程图、时序图、状态图、ER 图、甘特图 | 复用现有 `renderMermaidBlocks()`，补齐记忆对话和 Markdown 文件预览 |
| 文档大纲 | 单篇 Markdown 的 H1-H3 标题 | 可折叠、点击跳转并跟随阅读位置高亮的大纲 | 复用现有 Markdown 标题和浏览器滚动能力，零新增依赖 |
| HTML 幻灯片 | 使用 `---` 分页的 Markdown | 可独立打开和键盘翻页的单文件 HTML | 复用现有安全 Markdown 渲染和少量原生 CSS/JavaScript |
| PDF 幻灯片 | 与 HTML 幻灯片相同的 Markdown | 项目文档目录中的分页 PDF | 复用同一 HTML 页面、现有 `html-to-image` 和按需加载的成熟 PDF 写出器 |
| PPTX 幻灯片 | 与 HTML 幻灯片相同的 Markdown | 基础排版可编辑的真实 PPTX | 复用现有 PPTX 页面规格，按需加载 `pptxgenjs` |

这些能力仍属于记忆模式的通用基础能力，不建立专用 Skill，不进入快速模式，不改变用户现有 Markdown 正文。

### 7.2 Mermaid 与文档大纲

1. Mermaid 继续使用已经安装的 `mermaid`，只在页面实际包含 Mermaid 代码块时加载；不增加图表编辑器、独立文件格式或第二套渲染器。
2. Markdown 阅读视图从当前正文提取 H1-H3，显示可折叠文档大纲；点击标题滚动到正文位置，阅读滚动时高亮当前标题。
3. 文档大纲只是同一篇 Markdown 的导航，不提供缩放、拖动或独立空间视图，不保存第二份数据，不生成 `.canvas`。
4. 移动端使用按需展开的大纲入口，不长期占用正文宽度；没有标题时不显示空入口。

### 7.3 幻灯片工具合同

新增一个记忆模式常驻基础工具 `export_markdown_slides`：

```text
title
content       # 使用 --- 分隔幻灯片；没有分隔符时整篇作为一页
format        # html / pdf / pptx
```

- 工具只在用户明确要求生成或导出幻灯片时调用；输出统一进入 `.raw/jc-media/文档`，同名保留两份。
- 项目内生成 HTML、PDF、PPTX 与现有 PNG、DOCX、HTML 作品风险相同，自动执行并显示真实工具步骤，不新增三按钮审批；项目外写入继续遵守既有审批合同。
- HTML 与 PDF 复用同一套页面尺寸、主题和 Markdown 渲染。PDF 在 App 内直接生成文件，不调用 `window.print()`，不出现系统打印窗口。
- PDF 第一阶段按页面图像写入，优先保证与 HTML 视觉一致；文字不可搜索和复制。只有出现明确需求后才评估文本型 PDF。
- PPTX 使用真实 OOXML 文件写出，标题、正文、项目符号和表格保持可编辑；不承诺与 HTML 像素级一致。
- `pptxgenjs` 与 PDF 写出器均动态导入，不增加普通对话与启动路径的执行成本。

### 7.4 明确不做

- 不引入 Marp CLI、Slidev、Quarto、Playwright、Chromium 或后端 Office 服务。
- 不做幻灯片模板市场、动画时间线、母版编辑器或在线协作。
- 不同时提供“图片式 PPTX”和“可编辑 PPTX”两个模式；第一阶段只做基础可编辑 PPTX。
- 不增加 Markmap、思维导图视图或第二套文档结构文件；跨文件空间关系统一交给项目地图。

### 7.5 验收

1. 记忆对话和 Markdown 文件预览可渲染五类 Mermaid 图表；无 Mermaid 时不加载 Mermaid 运行时。
2. 任意有 H1-H3 的 Markdown 自动显示可折叠大纲，点击跳转和滚动高亮有效；没有标题时不显示空入口。
3. `export_markdown_slides` 在 Web/Desktop 生成可重新打开的 HTML、有效分页 PDF 和真实 PPTX；快速模式不暴露该工具。
4. HTML 可键盘翻页并离线打开；PDF 无系统打印弹窗、页面非空且与 HTML 使用同一视觉版式。
5. PPTX 可由 PowerPoint/WPS 打开，标题、正文、项目符号和表格可编辑；不得把文本占位字节冒充 `.pptx`。
6. 三种格式同名保留两份，文件成功写入后才返回项目相对路径；普通聊天首屏不加载 PDF 或 PPTX 运行时。
7. 定向测试、类型检查、Web/Desktop 构建和产物审计通过后可标记代码已实施；三平台人工打开矩阵通过后才能标记跨平台交付闭环。

### 7.6 实施结果

- 记忆对话和 Markdown 文件预览统一复用异步 Mermaid 渲染器；Markdown 文件按 H1-H3 生成可折叠、可跳转并随滚动高亮的大纲，没有标题时不显示。
- `export_markdown_slides` 已进入 Web/Desktop 记忆模式常驻工具，输出 HTML、无打印弹窗的分页 PDF 和真实 PPTX；PPTX 的标题、正文、项目符号和 Markdown 表格均写成可编辑对象。
- PDF 与 PPTX 运行时动态导入；含项目符号和表格的两页浏览器样例实际生成 20,235 字节 PDF（文件头 `%PDF-`）和 58,646 字节 PPTX（ZIP 文件头 `PK`），生成后无离屏节点残留。
- 定向回归、TypeScript、Web/Desktop quick build 与两端产物审计通过；普通聊天首屏未直接加载 PDF/PPTX 运行时。
- 未验证：PowerPoint/WPS 人工打开、Windows/Intel Mac/Apple Silicon 安装包矩阵。完成这些人工项前，不把跨平台交付写成闭环。
