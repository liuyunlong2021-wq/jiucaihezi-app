# Jina 联网搜索 New API 计费适配器 SDD

> 状态：本地代码已实现；App 已改为显式单轮启用，适配器待 Docker 构建与生产部署 · 2026-07-30

## 目标

让通用记忆工作台在用户本轮明确选择 `@联网搜索` 后才提供 `web_search` 工具。搜索继续只调用 New API，由 New API 完成用户鉴权、分组、按次预扣、失败退款和使用日志；独立 `jina-adapter` 只把 OpenAI Chat Completions 请求翻译为 Jina Search 原生请求。

## 不做什么

- 不让 App、Web 或 Gateway 直连 `s.jina.ai`。
- 不修改 New API 官方镜像、源码、PostgreSQL 结构或现有计费逻辑。
- 不修改或重建 `rh-adapter`、支付、同步、文档转换和创作模型服务。
- 不新增数据库、搜索索引、搜索历史、MCP、Skill 或第二套工具系统。
- 不增加公网 Nginx 搜索路由；适配器只允许 New API 从服务器内网访问。
- 不使用 `jina-deepsearch-v1` 代替普通搜索。DeepSearch 延迟和 Token 消耗不适合作为对话中的轻量工具。

## 已核实现状

- 生产 New API 是官方 `calciumion/new-api:v1.0.0-rc.20` 镜像，不能通过修改 `/root/new-api-new` 源码生效。
- PostgreSQL 中已有启用的渠道 `53 / jina-search`，但 `base_url=https://jina.ai` 指向官网，当前不可用。
- 当前 Nginx 没有生效的 `web-search`/Jina 路由；相关内容只存在于历史备份。
- 当前没有 Jina/Search 独立容器或 systemd 服务；`/opt/rh-adapter-full/src/utils/webSearch.ts` 是旧前端源码，不是服务器适配器。
- Jina 官方普通搜索端点为 `POST https://s.jina.ai/`；新 API Key 含 1000 万 Token 试用额度，免费 Key 限制约 100 RPM，每次搜索从 10000 Token 起计量。免费额度不是永久价格。
- New API `v1.0.0-rc.20` 对固定价格模型先预扣；下游请求失败时，已有 relay 逻辑会退回本次预扣。

## 架构

```text
通用记忆工作台（记忆模式 + 本轮已选择 @联网搜索）
  -> POST https://api.jiucaihezi.studio/v1/chat/completions
       model: jina-search
       Authorization: 用户的 New API Key
  -> New API
       用户鉴权 / 分组 / ModelPrice 固定按次预扣 / 日志
  -> http://jina-adapter:8000/v1/chat/completions
       Authorization: New API 渠道 53 中的 Jina Key
  -> jina-adapter
  -> POST https://s.jina.ai/
       Authorization: 同一 Jina Key
       { "q": "搜索词" }
  <- Jina 文本结果
  <- OpenAI Chat Completions JSON
  <- New API 结算一次
```

生产 `new-api` 已核实位于外部 Docker 网络 `new-api-new_new-api-network`。`jina-adapter` 加入同一网络，不映射宿主机端口；New API 使用容器 DNS 名访问。

## 请求合同

`jina-adapter` 只实现三个端点：

- `GET /health`：返回服务名和状态，不访问 Jina。
- `GET /v1/models`：只返回 `jina-search`，用于容器内检查。
- `POST /v1/chat/completions`：只接受 `model=jina-search`、`stream=false` 和至少一条文字 user message。

适配器取最后一条 user message 的文字作为 `q`，不接受文件、图片、工具调用或任意上游 URL。查询为空或超过约定上限时返回 400；缺少渠道 Authorization 返回 401；Jina 超时或非 2xx 返回 502。适配器不重试，避免重复消耗 Jina 额度。

成功响应保留 Jina 原始文本并包装为：

```json
{
  "id": "jina-search-...",
  "object": "chat.completion",
  "model": "jina-search",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "Jina 返回的文本" },
      "finish_reason": "stop"
    }
  ]
}
```

适配器不伪造 Jina Token 成本。用户扣费以 New API 中 `jina-search` 的固定 `ModelPrice` 为唯一真源。

## 安全与部署边界

