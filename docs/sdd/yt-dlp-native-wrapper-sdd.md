# 网页媒体采集 yt-dlp 原生薄 Wrapper SDD

## 1. 目标

把「网页媒体采集」明确收敛为 **yt-dlp 的产品化 UI**。

用户看到的仍然是现在的简单流程：

```text
粘贴链接 -> 解析 -> 选择内容 -> 下载 -> 打开播放 / Finder 显示
```

底层不复刻 yt-dlp，不维护站点规则库，不重建参数模型。后端只做一个薄 Native Wrapper：

```text
前端用户意图 -> 生成 yt-dlp argv -> 调用 bundled yt-dlp -> 回收输出 -> 展示结果
```

核心验收标准：以后 yt-dlp 原仓库升级时，我们可以直接替换 bundled `yt-dlp`，业务代码不需要跟着重写。

## 2. 产品原则

- 工具卡片就是 yt-dlp 的 UI，但用户不需要看到 `yt-dlp`。
- UI 继续保持简单，不显示命令行、参数、PATH、Homebrew、Python、ffmpeg、cookies 等技术概念。
- 不从头重做 UI，不删除现有工作台。
- 不把 yt-dlp 的 extractor、站点策略、参数语义搬进我们代码。
- 不维护「抖音策略」「B站策略」「新片场策略」这种长期会失控的规则库。
- 后端只负责调用、输出、安全和错误脱敏。
- 正式 App 包必须内置 `yt-dlp`、`ffmpeg`、`ffprobe`，用户无需安装。

## 3. 非目标

本 SDD 不做：

- 新 UI 重构。
- 命令行输入框。
- 用户可见高级参数面板。
- 自研下载器。
- 自研站点解析器。
- yt-dlp 参数完整 TypeScript/Rust 模型。
- LLM 自动下载链接。
- 批量爬取或开放式 Agent Loop。

## 4. 保留内容

继续保留：

- `src/components/tools/MediaUrlCapturePanel.vue`
- 工具仓库入口
- `media_url_inspect`
- `media_url_download`
- `cancel_media_url_download`
- `media_open_file`
- `media_reveal_file`
- 默认保存目录：`~/Movies/韭菜盒子/网页媒体/`
- 当前 UI 状态：解析中、准备下载、下载中、完成、取消、错误

这些是产品体验，不是问题来源。

## 5. 需要收缩的内容

后端需要删除或收缩会削弱 yt-dlp 原生能力的逻辑：

- 不再用站点白名单决定是否允许 `--cookies-from-browser`。
- 不再维护复杂站点规则。
- 不再把固定参数写死到无法覆盖。
- 不再让输出识别假设「一次任务只有一个文件」。
- 不再让 yt-dlp 依赖系统 PATH 找 ffmpeg。

保留的默认参数必须只是「UI 意图的默认翻译」，不是能力上限。

## 6. 后端架构

新增或整理为一个内部执行单元：

```text
YtDlpNativeRunner
```

职责：

1. 找到 bundled `yt-dlp`。
2. 找到 bundled `ffmpeg` / `ffprobe`。
3. 根据前端意图生成基础 argv。
4. 合并内部 extra argv。
5. 调用进程。
6. 监听 stdout/stderr。
7. 解析进度。
8. 生成输出 manifest。
9. 返回脱敏错误。

它不做：

- 站点 extractor 逻辑。
- yt-dlp 参数语义解释。
- 用户可见配置。

## 7. argv 生成规则

### 7.1 通用基础参数

所有下载任务默认带：

```text
--no-warnings
--newline
--paths <job_output_dir>
--output %(title).200B [%(id)s].%(ext)s
--print after_move:filepath
--ffmpeg-location <bundled_ffmpeg_path>
```

说明：

- `--print after_move:filepath` 是输出回收核心，优先用 yt-dlp 自己告诉我们的最终文件路径。
- `--paths` 和 `--output` 由 App 控制，避免写出授权目录。
- `--ffmpeg-location` 指向 App 内置 ffmpeg，避免依赖用户机器环境。

### 7.2 解析参数

解析使用：

```text
--dump-single-json
--skip-download
--no-playlist
```

如果解析失败并判断需要浏览器访问状态，重试时追加：

```text
--cookies-from-browser <browser>
```

这项能力是通用 yt-dlp 能力，不限站点白名单。

### 7.3 下载参数

视频：

```text
-f bv*+ba/b
--merge-output-format mp4
```

省空间视频：

```text
-f bv*[height<=720]+ba/b[height<=720]/b
--merge-output-format mp4
```

音频：

```text
-x
--audio-format mp3
```

字幕：

