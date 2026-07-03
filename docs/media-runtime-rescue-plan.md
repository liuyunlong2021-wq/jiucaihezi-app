# 媒体生成主线救援计划 — RH 视频路由修复

> **日期**: 2026-06-17
> **分支**: `codex/media-runtime-rescue`
> **目标**: 修复 RH 视频模型错误使用 `/v1/videos` 的问题，恢复已验证的 `/rh/submit/v1/videos` 路径
> **原则**: 以 main 为底座，只移植已验证路径，不整包替换旧 RH 支线

---

## 根因分析

当前 main 支线 RH 视频模型提交端点从已验证的 `/rh/submit/v1/videos` 被错误改为 `/v1/videos`。

```text
正确链路: POST /rh/submit/v1/videos → 轮询 GET /rh/tasks/{真实 RH task_id}
错误链路: POST /v1/videos → NewAPI 返回包装 task_id(如 task_xxx) → 轮询 /rh/tasks/{包装id} → RH adapter 查询失败
```

根因位置（2 处）：

1. `src/runtime/creation/creationModelRegistry.ts` L231 — `runninghubStandard()` 默认端点三元表达式
2. `src/api/media-generation.ts` ~L800 — `generateVideo()` 中 RH 视频硬编码路径

---

## Phase 1: 分支保护

```bash
# 确认工作区干净
git status

# 从 main 创建备份分支
git branch backup/main-broken-media-20260617 main

# 从 main 创建救援分支
git checkout main
git checkout -b codex/media-runtime-rescue
```

---

## Phase 2: 修复 RH 视频提交端点

### 2a: `src/runtime/creation/creationModelRegistry.ts` — L231

**当前（错误）：**

```typescript
endpoint: input.endpoint || (isAudio ? '/v1/audio/speech' : input.task === 'image' ? '/v1/images/generations' : '/v1/videos'),
```

**修改为：**

```typescript
endpoint: input.endpoint || (isAudio ? '/v1/audio/speech' : input.task === 'image' ? '/v1/images/generations' : '/rh/submit/v1/videos'),
```

> 影响范围：所有 `source: 'runninghub'` 且 `task: 'video'` 或 `task: 'digital-human'` 的模型（约 15 个）

### 2b: `src/api/media-generation.ts` — `generateVideo()` 函数

**当前（错误，~L800）：**

```typescript
const resData = await apiCall('/v1/videos', rhBody, 'POST', model)
```

**修改为：**

```typescript
const resData = await apiCall('/rh/submit/v1/videos', rhBody, 'POST', model)
```

> 不影响：RH 图片 (`/v1/images/generations` ✅) 、RH 音频 (`/v1/audio/speech` ✅)

---

## Phase 3: 禁用不可用的非 RH 视频模型

### 3a: `creationModelRegistry.ts` — 标记 broken/degraded

| 模型 ID | 当前错误 | 处理 |
|---------|---------|------|
| `newapi/t8/grok-video-3-fast` | 503 渠道不可用 | `contractStatus: 'broken'` |
| `newapi/t8/veo3.1-fast` | model_not_found | `contractStatus: 'broken'` |
| `newapi/trump/seedance-2.0` | `/api/v3/contents/generations/tasks` → 404 | `contractStatus: 'broken'` |
| `newapi/trump/seedance-2.0-fast` | 同上 404 | `contractStatus: 'broken'` |
| `newapi/t8/seedance-2-0-fast` | `/api/seedance/v1/videos` → 522 | `contractStatus: 'degraded'` |

### 3b: `mediaModelCapabilities.ts` — 同步旧面板

对应旧面板的 `grok-video-3` / `veo3.1-fast` / `seedance-2-0` 等模型同步标记为 `enabled: false` 或更新不可用原因。

---

## Phase 4: 更新测试

### 文件: `src/runtime/creation/__tests__/creationMediaRuntime.test.ts`

### 4a: 更新现有断言（4 处 `/v1/videos` → `/rh/submit/v1/videos`）

