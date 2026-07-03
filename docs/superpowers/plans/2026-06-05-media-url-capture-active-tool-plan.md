# 网页媒体采集主动工具执行计划

## 目标

按照 `docs/sdd/yt-dlp-media-capture-ui.md` 落地 P1：把网页视频/音频下载做成工具仓库里的主动工具，用户只看到「粘贴链接 -> 解析 -> 下载 -> 打开/显示文件」，不需要安装、配置、检测或理解 yt-dlp。

## 范围

- 前端：`MediaUrlCapturePanel.vue`、`ToolWarehousePanel.vue`、`toolRegistry.ts`
- 能力中心：从 `localCapabilities.ts` 移除网页媒体采集，不再作为用户配置项
- Rust：新增 `media_url_inspect`、`media_url_download`、`cancel_media_url_download`、`media_open_file`、`media_reveal_file`
- 测试：更新前端源码约束测试、能力中心测试、Rust 参数/URL/路径测试

## 步骤

1. 写失败测试，锁定产品口径：前端不出现 yt-dlp/检测/配置/能力中心文案，工具卡不显示 yt-dlp 标签，能力中心不含 ytdlp。
2. 删除旧的 `ytdlp_detect` 用户可见检测链路。
3. 实现主动工具 UI：URL 校验、解析、下载、进度、取消、结果、打开播放、Finder 显示。
4. 实现 Rust 命令：结构化参数、http/https URL 白名单、输出目录、内部采集组件解析、下载进程、取消和安全打开文件。
5. 运行聚焦测试、TypeScript 检查和 Rust 检查。

## 验收标准

- 工具仓库可打开「网页媒体采集」工作台。
- 用户粘贴 URL 后可直接解析，不显示任何本地组件配置入口。
- 下载完成后可打开文件或在 Finder 中显示。
- `localCapabilities.ts` 不再注册 ytdlp 能力。
- App 正式包需要内置采集组件；开发环境可使用本机 `/Users/by3/Documents/yt-dlp` 作为调试后备。
