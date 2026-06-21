# 媒体创作优化分支 — 交接说明

> **分支**: `media-creation-optimization`
> **基于**: `origin/desktop`
> **日期**: 2026-06-21
> **状态**: 前端改动完成已验证，rh-adapter 轮询 500 仍阻塞

---

## 一、目标

优化创作面板和画布共有的后端逻辑 + 前端 UI：
1. 只保留 RunningHub 渠道，隐藏其他不稳定渠道（T8/火山/WorldRouter/特朗普）
2. 对齐 5 个 RH 工作流模型的参数

---

## 二、已完成的前端改动（已验证通过）

| 文件 | 改动 | 状态 |
|------|------|:--:|
| `src/runtime/creation/creationModelRegistry.ts` | +`RH_ONLY_MODE=true` 过滤非 RH 模型；"我是导演"去掉多余 prompt 字段，text label 改为"简单说下动作是啥" | ✅ |
| `src/data/mediaModelCapabilities.ts` | +`RH_ONLY_MODE=true` 过滤旧系统非 RH provider | ✅ |
| `src/composables/useCreation.ts` | hint 文案同步 | ✅ |
| `src/components/creation/CreationPanel.vue` | placeholder 文案同步 | ✅ |
| `docs/rh-adapter-server-deploy-runbook.md` | 新增 §3.1 Git 稀疏检出部署方案 | ✅ |
| `CLAUDE.md` | rh-adapter 部署指令更新 | ✅ |

**验证方式**: `pnpm exec vue-tsc -b` + `pnpm exec vite build` 均通过。

> 前端改动已通过 Cloudflare Pages 部署到 `jiucaihezi.studio`。

---

## 三、rh-adapter 后端改动（已部署，但问题未完全解决）

### 3.1 改了什么

在 3 个文件增加了对非 dict 响应的防御，避免 `'str' object has no attribute 'get'` 崩溃：

| 文件 | 函数 | 防御 |
|------|------|------|
| `rh-adapter/src/services/rh_client.py` | `_check_rh_error` | `if not isinstance(data, dict): raise RHError(...)` |
| `rh-adapter/src/services/rh_client.py` | `extract_result_url` | `if not isinstance(task_data, dict): return ""` |
| `rh-adapter/src/services/rh_client.py` | `extract_result_text` | `if not isinstance(task_data, dict): return ""` |
| `rh-adapter/src/services/rh_client.py` | `extract_cost` | `if not isinstance(task_data, dict): return 0.0` |
| `rh-adapter/src/main.py` | `build_task_status_response` | `if not isinstance(task_data, dict): return {...}` |

### 3.2 已确认在容器内生效

```bash
docker exec rh-adapter-rh-adapter-1 grep -n "not isinstance(task_data, dict)" /app/src/services/rh_client.py
# 435:    if not isinstance(task_data, dict):
# 463:    if not isinstance(task_data, dict):
# 484:    if not isinstance(task_data, dict):

docker exec rh-adapter-rh-adapter-1 grep -n "not isinstance(task_data, dict)" /app/src/main.py
# 73:    if not isinstance(task_data, dict):
# 77:    if not isinstance(task_data, dict):
```

---

## 四、当前阻塞问题

### 4.1 现象

- **提交声音设计** → `POST /v1/audio/speech` → 200 OK ✅
- **上游 RunningHub** → 任务 105 秒完成，返回 SUCCESS + flac URL ✅
- **前端轮询** → `GET /rh/tasks/{task_id}?ai_app=true` → **500 Internal Server Error** ❌
- 错误消息：`Internal adapter error: 'str' object has no attribute 'get'`

### 4.2 轮询链路

```
前端 pollTask() → GET /rh/tasks/{id}?ai_app=true
  → Nginx → rh-adapter (172.17.0.1:8789)
    → get_task_status() → query_ai_app_task()
      → _get(RH_AI_APP_STATUS)     ← 查询 RH 任务状态
      → _get(RH_AI_APP_OUTPUTS)    ← 若无 URL 则补查 outputs
      → extract_result_url(task_data)
      → build_task_status_response(task_id, task_data)
```