| 行号 | 测试名称 | 改动 |
|------|---------|------|
| ~194 | P4 RH AI App digital-human | `url.endsWith('/v1/videos')` → `'/rh/submit/v1/videos'` |
| ~225 | 同上 | `assert.equal(request.endpoint, '/v1/videos')` → `'/rh/submit/v1/videos'` |
| ~341 | P5 RH Seedance | `url.endsWith('/v1/videos')` → `'/rh/submit/v1/videos'` |
| ~388 | P5 RH Grok | `url.endsWith('/v1/videos')` → `'/rh/submit/v1/videos'` |

### 4b: 新增端点路由专项测试

```text
test('RH 图片模型提交 URL 必须是 /v1/images/generations')
test('RH 视频模型提交 URL 必须是 /rh/submit/v1/videos')
test('RH 音频模型提交 URL 必须是 /v1/audio/speech')
test('RH 视频返回 task_id 后 pollUrl 必须是 /rh/tasks/{task_id}')
test('z-image-turbo 保留且作为 RH 图片模型可执行')
test('不可用非 RH 视频模型 contractStatus 不为 verified')
```

---

## Phase 5: 验证

```bash
# 类型检查
pnpm exec vue-tsc -b

# 媒体测试
pnpm run test:focused:build && pnpm run test:focused:run

# 手动验证路由映射：
# - z-image-turbo           → /v1/images/generations      ✅
# - rh-grok-text-video      → /rh/submit/v1/videos         ✅（修复后）
# - rh-video-v31-fast       → /rh/submit/v1/videos         ✅（修复后）
# - rh-seedance2-text-video → /rh/submit/v1/videos         ✅（修复后）
# - rh-suno-v55-single      → /v1/audio/speech             ✅
# - 不可用非 RH 模型不在创作面板显示为"可点击"
```

---

## 影响文件总览

| 文件 | 改动 | 风险 |
|------|------|------|
| `src/runtime/creation/creationModelRegistry.ts` | 🔴 核心：端点默认值修正 + broken/degraded 标记 | 高 — 影响所有 RH 视频模型路由 |
| `src/api/media-generation.ts` | 🔴 核心：硬编码 `/v1/videos` → `/rh/submit/v1/videos` | 高 — 影响 ChatPanel 直接调用路径 |
| `src/data/mediaModelCapabilities.ts` | 🟡 辅助：旧面板 model enabled 同步 | 低 — 仅 UI 层可见性 |
| `src/runtime/creation/__tests__/creationMediaRuntime.test.ts` | 🟡 测试：更新断言 + 新增路由测试 | 低 — 测试代码 |

### 不修改的文件

| 文件 | 原因 |
|------|------|
| `src/stores/mediaTaskStore.ts` | 纯委托层，无硬编码端点 |
| `src/components/creation/CreationPanel.vue` | UI 层，端点来自 plan，自动跟随 |
| `src/canvas/providers/canvasModels.ts` | 画布模型定义，不涉及 `/v1/videos` |
| `src/runtime/creation/creationMediaRuntime.ts` | 使用 `request.endpoint`（来自 plan），自动跟随 |
| `rh-adapter/` | `/rh/submit/v1/videos` 是其已有接口，无需改 |

---

## 关键决策记录

1. **RH 视频端点**: 使用 `/rh/submit/v1/videos`（rh-adapter 已有接口），不发明 `/v1/video/generations` 或继续用 `/v1/videos`
2. **RH 图片保持 `/v1/images/generations`**: 已验证可用（含 `z-image-turbo`），不修改
3. **不可用模型**: 标记 `broken`/`degraded` 而非删除，保留元数据以备上游恢复
4. **不整包替换**: 以 main 为底座，只移植已验证路径，保留 main 新增的 `z-image-turbo` 等能力

## 排除范围

- 不修改 `rh-adapter/` 后端
- 不重构创作面板 UI
- 不动画布媒体路由
- 不修改对话/OpenCode 链路
- 不「统一架构」而破坏已验证路径
