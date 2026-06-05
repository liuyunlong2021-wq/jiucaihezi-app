# 网页媒体采集主动工具 SDD

## 1. 目标

把网页视频/音频下载能力做成韭菜盒子 Studio 的内置主动工具，产品形态对齐现有「格式转换」工具。

用户只需要：

1. 打开 App。
2. 进入「工具仓库」。
3. 运行「网页媒体采集」。
4. 粘贴链接。
5. 解析。
6. 下载到本地。
7. 打开文件或在 Finder 中显示。

用户不需要安装、配置、修复或理解 `yt-dlp`。`yt-dlp` 只是 App 内部采集组件，不是用户可见能力。

## 2. 产品原则

- 这是主动工具工作台，不是对话 Agent，不是自动爬虫，不是开放式下载器。
- 用户必须显式粘贴 URL；系统不自动搜索、不自动从聊天历史抓 URL、不替用户选择下载目标。
- 先解析再下载。解析用于让用户确认标题、来源、时长、缩略图和可采集内容。
- 下载动作必须由用户点击触发。写入本地文件前，用户已看到下载类型和保存位置。
- 工具直接可用。正式 App 包必须内置采集组件，不出现「未检测到 yt-dlp」「请配置 yt-dlp」「等待配置」。
- UI 不暴露第三方运行时概念、命令行参数、PATH、Python、Homebrew、依赖安装。
- LLM Tool 暴露是后续扩展，当前主路径不依赖聊天区「本地能力」开关。

## 3. 与 CLAUDE.md 的一致性

本方案遵循 `CLAUDE.md` 的本地工具原则：

- 桌面端直接提供本地工具运行层。
- 用户侧只看见「工具仓库」和具体业务工具，不暴露额外网关、端口或第三方运行时概念。
- Tool 独立存在，默认不暴露给 LLM；用户主动进入工具仓库运行，不等于开启 LLM 工具调用。
- 新增工具优先接入现有工具仓库、前端工具面板和 Rust command，不增加用户可见配置。

因此，「网页媒体采集」不进入 `localCapabilities.ts`，不进入本地能力中心，不要求用户完成配置。

## 4. 参考模式：格式转换

「网页媒体采集」参考 `FormatConverterPanel.vue` 的主动工具模式：

- 工具仓库卡片点击「运行」进入独立子面板。
- 子面板负责输入、队列、选项、进度、取消、结果和后续动作。
- 后端通过 Tauri command 执行真实本地任务。
- 前端只传结构化参数，不拼接命令行。
- 完成后提供打开文件、打开目录等用户动作。
- 底层 runtime 不教育用户，不把内部依赖变成用户任务。

差异：

- 格式转换的输入是本地文件路径；网页媒体采集的输入是用户粘贴 URL。
- 格式转换可批量转换文件；网页媒体采集 P1 可以先支持单任务，但 UI 按任务队列设计，方便后续支持多链接。

## 5. 用户流程

以用户粘贴新片场链接为例：

1. 用户打开「工具仓库」。
2. 用户点击「网页媒体采集」卡片上的「运行」。
3. 页面进入网页媒体采集工作台。
4. URL 输入框直接可用。
5. 用户粘贴新片场视频链接。
6. 用户点击「解析」。
7. 系统显示解析结果：
   - 缩略图
   - 标题
   - 来源站点
   - 时长
   - 可采集内容：视频、音频、字幕、元数据
8. 用户选择下载内容：
   - 视频：最佳 / 省空间
   - 音频：mp3 / wav
   - 字幕：中文 / 英文 / 自动
   - 元数据：JSON
9. 用户确认保存位置，默认 `~/Movies/韭菜盒子/网页媒体/`。
10. 用户点击「开始下载」。
11. 系统显示阶段进度：
    - 正在获取媒体信息
    - 正在下载
    - 正在处理输出
    - 正在写入本地文件
12. 下载完成后显示结果卡片：
    - 文件名
    - 文件大小
    - 时长
    - 格式
    - 保存位置
13. 用户点击「打开播放」或「在 Finder 中显示」。

## 6. 工具仓库入口

`ToolWarehousePanel.vue` 保持现有主动工具入口模式。

工具卡：

```text
名称：网页媒体采集
图标：download
分类：音视频
风险：可生成
描述：从用户提供的链接下载视频、音频、字幕或元数据。
标签：视频下载 / 字幕 / 音频 / 网页媒体
```

说明：

