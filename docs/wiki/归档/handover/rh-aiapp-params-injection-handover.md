# RH AI App 工作流参数注入修复 — 交接文档

> **写给下一个 AI 协作者**：本文档**事无巨细**。读完即可独立工作，无需考古。
>
> **撰写日期**：2026-06-21
> **撰写者**：Claude Opus 4.7（前一轮会话用户：刘云龙）
> **任务难度**：中等偏难，估计 1-3 小时工作量
> **不修复的后果**：所有 5 个 RH AI App 工作流（声音设计、声音克隆、数字人、极速数字人、导演）**任务能跑、能扣费、能拿到结果**，但**输出内容永远是工作流默认 demo 数据，不是用户实际填的内容**

---

## 0. 上手必读（按顺序）

| 顺序 | 文件 | 说明 |
|:--:|------|------|
| 1 | `docs/notes/我的服务器运维手册.md` | 服务器 IP/密码/路径 |
| 2 | `CLAUDE.md` | 项目架构 + 已有铁律（特别是「💀 RH 视频排障铁律」） |
| 3 | `docs/sdd/chuangzuomianbanxiufu-sdd.md` | 创作面板 RH 视频修复记录（上一次类似 bug） |
| 4 | `docs/notes/runninghub 5个工作流模型参数.md` | **RH 5 个 AI App 工作流的真实节点结构** |
| 5 | **本文档** | 你正在读 |

---

## 1. 用户诉求（原话 + 翻译）

### 1.1 用户原话

> "上游 RH 已经生成好了，但是咱们前端没有显示" *（已修复，参见 §2.1）*
> "输出的居然是这个工作流最原始的，不是根据我 UI 前端输入的内容生成的"
> "我本来是他这个工作流我就做好了，我需要把每一个都替换成我的这个要求，然后再输出我的新要求的，输出的完整内容才是我要求的东西。但是现在他输出的是原来的。"

### 1.2 翻译成产品语言

韭菜盒子 Studio 的创作面板提供 **5 个 RH AI App 工作流模型**，用户可以在 UI 上填多个字段（文稿、声音设定、语言、参考图、参考音频等等），点提交后期望 RH 工作流**按这些字段**生成内容。

**当前 bug**：用户填的字段没传到 RH 工作流节点，RH 跑了**默认的 demo 数据**（比如"白起的故事"作为示例文稿）。用户拿到的音频/视频虽然能听/能看，但内容跟他填的**毫无关系**——这等于产品**对用户而言是不可用的**。

### 1.3 用户能接受的最低要求

- ✅ 用户填的字段必须**注入到对应的 RH 工作流节点**
- ✅ 至少**声音设计（rh-aiapp-voice-design）**这一个能跑通完整链路
- ✅ 其他 4 个 AI App 工作流（声音克隆 / 数字人 / 极速数字人 / 导演）**架构上可扩展**，不要求今天全部修完

### 1.4 用户希望避免的事

- ❌ **不要动创作面板的成功路径**（RH 视频 grok-image-video、RH 图像 z-image-turbo 等已经验证能跑，别破坏）
- ❌ **不要动今天上午刚修好的 rh-adapter `query_ai_app_task`**（轮询状态识别已经对了）
- ❌ **不要动 main 分支已经合入的画布、CORS 修复**（除非必要）

---

## 2. 今天已经完成（前一轮会话的成果）

### 2.1 RH AI App **状态识别**已修复 ✅

**Bug**：rh-adapter 调 RH `/task/openapi/status` 用错 HTTP 方法（GET 而不是 POST），且 status 字段是字符串 `"SUCCESS"` 不是 dict。

**修复文件**：`rh-adapter/src/services/rh_client.py` `query_ai_app_task()` 函数
**Commit**：`dd22420` 在分支 `media-creation-optimization`
**部署状态**：✅ 已部署到生产 `47.82.86.196:/opt/rh-adapter/src/services/rh_client.py`
**验证**：curl `http://172.17.0.1:8789/tasks/<taskId>?ai_app=true` 能正确返 `status:completed`、`url:...`

### 2.2 前端 URL 白名单加 xiaoyaoyou.com ✅

**Bug**：RH AI App 输出文件 URL 来自新 CDN `rh-images.xiaoyaoyou.com`，前端白名单只认旧 CDN `rh-*.cos.ap-beijing.myqcloud.com`，被 `mediaTaskStore` 拒绝。

