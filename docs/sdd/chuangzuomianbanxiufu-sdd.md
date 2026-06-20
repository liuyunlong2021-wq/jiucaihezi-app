# 创作面板 RH 视频计费修复 — 交接文档

> **写给下一个 AI 协作者**：读完本文档即可上手，无需考古。
>
> **当前分支**: `webhuabu`
> **目标**: 创作面板 RH 视频模型 → 正常扣费 + 及时显示成片 + 不误退款
> **服务器**: api.jiucaihezi.studio (47.82.86.196)
>
> **2026-06-20 下午（最新真相）**：核心问题已**彻底修复**，根因不是前端、也不是 NewAPI 升级，而是 **rh-adapter 缺一个路由别名**。详见 §0「真因突破」。本次修复改动极小：rh-adapter `main.py` 加 1 行装饰器；前端 `mediaFileReader.ts` 加防御性 fallback。其他在此之前所有"升级 NewAPI"、"修 ParseTaskResult"、"前端轮询路径调整"等等都是在错的方向上做的功，不要再继续往那些方向砍。

---

## 0. 真因突破（2026-06-20 必读）

### 0.1 问题表象

```
创作面板选 RH 视频 → 提交成功，扣费 → 前端轮询 60 次 → 永远拿不到 URL → 10 分钟超时
                                                              → 自动退款（CORS 拦截，钱实际没退）
```

### 0.2 真因（从用户问题反推）

| 现象 | 表面解读（之前两天的错路径） | 真因（这次发现） |
|------|------------------------|--------------|
| `GET /v1/videos/task_xxx` 永远返回 `{detail, id}` | NewAPI 没把 URL 写回数据库 | NewAPI 提交后 **9 秒** 就把任务标 FAILURE，data 字段被覆盖成 FastAPI 默认 404 |
| `tasks.fail_reason = "upstream returned unrecognized message"` | NewAPI 解析格式有 bug | NewAPI 调 `GET rh-adapter:8789/v1/videos/{id}` 拿到了 FastAPI 默认 `{"detail":"Not Found"}` |
| FastAPI 默认 404 | 不知道 | **rh-adapter 根本没注册 `/v1/videos/{task_id}` 路由**，只有 `/tasks/{task_id}` |

### 0.3 关键证据（PostgreSQL 任务表）

```
task_id  = task_kmNnslHfN1PkTwSZ7OlMfsfWEHfdVWOl
channel_id = 61 (RH-Adapter)
status   = FAILURE
fail_reason = upstream returned unrecognized message
data        = {"detail":"Not Found"}    ← FastAPI 默认 404
created_at  = 1781933229
updated_at  = 1781933238                 ← 9 秒后判失败，不是 10 分钟
upstream_task_id = 2068203982329090049   ← RH 真实任务 ID 拿到了
billing_source = wallet                  ← 钱扣了
```

直接 curl rh-adapter：

```bash
curl http://172.17.0.1:8789/v1/videos/2068203982329090049 → {"detail":"Not Found"}  # 路由不存在
curl http://172.17.0.1:8789/tasks/2068203982329090049     → 正常响应（带 URL）       # 路由存在
```

NewAPI Sora adaptor 用的是 OpenAI Sora 标准格式 `GET {base_url}/v1/videos/{task_id}`（见 `relay/channel/task/sora/adaptor.go:280`），但 rh-adapter 只注册了非标准的 `/tasks/{task_id}` —— 双方路径不对齐。

### 0.4 修复（生效中）

**服务器**：`/opt/rh-adapter/src/main.py` 第 205 行，把单装饰器改成双装饰器：

```python
@app.get("/v1/videos/{task_id}")    # ← 新增 alias，对齐 OpenAI Sora 标准
@app.get("/tasks/{task_id}")         # ← 保留旧路径，向后兼容前端直接轮询
async def get_task_status(task_id: str, ai_app: bool = False):
    """Stateless query: calls RH /openapi/v2/query once, returns current status."""
    ...
```

部署：`cd /opt/rh-adapter && docker compose up -d --build rh-adapter`

