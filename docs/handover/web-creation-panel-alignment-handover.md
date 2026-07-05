# 交接：Web 端创作面板对齐 + GPT Image 2 官方模型 + 轮询超时修复

> **日期**: 2026-07-05
> **作者**: Codex / by3
> **目标分支名**: `0705-chuagnzuo`
> **当前基线**: `main` @ `152f847`

---

## 一、目标

本次分支解决三个问题：

| # | 问题 | 类型 |
|---|------|------|
| 1 | Web 端创作面板对齐桌面端 | 功能补齐 |
| 2 | GPT Image 2 第三方模型轮询超时：上游 RH 5:30 出图，任务列表 10+ 分钟未收到 | Bug |
| 3 | 新增 RH GPT Image 2 官方模型 `rh-gpt2-official`，替换第三方渠道 | 新模型 |

---

## 二、问题 1：Web 端创作面板对齐桌面端

桌面端创作面板核心链路：
```
CreationPanel → useCreation → media-generation.ts → NewAPI/rh-adapter → 轮询 → 任务列表
                                                                              ↓
                                                              产出写入 {projectDir}/jc-media/
```

### 可行性分析

**核心链路已经跨平台**。从提交任务到轮询结果的 HTTP 调用链（`media-generation.ts` → NewAPI → 轮询）不依赖 Tauri，Web 端可以直接复用。

**只需处理 3 个文件 I/O 差异**：

---

### 需要改的 3 个点

#### Touchpoint 1: 参考图下载（解决跨域 CORS）

**文件**: `src/runtime/creation/creationMediaRuntime.ts` L122-140

**现状**: 桌面端通过 Tauri `http_download_base64` 下载参考图 URL，绕过浏览器 CORS。

**Web 方案**: 通过 gateway Worker 代理下载
- gateway/src/ 已有 Cloudflare Worker，加一个 `/api/proxy-image?url=...` 端点
- Worker fetch 不受 CORS 限制
- 前端: `imageBase64 = await fetch(\`/api/proxy-image?url=${encodeURIComponent(url)}\`)`

#### Touchpoint 2: 产出文件写入

**文件**: `src/utils/projectMediaWriter.ts` L59-68

**Web 方案**: 浏览器 Blob 下载，`projectMediaWriter.ts` 加 Web fallback。

#### Touchpoint 3: 打开/预览产出文件

**文件**: `src/components/creation/CreationPanel.vue` L159-180

**Web 方案**: 预览用 `window.open(resultUrl, '_blank')`，"打开文件夹" 按钮在 Web 端隐藏。

### 实施顺序

```
Phase 1: 参考图下载（Touchpoint 1）→ gateway Worker 加 /api/proxy-image
Phase 2: 产出文件下载（Touchpoint 2）→ projectMediaWriter 加 Web fallback
Phase 3: 预览/打开（Touchpoint 3）→ CreationPanel 预览按钮适配 Web
Phase 4: Web 端入口接入 → WorkspaceLayout 确认创作面板在 Web 端可见
Phase 5: 验证 → pnpm build && wrangler pages deploy dist
```

---

## 三、问题 2：GPT Image 2 轮询超时诊断

### 现象

用户反馈：RH 渠道 GPT Image 2（`rh-gpt2-image` / `rh-gpt2-text`，第三方第三方渠道模型）提交任务后，上游 RH 后台约 **5 分 30 秒** 已生成图片，但前端任务列表持续显示"处理中"超过 **10 分钟**，始终未收到结果。

### 根因分析（待验证）

| 可能原因 | 位置 | 说明 |
|----------|------|------|
| rh-adapter 轮询超时 | `config.py` `MAX_POLL_SECONDS=600` | 600s=10min，但上游 5:30 完成，理论上应在 600s 内 |
| 轮询间隔过大 | `POLL_INTERVAL_IMAGE=5` | 每 5s 查一次，正常 |
| NewAPI 层轮询失效 | NewAPI `relay/channel/task/sora/adaptor.go` | NewAPI 的 Sora 异步适配器可能未正确处理 RH 返回的 status |
| 任务状态解析错误 | rh-adapter `build_task_status_response()` | `SUCCESS` 状态未正确映射为 `completed` |
| 前端轮询停止条件 | `media-generation.ts` | 可能轮询逻辑在某个条件下提前停止或无限循环 |

### 排查步骤