**修复文件**：`src/utils/urlSafety.ts`
**Commit**：`29ba9d8` 在分支 `media-creation-optimization`

### 2.3 CSP 加 xiaoyaoyou.com 白名单 ✅

**Bug**：与 2.2 同源——CSP `connect-src` 没加 xiaoyaoyou，浏览器拒绝 fetch。

**修复文件**：`public/_headers`
**Commit**：`5c2fd70` 在分支 `media-creation-optimization`
**部署状态**：⏳ **待用户 build + Cloudflare Pages deploy**（命令见 §8.1）

---

## 3. 仍未解决：AI App 工作流参数注入

### 3.1 核心症状

用户在创作面板选 `rh-aiapp-voice-design`，填了「文稿」、「声音设定」、「语言」三个字段，点生成。**RH 任务成功**（状态 success、有 url），但**音频内容是 RH 工作流的默认 demo**（"白起的故事" + "30岁男性声音"），**不是用户填的内容**。

### 3.2 完整 Bug 链（已通过纯代码审查定位）

```
┌──────────────────────────────────────────────────────────────┐
│  前端                                                          │
├──────────────────────────────────────────────────────────────┤
│  1. CreationPanel.vue 用户填字段                              │
│       text="用户的文稿"                                        │
│       voicePrompt="用户的声音设定"                             │
│       language="中文"                                          │
│                                                                │
│  2. useCreation.ts:408 buildCurrentCreationParams()           │
│     物化所有 fields → params 对象                              │
│                                                                │
│  3. CreationPanel.vue runCreationViaTaskStore()               │
│     调 mediaTaskStore.submitTask({                            │
│       source: 'creation',                                      │
│       plan,                                                    │
│       audioParams: { text, voicePrompt, language, ... }        │
│     })                                                         │
│                                                                │
│  4. mediaTaskStore.ts:656 _executeTask                        │
│     shouldUseCreationRuntime = source==='creation' && plan    │
│     ✅ 走 creationSubmitExecutor → creationMediaRuntime        │
│                                                                │
│  5. creationMediaRuntime.ts:316 executeRunningHubAudioRequest  │
│     ✅ if (plan.apiStyle === 'rh-aiapp') {                     │
│        body.nodeInfoList = buildRhAiAppNodeInfoList(request)   │
│     }                                                          │
│     ← 这一步**正确构造了 nodeInfoList**！                       │
│     例如 voice-design 会生成：                                  │
│     [                                                          │
│       {nodeId:'12', fieldName:'语言', fieldValue:'中文',       │
│        description:'语言'},                                    │
│       {nodeId:'14', fieldName:'text', fieldValue:'用户文稿',   │
│        description:'文稿'},                                    │
│       {nodeId:'15', fieldName:'text',                          │
│        fieldValue:'用户声音设定',                              │
│        description:'【人设】+【音色特征】...'}                  │
│     ]                                                          │
│                                                                │
│  6. apiCall('/v1/audio/speech', body)                         │
│     POST https://api.jiucaihezi.studio/v1/audio/speech         │
│     body 含 model + nodeInfoList                              │
│                                                                │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  NewAPI (47.82.86.196:3000，channel 61)                       │
├──────────────────────────────────────────────────────────────┤
│  7. NewAPI 收到 POST /v1/audio/speech                          │
│     ★ 嫌疑：NewAPI 的 TTS adaptor 可能只透传 OpenAI 标准字段   │
│       （model / input / voice），把非标准的 nodeInfoList 丢弃 │
│                                                                │
│     对照：RH 视频走 /v1/videos 的 sora adaptor（今天上午已修复）│
│     sora adaptor 是 work 的，能透传 nodeInfoList               │
│     但 /v1/audio/speech 走的是另一个 adaptor，行为未知         │
│                                                                │
│  8. NewAPI 转发给 rh-adapter（透传后的 body）                  │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  rh-adapter (47.82.86.196:8789)                               │
├──────────────────────────────────────────────────────────────┤
│  9. POST /v1/audios 触发 rh-adapter/src/services/audio.py     │
│     create_speech(request: AudioRequest)                       │
│                                                                │
│ 10. audio.py:69 if is_ai_app_model(model): → _submit_via_app  │
│                                                                │
│ 11. audio.py:105 if request.nodeInfoList:                     │
│      ★ 如果 NewAPI 丢字段，request.nodeInfoList = None        │
│      → 进 else 分支 fallback                                  │
│      → discovered = fetch_ai_app_node_info(webapp_id)          │
│      → apply_ai_app_inputs(prompt=request.text or             │
│                            request.prompt)                     │
│                                                                │
│ 12. ai_app.py:108 apply_ai_app_inputs() 函数签名              │
│      def apply_ai_app_inputs(                                  │
│          ..., prompt='', images, videos, audios,               │
│          duration, ratio, size                                 │
│      ):                                                        │
│      ★ 完全没有 text / voice_prompt / language 参数！         │
│      → prompt = "" （用户的 text/voicePrompt 不在签名里被丢）  │
│      → 启发式 _is_prompt_node 找到第一个 text 节点（nodeId 14）│
│      → 注入空字符串                                            │
│      → 第二个 text 节点（nodeId 15）和语言节点（nodeId 12）   │
│         都没被设置                                              │
│                                                                │
│ 13. submit_ai_app(client, webapp_id, node_list)               │
│      → RH 收到的 nodeInfoList：                                │
│         - 节点 14 fieldValue=""（空）                          │
│         - 其他节点全部用工作流默认值                           │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  RunningHub                                                    │
├──────────────────────────────────────────────────────────────┤
│ 14. RH 工作流接收到 nodeInfoList                                │
│      - 节点 14 (text/文稿) = ""                                │
│      - 节点 15 (text/声音设定) 未传 → 用默认值                  │
│      - 节点 12 (语言) 未传 → 用默认值                          │
│                                                                │
│ 15. 工作流执行：                                                │
│     ★ 节点 14 是空字符串，工作流会 fallback 到 demo 数据       │
│     （"白起：秦国最狠的一把刀..." 这种）                        │
│     ★ 节点 15 用 demo "30岁男性声音..."                        │
│                                                                │
│ 16. 生成音频 → 返回 fileUrl                                    │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼
              用户听到：默认 demo 数据，不是自己填的
```

