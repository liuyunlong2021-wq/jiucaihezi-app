<p align="center">
  <img src="logo.svg" alt="韭菜盒子" width="120" />
</p>

<h1 align="center">韭菜盒子</h1>
<p align="center"><strong>从小说到漫剧，一盒搞定。</strong></p>
<p align="center">AI 故事创作工作台</p>
<p align="center">小说创作 · 短剧改编 · 漫剧制作</p>

<p align="center">
  <a href="https://jiucaihezi.studio">jiucaihezi.studio</a>
</p>

---

## 这是什么

韭菜盒子帮助创作者把小说改成剧本，把剧本做成漫剧。围绕同一个项目，整理原作、人物和设定，创作小说、改编分集剧本，继续制作资产、分镜和视频提示词。

Wiki 保存项目资料和创作成果，专业 Skill 提供创作方法，AI 模型与工具负责执行。桌面版支持本机项目与本地模型，也可连接云端模型。

## 三大核心业务

- **小说创作**：通过专业 Skill 辅助故事构思与正文创作，作品和设定保存在项目 Wiki 中。
- **短剧改编**：读取原作、整理项目资料、完善改编方案、逐章规划与章内分集切分，再逐集改编、自检和保存。当前专业流程聚焦改编。
- **漫剧制作**：整理项目资料与影片风格，创作角色、场景、道具提示词和工程剧本，继续生成分镜及视频提示词。

「一盒搞定」是品牌主张。提示词流水线、图片与视频生成分别有各自的执行和验收边界，不代表所有环节已实现整片自动制作。

## 配套能力

- 项目中心、文件树、Markdown 阅读编辑与 Wiki 索引
- Harness 持久对话、用户 Skill、模型与 Provider 配置、MCP
- 图片、视频、音频生成及项目媒体任务
- `.canvas`、`.jccanvas` 和桌面 `.jcscene`
- 既有文字同步与桌面更新能力

桌面端是主产品，现有桌面能力继续保留。Web 面向下载与展示；Mobile 现有 App 冻结，目标形态为桌面控制器，不作为已完成能力宣传。

开发合同与知识库见 [AGENTS.md](./AGENTS.md)、[知识库首页](./docs/wiki/index.md)和[产品架构](./docs/wiki/架构/产品架构.md)。

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
