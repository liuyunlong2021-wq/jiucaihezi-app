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
- **漫剧制作**：整理项目资料与影片风格，创作角色、场景、道具、人群与换装造型提示词和工程剧本，继续生成分镜及视频提示词；支持从剧本全自动做到成片。

### 漫剧制作的三种用法

| 用法 | 做什么 | 费用 |
| --- | --- | --- |
| 自由创作 | 按你的话自动选择专业 Skill，想做哪一步做哪一步 | 只有对话费用 |
| 全自动·到提示词 | 剧本按集拆分，逐集写完项目资料、资产提示词、工程剧本和视频提示词 | 只有对话费用 |
| 全自动·到成片 | 在此基础上自动生图、审图、按参考图顺序生视频，并用 ffmpeg 拼接每集成片 | 生图、视频按集计费，开始前确认模型与单集预算 |

- 视频路线支持 **Seedance** 与 **MiniMax H3**，按所选视频模型的时长与参考图上限分段写提示词。
- 审图可单独重新生成或改提示词重生成；角色换装用身份图与服装图融合出新造型参考图。
- 三种用法共用同一套 Wiki 进度，可以随时切换接续：已写好的集不重写，已出好的图不重做。

「一盒搞定」是品牌主张。全自动成片已在真实模型上跑通单集（提示词 → 资产图 → 视频 → 拼接），字幕、配乐与审片尚未纳入；各模型渠道的稳定性与费用以实际为准。

## 配套能力

- 项目中心、文件树、Markdown 阅读编辑与 Wiki 索引
- Harness 持久对话、用户 Skill、模型与 Provider 配置、MCP
- 图片、视频、音频生成及项目媒体任务
- `.canvas`、`.jccanvas` 和桌面 `.jcscene`
- 既有文字同步与桌面更新能力
- 手机控制器：扫码配对后经云端中继连回电脑，在外也能选对话、推进创作、看成果，开始或停止漫剧全自动并审图

桌面端是主产品，现有桌面能力继续保留。Web 面向下载与展示；手机 App 是桌面的控制器，不在手机上独立创作。

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
