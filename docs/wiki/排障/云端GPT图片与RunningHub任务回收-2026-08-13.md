# 云端 GPT 图片与 RunningHub 任务回收排障

> 日期：2026-08-13
> 状态：`GPT Image 2 VIP` 已下线；RunningHub GPT2.0 图片任务的 `global:` 任务 ID 回收已修复。云端结果落盘失败仍应按上游结果地址可下载性单独排查。

## 先区分三条独立链路

| 用户看到的现象 | 实际链路 | 本轮结论 |
| --- | --- | --- |
| `GPT Image 2 · 直连` 返回 Cloudflare `502` | App -> Gateway -> NewAPI 渠道 -> 图片上游 | 与本机 ComfyUI 无关；当时 NewAPI 渠道 `104` 的上游临时不可用 |
| `GPT2.0 文生图 / 图生图` 一直“提交中” | App -> Gateway -> NewAPI -> RH adapter -> RunningHub | RH 已接收任务；客户端轮询地址白名单错误阻断回收 |
| 已显示生成成功但没有“放到画布” | 结果 URL -> Desktop 下载 -> 项目媒体落盘 -> 画布 | 结果未落到项目时不会显示按钮；不是画布插入功能失效 |

不要把这三类现象合并为“本地模型改坏了云端路径”。本机 ComfyUI 仅在 `local-comfy/z-image-turbo` 选择时请求本机 `/prompt`；GPT Image 2 和 RunningHub 都仍通过云端 `/v1/images/generations`。

## 一、GPT Image 2 VIP 上游失效

### 证据与根因

用户在 App 中使用 `GPT Image 2 · 直连` 得到 `HTTP 502` 的 Cloudflare HTML。用同一模型从服务器直接请求仍得到 `502`。NewAPI 容器日志确认：

```text
channel error: [channel #104, status code: 502]: Upstream service temporarily unavailable
modelName=gpt-image-2
POST /v1/images/generations -> 502
```

这证明请求已正确到达 NewAPI，失败点是 `104` 号图片渠道配置的上游服务；不是 App 请求路径、Cloudflare 前端、本机 ComfyUI、提示词或设备问题。

### 处理

Git `4e33901f` 从创作模型注册和兼容媒体模型目录移除了 `gpt-image-2-vip`，并把这个旧模型 ID 标记为已下线。历史任务保留，但不能再次提交。

### 下次排查顺序

1. 从任务历史确认模型、路由和提交端点，先区分 `newapi-direct`、`runninghub-adapter`、`local-comfy`。
2. 用同一 Token 在服务器对同一端点做一次最小请求，确认是不是 App 独有问题。
3. 在 NewAPI 日志按时间和 `/v1/images/generations` 查 `channel error`、渠道 ID、`modelName` 与上游状态。
4. 若日志显示某渠道上游不可用，先在 NewAPI 后台禁用或替换该渠道；不要修改 App 路由来掩盖渠道故障。

## 二、RunningHub 的 `global:` 任务 ID 被错误拦截

### 现象与证据

`GPT2.0 文生图 · RunningHub` 已获得原始上游任务 ID：

```text
global:2087782571974000642
```

客户端生成轮询路径时会将冒号编码为：

```text
/rh/tasks/global%3A2087782571974000642
```

但 URL 安全校验只按未编码字符匹配路径，随后抛出“任务轮询地址不安全，已阻止请求”。任务已在 RunningHub 提交，App 却无法取回结果，任务因此停留在可恢复的“提交中”。图生图和文生图共用该轮询规则，都会受影响。

### 最小修复

Git `4e33901f` 仅在 `/rh/tasks/` 的既有白名单校验中，对 `pathname` 解码后再进行严格 ID 匹配。它仍只允许：

- 固定的 `/rh/tasks/<ID>` 路径；
- ID 中的字母、数字、点、下划线、连字符、冒号；
- 空查询或精确的 `?ai_app=true`。

绝对 URL、路径穿越、空格、斜杠编码和任意额外查询参数仍被拒绝。新增测试覆盖已编码 `global%3A...` 任务 ID。

### 后续模型接入规则

凡是经 NewAPI 提交、经 RH adapter 轮询的异步模型，都必须用真实上游任务 ID 验收一次，特别检查：提交返回的 ID 形态、最终 `pollUrl`、安全校验、轮询响应和结果落盘。不能只用 `rh_task_001` 这类不含保留字符的模拟 ID 证明生产链路正常。

## 三、成功结果没有“放到画布”

任务历史的“放到画布”只在结果已写入当前项目时显示，即任务有 `projectPath` 或 `assetUri`。这是为了让画布保存稳定项目路径，不直接依赖会过期的远程 URL。

本轮一张云端成功图片返回了可预览 URL，但 Desktop 后台下载该 URL 两次均未成功；随后对该 URL 的只读探测在 30 秒内连接超时。因此任务没有项目路径，历史卡只显示“保存到项目”，不会显示“放到画布”。

排查顺序：先确认任务 `assetStatus`、`assetRetryCount`、`projectPath/assetUri`，再从 Desktop 后台或服务器探测结果 URL 是否可下载。只有落盘成功后才检查画布归属、当前项目和插入逻辑。

## 四、GPT Image 2 临时 URL 失效与 Grok 图片模型下线

### 根因

用户复测时，`GPT Image 2` 完成后既没有“放到画布”，预览返回 `{"error":"image not found"}`，下载还会打开错误页。该渠道返回的是短生命周期远程 URL；Desktop 尚未下载并写入项目时，链接就已失效。因此任务没有 `projectPath/assetUri`，并非画布渲染或插入失败。

### 最小修复与边界

- `gpt-image-2` 强制请求 `b64_json`，让既有媒体结果落盘链路直接接收图片字节、生成项目内 `data:` 结果，再正常显示“预览 / 放到画布 / 打开文件夹”。已经失效的旧 URL 无法恢复，需重新生成。
- 对仍需要保存的远程结果，任务卡不再提供预览入口，避免把上游错误 JSON 当图片打开；保存成功后按既有项目路径预览。
- 按用户决定，`Grok Image 4.2 文生图` 与 `Grok Image 4.2 图生图` 已从创作模型注册表删除，旧 ID `runninghub/api/rh-grok-image-text`、`rh-grok-image-text`、`runninghub/api/rh-grok-image-image`、`rh-grok-image-image` 均标记为下线。`rh-grok-image-video` 不受影响。

### 回归规则

云端图片接入若只返回临时 URL，必须先在生成完成前可靠落盘，或者直接请求可写入的字节数据；不能把临时 URL 当作画布资产。下线模型须同时从可见注册表删除并阻断旧 ID 执行，保留相邻的有效模型回归测试。

## 验证边界

- 通过：`vue-tsc -b`；仓库内置 focused 定向测试覆盖 URL 安全、模型注册、模型准入、创建计划和媒体任务；`git diff --check`。
- 未重新执行真实付费 RunningHub GPT2.0 任务，因此不把本次修改写成其生产回收已再次人工验收。已有挂起任务需要在更新后的 Desktop App 中恢复轮询或重新提交验证。