- 标签不需要显示 `yt-dlp`。
- 点击「运行」只打开工作台，不直接解析或下载。
- 该入口不受聊天区 Tool 开关影响；这是用户在工具仓库里的显式操作。

## 7. 工作台 UI

组件：`MediaUrlCapturePanel.vue`

### 7.1 顶部

```text
[返回] 网页媒体采集
       把用户提供的链接变成本地素材
```

### 7.2 URL 输入区

```text
[link] [粘贴视频/音频网页链接                         ] [解析]
```

规则：

- 空 URL 禁用「解析」。
- 非 `http/https` 链接前端直接提示无效。
- 解析中禁用输入框和按钮。
- 不显示本地组件检测状态。
- 不显示安装、配置、修复、更新。

### 7.3 任务列表

P1 可只有一个任务，但 UI 结构按任务卡设计：

```text
[缩略图] 新片场作品标题
来源：新片场 · 03:42
可采集：视频 / 音频 / 字幕 / 元数据

下载内容：[视频] [音频] [字幕] [元数据]
选项：最佳 / 省空间
状态：等待下载
```

下载中：

```text
正在下载视频 · 42%
[进度条]
```

完成：

```text
下载完成
新片场作品标题.mp4
128 MB · 03:42 · MP4
保存位置：~/Movies/韭菜盒子/网页媒体/
[打开播放] [在 Finder 中显示]
```

### 7.4 底部工具条

参考格式转换：

```text
保存到：~/Movies/韭菜盒子/网页媒体/       [更改位置]
任务：等待 1 · 下载中 0 · 完成 0          [开始下载]
```

P1 如果暂不启用「更改位置」，仍展示保存位置，但按钮 disabled 或隐藏。

### 7.5 状态机

```text
empty
  -> inspecting
  -> ready
  -> downloading
  -> done

任意执行态 -> error
downloading -> cancelled
error -> empty 或 inspecting
done -> empty
```

| 状态 | UI 行为 |
| --- | --- |
| empty | 等待用户粘贴链接 |
| inspecting | 禁用输入，显示解析中 |
| ready | 显示解析结果、下载类型和保存位置 |
| downloading | 锁定下载选项，显示阶段进度 |
| done | 显示输出文件和后续动作 |
| cancelled | 显示已停止，可重新下载 |
| error | 显示业务错误和重试入口 |

## 8. 前端数据结构

```ts
type MediaUrlTaskStatus =
  | 'empty'
  | 'inspecting'
  | 'ready'
  | 'downloading'
  | 'done'
  | 'cancelled'
  | 'error'

type MediaUrlDownloadKind = 'video' | 'audio' | 'subtitles' | 'metadata'

interface MediaUrlInspectResult {
  id: string
  url: string
  title: string
  site: string
  durationSeconds?: number
  thumbnailUrl?: string
  hasVideo: boolean
  hasAudio: boolean
  hasSubtitles: boolean
  hasMetadata: boolean
}

interface MediaUrlDownloadOptions {
  kind: MediaUrlDownloadKind
  videoQuality?: 'best' | 'compact'
  audioFormat?: 'mp3' | 'wav'
  subtitleLanguage?: 'zh' | 'en' | 'auto'
  outputDir?: string
}

interface MediaUrlDownloadOutput {
  filename: string
  outputPath: string
  outputDir: string
  size?: number
  durationSeconds?: number
  format: string
}

interface MediaUrlTask {
  id: string
  jobId: string
  status: MediaUrlTaskStatus
  url: string
  inspect?: MediaUrlInspectResult
  options: MediaUrlDownloadOptions
  progress: number
  detail: string
  output?: MediaUrlDownloadOutput
  error?: string
  startedAt?: number
  finishedAt?: number
}
```

P1 可以组件内 `ref` 管理，不新增 Pinia store。后续若支持下载历史或多任务持久化，再考虑 store。

## 9. Rust 命令

新增 Tauri commands：

```text
media_url_inspect
media_url_download
cancel_media_url_download
media_open_file
media_reveal_file
```

### 9.1 `media_url_inspect`

输入：

```ts
interface MediaUrlInspectInput {
  url: string
  jobId?: string
}
```

输出：

```ts
interface MediaUrlInspectOutput {
  status: 'success' | 'error'
  id: string
  url: string
  title: string
  site: string
  durationSeconds?: number
  thumbnailUrl?: string
  hasVideo: boolean
  hasAudio: boolean
  hasSubtitles: boolean
  hasMetadata: boolean
  message: string
  error?: string
}
```