```text
--skip-download
--write-subs
--write-auto-subs
--sub-lang <lang>
--convert-subs srt
```

元数据：

```text
--skip-download
--write-info-json
--write-thumbnail
```

这些只是默认映射。后端必须保留内部 `extraArgs` 合并能力，用于自动重试和未来内部调试。

## 8. 安全边界

薄 Wrapper 不是无边界透传。必须保留以下边界：

- URL 只允许 `http` / `https`。
- 输出目录由 App 生成并授权。
- 用户不能传任意输出路径模板。
- 用户不能传任意 shell 命令。
- 不启用 `--exec`。
- 不启用 `--external-downloader`。
- 不启用 `--plugin-dirs`。
- 不启用 `--config-locations` 指向用户任意路径。
- 不启用 `file://`。
- 错误文案不暴露本地绝对路径、内部 binary 路径或命令行细节。

这些是 App 安全边界，不是 yt-dlp 能力复刻。

## 9. 输出回收

现有「根据文件名前缀猜输出文件」不够稳定。应改为：

1. 优先读取 `--print after_move:filepath` 输出的最终路径。
2. 校验路径必须在当前 job 输出目录下。
3. 对多输出任务生成 manifest。

输出 manifest：

```ts
interface MediaUrlOutputManifest {
  primary?: MediaUrlOutputFile
  files: MediaUrlOutputFile[]
}

interface MediaUrlOutputFile {
  path: string
  filename: string
  kind: 'video' | 'audio' | 'subtitle' | 'metadata' | 'thumbnail' | 'other'
  size?: number
  format: string
}
```

P1 UI 仍可只展示 `primary`，但后端必须能记录多个文件，避免字幕、封面、info json 丢失。

## 10. 升级策略

yt-dlp 必须作为独立组件存在：

- 开发环境可继续优先使用 `/Users/by3/Documents/yt-dlp/yt-dlp.sh`。
- 正式包使用 `src-tauri/binaries/yt-dlp-*`。
- 升级 yt-dlp 时只替换 binary 或源码 checkout。
- Wrapper 不 import yt-dlp 内部 Python 模块。
- Wrapper 不依赖 extractor 文件结构。
- 测试只验证 argv、输出、安全边界，不验证具体站点 extractor 细节。

升级流程：

1. 替换 bundled yt-dlp。
2. 运行 argv 单元测试。
3. 运行本地 smoke test。
4. 打包。

## 11. 实施路径

### P0：外科式收缩

- 保留 UI。
- 保留 Tauri command 名称。
- 抽出 `YtDlpNativeRunner` 或等价内部函数组。
- 下载统一追加 `--ffmpeg-location`。
- 浏览器状态重试使用通用 `--cookies-from-browser`。
- 删除站点白名单 cookies 限制。
- 增加 `--print after_move:filepath`。
- 输出路径从 yt-dlp 返回值回收。

### P1：manifest

- 后端返回多个输出文件。
- UI 暂时仍展示主文件。
- 元数据/字幕/缩略图不丢失。

### P2：内部 extra args

- 后端支持内部 `extraArgs`。
- 前端普通 UI 不展示。
- 自动重试可追加参数。
- 禁止危险参数。

## 12. 验收标准

- 用户流程不变。
- UI 不出现 `yt-dlp`、`ffmpeg`、PATH、Homebrew、安装配置文案。
- 后端调用 yt-dlp 使用标准 argv。
- 下载视频时传入 bundled `--ffmpeg-location`。
- 需要浏览器访问状态时，通用使用 `--cookies-from-browser`，不受站点白名单限制。
- 输出文件优先来自 `--print after_move:filepath`。
- 输出路径必须限制在 job 输出目录内。
- 替换 yt-dlp binary 后，业务代码不需要变。

## 13. 测试要求

Rust 单元测试：

- URL 只允许 http/https。
- 默认视频 argv 包含 `-f`、`--merge-output-format`、`--ffmpeg-location`。
- 浏览器状态 argv 对任意 http/https 站点可追加 `--cookies-from-browser`。
- 危险参数不会从内部 extra args 透传。
- `after_move:filepath` 输出路径必须在 job 输出目录下。
- 多文件输出可生成 manifest。

前端源码约束测试：

- UI 不暴露 `yt-dlp`。
- UI 不暴露安装/配置/能力中心。
- 下载仍走现有 `media_url_download` command。

验证命令：

```bash
cargo test media_url_ --manifest-path src-tauri/Cargo.toml
cargo test media_capture_ --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml -- --test-threads=1
pnpm exec vue-tsc -b
node --test src/components/__tests__/mediaUrlCaptureUi.test.ts
pnpm run test:focused:build
```

