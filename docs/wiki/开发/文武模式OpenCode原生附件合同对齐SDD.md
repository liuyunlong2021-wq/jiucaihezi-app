# 文武模式 OpenCode 原生附件合同对齐 SDD

> 日期：2026-07-21
> 状态：附件翻译与 Provider 回归已实现并通过定向自动验证；正式构建和 Desktop 真实复测待补
> 范围：Desktop 文模式与武模式到 OpenCode v1.17.18 的附件翻译；不改创模式、New API 或 Google Files API。

## 1. 根因链路

`FileUploader` 已冻结上传原件的 `modelValue`、类型和媒体本地缓存路径；`ChatPanel` 也将同一轮的 `modelAttachments` 传给 `useChat`。但 Desktop 分支调用 `buildOpenCodePromptParts()` 时只传入 `images` 和已提取的文字 `files`，故视频、音频、PDF 和其他原件从未进入 `promptAsync`。视频摘要仅进入文字附件，不能代表原件。

同时 `providerProjection.buildModelConfig()` 使用 `supportsVision()` 将能力压缩为 `text + image`。这会让 OpenCode 上游的 `model.capabilities.input` 不知道视频、音频或 PDF 是否真实可读。

根因不是 build 和 plan 的运行时差异，也不是本地媒体工具。二者本应使用同一条 `SubmitOpenCodePromptInput.parts` 合同，差异仅在 agent 的工具权限。

## 2. OpenCode 官方合同

以本机 `/Users/by3/Documents/opencode-official-v1.17.18` 的 v1.17.18 源码为事实源：

- `session/prompt.ts` 接收 `{ type: 'file', url, mime, filename }`；`file://` 经 `fileURLToPath()` 读取原件，最终将该文件 part 记录到 session。图片可能被规范化，但音视频/PDF 不被摘要替代。
- `session/message-v2.ts` 将非 `text/plain` 的 file part 转为 AI SDK 的 `{ type: 'file', url, mediaType, filename }`。
- `provider/transform.ts` 使用 MIME 映射 `image`、`video`、`audio`、`pdf`，只有 `model.capabilities.input[modality]` 为真时保留原件；否则替换为官方明确提示：`ERROR: Cannot read \"filename\" (this model does not support <modality> input). Inform the user.`。
- `agent/agent.ts` 只决定 agent 配置与权限，不创建媒体运行时。

本地 `/Users/by3/Documents/jiucaihezi-opencode` 对上述 prompt、message-v2、agent 文件与官方一致；`transform.ts` 的差异仅为不相干的 provider options，不改变附件 MIME 或能力判断。

## 3. 韭菜盒子翻译边界

韭菜盒子只把已冻结的 `ResolvedDirectAttachment` 翻译为 OpenCode `file` part：

1. Desktop 若有缓存绝对路径，构造 `file://` URL；项目资源路径可由当前 OpenCode 项目目录解析时也构造 `file://` URL。
2. 不存在本地路径时，保留既有 `modelValue` 原件 URL，交给 OpenCode；不重新读取 File，不为文武模式创建另一份 Base64。
3. 本地路径不可用、失效或不能转为 file URL 时，在提交前明确报错，不用摘要、文件名或元数据替代。
4. 普通文本提取继续仅作辅助 text part；原文件仍作为独立 file part 进入 OpenCode。

附件原件只在发送态存在。SQLite、普通消息、日志、Wiki 与持久化的 `DirectAttachmentRef` 只保存身份、资源和缓存路径，绝不保存 `data:` 媒体字节。

## 4. 数据流

```text
用户上传/引用附件
  -> FileUploader 冻结 modelValue、kind、cachePath/resource
  -> ChatPanel 为同一附件生成 modelAttachments 与轻量 attachmentRefs
  -> useChat (build / plan 共用)
  -> buildOpenCodePromptParts
  -> { type: 'file', url: file:// | 原件 URL, mime, filename }
  -> OpenCode promptAsync
  -> OpenCode 读取 file:// 原件
  -> ProviderTransform 按 model.capabilities.input 允许或官方能力错误
```

