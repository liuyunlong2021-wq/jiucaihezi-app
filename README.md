<p align="center">
  <img src="logo.svg" alt="韭菜盒子 Studio" width="120" />
</p>

<h1 align="center">韭菜盒子 Studio</h1>
<p align="center">本地优先的 AI 工作台 · 纯手动 · 用户完全可控</p>

<p align="center">
  <a href="https://jiucaihezi.studio">jiucaihezi.studio</a>
</p>

---

## 这是什么

韭菜盒子 Studio 是一个**本地优先的纯手动 AI 工作台桌面应用**。它服务三类核心任务：

- **对话与项目协作** — 通过 OpenCode 内核在项目目录中读写、搜索、运行命令
- **Skill 工作流** — 官方 Skill 形态的能力包，按 SKILL.md 执行
- **创作与工具** — 图片、视频、音频生成，文档导出，网页采集，本地文件处理

> 不做通用 Agent、不做自主决策、不做黑盒工作流。用户显式选择 Skill、工具、模型，AI 按配置执行。

## 特性

- **多模型对话** — Claude / GPT / Gemini / DeepSeek / Grok 等，通过 NewAPI 统一接入
- **Skill 仓库** — 官方 Skill 包管理，支持 GitHub 导入、平台安装、中央库
- **创作面板** — 图片（GPT Image、Nano Banana）、视频（Veo、Grok Video、Seedance 2.0）、音频（Suno）
- **画布节点系统** — VueFlow 可视化创作工作台，31 种节点串联执行
- **OpenCode 项目协作** — 桌面端 100% 复刻官方 OpenCode，project directory 贯穿全链路
- **本地工具** — Chrome 浏览器控制、文件转 Markdown、ffmpeg 媒体处理、yt-dlp 网页采集
- **三平台发布** — macOS Apple Silicon / Intel + Windows x64

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面壳 | Tauri v2 (Rust) |
| 前端 | Vue 3 + Pinia + TypeScript |
| 构建 | Vite 8 + pnpm |
| 编辑器 | Tiptap v3 |
| 渲染 | marked + highlight.js + KaTeX + Mermaid |
| 存储 | SQLite (桌面) / localStorage (浏览器降级) |

## 快速开始

```bash
# 安装依赖
pnpm install

# Web 开发（浏览器）
pnpm dev

# 桌面开发（Tauri）
pnpm tauri dev

# 构建桌面应用
pnpm build:desktop && pnpm tauri:build

# 类型检查
pnpm exec vue-tsc -b
```

## 下载

从 [Releases](https://github.com/liuyunlong2021-wq/jiucaihezi-app/releases/latest) 下载最新版本：

- **macOS Apple Silicon** — `*_aarch64.dmg`
- **macOS Intel** — `*_x64.dmg`
- **Windows x64** — `*_x64_windows_portable.zip`（解压即用）

## 许可

本软件为专有软件。商业使用需获得授权。详见 [LICENSE](./LICENSE)。