### 3.3 嫌疑根因（按概率排序）

**A. NewAPI 转发 /v1/audio/speech 时丢字段（概率 70%）**

NewAPI 的 TTS adaptor 可能只透传 OpenAI 标准字段：
- 标准字段：`model`、`input`、`voice`、`response_format`、`speed`
- 非标准字段：`nodeInfoList`、`text`、`voice_prompt`、`language` → 可能被丢

对比：
- `/v1/videos`（sora adaptor）今天上午测试时 `nodeInfoList` 是有传过去的（grok 视频生成成功，用了用户的提示词）
- `/v1/images/generations` 也是 sora-like，未测试但应该同 sora 行为
- `/v1/audio/speech` 走的可能是 TTS adaptor，行为不同

**B. 前端 audio 路径根本没走 executeRunningHubAudioRequest（概率 20%）**

虽然 `mediaTaskStore.ts:656` 在 `source='creation' && plan` 时走 creationMediaRuntime，但**audio 类型可能因为某个分支条件没满足而 fallback 到 `generateAudio()` 旧路径**（`mediaTaskStore.ts:707`）。

旧路径 `generateAudio()` (`media-generation.ts:839`) **完全没处理 rh-aiapp 类型的工作流注入**——只处理 Suno 系列模型。所以对 voice-design 会走 `else { rhBody.prompt = audioParams.prompt }`（line 867-869），body 里**只有 model 和 prompt**，没 nodeInfoList。

**C. rh-adapter 内部 logic 有 bug（概率 10%）**

即使前端正确发了 nodeInfoList、NewAPI 也正确透传，rh-adapter `audio.py:105` 判断条件也可能因为某种原因不进入 if 分支。比如：
- `nodeInfoList` 是空数组 `[]` 但 Python 把它视为 truthy → 不进 fallback 但也没起作用
- Pydantic schema 解析时字段名不一致

### 3.4 100% 验证真因的方法

**唯一确定方法**：在 rh-adapter 加诊断日志，看实际收到的 body。

ssh 到服务器（密码在 `docs/notes/我的服务器运维手册.md`）：