- 仓库目录：`jina-adapter/`；生产目录：`/opt/jina-adapter/`。
- 使用独立 Docker Compose，只重建 `jina-adapter`。
- 不声明 `ports`，只加入 `new-api-new_new-api-network`；不添加公网 Nginx location。
- Jina Key 只保存在 New API 渠道 53；适配器仅透传请求中的渠道 Authorization，不把 Key 写入镜像、仓库、响应或日志。
- 截图中已暴露的旧 Jina Key 必须撤销；上线使用新 Key。
- 部署前按运维手册执行 PostgreSQL `pg_dump`，并记录渠道 53 修改前的非敏感字段。
- 上线前从 `new-api` 容器验证适配器地址可达，不能以宿主机 `curl` 成功代替容器网络验收。

## New API 渠道 53 迁移

渠道继续使用真实模型名 `jina-search`，不新增带渠道前缀的模型 ID：

| 字段 | 目标值 |
|---|---|
| 名称 | `jina-search` |
| 类型 | OpenAI 兼容渠道 |
| Base URL | `http://jina-adapter:8000` |
| Key | 新 Jina API Key |
| 模型 | `jina-search` |
| 分组 | 覆盖实际用户 Token 分组；先只开放测试分组 |
| 价格 | New API `ModelPrice` 固定按次；生产值待确认 Jina 付费成本后由管理员决定 |

不使用模型映射，不把 `jina-search` 改写为 `jina-deepsearch-v1`。

## 验收

1. 本地单测证明：只取最后一条文字 user message；正确转发 `q` 和渠道 Authorization；空查询、错误模型、流式请求、Jina 401/429/5xx/超时均返回明确且不泄密的错误。
2. Docker 健康检查通过，宿主机公网地址和主站 Nginx 均不能直接访问适配器。
3. 从 `new-api` 容器访问 `/health` 和 `/v1/models` 成功。
4. 管理员测试 Token 通过公开 New API 调用 `jina-search`，得到包含真实来源的搜索结果；不能用宿主机直连 Jina 代替该验收。
5. New API 使用日志记录模型 `jina-search`、渠道 53 和一次固定价格扣费；用户余额变化与 `ModelPrice × 分组倍率` 一致。
6. 临时使用无效 Jina Key 发起一次失败请求，确认响应失败且用户余额净变化为 0，再立即恢复新 Key。构建成功、容器启动成功或渠道测试成功均不能代替此退款验收。
7. App 默认不把 `web_search` 放入工具池；选择 `@联网搜索` 后仅本轮提供该工具，成功发送后清除；快速模式始终无工具。该开关只存在于输入框状态，不写入 Raw。

## App 单轮开关实施记录（2026-07-30）

- 根因：`memoryChat.ts` 曾在每轮记忆模式请求中无条件追加 `WEB_SEARCH_TOOL_DEFINITION`，模型可绕过已有 GitHub MCP 直接反复搜索。
- 修复：复用现有 `@` 菜单和附件 chip；默认关闭，选择 `@联网搜索` 后本轮开启，可手动移除，成功发送或切换快速模式后清除。
- 边界：不调整 GitHub MCP，不新增搜索模式、持久化设置、组件、Store 或依赖。
- 验证：`node --test src/components/memory/__tests__/memoryWorkbench.test.ts` 通过（38/38）。

## 回滚

出现错误时按以下顺序回滚，不修改 New API 镜像和数据库结构：

1. 在 New API 后台禁用渠道 53，立即停止新搜索请求和扣费。
2. 恢复渠道 53 修改前的 Base URL、分组和价格记录；旧错误地址只用于留档，不重新启用。
3. `docker compose down` 停止 `/opt/jina-adapter`，确认 RH、支付、同步、文档转换和普通聊天健康状态不受影响。
4. 如发生异常扣费，按 New API 请求日志和用户余额记录单独核对；不得用批量数据库改写代替逐笔证据。

## 执行顺序

1. 实现最小 FastAPI/httpx 适配器、单测、Dockerfile 和只绑定内网的 Compose。
2. 本地运行测试、Docker 构建、健康检查和敏感信息审计。
3. 只读核对生产端口、Docker 网络、磁盘和渠道 53 当前配置；执行 PostgreSQL 备份。
4. 部署独立容器，不改 Nginx、不重建其他服务。
5. 先将渠道 53 只开放给管理员测试分组，完成成功请求、一次扣费和失败退款验收。
6. 管理员确认生产价格与用户分组后再开放；更新服务器运维手册、本文状态和 `hot.md`。