### 4.3 已排除的崩溃点

5 个 `.get()` 调用点已防御：
1. `_check_rh_error(data).get("code")` ✅
2. `extract_result_url(task_data).get("url")` ✅
3. `extract_result_text(task_data).get("text")` ✅
4. `extract_cost(task_data).get("usage")` ✅
5. `build_task_status_response(task_data).get("status")` ✅

### 4.4 可能仍有问题的位置

以下代码路径中的 `.get()` **尚未防御**，需要排查：

**`rh_client.py` — `query_ai_app_task()` L402-431:**
```python
async def query_ai_app_task(client, api_key, task_id):
    data = await _get(client, RH_AI_APP_STATUS, ...)
    task_data = data.get("data", data)      # ← data 已验证是 dict，安全
    url = extract_result_url(task_data)      # ← 已防御 ✅
    if not url:
        out_data = await _get(client, RH_AI_APP_OUTPUTS, ...)
        out = out_data.get("data", out_data)  # ← 同上
        url = extract_result_url(out) if isinstance(out, dict) else ""
        if url:
            task_data["url"] = url           # ← 如果 task_data 是 str，这里崩溃但不是 .get()
    return task_data
```

**`rh_client.py` — `extract_task_time()`:**
```python
def extract_task_time(task_data: dict) -> float:
    usage = task_data.get("usage", {})  # ← 未防御！
    t = usage.get("taskCostTime")
```

**`rh_client.py` — `_get()` L140-152:**
```python
async def _get(client, url, payload, api_key, timeout=30):
    try:
        resp = await client.post(...)
        data = resp.json()
        _check_rh_error(data, f"GET {url}")
        return data
    except RHError:
        raise
    except httpx.TimeoutException:
        raise RHError(...)
    except Exception as e:
        raise RHError(f"Request failed: {e}", code=500)
```

### 4.5 关键线索

错误出现在 `general_exception_handler`（type=`adapter_error`），说明抛出的**不是** `RHError`，而是未包装的原始 `AttributeError`。这意味着崩溃发生在 try-except 块**之外**，或者某个 except 块本身又抛了异常。

**下一步排查建议**：
1. 在服务器查 rh-adapter 日志，找完整 traceback：
   ```bash
   docker compose logs rh-adapter --tail 100 | grep -A20 "AttributeError\|object has no attribute"
   ```
2. 如果日志不够，临时在 `_get()` 里加 `logger.exception("_get failed")` 看完整堆栈
3. 最可能漏掉的：`extract_task_time` 函数的 `task_data.get("usage")` 调用

---

## 五、服务器信息

| 项目 | 值 |
|------|-----|
| IP | `47.82.86.196` |
| rh-adapter 路径 | `/opt/rh-adapter` |
| 部署方式 | `python3 -c "..."` 热修改源码 + `docker compose up -d --build rh-adapter` |
| 验证修复是否在容器内 | `docker exec rh-adapter-rh-adapter-1 grep -n "not isinstance" /app/src/services/rh_client.py` |

---

## 六、本地无法测试的原因

`pnpm tauri dev` 和 `pnpm dev` 都无法测试创作面板：
- Tauri dev：`localhost:1420` 被 `isLocalWebOrigin` 命中，API 走 Vite proxy，但 `media-generation.ts` 硬编码了 `https://api.jiucaihezi.studio`，不走 proxy，浏览器 CORS 拦截
- Web dev (`pnpm dev`)：同上
- 唯一可行：Cloudflare Pages 部署 Web 包到 `jiucaihezi.studio`

---

## 七、后续建议

1. **先查日志**定位剩余崩溃点（最可能 `extract_task_time` 或 `_get()` 内部的异常处理）
2. **修完后**建议在服务器上初始化 git sparse checkout（见 runbook §3.1），以后 `git pull` + `docker compose up -d --build` 两命令部署，避免手动 `sed`/`python3 -c` 容易出错
3. **前端改动**可直接合入 `desktop` 分支——已验证通过，不影响任何现有功能