## 5. 模型能力判断

OpenCode provider 投影必须声明真实输入模态：`text`、`image`、`video`、`audio`、`pdf`。来源是模型目录的 `inputModalities`；现有内部 `file` 语义映射为 OpenCode 的 `pdf`，不再由 `supportsVision()` 推导视频、音频或 PDF。`supportsVision()` 仅保留为模型目录未提供输入模态时的图片向后兼容回退。

OpenCode 是能力裁决者。本层不提前把不支持媒体降级为摘要；由上游的官方能力错误进入模型上下文并提示用户。

## 6. 错误处理

- 没有可读原件 URL：提交前报出“附件原件不存在或已失效”。
- 有效 `file://` 但 OpenCode 读取失败：让 OpenCode 的 session 错误原样反馈。
- 模型不支持 image/video/audio/pdf：保留官方 `ProviderTransform.unsupportedParts()` 错误文本，不在前端另造能力文案。
- 普通文件不属于 OpenCode 的四种 MIME 模态时仍以 file part 发送，交由其 Provider 合同处理。

## 7. 自动测试与人工验收

先写失败测试，覆盖：

- `buildOpenCodePromptParts()` 为 MP4、MOV、WebM、音频、PDF、普通文件保留 `file` part；缓存路径优先为 `file://`。
- 无本地路径时复用原件 URL；无 URL 明确失败。
- `projectNewApiForOpenCode()` 将模型真实输入模态投影为 `text/image/video/audio/pdf`，不是 vision 黑名单推导。
- `useChat` 同时向 build 与 plan 传入同一 `modelAttachments` 合同。
- 消息持久化只拿到轻量 `attachments`，不写 `modelValue` 或 data URL。

Desktop 人工验收：支持视频模型上传 MP4/MOV/WebM 后收到真实 file part；文字模型收到 OpenCode 官方能力提示；图片、音频、PDF、普通文件无回归；build/plan 行为一致；删除缓存原件后提示明确；检查 SQLite 和日志无 Base64。

## 8. 非目标

- 不修改创模式或其 Direct Runtime。
- 不修改 New API、Provider 上传协议，或解决 OpenCode 最终向 Provider 转 Base64 的现有上游实现。
- 不实现 Google Files API，不新建第二套附件系统，不新建 build 独立视频运行时。

## 9. 最终边界

真实 MOV 已证明原件能够进入 OpenCode，通用 `@ai-sdk/openai-compatible` 会在请求到达 NewAPI 前拒绝不支持的 `video/mov`。2026-07-22 曾实验切换 Gemini 模型级 Google Provider，但 22 MB MOV 被转成约 30.8 MB Base64，首轮请求超过 8 分钟无响应；NewAPI 官方最新版又没有 Gemini Files API 上传链路，因此实验已撤销。

现行规则：文武模式保持统一 OpenAI-compatible Provider；自然语言中的视频路径保持普通文字；直接视频附件由官方 Provider返回支持或不支持结果。产品不为视频新增上传、转码、模型切换、第三方工具检测或内置依赖。

## 10. 回归证据与未验证项

- `providerProjection.ts` 不再为 Gemini 增加模型级 `@ai-sdk/google + /v1beta` 覆盖。
- 带自然语言前缀的视频路径不再自动转为项目附件；显式附件仍使用 OpenCode 官方 file part。
- 同一图片同时出现在附件与图片输入时只形成一个 file part，保留既有图片能力。
- Provider、session 和 mediaReference 定向测试 `37/37` 通过；`pnpm exec vue-tsc -b` 与 `git diff --check` 通过。
- 测试证据：`/private/tmp/test result jc-opencode-video-rollback.log`，`sha256:699a755feb75`。
- 未验证：正式 Web/Desktop 构建、Desktop 完整重启后的普通文字/图片/视频附件真实请求、Windows 与 Intel Mac。