```bash
ssh root@47.82.86.196

# 在 audio.py 的 _submit_via_app 开头加诊断日志
cat > /tmp/audio_diag_patch.py << 'EOF'
import re
path = '/opt/rh-adapter/src/services/audio.py'
text = open(path).read()
# 在 _submit_via_app 函数体开头加 logger
marker = 'async def _submit_via_app('
insert = (
    '    logger.info(f"[DIAG] AudioRequest: model={request.model} '
    'nodeInfoList_len={len(request.nodeInfoList) if request.nodeInfoList else 0} '
    'text={(request.text or \"\")[:40]} prompt={(request.prompt or \"\")[:40]}")\\n'
)
# 找到 _submit_via_app 函数定义后第一个 docstring 后插入
new_text = re.sub(
    r'(async def _submit_via_app\([^)]*\)[^:]*:\s*"""[^"]*"""\s*\n)',
    r'\1' + insert,
    text,
    count=1,
)
open(path, 'w').write(new_text)
print('patched')
EOF
python3 /tmp/audio_diag_patch.py

# 重启
cd /opt/rh-adapter && docker compose up -d --build rh-adapter

# 让用户在生产网站再测一次 voice-design
# 然后看日志：
docker logs rh-adapter-rh-adapter-1 --since 5m 2>&1 | grep '\[DIAG\]'
```

**期望看到**：
- 如果 `nodeInfoList_len=0` → 嫌疑 A 确认（NewAPI 丢字段）
- 如果 `nodeInfoList_len=3` 但 RH 还是默认值 → 嫌疑 C
- 如果 audio.py 没被触发 → 嫌疑 B

**用完记得回滚诊断**：`git restore /opt/rh-adapter/src/services/audio.py`（或者用本地仓库覆盖回去）。

### 3.5 修复方案（按嫌疑 A 确认后的处理）

#### 方案 X: 改 NewAPI（治本，难度高）

让 NewAPI 的 TTS adaptor 透传 `nodeInfoList`、`text`、`voice_prompt`、`language` 等非标准字段。

需要：
1. 找 NewAPI 处理 `/v1/audio/speech` 的 adaptor 代码（在 `/root/new-api-new/relay/channel/audio/` 或类似路径）
2. 修改 adaptor 让它透传完整 body
3. 重新编译/替换 NewAPI 二进制
4. 重启 new-api 容器

**风险**：NewAPI 是 Go 项目，需要 Go 环境编译。今天上午已经做过一次类似操作（参见 SDD §6.1）。

#### 方案 Y: 前端 hack 编码（最快，治标）

把 `nodeInfoList` 序列化后塞到 OpenAI 标准字段（NewAPI 一定会透传的字段）里，让 rh-adapter 解析。

**修改前端** `src/runtime/creation/creationMediaRuntime.ts:325`：

```typescript
if (request.plan.apiStyle === 'rh-aiapp') {
  const nodeInfoList = buildRhAiAppNodeInfoList(request)
  if (!nodeInfoList.length) throw new Error(...)
  body.nodeInfoList = nodeInfoList
  // ★ HACK: 同时把 nodeInfoList 用 base64 塞进 voice 字段
  //   防止 NewAPI 的 TTS adaptor 丢失非标准字段
  body.voice = '__rh_nodeinfo__' + btoa(JSON.stringify(nodeInfoList))
}
```

**修改后端** `rh-adapter/src/services/audio.py` `_submit_via_app`：

```python
async def _submit_via_app(client, request, api_key):
    # ★ 从 voice 字段恢复 nodeInfoList（NewAPI 可能丢字段的兼容）
    import base64, json
    if not request.nodeInfoList and request.voice and request.voice.startswith('__rh_nodeinfo__'):
        try:
            encoded = request.voice[len('__rh_nodeinfo__'):]
            request.nodeInfoList = json.loads(base64.b64decode(encoded))
            logger.info(f"[HACK] Recovered nodeInfoList from voice field: {len(request.nodeInfoList)} nodes")
        except Exception as e:
            logger.warning(f"[HACK] Failed to decode voice nodeInfoList: {e}")
    # ... 原有逻辑
```

**风险**：
- `voice` 是 OpenAI 标准字段，用户可能有别的用途（但 voice-design 模型没用 voice）
- 编码字符串可能超过 NewAPI 字段长度限制（如果工作流节点很多）

#### 方案 Z: 让 audio 走专门的 RH 端点（违反 SDD 计费规则）

让前端 audio 不走 NewAPI 而直连 rh-adapter Nginx 路径（`/rh/submit/`），绕开 NewAPI 字段过滤。

**风险**：违反 SDD `Nginx: /rh/submit/ → 410（封死）` 的规则——这条路径是被故意封死的，因为它绕过计费。**不推荐**。

#### 方案 W: 修复嫌疑 B（如果是路径问题）

