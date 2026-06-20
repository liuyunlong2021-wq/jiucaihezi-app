# 创作面板 RH 视频计费修复 — 交接文档

> **写给下一个 AI 协作者**：读完本文档即可上手，无需考古。
>
> **当前分支**: `webhuabu`
> **目标**: 创作面板 RH 视频模型 → 正常扣费 + 及时显示成片 + 不误退款
> **服务器**: api.jiucaihezi.studio (47.82.86.196)
>
> **2026-06-20 最新状态**：NewAPI 生产容器内主程序已替换为“官方最新版基线 v1.0.0-rc.13 + 本地 RH 解析补丁”，服务已恢复 healthy；但 RH 视频链路没有修成功，仍然会超时/退款，前端仍然拿不到视频 URL。不要把“NewAPI 已升级”误判为“创作面板问题已解决”。

---

## 0. 上手必读（按顺序）

| 顺序 | 文件 | 说明 |
|:--:|------|------|
| 1 | `docs/notes/我的服务器运维手册.md` | 服务器 IP、密码、架构、文件位置 |
| 2 | `CLAUDE.md` | 项目架构、存储设计、启动流程、火宝画布移植铁律 |
| 3 | `AGENTS.md` | 审查范围、已知问题、上线标准 |
| 4 | **本文档** | 创作面板计费问题的完整上下文 |

---

## 1. 目标

```
创作面板选 RH 视频模型 → 填 prompt → 点生成
  → 正常扣费 ✅
  → 任务提交成功 ✅
  → 轮询拿到成片 URL ❌
  → 画廊显示视频 ❌
  → 不误退款 ❌
```

**2026-06-20 结论**：当前只确认“扣费 + 提交任务”正常；“拿到成片 URL / 前端显示视频 / 不误退款”仍未解决。

**支线（webhuabu）目标**：在主线基础上完善创作面板 + 画布，同时修复误退款，让整个 RH 视频链路稳定。

---

## 2. 架构速览

```
前端 → POST /v1/videos → NewAPI(:3000) → rh-adapter(:8789) → RunningHub 官方 API
                              ↑                ↑
                         鉴权+计费+退款    只做协议翻译(OpenAI↔RH)
```

- NewAPI 负责鉴权 + 计费 + 退款
- rh-adapter 只做一件事：OpenAI 格式 ↔ RunningHub 原生格式（含 Key 的 apikey 注入）
- 前端提交走 NewAPI，轮询优先走 NewAPI（`/v1/videos/{task_xxx}`），因为 NewAPI 知道 task_xxx ↔ RH 原始 ID 的映射
- Nginx: `/rh/submit/` → 410（封死），`/rh/tasks/` → rh-adapter:8789（仅纯数字 RH ID）

---

## 3. 当前状态

### ✅ 已完成/已确认

| 问题 | 怎么解决的 | 涉及 |
|------|-----------|------|
| `CORPAPIKEY_INVALID` (811) | 旧 Key 权限失效，重新生成 Key 部署到 `/opt/rh-adapter/.env` | 服务器 |
| UI 显示 RH 不支持的参数（如 3:4） | 前端同步 `capabilities.json`，从官方能力读取参数 | `rhCapabilities.ts`, `creationModelRegistry.ts` |
| `grok-video-3` T8 broken 无法使用 | 恢复 `grok-video-3` → `rh-grok-*` 自动映射 | `media-generation.ts` |
| 画布节点发 spec ID 而非 model 名 | 改用 `modelName` | V8VideoGenNode, V8ImageGenNode |
| 轮询走 `/rh/tasks/` CORS 拦截 | task_xxx→NewAPI，纯数字→rh-adapter | `media-generation.ts`, `creationMediaRuntime.ts` |
| `/rh/submit/` 绕过计费 | Nginx 410 | 服务器 Nginx |
| NewAPI 升级到官方最新版基线 | 本地拉取 `QuantumNous/new-api` commit `0229dc20573f728ec1140543cdee291197d67e8c` (`v1.0.0-rc.13`)，加入 RH 解析补丁后编译 Linux 二进制，上传并替换容器内 `/new-api` | 生产 NewAPI |
| 生产服务恢复 healthy | `docker restart new-api` 后 `/api/status` 返回 success，`docker ps` 显示 `new-api Up ... (healthy)` | 生产 NewAPI |
| 数据未被重置 | NewAPI 启动日志显示 `using PostgreSQL as database`、`system is already initialized`，后台可登录且数据看板/额度可见 | PostgreSQL |

### ❌ 2026-06-20 升级验证失败项

