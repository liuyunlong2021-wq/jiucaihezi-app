# Web Cloud Mode Positioning

## Product Definition

韭菜盒子 Studio 是一个统一产品，不是桌面端和 Web 端两个互相分裂的产品。当前仓库承载同一套 Studio 核心体验，并通过运行时边界提供两种发布物：

- Desktop Runtime：Tauri 桌面端，提供完整本地工作台能力。
- Web Runtime：浏览器端，提供云端 Skill 工作台能力。

两端共享账号、模型、Skill、对话体验、附件上传、创作面板、Markdown 渲染和基础会话能力。差异只来自运行时权限和可执行能力。

## Runtime Boundary

Desktop Runtime 可以使用：

- OpenCode
- 本地项目读写
- Shell / 终端
- Tauri 文件系统
- 可见浏览器控制
- 本地 ffmpeg / Whisper / 资料转换链路
- 本地能力中心
- NewAPI 云端对话
- Skill、附件、创作面板

Web Runtime 可以使用：

- NewAPI 云端对话
- 手动选择 Skill
- 文档上传和图片上传
- 云端可用的 Office / 文档转换接口
- 创作面板的图片、视频、音频生成
- 登录、充值、使用日志
- 会话历史和基础 Web 存储
- Markdown、代码高亮、KaTeX、Mermaid 渲染

Web Runtime 不使用：

- OpenCode
- Shell / 终端
- 本地项目读写
- Tauri 文件系统
- 可见 Chrome 控制
- 本地 ffmpeg / Whisper
- 本地能力中心

## Execution Principle

Web Runtime 必须走显式、可控、云端可用的执行链：

```text
用户选择模型
用户选择 Skill（可为空）
用户上传附件（可为空）
用户发送消息
前端组装 system + messages
NewAPI /v1/chat/completions 返回回复
```

Web Runtime 不做自主 Agent，也不自动选择 Skill、Knowledge、Tool 或 Model。

## Development Rule

以后新增功能必须先标注运行时：

- `shared`：Web 和 Desktop 都可用。
- `desktop-only`：只在 Tauri 桌面端可用。
- `web-only`：只在浏览器端可用。

默认优先写成 shared。凡是依赖 Tauri、Shell、本地路径、OpenCode、Chrome 控制或本地进程的功能，必须显式标记为 desktop-only，并在 Web Runtime 中隐藏或禁用。