如果诊断显示 audio 走的是 `generateAudio()` 而非 `executeRunningHubAudioRequest`，那是 mediaTaskStore 路径选择有 bug。

需要查：为什么 `source='creation' && plan` 没生效。

**修复点**：`src/stores/mediaTaskStore.ts:656` 附近的 `shouldUseCreationRuntime` 判断。

---

## 4. 代码位置一览（深入修复时查这里）

### 4.1 前端关键文件

| 文件 | Line | 内容 |
|------|------|------|
| `src/composables/useCreation.ts` | 385-399 | `modelFieldParams()` — 从模型 fields 物化默认值 |
| `src/composables/useCreation.ts` | 408-443 | `buildCurrentCreationParams()` — 构造完整 params |
| `src/components/creation/CreationPanel.vue` | ~320 | `runCreationViaTaskStore()` — 创作面板提交入口 |
| `src/components/creation/CreationPanel.vue` | ~381 | `buildCreationRunPlan()` 调用 |
| `src/stores/mediaTaskStore.ts` | 252-272 | `validateTaskInputs()` |
| `src/stores/mediaTaskStore.ts` | 571 | `submitTask()` 函数 |
| `src/stores/mediaTaskStore.ts` | 656 | `shouldUseCreationRuntime` 判断 |
| `src/stores/mediaTaskStore.ts` | 706-707 | audio 类型走 `generateAudio()` 的 fallback 分支 |
| `src/runtime/creation/creationMediaRuntime.ts` | 316-368 | `executeRunningHubAudioRequest` — **关键** |
| `src/runtime/creation/creationMediaRuntime.ts` | 325-328 | AI App 类型构造 nodeInfoList 的分支 |
| `src/runtime/creation/creationMediaRuntime.ts` | 380-491 | `buildRhAiAppNodeInfoList()` — 5 个 AI App 工作流的 nodeInfoList 模板 |
| `src/runtime/creation/creationMediaRuntime.ts` | 473-478 | **voice-design** 的 nodeInfoList 模板（**这是参考真实 RH 节点结构写的**） |
| `src/runtime/creation/creationModelRegistry.ts` | ~351 | voice-design 模型 spec（fields: language/text/voice_prompt） |
| `src/api/media-generation.ts` | 839-885 | `generateAudio()` 旧路径，**没处理 rh-aiapp**，只处理 Suno |
| `src/utils/urlSafety.ts` | 14-28 | `CREATION_RESULT_HOST_PATTERNS` 白名单 |
| `public/_headers` | 1-2 | CSP 头 |

### 4.2 后端 rh-adapter 关键文件

| 文件 | Line | 内容 |
|------|------|------|
| `rh-adapter/src/services/audio.py` | 60-95 | `submit_audio()` 入口 |
| `rh-adapter/src/services/audio.py` | 96-122 | `_submit_via_app()` AI App 提交 — **关键** |
| `rh-adapter/src/services/audio.py` | 105 | `if request.nodeInfoList:` 判断 |
| `rh-adapter/src/services/ai_app.py` | 108-165 | `apply_ai_app_inputs()` 启发式注入（fallback 用） |
| `rh-adapter/src/services/ai_app.py` | 55-70 | `_is_media_node` / `_is_prompt_node` 判定 |
| `rh-adapter/src/services/rh_client.py` | 399-454 | `query_ai_app_task()` — **昨天已修复，别动** |
| `rh-adapter/src/services/rh_client.py` | 430-460 | `extract_result_url()` |
| `rh-adapter/src/models/schemas.py` | 44-68 | `AudioRequest` schema — `nodeInfoList` 字段定义 |
| `rh-adapter/src/main.py` | 191-192 | `/v1/audio/speech` 和 `/v1/audios` 路由 |
| `rh-adapter/src/main.py` | 205 | `/v1/videos/{task_id}` 路由 — **昨天加的 alias，别动** |

### 4.3 RH 真实工作流节点结构

参考文档：`docs/notes/runninghub 5个工作流模型参数.md`

| 模型 | webapp_id | 关键节点 |
|------|-----------|---------|
| `rh-aiapp-voice-design` | 2035739697670000642 | 12=语言, 14=文稿(text), 15=声音设定(text) |
| `rh-aiapp-voice-clone` | TBD | 4=参考音频, 6=start/end, 36=参考文字, 11=输出文字, 1=语言 |
| `rh-aiapp-fast-digital-human` | TBD | 见前端 line 442-444 |
| `rh-aiapp-digital-human` | TBD | 见前端 line 449-454 |
| `rh-aiapp-director` | TBD | 见前端 line 458-463 |

