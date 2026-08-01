# ZX Grok 视频独立适配器 SDD

> 日期：2026-08-01
> 状态：已实现，待服务器部署与真实任务验收
> 范围：为 ZX `grok-1.5-video-6s/10s/15s` 提供协议转换；不修改 NewAPI 源码，不影响 RunningHub、Jina 或其他渠道。

## 1. 背景与根因

ZX 文档确认三个模型使用固定时长模型名，创建合同为：

- `POST /v1/videos`
- `multipart/form-data`
- `model`、`prompt`、`size=1280x720`、`input_reference` 文件均为必需字段
- 不发送 `seconds`
- 查询 `GET /v1/videos/{task_id}`
- 完成后读取 `video_url`，不调用 `/content`

当前 NewAPI 96 渠道直接指向 `https://img-api.zxcode.vip`，APP 发送的是标准 JSON 视频请求。6 秒真实任务虽然创建成功，但上游最终返回“流处理结束但未收到完成或错误事件”。问题是协议不匹配，不能据此判定模型不可用。

## 2. 目标架构

```text
APP / Web
  -> NewAPI /v1/videos（鉴权、计费、渠道选择）
  -> zx-video-adapter（独立协议转换服务）
  -> ZX POST /v1/videos（multipart/form-data）

APP / Web
  <- NewAPI 轮询 /v1/videos/{id}
  <- zx-video-adapter 查询 ZX 任务并返回 OpenAI 视频状态
```

### 2.1 服务边界

`zx-video-adapter` 只负责：

1. 接收 NewAPI 转发的标准视频 JSON。
2. 校验固定模型名、提示词、单张参考图和 `size`。
3. 将 URL 或 data URL 参考图下载/解码为 multipart 的 `input_reference` 文件。
4. 不发送 `seconds`，模型名决定 6/10/15 秒。
5. 保存并透传 ZX 上游任务 ID。
6. 查询 ZX 状态并映射为 `processing`、`in_progress`、`completed`、`failed`。
7. 完成时透传 `video_url`；不代理 `/content`。

它不负责用户鉴权、余额、价格、退款或模型列表。

## 3. NewAPI 兼容与升级边界

- 不 fork NewAPI，不修改 Go 源码，不增加自定义数据库表。
- NewAPI 继续使用官方镜像和官方升级路径。
- 96 渠道的上游 Key 仍由 NewAPI 保存；适配器只从内部请求的 Bearer 头取得本次渠道 Key 并转发，日志不得记录 Key。
- 上线前优先复制 96 渠道为临时验证渠道，把 Base URL 指向适配器；原 96 直连配置保留，失败可立即切回。
- 适配器采用现有独立 FastAPI/Docker 服务模式，类似 `rh-adapter`、`jina-adapter`，与 NewAPI 通过内网通信。

## 4. 请求合同

适配器对 NewAPI 接受最小 OpenAI 视频请求：

```json
{
  "model": "grok-1.5-video-6s",
  "prompt": "让主体缓慢自然地运动",
  "image": "https://.../reference.jpg",
  "size": "1280x720"
}
```

兼容现有客户端的 `image`、`images` 或 `reference_images` 输入，但最终只允许一张，并统一转成 ZX 的 `input_reference` 文件字段。请求不接受或忽略 `seconds`，固定时长由模型名决定。

若没有参考图，适配器应在提交前返回明确的 4xx 错误，不创建上游任务，避免产生重复扣费或无效任务。

## 5. 任务与结果

- 创建成功必须返回任务 ID；不能因为响应中的 `model` 为空或 `created_at=0` 重复提交。
- `GET /v1/videos/{id}` 由适配器使用原始 ZX 任务 ID查询，返回标准 OpenAI 视频对象。
- `completed` 必须包含 `video_url`；`failed` 必须透传上游错误和任务 ID。
- 不新增适配器任务数据库；ZX 任务 ID本身作为无状态查询凭据。若上游后续要求额外会话信息，再单独评估，不预建状态系统。

## 6. 安全与可靠性

- 适配器只绑定 Docker 内网，不公开公网端口。
- 日志只记录模型、任务 ID、HTTP 状态和耗时，不记录 API Key、完整图片 data URL 或完整提示词。
- 下载参考图限制协议、大小和超时，拒绝本地路径、内网地址和非图片 MIME。
- 上游明确 `failed` 立即终止轮询；不把失败伪装成 500 后无限重试。
- `/content` 不实现，避免与 ZX 当前 502 限制冲突；直接使用 `video_url`。

## 7. 分阶段验收

1. 适配器单元测试：模型时长校验、禁止 `seconds`、data URL/URL 转 multipart、错误状态映射、Key 不进日志。
2. 直连 ZX 测试：使用真实参考图分别提交 6 秒、10 秒、15 秒各一笔，记录上游任务 ID、终态和 `video_url`。
3. NewAPI 临时渠道测试：确认一次鉴权、一次计费、提交和轮询均走适配器；失败时不重复扣费。
4. APP 测试：上传一张参考图，三个模型分别完成预览、下载和项目落盘。
5. 通过后再决定是否将正式 96 渠道切换到适配器；未通过则保留原直连配置，不改其他渠道。

## 8. 明确不做

- 不修改 NewAPI 源码或镜像。
- 不把 ZX 特殊逻辑塞进 `rh-adapter`；它只服务 RunningHub。
- 不为三个模型新增 `seconds` 参数、伪造文生视频模式或 `/content` 下载代理。
- 不同时改前端、NewAPI 和适配器；先以适配器和临时渠道闭环，再决定产品注册。

## 9. 当前实施结果（2026-08-01）

- 新增 `zx-video-adapter/` 独立 FastAPI 服务、Dockerfile、Compose 和依赖声明。
- JSON 参考图、data URL、URL 和直接 multipart 均可统一转换为 ZX `input_reference` multipart 请求。
- 已覆盖模型校验、固定尺寸、禁止 `seconds`、缺图提前拒绝、状态映射和 `video_url` 透传。
- 本地 unittest `3/3` 通过，Python 编译检查和 `git diff --check` 通过。
- 尚未启动 Docker、尚未部署服务器、尚未修改 NewAPI 96 渠道，也尚未产生真实 ZX 任务。
