# FK 参考图上传 Load failed 与桌面原生 HTTP 修复

## 结论与证据

用户报告「特价渠道 MiniMax H3-768p」在本 App 失败，而按对外 API 文档制作的 App 成功。

- 本机任务 `mtask_muxi2t41_mmgh`：模型 `ft-video-v1-77e8ee7a636f15dac27b2ce6d6fcd746`，带两张参考图，错误 `Load failed`、阶段 submit，没有上游任务 ID 或轮询地址。
- `uploadCreationAsset` 先把本地参考素材以 FormData 上传到公网 `/api/creations/uploads`。原 `canUseRustFetch` 仅支持文本正文，FormData 被排除后使用 WebView fetch。
- 公网上传接口对桌面来源 `tauri://localhost`、`https://tauri.localhost` 的 OPTIONS 响应缺少 `Access-Control-Allow-Origin`，导致 WebView 跨域上传失败。
- 使用原生 HTTP 实际上传小型诊断 PNG 返回 200，公开读取成功且字节一致；模型列表也包含该 FK 模型。未提交收费视频任务。

因此，本次失败发生在参考图上传链路，未进入 FK 生成阶段；插件缺失不是本次原因。外部 App 是否使用服务端请求或公开素材 URL，仍应以其实现为准。

## 修复

- `src/utils/httpClient.ts`：桌面 FormData/Blob 请求走既有 Rust HTTP 桥接；使用 Request 一次生成 multipart 正文与边界头，二进制经 base64 跨桥传输；素材上传超时保持 120 秒。
- `src-tauri/src/commands/http.rs`：新增可选 `body_base64`，解码后按原始字节提交；文本请求兼容原合同。
- multipart Request 归一化使用 Blob，避免 text() 损坏参考图片。

## 验证与边界

- 修复前新增路由回归失败；修复后 HTTP 测试 13/13 通过，涵盖 multipart 边界、鉴权、中文字段和 70,000 字节二进制保真。
- Rust 本地 HTTP 上传回归 1/1 通过，断言实际请求的原始字节、边界和鉴权。
- 创作运行时回归 41/41 通过；`pnpm run typecheck`、`git diff --check` 通过。
- 公网真实素材上传与读取已验证；实际视频生成、安装版 UI、Windows/Intel 实机未验收。
- 当前已发布 v2.2.18 不包含此修复；源码修改尚未发布。用户需要更新包含修复的安装包后再使用本地参考图。