### 9.2 `media_url_download`

输入：

```ts
interface MediaUrlDownloadInput {
  url: string
  kind: 'video' | 'audio' | 'subtitles' | 'metadata'
  videoQuality?: 'best' | 'compact'
  audioFormat?: 'mp3' | 'wav'
  subtitleLanguage?: 'zh' | 'en' | 'auto'
  outputDir?: string
  jobId?: string
}
```

输出：

```ts
interface MediaUrlDownloadOutput {
  status: 'success' | 'error'
  filename: string
  outputPath: string
  outputDir: string
  size?: number
  durationSeconds?: number
  format: string
  message: string
  error?: string
}
```

### 9.3 进度事件

事件名：

```text
media-url-capture-progress
```

Payload：

```ts
interface MediaUrlCaptureProgress {
  jobId: string
  url: string
  progress: number
  message: string
  phase: 'inspect' | 'download' | 'postprocess' | 'write'
}
```

### 9.4 打开文件

- `media_open_file({ path })`：用系统默认播放器打开下载输出。
- `media_reveal_file({ path })`：在 Finder 中显示下载输出。

这两个命令只能接受后端确认过的输出文件路径，不接受任意前端路径。

## 10. 内置采集组件打包

正式产品必须内置平台对应采集二进制。用户不安装任何依赖。

建议采用 Tauri sidecar / externalBin：

```text
src-tauri/binaries/
  yt-dlp-aarch64-apple-darwin
  yt-dlp-x86_64-apple-darwin
  yt-dlp-x86_64-pc-windows-msvc.exe
```

`tauri.conf.json`：

```json
{
  "bundle": {
    "externalBin": [
      "binaries/yt-dlp"
    ]
  }
}
```

构建规则：

- macOS ARM 包必须包含 `yt-dlp-aarch64-apple-darwin`。
- macOS Intel 包必须包含 `yt-dlp-x86_64-apple-darwin`。
- Windows 包必须包含 `yt-dlp-x86_64-pc-windows-msvc.exe`。
- 缺少目标平台二进制时构建失败。
- 二进制版本跟随 App 版本更新，不提供用户可见的独立更新入口。

开发规则：

- 开发环境可以 fallback 到 `/Users/by3/Documents/yt-dlp/yt-dlp.sh` 或 PATH 中的 `yt-dlp`。
- fallback 只用于开发调试，不出现在用户 UI，不作为正式包依赖。
- 正式包运行时优先且必须使用 App 内置二进制。

## 11. 安全边界

### 11.1 URL

Rust 侧必须二次校验 URL：

- 只允许 `http` / `https`。
- 拒绝空 host。
- 拒绝 `file`、`data`、`javascript`、`ftp` 等协议。
- P1 不支持 cookies、浏览器登录态、私密站点下载。
- 不从页面内容或聊天历史自动提取 URL。

### 11.2 命令参数

前端不得传任意命令行参数。Rust 侧只允许固定映射：

| 用户选项 | 内部映射 |
| --- | --- |
| 视频 / 最佳 | 受控的视频下载参数 |
| 视频 / 省空间 | 受控的小体积视频参数 |
| 音频 / mp3 | 受控音频提取参数 |
| 音频 / wav | 受控音频提取参数 |
| 字幕 / 语言 | 受控字幕参数 |
| 元数据 | 受控 JSON 写出参数 |

禁止：

- 用户输入 `format_id`
- 用户输入额外 flags
- 用户输入 output template
- 用户输入 cookies 路径
- 用户输入代理参数

### 11.3 输出路径

- 默认输出目录：`~/Movies/韭菜盒子/网页媒体/`。
- 用户选择输出目录时，Rust 侧必须 canonicalize。
- `media_url_download` 返回的 `outputPath` 必须来自实际写入结果。
- 前端不得拼接可信输出路径。
- `media_open_file` / `media_reveal_file` 只能打开下载任务产生的输出文件。
- 拒绝路径遍历、符号链接逃逸和任意用户路径。

### 11.4 错误脱敏

前端不展示：

- 完整本地路径
- 完整命令行
- cookie
- token
- 代理地址
- 内部二进制路径

内部日志可以记录脱敏后的诊断信息。

## 12. 错误文案

用户只看到业务错误：

