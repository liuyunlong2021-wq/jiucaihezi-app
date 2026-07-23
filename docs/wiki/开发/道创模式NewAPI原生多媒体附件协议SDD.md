# 道创模式 New API 原生多媒体附件协议 SDD

> 日期：2026-07-23  
> 状态：已完成  
> 范围：Web / Desktop 的道模式和创模式直连请求  
> 不涉及：文武 OpenCode、媒体生成、工具降级、New API 服务端改造

## 1. 目标

用户在道模式或创模式上传图片、视频、音频、PDF 或普通文件后，韭菜盒子只做一次当前模型请求，并按 New API 官方已有的内容结构发送原件。

用户体验保持“选择文件，直接发送”。协议包装只发生在网络边界，不能要求用户理解 `image_url`、`video_url`、`input_audio` 或 `file`。

## 2. 根因

当前公共构造器 `src/utils/directMessageBuilder.ts` 只区分两类附件：

```text
图片 -> image_url
其他全部 -> file.file_data
```

因此 MP4 被发送为 `file part(media type video/mp4)`。真实请求已被当前渠道或上游拒绝，错误为：

```text
'file part media type video/mp4' functionality not supported.
```

`src/runtime/direct/modelInputCapabilities.ts` 中的 Gemini 能力登记只说明模型目标能力，不会改变请求协议。把“模型支持视频”当成“所有渠道都接受视频 file part”是错误假设。

## 3. 官方事实

当前 New API 官方源码的 OpenAI 兼容消息合同已经区分：

| 原件 | New API 内容类型 | 数据字段 |
|---|---|---|
| 图片 | `image_url` | `image_url.url` |
| 视频 | `video_url` | `video_url` |
| 音频 | `input_audio` | `input_audio.data` + `input_audio.format` |
| PDF / 其他文件 | `file` | `file.filename` + `file.file_data` |

证据：

- `dto/openai_request.go` 定义 `ContentTypeImageURL`、`ContentTypeVideoUrl`、`ContentTypeInputAudio` 和 `ContentTypeFile`。
- `MediaContent.ToFileSource()` 将四类结构统一转换为 New API 内部文件源。
- Gemini 转换器再把文件源转换为 Gemini `inlineData`，并校验真实 MIME。

本 SDD 只使用这些现有结构，不新增自定义字段，不维护 New API Fork。

## 4. 唯一发送合同

```text
用户文字 + 本轮原始附件
  -> MIME 归一化
  -> 根据真实 MIME 选择 New API 内容类型
  -> 一次当前模型请求
  -> New API 按实际渠道转换或返回真实能力错误
```

### 4.1 映射规则

1. `image/*` 使用 `{ type: "image_url", image_url: { url } }`。
2. `video/*` 使用 `{ type: "video_url", video_url: dataUrlOrUrl }`。
3. `audio/*` 使用 `{ type: "input_audio", input_audio: { data, format } }`：
   - `data` 只包含 Base64 数据，不包含 `data:...;base64,` 头；
   - `format` 使用 MIME 子类型，如 `wav`、`mpeg`。
4. 其他 MIME 使用 `{ type: "file", file: { filename, file_data } }`。
5. 浏览器常见 MIME 别名归一化继续生效，例如 `video/quicktime -> video/mov`、`video/x-msvideo -> video/avi`、`video/x-ms-wmv -> video/wmv`、`video/x-flv -> video/flv`。
6. 同一个原件只发送一次，不同时发送 `file` 和 `video_url`。

### 4.2 模式边界

- 道模式：无系统提示词、无工具、无 Skill、无 Wiki、无项目上下文；附件映射后只请求一次当前模型。
- 创模式：复用同一附件映射；工具和 Skill 的现有逻辑不改变。
- 文武模式：继续完全使用 OpenCode 官方附件合同，本 SDD 不修改。

## 5. 明确不做

- 不自动切换 Gemini 或其他模型。
- 不用 FFmpeg、OCR、Whisper 或本地工具替代原件。
- 不根据错误自动用另一种协议重试。
- 不新增 Google Files API、上传服务或短时 URL 服务。
- 不修改 New API 源码或生产渠道配置。
- 不执行创作模式双端统一 SDD 的其他 UI、会话或渐进工具任务。

