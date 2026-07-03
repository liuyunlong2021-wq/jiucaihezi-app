# Web Cloud Mode P0 Plan

## Goal

让 Web Runtime 在不触发 OpenCode 和本地工具的前提下，完成用户可用的云端对话闭环：登录后可选模型、可选 Skill、可上传文本/图片附件、可发送消息并收到 NewAPI 回复，同时保留现有创作面板。

## Non-goals

P0 不做以下内容：

- 不接 OpenCode Web 版。
- 不做远程 Shell。
- 不做本地项目读写。
- 不做浏览器控制。
- 不做本地 ffmpeg / Whisper。
- 不做复杂云端知识库同步。
- 不改桌面端 OpenCode 主路径。

## Existing Assets

当前代码已经具备 P0 所需的大部分基础：

- `src/composables/useChat.ts` 已有 `sendWebCloudMessage()`，Web Runtime 会强制进入云端对话。
- `src/components/chat/ChatPanel.vue` 已有 `isWebRuntime`，Web 中隐藏 slash / shell / 项目目录等桌面入口。
- `src/components/chat/SkillPickerBar.vue` 已支持 Web mode，并使用内置 Skill 列表。
- `src/components/chat/FileUploader.vue` 已作为聊天附件入口存在。
- 创作面板和媒体生成已统一走 NewAPI Token，可作为 shared 能力保留。

## Implementation Steps

1. 固化 Web Cloud Mode 文档和测试口径。
2. 确认 Web Runtime 发送消息时只走 NewAPI，不进入 OpenCode。
3. 将 Web 云端回复改为流式 `stream: true`，复用现有 OpenAI-compatible SSE 解析。
4. 让 Web 图片附件以 OpenAI-compatible `image_url` 消息格式发送给 vision 模型；非 vision 模型暂由模型端或后续 image bridge 处理。
5. 保留文本类附件注入：`.txt`、`.md`、`.csv`、`.json` 等通过浏览器读取后拼入上下文。
6. 补充测试，验证：
   - Web Runtime 不含 OpenCode 执行路径。
   - Web Runtime 云端请求使用 `stream: true`。
   - Web Runtime 能把选择的 Skill 注入 system prompt。
   - Web Runtime 能携带图片附件消息。
   - Desktop Runtime OpenCode 路径仍存在。

## Acceptance Criteria

- Web 端用户能登录后发送普通文本消息并收到回复。
- Web 端用户选择 Skill 后，回复按 Skill 约束执行。
- Web 端用户上传文本类附件后，附件内容进入对话上下文。
- Web 端用户上传图片后，图片进入云端模型请求。
- Web 端不会启动 OpenCode、Shell、本地项目读写或 Tauri 本地工具。
- 桌面端现有 OpenCode 能力不被移除。
- `pnpm test:focused:build`、`pnpm exec vue-tsc -b`、相关 focused tests 通过。

## Deployment Model

同一 GitHub 仓库继续产出两类发布物：

- Web：Vite build 后部署到 Cloudflare Pages 或等价静态托管。
- Desktop：Tauri build 打包桌面 App。

Gateway 继续作为 Cloudflare Worker 单独部署，负责账号、鉴权、登录中转和已有云端 API 入口。