| 错误 | 文案 |
| --- | --- |
| invalid_url | 链接无效，请粘贴 http 或 https 开头的网页地址。 |
| unsupported_site | 当前链接暂不支持解析，请换一个链接重试。 |
| no_media | 没有找到可下载的视频、音频或字幕。 |
| login_required | 该内容可能需要登录，当前版本暂不支持登录态下载。 |
| timeout | 操作超时，请稍后重试或检查网络。 |
| download_failed | 下载失败，请重试或更换采集类型。 |
| internal_runtime_error | 媒体采集失败，请重试或换一个链接。 |

禁止出现：

- 未检测到 yt-dlp
- 请安装 yt-dlp
- 请配置 PATH
- 请安装 Python
- 请去本地能力中心配置

## 13. 与 LLM Tool 的关系

P1 主路径是用户主动点击工具仓库运行，不依赖 LLM。

后续如果要让 LLM 调用网页媒体采集，需要单独接入 ToolConnection：

- Tools off 时不暴露。
- 只有用户显式开启/选择工具后才暴露。
- URL 必须来自用户明确提供。
- 写入本地文件前需要遵守高风险工具确认边界。
- 工具结果以文件卡片或 Tool result 返回，不让 JSON 污染主阅读流。

这不是 P1 范围。

## 14. 实施范围

### P1 必做

- 工具仓库入口。
- `MediaUrlCapturePanel.vue` 按主动工具工作台重构。
- 去掉 yt-dlp 本地能力中心依赖。
- Rust 命令：
  - `media_url_inspect`
  - `media_url_download`
  - `cancel_media_url_download`
  - `media_open_file`
  - `media_reveal_file`
- App 内置二进制路径解析。
- 开发 fallback。
- 进度事件。
- 输出文件打开 / Finder 显示。
- 单任务工作流。
- 测试覆盖。

### P1 可延后

- 多链接批量队列。
- 下载历史。
- 加入对话。
- 转写字幕。
- 抽取音频。
- 加入知识库 raw。
- 用户自选保存目录。

### 非目标

- 不让用户安装 yt-dlp。
- 不让用户配置 yt-dlp。
- 不接本地能力中心。
- 不实现自动搜索视频。
- 不实现播放列表批量下载。
- 不实现 cookies 或浏览器登录态下载。
- 不暴露任意命令行参数。
- 不默认保存到桌面。
- 不让 LLM 自主决定下载 URL。
- 不新增全局媒体库。

## 15. 测试与验收

### 15.1 前端测试

- 工具仓库出现「网页媒体采集」卡片。
- 点击「运行」进入采集工作台。
- 工作台不包含 `yt-dlp`、安装、配置、本地能力中心文案。
- 空 URL 禁用「解析」。
- 非 `http/https` URL 显示业务错误。
- 解析中输入框禁用。
- 解析成功显示标题、来源、时长、缩略图、可采集内容。
- 用户能切换视频、音频、字幕、元数据。
- 下载中锁定下载选项。
- 完成卡片显示文件名、格式、大小、保存位置。
- 完成卡片显示「打开播放」「在 Finder 中显示」。
- 返回后回到工具仓库。

### 15.2 Rust 测试

- 内置二进制路径按平台解析。
- 正式包缺失内置二进制时构建校验失败。
- 开发 fallback 能识别本机源码路径，但不会成为正式包依赖。
- URL 校验拒绝非 `http/https`。
- 输出目录 canonicalize。
- `media_open_file` / `media_reveal_file` 拒绝非下载输出路径。
- 错误脱敏不泄露本地路径和命令行。

### 15.3 手动验收

- 打开 App 后无需任何配置即可进入工作台。
- 粘贴新片场链接后可解析。
- 下载视频后文件写入默认目录。
- 点击「打开播放」可用系统播放器打开。
- 点击「在 Finder 中显示」定位到文件。

## 16. 需要回滚的旧方向

实施时需要移除或废弃以下旧逻辑：

- `localCapabilities.ts` 中的 `ytdlp` 能力。
- `MediaUrlCapturePanel.vue` 中的 `requiresYtdlpSetup` 门禁。
- `jc_ytdlp_detected`、`jc_ytdlp_path`、`jc_ytdlp_version` 作为 UI 状态依赖。
- `ytdlp_detect` 作为用户可见能力检测入口。
- 「未检测到 yt-dlp，请先在本地能力中心完成配置。」文案。

开发 fallback 可保留在 Rust 内部二进制解析中，但不得影响正式 UI。