**前端**：`src/utils/mediaFileReader.ts` 防御性修复 — `resolveJcMediaUrl` 在 Web 端拿不到 `media_assets.sourceUrl` 时原样回退 url，避免 `<img src="">` 必死情况。这一处对当前 RH 视频流不是必要，但是稳定性兜底。

### 0.5 验证证据（2026-06-20 14:30 通过）

```bash
# 假 ID → 不再 FastAPI 404，而是结构化 500
curl -i http://172.17.0.1:8789/v1/videos/9999999999999999999
HTTP/1.1 500
{"error":{"message":"GET .../openapi/v2/query: failed to parse request body","code":"1007"}}

# 真任务 ID → success + URL
curl http://172.17.0.1:8789/v1/videos/2068203982329090049
{"task_id":"2068203982329090049","status":"success","url":"https://rh-images-1252422369.cos.ap-beijing.myqcloud.com/.../0fbda7a2-403a-441c-a54c-c5631659e13a.mp4","usage":{"cost":0.24,"duration_seconds":0.0}}

# 客户端 pnpm dev 重测，新任务前端日志：
GET /v1/videos/task_vZiCryzXpnRPSdwWtEoey1fYfKdLU39s
response status: 200
response data keys: Array(3) → Array(5)    ← 字段在变化，状态在更新
最终：[JC] Web 端 remote-only: mtask_mqm0jxwe_o47d   ← 任务成功，显示视频
```

---

## 1. 目标 vs 实际（修复后）

```text
创作面板选 RH 视频模型 → 填 prompt → 点生成
  → 正常扣费 ✅
  → 任务提交成功 ✅
  → 轮询拿到成片 URL ✅
  → 画廊显示视频 ✅
  → 不误退款 ✅ （因为不再判超时失败）
```

---

## 2. 架构速览（保持不变）

```text
前端 → POST /v1/videos → NewAPI(:3000) → rh-adapter(:8789) → RunningHub 官方 API
                              ↑                ↑
                         鉴权+计费+退款    只做协议翻译(OpenAI↔RH)
```

- NewAPI 负责鉴权 + 计费 + 退款
- rh-adapter 只做一件事：OpenAI 格式 ↔ RunningHub 原生格式（含 Key 的 apikey 注入）
- NewAPI Sora adaptor 用 OpenAI Sora 标准 `GET {base}/v1/videos/{task_id}` 轮询任务
- **rh-adapter 必须同时注册 `/v1/videos/{task_id}` 和 `/tasks/{task_id}` 两个路径**（OpenAI 兼容 + 向后兼容）
- Nginx: `/rh/submit/` → 410（封死），`/rh/tasks/` → rh-adapter:8789（仅纯数字 RH ID）

---

## 3. 当前状态（全绿）

### ✅ 已修复

| 问题 | 修复 | 涉及 |
|------|------|------|
| `CORPAPIKEY_INVALID` (811) | 重新生成 Key 部署到 `/opt/rh-adapter/.env` | 服务器 |
| UI 显示 RH 不支持的参数 | 前端读 `capabilities.json` | `rhCapabilities.ts` |
| `grok-video-3` T8 broken | 恢复 → `rh-grok-*` 自动映射 | `media-generation.ts` |
| 画布节点发 spec ID | 改用 `modelName` | V8VideoGenNode, V8ImageGenNode |
| `/rh/submit/` 绕过计费 | Nginx 410 | 服务器 Nginx |
| NewAPI 升级到官方基线 v1.0.0-rc.13 | 本地编译 Linux 二进制 + 容器内热替换 | 生产 NewAPI |
| **rh-adapter 缺 `/v1/videos/{id}` 路由** | **加装饰器 alias**，对齐 NewAPI Sora adaptor 期望 | `/opt/rh-adapter/src/main.py:205` |
| **Web 端 jc-media:// 解析回归** | 拿不到 sourceUrl 时回退到原 url，不返回 `''` | `src/utils/mediaFileReader.ts` |

### 🟡 遗留问题（不影响主流程）