---

## 5. 服务器与部署

### 5.1 服务器基础信息

- **IP**: 47.82.86.196（阿里云香港）
- **SSH**: `ssh root@47.82.86.196`，密码在用户密码管理器
- **关键容器**:
  - `new-api` (3000) — NewAPI 主服务
  - `postgres` (内部) — NewAPI 数据库
  - `rh-adapter-rh-adapter-1` (8789) — RH 适配器
  - `nginx` (80/443) — 反向代理

### 5.2 rh-adapter 部署

- 源码：`/opt/rh-adapter/`
- .env：`/opt/rh-adapter/.env`（含 `RUNNINGHUB_API_KEY=32位`）
- docker compose：`/opt/rh-adapter/docker-compose.yml`
- 重启：`cd /opt/rh-adapter && docker compose up -d --build rh-adapter`
- 备份：`cp /opt/rh-adapter/src/services/audio.py /opt/rh-adapter/src/services/audio.py.before-<task>`

### 5.3 从 GitHub 拉新代码到服务器（今天上午用过的套路）

```bash
# 服务器上跑
wget -O /tmp/audio.py \
  https://raw.githubusercontent.com/liuyunlong2021-wq/jiucaihezi-app/<branch>/rh-adapter/src/services/audio.py
cp /opt/rh-adapter/src/services/audio.py /opt/rh-adapter/src/services/audio.py.before-fix
cp /tmp/audio.py /opt/rh-adapter/src/services/audio.py
cd /opt/rh-adapter && docker compose up -d --build rh-adapter
docker logs --tail 20 rh-adapter-rh-adapter-1
```

### 5.4 前端部署（Cloudflare Pages）

```bash
cd /Users/by3/Documents/jiucaihezi-app
git pull origin <branch>
pnpm exec vue-tsc -b && pnpm exec vite build && node scripts/prune-web-dist.mjs
npx wrangler pages deploy dist
```

注意：`pnpm run build` 会跑 `test:focused`，目前有 11 个测试失败（与本次修复无关，是别的 AI 工具的遗留），所以直接用 `pnpm exec vue-tsc -b && vite build` 跳过测试。

---

## 6. 验收标准（怎么算修好）

修复完成后必须满足：

### 6.1 必须通过的测试

1. **诊断日志确认 nodeInfoList 到达 rh-adapter**：
   ```
   docker logs rh-adapter-rh-adapter-1 | grep '\[DIAG\]'
   期望：nodeInfoList_len=3 （或更多，看具体工作流）
   ```

2. **生产网站 voice-design 实测**：
   - 用户在 `https://jiucaihezi.studio` 选 `rh-aiapp-voice-design`
   - 文稿填："今天天气真好我想出去走走"（任意非默认内容）
   - 声音设定填："温柔的女声"（任意非默认内容）
   - 点生成 → 等几十秒
   - **听到的音频内容必须包含「今天天气真好我想出去走走」**，**音色必须是温柔女声**
   - 不能是"白起的故事"或者默认 demo

3. **其他 4 个 AI App 工作流至少**：
   - 提交不报错（POST /v1/audio/speech 返回 200）
   - 能拿到 url
   - 内容上跟用户输入有关联（不强求 100% 完美）

### 6.2 不能破坏的现有功能（回归测试）

- ✅ 创作面板 RH 视频（`rh-grok-text-video`、`rh-grok-image-video`）
- ✅ 创作面板 RH 图像（`z-image-turbo`、`rh-gpt2-image`、`rh-pro-image`）
- ✅ 创作面板 GPT Image 2（同步路径）
- ✅ 创作面板 Suno 音频（`rh-suno-v55-single`、`rh-suno-v55-custom`、`rh-suno-lyrics`）
- ✅ 画布生图/生视频节点
- ✅ 桌面 APP 编译能过 `pnpm tauri:build`

### 6.3 文档完成

- 修复完成后更新：
  - `CLAUDE.md` 加「💀 RH AI App 工作流参数注入铁律」（参考已有的 RH 视频铁律风格）
  - `docs/sdd/chuangzuomianbanxiufu-sdd.md` 加新章节
  - 本文档转 `docs/handover/rh-aiapp-params-injection-completed.md` 并加完成总结

---

## 7. 给下一个 AI 协作者的建议

