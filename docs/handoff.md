# 交接文档：jiucaihezi 后端架构

> 日期: 2026-06-03  
> 状态: gateway 已是 Auth Broker，需清理死代码；rh-adapter 已独立完成

---

## 1. 整体架构

```
用户浏览器
    │
    ├── 一键登录 ──→ Auth Broker (CF Worker)
    │                 api.jiucaihezi.studio/auth/*
    │                 换 NewAPI Key → 返回 api_key
    │
    ├── 聊天 ──────→ New API (:3000)
    │                 直连 /v1/chat/completions
    │
    └── 媒体生成 ──→ New API (:3000) ──→ rh-adapter (:8789) ──→ RunningHub
                      直连 /v1/images/generations                (356+ 端点)
                          /v1/videos
                          /v1/audio/speech
```

**三个组件各司其职：**

| 组件 | 位置 | 职责 | 状态 |
|:---|:---|:---|:---|
| **Auth Broker** | `gateway/` (CF Worker) | 一键登录换 Key | ✅ 已是纯 Auth |
| **New API** | Docker `cautionion/new-api` | 用户系统 / 定价 / 扣费 / LLM | ✅ 已部署 |
| **rh-adapter** | `rh-adapter/` (独立项目) | RunningHub 协议翻译 | ✅ 刚完成 |

---

## 2. Auth Broker 现状

### 文件：`gateway/src/index.js`

```
路由:
  GET  /                    → landing 首页
  GET  /health              → 健康检查
  GET  /landing/*           → landing 静态资源
  POST /auth/login          → 登录 → 返回 { api_key, base_url }
  POST /auth/logout         → 登出
  GET  /auth/session        → 会话检查
```

**✅ 已是纯 Auth Broker**。没有聊天代理路由，没有媒体生成路由。

### ⚠️ 需要清理的死代码

`gateway/src/newapi.js` 中有 **4 个已不再使用的函数**：

```javascript
// ❌ 死代码 — index.js 已不调用
submitManualChatCompletion()
submitManualChatCompletionStream()
submitUserChatCompletion()
submitUserChatCompletionStream()

// ❌ 仅被上面函数使用的辅助函数
sanitizePayload()
requestFor()
parseUpstreamError()
```

**保留不删：**
```javascript
newApiBase()        // 被 auth-service.js 使用
```

### 清理后 `newapi.js` 只剩

```javascript
import { readFirstEnv, trimBaseUrl } from './env.js';

export function newApiBase(env) {
  return trimBaseUrl(readFirstEnv(env, ['NEWAPI_BASE_URL', 'NEW_API_BASE_URL', 'NEWAPI_API_URL'], 'https://api.jiucaihezi.studio'));
}
```

> 甚至可以合并到 `env.js`，删掉整个 `newapi.js`。

---

## 3. rh-adapter 状态

### 位置

```
rh-adapter/
├── src/
│   ├── main.py                    # FastAPI 入口
│   ├── config.py                  # 环境变量（只需 RUNNINGHUB_API_KEY）
│   ├── models/
│   │   ├── mapping.py             # 🔧 模型映射表 — 唯一需要维护的配置
│   │   └── schemas.py             # OpenAI 兼容请求/响应格式
│   ├── services/
│   │   ├── rh_client.py           # RunningHub HTTP 客户端（核心引擎）
│   │   ├── image.py               # 图片生成
│   │   ├── video.py               # 视频生成
│   │   └── audio.py               # 音频生成
│   └── middleware/
│       └── error_handler.py       # 错误处理
├── tests/
│   ├── test_health.py             # 17 个测试全部通过
│   └── test_mapping.py
├── Dockerfile
├── docker-compose.yml
└── .env.example                   # RUNNINGHUB_API_KEY=
```