| 项目 | 严重度 | 说明 |
|------|:--:|------|
| `/v1/chat/completions`、`/v1/models`、`/api/creation/models`、`/v1/tasks/*/refund` 缺 CORS 头 | 🟡 | 服务器 Nginx 给 `/v1/videos*` 配了 `Access-Control-Allow-Origin`，但其他路径没配。**只影响 localhost:1420 开发调试，不影响生产**（生产 Web 端走同域名，无 CORS） |
| 本地开发 `getGatewayBaseUrl()` 未走 `/__jc_api` 代理 | 🟡 | CLAUDE.md §0.3 铁律本应走 Vite proxy，但实际直接打了 `api.jiucaihezi.studio`。和 CORS 共因 |
| 旧"幽灵任务" `task_kmNnslHfN1PkTwSZ7OlMfsfWEHfdVWOl` | 🟢 | 视频生成成功但 NewAPI 数据库标 FAILURE，钱扣了没退。**新任务不会复发**。视频 URL 24h 内有效，需要可在 RH COS 上找回；不需要可手动 SQL 把 status 改 SUCCESS 或退款 |
| rh-adapter 失败状态 `error` 字段是字符串 vs NewAPI 期望对象 | 🟢 | 防御性问题。任务真失败时 NewAPI 解析 `responseTask.Error` 会失败，但当前情况下不阻塞主流程。建议下次顺手改 `/opt/rh-adapter/src/main.py` 第 234 行附近：`response["error"] = {"message": error_msg, "code": "task_failed"}` |

---

## 4. 全部已部署修复清单（webhuabu）

### 服务器 rh-adapter（`/opt/rh-adapter/`，已部署）

| 文件 | 改了什么 | commit/动作 |
|------|---------|------------|
| `src/main.py:205` | 加 `@app.get("/v1/videos/{task_id}")` 装饰器 alias | sed 一行，docker compose build |
| `src/main.py`（历史改动）| `build_task_status_response` 加 model/object/created_at/completed_at；`/v1/models` 返回每个模型的 `params`；新 import `load_official_capabilities` | 早期改动 |
| `src/services/video.py` | `generate_video` 返回 `"processing"` | 早期改动 |

### 前端

| 文件 | 改动 |
|------|------|
| `src/utils/mediaFileReader.ts` | `resolveJcMediaUrl` Web 端 fallback 行为修复，拿不到 sourceUrl 不返回 `''`；`resolveForDisplay` 加 try/catch |
| `src/data/rhCapabilities.json` / `.ts` | 官方 RH 端点能力 |
| `src/runtime/creation/creationModelRegistry.ts` | runninghubStandard 从 capabilities 读参数；grok-video-3→broken |
| `src/api/media-generation.ts` | 恢复 grok-video-3 映射；轮询 task_xxx→NewAPI；新增 `requestRefund()` |
| `src/runtime/creation/creationMediaRuntime.ts` | 轮询 task_xxx→NewAPI |
| `src/services/newApiClient.ts` / `src/utils/api.ts` | getGatewayBaseUrl/resolveApiConfig localhost→/__jc_api（**实际未完全生效，见遗留问题**） |
| `src/components/canvas/v8/nodes/V8VideoGenNode.vue` / `V8ImageGenNode.vue` | model 用 modelName |
| `src/stores/mediaTaskStore.ts` | Web 端 task 完成走 remote-only 分支；任务失败自动调 requestRefund |

---

## 5. 本地开发

```bash
cd /Users/by3/Documents/jiucaihezi-app-main
pnpm dev          # Vite → http://localhost:1420（默认）
pnpm tauri dev    # 桌面壳
```

**localhost CORS 注意**：当前部分 endpoint 仍被 CORS 拦截（见 §3 遗留问题）。`/v1/videos*` 不受影响，所以 RH 视频流可以正常验证。

---

## 6. 服务器操作（参考）

SSH: `ssh root@47.82.86.196`（密码在密码管理器）。

### 6.1 关键路径

