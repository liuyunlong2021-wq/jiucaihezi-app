# 创作面板 RH 视频计费修复 — 交接文档

> **写给下一个 AI 协作者**：读完本文档即可上手，无需考古。
>
> **当前分支**: `webhuabu`
> **目标**: 创作面板 RH 视频模型 → 正常扣费 + 及时显示成片 + 不误退款
> **服务器**: api.jiucaihezi.studio (47.82.86.196)

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
  → 轮询拿到成片 URL ✅
  → 画廊显示视频 ✅
  → 不误退款 ✅
```

**主线（main）状态**：扣费和显示基本正常，但偶尔误退款（NewAPI 轮询拿不到正确状态就退）。

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

### ✅ 已解决（不用再排查）

| 问题 | 怎么解决的 | 涉及 |
|------|-----------|------|
| `CORPAPIKEY_INVALID` (811) | 旧 Key 权限失效，重新生成 Key 部署到 `/opt/rh-adapter/.env` | 服务器 |
| UI 显示 RH 不支持的参数（如 3:4） | 前端同步 `capabilities.json`，从官方能力读取参数 | `rhCapabilities.ts`, `creationModelRegistry.ts` |
| `grok-video-3` T8 broken 无法使用 | 恢复 `grok-video-3` → `rh-grok-*` 自动映射 | `media-generation.ts` |
| 画布节点发 spec ID 而非 model 名 | 改用 `modelName` | V8VideoGenNode, V8ImageGenNode |
| 轮询走 `/rh/tasks/` CORS 拦截 | task_xxx→NewAPI，纯数字→rh-adapter | `media-generation.ts`, `creationMediaRuntime.ts` |
| `/rh/submit/` 绕过计费 | Nginx 410 | 服务器 Nginx |

### 🟡 当前阻塞（需要你解决）

**现象**：
1. 提交 `POST /v1/videos` → 200 OK，扣费正常，返回 `task_xxx` ID
2. 轮询 `GET /v1/videos/task_xxx` → 200 OK，但响应体为 `{ detail, id }` — **不含 `url`**
3. `extractMediaUrl()` 找不到 URL → `pollTask` 继续轮询 → 超时 → 触发退款
4. 后台 48 秒就完成了，前端一直看不到成片

**关键线索**：`main` 分支同样走 `/v1/videos/{task_xxx}` 轮询且能正常显示。差异不在 NewAPI，在 `webhuabu` 的响应解析。

**排查方向**：
1. 在 `pollTask`（`media-generation.ts` ~620 行）completed 分支打印完整 data
2. `git diff main -- src/api/media-generation.ts` 对比 `extractStatus`/`extractMediaUrl`
3. 看响应体到底是 `{ detail, id }` 还是里面有嵌套的 url

---

## 4. 全部改动清单（webhuabu vs main）

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

NewAPI 源码：服务器 `/root/new-api-new/`，本地 `/Users/by3/Documents/搭子Studio桌面版/MYnewapi/`。
RH 视频走 channel 61，Sora adaptor: `relay/channel/task/sora/adaptor.go`。

---

## 7. 接手行动清单

1. 读 §0 的 3 个上手文件 + 本文档
2. `pnpm dev` → 浏览器 → 创作面板 → 测试 RH 视频生成
3. 控制台观察：提交 200 → 轮询 200 → 有没有 url？
4. 没有 url 就 `git diff main -- src/api/media-generation.ts` 看 pollTask/extractMediaUrl/extractStatus
5. 在 pollTask completed 分支加 `console.log(JSON.stringify(data))` 打印完整响应
6. `npx vue-tsc -b` → Cmd+Shift+R 硬刷新
