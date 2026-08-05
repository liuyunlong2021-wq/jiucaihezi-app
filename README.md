<p align="center">
  <img src="logo.svg" alt="韭菜盒子" width="120" />
</p>

<h1 align="center">韭菜盒子</h1>
<p align="center">本地优先的通用记忆工作台</p>

<p align="center">
  <a href="https://jiucaihezi.studio">jiucaihezi.studio</a>
</p>

---

## 这是什么

韭菜盒子围绕项目保存对话、资料和已确认知识。每个项目包含文件树、Raw 对话与 Wiki，用户可在快速模式或记忆模式中继续工作。

## 当前能力

- 项目中心、项目文件树和 Markdown 文档
- `.raw/对话记录/` 中的对话原文与项目 Wiki
- 快速模式与记忆模式
- 用户 Skill、系统 Skill、模型、Provider 与 MCP
- 图片、视频、音频生成和项目媒体任务
- `.canvas`、`.jccanvas`，以及 Desktop 的 `.jcscene`
- 手动“上传并覆盖云端”和“下载并覆盖本地”文字同步
- Web、Desktop 和 Mobile 平台适配

文字同步是方向性覆盖：只处理可同步文字，不同步媒体、空目录、凭据、设置、Skill、MCP、Provider、`.raw` 或 `.sync`。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面与移动壳 | Tauri v2 (Rust) |
| 前端 | Vue 3 + Pinia + TypeScript |
| 构建 | Vite 8 + pnpm |
| 渲染 | marked + highlight.js + KaTeX + Mermaid |
| 平台存储 | 本机项目目录 / IndexedDB + OPFS / App 管理目录 |

## 开发

```bash
pnpm install
pnpm dev
pnpm tauri dev
pnpm run test:focused
pnpm exec vue-tsc -b
pnpm run build:quick
pnpm run build:desktop:quick
```

## 下载

从 [Releases](https://github.com/liuyunlong2021-wq/jiucaihezi-app/releases/latest) 下载桌面版：

- macOS Apple Silicon：`*_aarch64.dmg`
- macOS Intel：`*_x64.dmg`
- Windows x64：`*_x64_windows_portable.zip`

## 许可

本软件为专有软件。商业使用需获得授权。详见 [LICENSE](./LICENSE)。