| 目标 | 结果 | 证据/现象 |
|------|------|-----------|
| RH 视频任务及时返回成片 URL | 失败 | 前端持续轮询 `GET /v1/videos/task_otQScPWsAA0yCTWe1Z99gFkEBs8OoGuz`，每次 200，但 `response data keys: [detail, id]`，没有可提取的 URL |
| 前端画廊显示视频 | 失败 | `mediaTaskStore` 最终报 `生成超时 (10分钟)`，没有显示视频卡片 |
| 不误退款 | 失败 | NewAPI 后台日志出现一次消费 `$0.432`，随后出现“异步任务退款” |
| 本地桌面/开发环境 CORS | 失败 | `http://localhost:1420` 请求 `https://api.jiucaihezi.studio/v1/models`、`/v1/chat/completions`、`/api/creation/models`、`/v1/tasks/{task}/refund` 被 CORS 拦截 |
| NewAPI 后台前端完全稳定 | 部分失败 | 登录可用，但新版前端控制台仍有 `vendor-tanstack... _nonReactive` 报错；首页/Logo/品牌定制未迁移完整 |

### 🟡 当前阻塞（下一位接手先查这里）

**本轮最新现象**：
1. 提交 `POST /v1/videos` → 200 OK，扣费正常，返回 `task_xxx` ID
2. 轮询 `GET /v1/videos/task_xxx` → 200 OK，但响应体只有 `{ detail, id }` 这类信息，前端没有拿到 `url`
3. 前端持续轮询 10 分钟后自己判超时，随后尝试调用 `/v1/tasks/{task}/refund`
4. 退款请求在 `localhost:1420` 场景下还会被 CORS 拦截
5. NewAPI 管理后台记录显示该 RH 视频任务仍发生“异步任务退款”

**关键结论**：
- NewAPI “升级成功”是真的；RH 视频“修复成功”是假的。
- 只修 `relay/channel/task/sora/adaptor.go` 的 `ParseTaskResult` 不够。
- 下一步不能继续猜，需要直接查任务数据库记录和任务查询接口返回。

**下一步排查方向**：
1. 查询这次任务 `task_otQScPWsAA0yCTWe1Z99gFkEBs8OoGuz` 的 `tasks.status / fail_reason / data / private_data / progress / channel_id`
2. 查 NewAPI 日志是否仍有 `upstream returned unrecognized message`、`upstream returned empty status`、`Task xxx failed`
3. 直接 curl `GET /v1/videos/task_otQScPWsAA0yCTWe1Z99gFkEBs8OoGuz`，保存完整响应体
4. 如果数据库已经有成功 URL，但接口没返回，修 NewAPI 的任务查询/转换格式
5. 如果数据库仍是 `IN_PROGRESS` 或 `FAILURE`，修 NewAPI 的轮询写回逻辑
6. 前端侧禁止“10 分钟超时就主动退款”；只有后端明确 `failed` 才允许退款

---

## 4. 全部改动清单（webhuabu vs main）

> 注意：下面是历史改动清单，不代表 2026-06-20 已验证成功。最新事实以 §3 为准。

### 服务器 rh-adapter（`/opt/rh-adapter/`，已部署）

| 文件 | 改了什么 |
|------|---------|
| `src/main.py` | `build_task_status_response` 加 model/object/created_at/completed_at |
| `src/main.py` | `/v1/models` 返回每个模型的 `params`（来自 capabilities.json） |
| `src/main.py` | 新 import: `load_official_capabilities` |
| `src/services/video.py` | `generate_video` 返回 `"processing"` |

### 前端

| 文件 | 改动 |
|------|------|
| `src/data/rhCapabilities.json` | **新增** — 官方 RH 端点能力 |
| `src/data/rhCapabilities.ts` | **新增** — `getRhEndpointCapability()` |
| `src/runtime/creation/creationModelRegistry.ts` | runninghubStandard 从 capabilities 读参数；grok-video-3→broken |
| `src/api/media-generation.ts` | 恢复 grok-video-3 映射；轮询 task_xxx→NewAPI |
| `src/runtime/creation/creationMediaRuntime.ts` | 轮询 task_xxx→NewAPI |
| `src/services/newApiClient.ts` | getGatewayBaseUrl localhost→/__jc_api |
| `src/utils/api.ts` | resolveApiConfig localhost→/__jc_api |
| `src/components/canvas/v8/nodes/V8VideoGenNode.vue` | model 用 modelName |
| `src/components/canvas/v8/nodes/V8ImageGenNode.vue` | 同上 |

---

## 5. 本地开发

```bash
cd /Users/by3/Documents/jiucaihezi-app-main
pnpm dev          # Web 端 → http://localhost:5173
pnpm tauri dev    # 桌面端 → http://localhost:1420
```