1. **查 rh-adapter 日志**：`docker logs rh-adapter` 看任务 `task_id` 的提交和轮询记录
2. **查 NewAPI tasks 表**：`docker exec newapi-postgres psql -U newapi -d newapi -c "SELECT task_id, status, created_at, updated_at FROM tasks WHERE task_id = '<taskId>' ORDER BY updated_at DESC LIMIT 5;"`
3. **直接查 RH**：`curl -X POST https://www.runninghub.cn/openapi/v2/query -H "Authorization: Bearer $RH_KEY" -d '{"taskId":"<taskId>"}'` 确认 RH 侧状态
4. **对比时间戳**：RH 完成时间 vs NewAPI 最后一次轮询时间 vs 前端显示时间

### 快速修复方向

- 如果 rh-adapter 轮询正常但 NewAPI 未更新 → 检查 NewAPI 的 RH channel adaptor
- 如果前端未收到更新 → 检查 `media-generation.ts` 轮询循环
- 如果 rh-adapter 未正确轮询 → 检查 `services/rh_client.py` 的 `query_task` 函数

---

## 四、问题 3：新增 RH GPT Image 2 官方模型

### 背景

当前产品使用的是 **第三方渠道** GPT Image 2（`rhart-image-g-2`），需要增加 **官方稳定版**（`rhart-image-g-2-official`）。官方版有两个子模式：

- `rhart-image-g-2-official/text-to-image` — 文生图
- `rhart-image-g-2-official/image-to-image` — 图生图

### 关键约束

| 参数 | 固定值 | 原因 |
|------|--------|------|
| `quality` | `low` | NewAPI 统一计费 |
| `resolution` | `1k` | NewAPI 统一计费 |

这两个参数在 rh-adapter 层强制写入，前端不暴露给用户选择。

### 前端 UI 设计

模型显示位置：**创作面板模型列表最顶部**（优先级最高）

交互逻辑：
- 用户 **不传参考图** → 自动走文生图（`text-to-image`）
- 用户 **上传参考图** → 自动切图生图（`image-to-image`）
- 两种模式统一为一个条目：「**GPT Image 2 官方**」

### 需要改的文件

| 层 | 文件 | 改动 |
|----|------|------|
| rh-adapter | `src/models/mapping.py` | 新增 `rh-gpt2-official` 模型映射 |
| rh-adapter | `src/services/image.py` | 对官方模型强制 `quality=low` + `resolution=1k` |
| 前端 | `src/data/mediaModelCapabilities.ts` | 新增 `rh-gpt2-official` 能力声明 |
| 前端 | `src/runtime/creation/creationModelRegistry.ts` | 新增模型条目（置顶） |
| 服务器 | rh-adapter 重新部署 | `docker compose up -d --force-recreate rh-adapter` |
| NewAPI | 渠道模型配置 | 新增 `rh-gpt2-official` 模型 + 计费 |

---

## 五、NewAPI 配置

### 渠道中要添加的模型名

```
rh-gpt2-official
```

### 计费配置（按 0.1 元/次）

在 NewAPI 渠道模型设置中：

- **模型名**: `rh-gpt2-official`
- **模型类型**: `image`（图片生成）
- **计费方式**: 按次计费
- **倍率/价格**: `0.1`

NewAPI 中具体操作路径：`渠道 → 编辑 RunningHub 渠道 → 模型 → 添加模型`，填写：
- 模型名称：`rh-gpt2-official`
- 模型标签：`GPT Image 2 官方`
- 类型：`image`
- 计费倍率：`0.1`（假设基础费率为 1，即 0.1 元/次）

如果 NewAPI 使用分组计费，则在分组中加一条：
```
模型映射: rh-gpt2-official → rh-gpt2-official
价格: 0.1
```

---

## 六、验证清单

- [ ] rh-adapter 本地测试：`curl -X POST localhost:8789/v1/images/generations -d '{"model":"rh-gpt2-official","prompt":"test"}'` 返回 task_id
- [ ] 查 rh-adapter 日志确认 `quality=low, resolution=1k` 已写入 payload
- [ ] 前端模型列表第一位显示「GPT Image 2 官方」
- [ ] 不上传参考图 → 走文生图
- [ ] 上传参考图 → 走图生图
- [ ] 任务提交后正常轮询，结果正常显示
- [ ] Web 端能打开创作面板
- [ ] Web 端参考图上传/URL 能正常工作
- [ ] 桌面端创作面板不受影响（回归测试）