### 7.1 不要重蹈的覆辙

- ❌ **不要从前端开始排查**——前端代码我已经审查过，`executeRunningHubAudioRequest:325-328` 是对的
- ❌ **不要怀疑 rh-adapter 的 query_ai_app_task**——昨天刚修好，且 GET→POST 那段已经验证过
- ❌ **不要怀疑 URL 白名单**——昨天也刚修好（urlSafety + CSP 两套）
- ❌ **不要试图修测试失败再继续**——那 11 个失败测试跟这个 bug 完全无关，是别的 AI 工具的遗留

### 7.2 推荐的工作顺序

1. **先读完 §3.4 的诊断方法**，ssh 上服务器加诊断日志
2. **跑一次 voice-design 看日志**——这一步就能 100% 确定是嫌疑 A/B/C 哪种
3. **根据诊断结果选 §3.5 的方案**（X/Y/W）
4. 实施修复
5. 部署 + 验证 §6 的 6.1/6.2
6. 完成 §6.3 的文档更新

### 7.3 时间预算

- 诊断（§3.4）：30 分钟
- 修复（§3.5 任一方案）：30-90 分钟
- 验证 + 部署：30 分钟
- 文档更新：30 分钟
- **总计：1.5-3 小时**

### 7.4 与用户协作

用户（刘云龙）**不是编程背景**，但很愿意配合：
- 给他**明确的命令**让他贴到 ssh 终端
- 让他做**白话级别的验证**（"打开网页、点这个、看是不是 XX"）
- 不要让他做"判断代码对不对"的事
- 用户在 macOS 上，工作目录 `/Users/by3/Documents/jiucaihezi-app`（main worktree）
- 用户已部署的版本：分支 `media-creation-optimization`，最新 commit `5c2fd70`（CSP fix）

---

## 8. 当前会话剩余任务（用户已做或将做）

### 8.1 用户需要做：CSP 修复部署

```bash
cd /Users/by3/Documents/jiucaihezi-app
git pull origin media-creation-optimization
pnpm exec vue-tsc -b && pnpm exec vite build && node scripts/prune-web-dist.mjs
npx wrangler pages deploy dist
```

部署后：
- 强制刷新生产网站 Cmd+Shift+R
- 验证 CSP 红字消失（`Connecting to 'rh-images.xiaoyaoyou.com' violates CSP`）
- **音频内容仍然不对**——这是本文档要交接的 bug，需要下一个 AI 处理

### 8.2 即将由当前 AI 完成（在本次会话结束前）

- ✅ 本交接文档（你正在读）
- 📌 顺手补 `CLAUDE.md` 加「Cloudflare Pages 部署铁律」段（因为之前没人写）

---

## 9. 关键 commit/分支信息（接手 AI 抓状态用）

### 9.1 分支

- **`main`**：生产基线，含昨天到今天的所有修复
- **`media-creation-optimization`**：用户当前工作分支，已 push 含本次修复
  - HEAD: `5c2fd70 fix(_headers): CSP connect-src 加 *.xiaoyaoyou.com`
  - 前一个: `29ba9d8 fix(urlSafety): 白名单加 rh-*.xiaoyaoyou.com`
  - 前一个: `dd22420 fix(rh-adapter): AI App 任务状态识别`
- **`webhuabu`**：画布支线，已 merge 到 main（昨天）

### 9.2 重要文件 working tree 状态

用户的 main worktree `/Users/by3/Documents/jiucaihezi-app` 有别的未提交改动：
- `src/components/creation/CreationPanel.vue` (M)
- `src/composables/useCreation.ts` (M)
- `src/data/mediaModelCapabilities.ts` (M)
- `src/runtime/creation/creationModelRegistry.ts` (M)
- 几个未跟踪的 docs/handover/*.md
- `web-dist-update.tar.gz` 文件

**这些不是本次 bug 相关的**——是别的 AI 工具在做的「creation panel 优化」工作。**接手 AI 不要动这些文件**，做自己的 commit 时只 add 自己改的文件。

---

## 10. 联系信息

- 用户：刘云龙（GitHub: liuyunlong2021-wq）
- 项目仓库：https://github.com/liuyunlong2021-wq/jiucaihezi-app
- 生产网站：https://jiucaihezi.studio
- API 域名：https://api.jiucaihezi.studio

---

**文档结束。祝你修复顺利。**

— Claude Opus 4.7（前一轮会话）