`media-generation.ts` 硬编码 `https://api.jiucaihezi.studio`，不受本地 proxy 影响。

---

## 6. 服务器操作

SSH: `ssh root@47.82.86.196`（密码在运维手册）。所有操作在服务器终端粘贴。

```bash
# rh-adapter 重建
cd /opt/rh-adapter && docker compose down && docker compose up -d --build

# 验证
curl -s http://172.17.0.1:8789/health
curl -s http://172.17.0.1:8789/v1/models | python3 -m json.tool | head -30

# 直接测试视频提交
curl -s -X POST http://172.17.0.1:8789/v1/videos \
  -H "Content-Type: application/json" \
  -d '{"model":"rh-grok-text-video","prompt":"a beautiful sunset over the ocean"}'

# 日志
docker logs --since 10m rh-adapter-rh-adapter-1 --tail 30
docker logs --since 10m new-api 2>&1 | grep -i "task\|poll\|refund" | tail -20
```

NewAPI 源码/工作区：

| 位置 | 说明 |
|------|------|
| 服务器 `/root/new-api-new/` | 生产 Compose 运行目录；当前容器仍显示镜像 `calciumion/new-api:latest`，但容器内 `/new-api` 已被本地编译二进制替换 |
| 服务器 `/root/new-api-upgrade-rh-20260620/` | 服务器上拉取过的官方源码 + RH 补丁；因磁盘不足，Docker build 失败，不能作为已部署产物来源 |
| 本地 `/Users/by3/Documents/搭子Studio桌面版/MYnewapi-upgrade/` | 官方 `v1.0.0-rc.13` 基线 + RH 补丁分支 `jc/rh-video-upgrade-fix`；本地 Linux 二进制从这里编译 |
| 本地 `/Users/by3/Documents/搭子Studio桌面版/MYnewapi/` | 旧版本地定制源码；首页/Logo/充值/登录等定制尚未迁移到 upgrade 工作区 |

RH 视频走 channel 61，Sora adaptor: `relay/channel/task/sora/adaptor.go`。

### 6.1 2026-06-20 NewAPI 升级实录

已完成：

```text
1. 备份生产 PostgreSQL 和 docker-compose。
2. 生产服务器磁盘仅 30G，Docker build 因 No space left on device 失败。
3. 改为本地编译 Linux amd64 二进制：
   /Users/by3/Documents/搭子Studio桌面版/newapi-release/new-api-rh-20260620-linux-amd64.tar.gz
4. 上传到服务器 `/new-api-rh-20260620-linux-amd64.tar.gz`。
5. 解压到 `/root/new-api-rh-20260620-linux-amd64`，sha256 校验 OK。
6. 容器内旧程序备份为 `/new-api.before-rh-upgrade`。
7. 用新二进制覆盖容器内 `/new-api` 并重启。
8. `docker ps` 显示 new-api healthy，`/api/status` 返回 success。
```

重要限制：

```text
这次不是换 Docker 镜像，而是替换容器内 /new-api 主程序。
因此 docker ps 仍显示 IMAGE=calciumion/new-api:latest，这是正常现象。
但如果执行 docker compose up -d --force-recreate new-api，会回到镜像内置二进制，丢失本次容器内热替换。
```

可回滚：

```bash
docker cp new-api:/new-api.before-rh-upgrade /root/new-api.before-rh-upgrade
docker cp /root/new-api.before-rh-upgrade new-api:/new-api
docker exec new-api chmod +x /new-api
docker restart new-api
```

---

## 7. 接手行动清单

1. 读 §0 的 3 个上手文件 + 本文档
2. 不要先改代码，不要先继续烧 RH 任务；先查数据库和接口真相
3. 用最新失败任务 `task_otQScPWsAA0yCTWe1Z99gFkEBs8OoGuz` 查询 NewAPI `tasks` 表
4. 直接 curl `/v1/videos/{task}` 保存完整响应
5. 看 NewAPI 日志中的失败原因，不要只看前端超时
6. 根据结果决定修后端写回、后端查询格式，还是前端解析
7. 前端侧单独修 CORS 和“超时主动退款”策略

## 8. 当前判断

用户对白话总结：

```text
这轮至少把生产 NewAPI 程序升级到了官方最新基线（v1.0.0-rc.13）并能正常启动。
但是 RH 视频核心问题没有解决：
  - 仍然拿不到视频 URL
  - 仍然显示不了视频
  - 仍然发生退款

所以“升级 NewAPI”完成了；
“修好创作面板 RH 视频”没有完成。
```