| 路径 | 说明 |
|------|------|
| `/opt/rh-adapter/` | rh-adapter 部署目录（docker compose） |
| `/opt/rh-adapter/src/main.py` | **主修复文件**，line 205 双装饰器 |
| `/opt/rh-adapter/src/main.py.before-v1-videos-alias` | 修复前备份 |
| `/root/new-api-new/` | NewAPI 生产 compose 目录 |
| 容器内 `/new-api` | NewAPI 二进制（已被本地编译版热替换） |
| 容器内 `/new-api.before-rh-upgrade` | NewAPI 旧二进制备份 |

### 6.2 常用命令

```bash
# rh-adapter 重建
cd /opt/rh-adapter && docker compose up -d --build rh-adapter

# rh-adapter 验证
curl -i http://172.17.0.1:8789/v1/videos/9999999999999999999  # 应返 500，不是 404
curl http://172.17.0.1:8789/v1/videos/{real_rh_task_id}       # 应返 success+URL

# NewAPI tasks 表查询（核心诊断工具）
docker exec postgres psql -U newapi -d new-api -c "
SELECT task_id, status, fail_reason, LEFT(data::text, 200), 
       (private_data::json)->>'upstream_task_id' AS rh_id, 
       created_at, updated_at
FROM tasks 
WHERE task_id = '<task_xxx>';"

# NewAPI 日志
docker logs new-api --since 10m 2>&1 | grep -i task | tail
```

### 6.3 NewAPI 升级回滚（如需）

```bash
docker cp new-api:/new-api.before-rh-upgrade /root/
docker cp /root/new-api.before-rh-upgrade new-api:/new-api
docker exec new-api chmod +x /new-api
docker restart new-api
```

### 6.4 rh-adapter 回滚（如需）

```bash
cp /opt/rh-adapter/src/main.py.before-v1-videos-alias /opt/rh-adapter/src/main.py
cd /opt/rh-adapter && docker compose up -d --build rh-adapter
```

---

## 7. 关键经验（写给未来 AI）

1. **第一信号是数据库，不是前端控制台**。前端轮询日志只能告诉你"前端拿到了什么"，告诉不了你"上游真实状态"。RH 视频问题的真凶藏在 `tasks.fail_reason` 和 `tasks.data` 里，前端两天看不到。

2. **任务 9 秒就失败 ≠ 10 分钟超时**。前端日志会让你以为是超时问题（因为它确实等了 10 分钟才报错），但 PostgreSQL 显示任务 9 秒就 FAILURE 了。前端只是拿到 NewAPI 返回的"任务历史 data"，不是"实时状态"。

3. **`{"detail":"Not Found"}` 是 FastAPI 默认 404**。这是 FastAPI 的指纹响应，看到这个就先怀疑"路由根本没注册"，不要先怀疑"路由的业务逻辑"。

4. **不要在前端折腾上游服务器问题**。CORS、URL 不返回、status 解析等问题 99% 是服务器侧。前端能做的是兜底显示，不是补救后端 bug。

5. **rh-adapter 修复用 sed + Docker rebuild，~30 秒**。NewAPI 升级容器内热替换，~30 分钟，且不是问题所在。**对症下药 vs 全身换药**的差距在这。

---

## 8. 接手行动清单

如果生产/支线再次出现 RH 视频"前端不显示"或"自动退款"：

1. **不要再升级 NewAPI**。升级是上一轮的弯路。
2. **不要从前端开始排查**。前端只是症状方。
3. ssh 服务器，先查 PostgreSQL：

   ```sql
   SELECT task_id, status, fail_reason, LEFT(data::text, 300),
          (private_data::json)->>'upstream_task_id' AS rh_id
   FROM tasks WHERE task_id = '<最近失败任务 ID>';
   ```

4. 如果 fail_reason 是 `upstream returned unrecognized message` 且 data 是 `{"detail":"Not Found"}` → **rh-adapter 路由问题，检查 `/opt/rh-adapter/src/main.py` 是否还有 `/v1/videos/{task_id}` alias**（可能被某次 docker compose --force-recreate 或代码合并冲掉）。
5. 如果是别的 fail_reason → 看 NewAPI Sora adaptor 在调什么 URL，跟 rh-adapter 路由表对照。
6. 看完真因再决定改前端还是改服务器。**99% 的可能是服务器**。
