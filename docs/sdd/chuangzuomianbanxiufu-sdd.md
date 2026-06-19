# 创作面板计费修复 — 完整排障实录

> **分支**: `chuangzuomianbanxiufu`（2026-06-19 从 `webhuabu` 创建）
> **状态**: ⏳ 前端已修正，NewAPI task_xxx 包装致轮询失败，需定位 RH 原始 ID
> **服务器**: api.jiucaihezi.studio

---

## 一、发现的两个 P0 Bug

| Bug | 现象 | 根因 |
|-----|------|------|
| A | 视频模型完全不扣费 | `/rh/submit/` Nginx 直连 rh-adapter，绕过 NewAPI 计费 |
| B | 扣费($6)后几秒退款 | NewAPI 包装 task ID 为 `task_xxx`，轮询链断裂 → 判失败 → 退款 |

另有 P2 问题 CORS 双头，以及已修复的 Grok Video 3 静默切换。

---

## 二、尝试过的方案及结果

### 方案 1：rh-adapter 补 cost 字段 ✅ 已部署

修改 `/opt/rh-adapter/src/main.py`，`build_task_status_response()` 添加 `usage.cost` + `output` 字段。
`grep -n '"usage"' /opt/rh-adapter/src/main.py` 确认第 228-229 行已添加，容器内也生效。
但这步必要不充分——NewAPI 轮询拿不到 completed 状态的话 cost 也没用。

### 方案 2：Nginx 封死 /rh/submit/ ⚠️ 止血但副作用大

Nginx `/rh/submit/` location 改为 `return 410`。
结果：旧前端所有视频报错 410。白嫖被封死，但功能也断了。

### 方案 3：前端 endpoint 改为 /v1/videos ✅ 正确方向

`creationModelRegistry.ts:232` 将 RH 视频默认 endpoint 改为 `/v1/videos`。
结果：Seedance 2.0 视频扣费 $6.00 成功，扣费链路通了。

### 方案 4：task_xxx 轮询走 NewAPI ❌ 无效

`creationMediaRuntime.ts` `buildRunningHubPollUrl` 对 `task_xxx` 格式走 `/v1/videos/{id}`。
结果：NewAPI 永远返回 processing，前端 10 分钟超时；NewAPI 自轮询拿 task_xxx 查 rh-adapter → 500 → 退款。

**根因**：NewAPI 无法把 task_xxx 映射回真实 RH 数字 ID，代理轮询失败。

### 方案 5：恢复 /rh/submit/ 直连 ❌ 不可行

回到 Bug A：免费白嫖。

---

## 三、当前状态

```
前端提交 /v1/videos → NewAPI → rh-adapter → RunningHub         ✅
NewAPI 扣费 $6                                                   ✅
NewAPI 返回 { id: "task_xxx", ... } (7 keys, 包装了 RH 数字 ID)   ⚠️
前端轮询 /v1/videos/task_xxx → NewAPI 无法映射 → 永远 processing  ❌
NewAPI 自轮询 task_xxx → rh-adapter → RH 无法解析 → 500          ❌
NewAPI 判 "unrecognized" → 退款                                   ❌
```

**唯一阻塞点**：NewAPI 的 `task_xxx` 包装打破轮询链路。

**当前 Nginx**：`/rh/submit/` → 410（旧前端无法提交视频，需重新部署）

---

## 四、下一步

NewAPI 提交响应有 **7 个 key**，其中一个大概率是 RH 原始数字 ID。
浏览器 DevTools → Network → `POST /v1/videos` → Response JSON，找出 RH 原始 task_id。
找到后前端提取它，轮询走 `/rh/tasks/{数字ID}` 即可闭环。

---

## 五、所有改动

| 文件 | 改动 |
|------|------|
| `creationModelRegistry.ts:232` | endpoint: `/rh/submit/v1/videos` → `/v1/videos` |
| `creationModelRegistry.ts:309` | grok-video-3 → broken |
| `media-generation.ts:761` | 移除 grok-video-3 静默切换 |
| `creationMediaRuntime.ts:415` | task_xxx 走 /v1/videos/{id} |
| `creationMediaRuntime.test.ts` | 测试同步 |
| `mediaGenerationModelGuard.test.ts` | Grok 测试更新 |
| `rh-adapter/src/main.py` (服务器) | 加 usage.cost + output |
| Nginx (服务器) | /rh/submit/ → 410 |

---

## 六、诊断命令

```bash
docker logs --since 1h new-api 2>&1 | grep -i "consume\|record consume"
grep -n '"usage"' /opt/rh-adapter/src/main.py
docker logs --since 10m rh-adapter-rh-adapter-1 2>&1 | grep -i "submit\|query"
grep -A5 'location /rh/submit/' /etc/nginx/sites-enabled/api.jiucaihezi.studio.conf
```
