# ZX Grok 视频独立适配器 SDD

> 日期：2026-08-01
> 状态：已部署；6 秒图生视频、10 秒文生视频直连验收通过，待部署双模式修复并完成三模型验收
> 范围：为 ZX `grok-1.5-video-6s/10s/15s` 提供协议转换；不修改 NewAPI 源码，不影响 RunningHub、Jina 或其他渠道。

## 1. 背景与根因

ZX 三个固定时长名称是计费别名，均源自 `grok-imagine-video-1.5`，但 ZX 对外只允许按别名调用。创建合同分为两种：

- `POST /v1/videos`
- 无参考图时使用 JSON 文生视频，发送 `model`、`prompt`、`resolution=720p`
- 有 1~7 张参考图时使用 multipart 参考图视频，发送 `model`、`prompt`、`size=1280x720` 和重复的 `input_reference` 文件字段
- 不发送 `seconds`
- 查询 `GET /v1/videos/{task_id}`
- 完成后读取 `video_url`，不调用 `/content`

当前 NewAPI 96 渠道直接指向 `https://img-api.zxcode.vip`，APP 发送的是标准 JSON 视频请求。6 秒真实任务虽然创建成功，但上游最终返回“流处理结束但未收到完成或错误事件”。问题是协议不匹配，不能据此判定模型不可用。

## 2. 目标架构

```text
APP / Web
  -> NewAPI /v1/videos（鉴权、计费、渠道选择）
  -> zx-video-adapter（独立协议转换服务）
  -> ZX POST /v1/videos（文生 JSON / 图生 multipart）

APP / Web
  <- NewAPI 轮询 /v1/videos/{id}
  <- zx-video-adapter 查询 ZX 任务并返回 OpenAI 视频状态
```

### 2.1 服务边界

`zx-video-adapter` 只负责：

1. 接收 NewAPI 转发的标准视频 JSON。
2. 校验固定模型名、提示词和 `size`。
3. 无参考图时发送 JSON；有 1~7 张参考图时将 URL 或 data URL 下载/解码为重复的 multipart `input_reference` 文件字段。
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
  "size": "1280x720"
}
```

没有参考图时按文生视频 JSON 提交；有参考图时兼容现有客户端的 `image`、`images` 或 `reference_images` 输入，最多 7 张并全部转成重复的 ZX `input_reference` 文件字段。请求忽略 `seconds`，固定时长由模型名决定。该合同由 [[ZX视频适配器多模型升级TDD-2026-08-18]] 更新。

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

1. 适配器单元测试：文生 JSON、图生 multipart、禁止 `seconds`、错误状态映射、Key 不进日志。
2. 直连 ZX 测试：分别提交 6 秒、10 秒、15 秒文生视频，并抽验单图视频，记录上游任务 ID、终态和 `video_url`。
3. NewAPI 临时渠道测试：确认一次鉴权、一次计费、提交和轮询均走适配器；失败时不重复扣费。
4. APP 测试：上传一张参考图，三个模型分别完成预览、下载和项目落盘。
5. 通过后再决定是否将正式 96 渠道切换到适配器；未通过则保留原直连配置，不改其他渠道。

## 8. 明确不做

- 不修改 NewAPI 源码或镜像。
- 不把 ZX 特殊逻辑塞进 `rh-adapter`；它只服务 RunningHub。
- 不为三个模型新增 `seconds` 参数或 `/content` 下载代理。
- 不同时改前端、NewAPI 和适配器；先以适配器和临时渠道闭环，再决定产品注册。

## 9. 当前实施结果（2026-08-02）

- 新增 `zx-video-adapter/` 独立 FastAPI 服务、Dockerfile、Compose 和依赖声明。
- 独立服务已部署，健康检查与 NewAPI Docker 内网解析通过。
- 6 秒单图任务真实完成，证明图生 multipart、轮询和 `video_url` 链路可用。
- 10 秒固定别名使用 JSON 文生视频真实完成；同一别名被旧适配器强制转换成带图 multipart 时返回无可用平台，根因是适配器混淆文生与图生合同，不是 NewAPI 渠道或模型不可用。
- 当前修复让无图请求透传为 JSON、有图请求继续转换为 multipart；待部署后验证 6/10/15 秒双模式。