### 已实现 API

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/health` | 返回 `{"status":"ok","models":15}` |
| GET | `/v1/models` | 列出 15 个可用模型 |
| POST | `/check` | 验证 API Key + 查余额 |
| POST | `/v1/images/generations` | 图片生成 |
| POST | `/v1/videos` | 视频生成 |
| POST | `/v1/audio/speech` | 语音合成 |

### 支持 15 个模型

| 类别 | 数量 | 模型名 |
|:---|:---|:---|
| 图片 | 3 | rh-pro-image, rh-image-v2, rh-gpt2-image |
| 视频 | 6 | rh-video-v31-fast, rh-kling-v30-pro, rh-veo-31-fast, rh-veo-31-pro, rh-seedance2, grok-video-3 |
| 音频 | 4 | rh-speech-hd, rh-speech-turbo, rh-music, rh-voice-clone |
| 3D | 2 | rh-3d-text, rh-3d-image |

---

## 4. 下一步工作

### 前端侧（另一个同事做）

```
jiucaihezi-app/src/
```

现有 `CreationPanel.vue` 已定义了 GH 模型（`rh-pro-image` 等），但状态都是 `enabled: false`。

**需要做的：**
1. 把 `mediaModelCapabilities.ts` 中 RH 模型的 `enabled: false` → 改成 `enabled: true`
2. 前端调 New API `/v1/images/generations` 时传 `model: "rh-pro-image"`
3. New API 识别到 RH 模型 → 转发给 rh-adapter → 返回结果

**定价在 New API 后台配置**，前端不感知。

### 部署侧

1. 把 rh-adapter 的 `docker-compose.yml` service 块合并到 New API 的 compose 文件
2. 在 New API 后台添加「自定义渠道」：
   - 类型：自定义渠道
   - 代理：`http://rh-adapter:8789`
   - 模型列表：`rh-pro-image,rh-image-v2,...,rh-3d-image`
3. 在 New API 后台「模型价格」为每个模型设 `¥X.XX/次`

### Gateway 清理（可选，优先级低）

从 `gateway/src/newapi.js` 删除死代码（chat 代理函数），不影响线上。

---

## 5. 关键决策记录

| 决策 | 选择 | 原因 |
|:---|:---|:---|
| rh-adapter 工作在哪里 | 独立 FastAPI 服务 | 复用 Python 生态，不依赖现有项目 |
| rh-adapter 如何部署 | Docker，跟 New API 同机 | 内网通信，不需要公网暴露 |
| 计费在哪里 | New API 内置（按次定价） | 零计费代码，后台配价格就行 |
| 聊天走不走 Gateway | 不走，直连 New API | 前端已有 API Key，不需要中间层 |
| 前端要不要改 | 不改，只改 `enabled` 状态 | 现有模型定义已足够 |

---

## 6. 文件清单

```
jiucaihezi-app/
│
├── gateway/              ← Auth Broker (CF Worker)
│   ├── src/
│   │   ├── index.js      ✅ 纯 Auth，路由清晰
│   │   ├── auth-service.js ✅ 登录/登出/session 逻辑
│   │   ├── newapi.js     ⚠️ 含死代码（chat 代理函数）
│   │   ├── cors.js
│   │   ├── env.js
│   │   ├── errors.js
│   │   └── http.js
│   ├── tests/
│   │   ├── auth-broker.test.mjs ✅ 新测试
│   │   └── login.test.mjs
│   ├── wrangler.toml     ✅ 路由已精简（无 chat 路由）
│   └── docs/
│       └── SDD-rh-adapter.md   (设计文档，vs 实际代码可能有偏差)
│
├── rh-adapter/           🆕 RunningHub 协议翻译层
│   └── (见第 3 节)
│
├── src/                  ← 前端 Vue 项目
│   ├── components/creation/    ← CreationPanel 等
│   ├── composables/useCreation.ts
│   ├── stores/mediaTaskStore.ts
│   ├── data/
│   │   ├── creationModels.ts
│   │   └── mediaModelCapabilities.ts  ← RH 模型定义在这里
│   ├── api/media-generation.ts
│   └── services/newApiClient.ts
│
└── docs/
    └── sdd/
        └── auth-broker-adapter-layer-tdd-plan.md   (设计蓝图)
```