## 6. 实施文件

| 文件 | 修改 |
|---|---|
| `src/runtime/direct/newApiAttachments.ts` | 将浏览器常见视频 MIME 别名归一为 New API Gemini 官方白名单 |
| `src/utils/directMessageBuilder.ts` | 把非图片统一 `file` 改成四类官方映射；增加最小 Data URL 音频解析 |
| `src/utils/__tests__/directMessageBuilder.test.ts` | 覆盖 MP4、MOV、WAV、MP3、PDF 和未知文件的准确请求结构 |
| `src/composables/__tests__/chatCloud.test.ts` | 验证道模式视频仍只有一次请求，且请求体为 `video_url` |
| `src/composables/__tests__/creativeChat.test.ts` | 验证创模式 Desktop 请求同样使用唯一 `video_url` |
| `src/runtime/direct/directAttachmentErrors.ts` | 让现有附件错误提示识别四类原生附件 part |
| `src/runtime/direct/__tests__/directAttachmentErrors.test.ts` | 验证 `video_url` 请求仍获得明确附件错误提示 |

## 7. TDD 顺序

1. 先把 MP4/MOV 期望改为 `video_url`，WAV/MP3 期望改为 `input_audio`，运行并确认现实现失败。
2. 最小修改 `buildOpenAiAttachmentParts()`，让测试转绿。
3. 验证 PDF 和未知文件仍为 `file.file_data`，图片仍为 `image_url`。
4. 验证道模式无工具、无系统提示词、单次请求合同不变。
5. 运行类型检查、focused 测试和 Desktop 构建审计。

## 8. 验收标准

### 自动验收

1. MP4 和 MOV 不再产生 `file` part，只产生一个 `video_url` part。
2. WAV 和 MP3 不再产生 `file` part，只产生一个 `input_audio` part。
3. PDF 和普通文件继续使用 `file.file_data`。
4. 图片继续使用 `image_url`。
5. 道模式视频请求没有 `tools`、`system`、固定 `max_tokens`，且总请求次数为 1。
6. Web 与 Desktop 直连共用同一个构造器，不出现模式专属附件协议。
7. 文武 OpenCode 文件不发生改动。

### 人工验收

| 场景 | 预期 |
|---|---|
| 道模式 + Gemini 3.5 Flash + MP4 | 当前模型直接分析，不出现 `file part media type video/mp4` |
| 道模式 + Gemini 3.5 Flash + MOV | MIME 归一为 `video/mov` 后直接分析 |
| 道模式 + 支持音频模型 + WAV/MP3 | 原始音频进入当前模型 |
| 道模式 + PDF | PDF 原件进入当前模型；不查 Wiki、不调用工具 |
| 当前渠道不支持某类原件 | 展示 New API 或上游真实能力错误，不自动降级 |

## 9. 风险

- New API 的协议结构正确不等于每个渠道都支持对应媒体。渠道不支持时必须保留真实错误。
- Base64 仍受 New API 请求体、反向代理和上游大小限制；本轮继续使用已有 128 MiB 最终 JSON 预算，不扩大限制。
- 真实生产验收必须使用用户当前 Provider/K；自动测试只能证明请求合同，不能代替上游能力验证。

## 10. 实施结果

已按本 SDD 完成，未修改文武 OpenCode、New API 服务端、模型切换、工具降级或创模式其他流程。

自动验证：

- 协议、道模式、创模式和附件错误定向回归：`49/49` 通过。
- TypeScript：`pnpm exec vue-tsc -b` 通过。
- Desktop：`pnpm run build:desktop:quick` 通过，分发目录审计通过。
- Rust：`397` 通过、`1` 忽略、`0` 失败。
- `pnpm run test:focused` 的 Node focused runner 在既有媒体测试完成后未退出，无法作为通过证据；该残留进程已清理。协议相关定向测试和 `pnpm run test:tauri` 均单独通过。
- 补丁格式：`git diff --check` 通过。

仍需人工验收：使用真实 Desktop/Web、真实 New API 渠道及支持相应输入的模型，分别发送 MP4、MOV、WAV/MP3、PDF。自动测试证明发送协议正确，不替上游模型和渠道作能力承诺。
