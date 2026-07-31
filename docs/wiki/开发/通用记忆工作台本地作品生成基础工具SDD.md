# 通用记忆工作台本地作品生成基础工具 SDD

> 日期：2026-08-01
> 状态：已实施；待真实模型与三平台人工验收
> 范围：通用记忆工作台 Web / Desktop 的本地 PNG、文档与 HTML 导出；不改主 Studio 文武模式和 AI 媒体卡。

## 1. 目标

把产品已有的三个能力作为记忆模式常驻基础工具，和 `read / write / grep` 同级：

| 工具 | 输入 | 输出 |
| --- | --- | --- |
| `export_markdown_png` | 已有文字或 Markdown、标题和可选宽度 | `.raw/jc-media/图片/*.png` |
| `create_document` | Markdown/文本、标题和 `docx/md/txt` 格式 | `.raw/jc-media/文档/*` |
| `create_html` | Markdown 内容和标题 | `.raw/jc-media/文档/*.html` |

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
- HTML 不执行脚本；不增加 PDF、PPTX、Playwright、FFmpeg 或 Whisper。
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
- TypeScript、focused（前端 1417/1417、Rust 402/402）、Web/Desktop quick build 与两端产物审计通过。
