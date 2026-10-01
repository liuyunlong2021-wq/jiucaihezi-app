# 本机 ComfyUI 接入 NewAPI 任务插件通道 SDD（2026-10-01）

> 制定：2026-10-01 · 状态：**方案待审，未实施** · 上游版本：NewAPI `v1.0.0-rc.40`（已实测装好插件子系统）
>
> 一句话：把 `jc-minimax-h3*` 从「type 1 OpenAI 渠道 + 手写 relay」换成「**type 61 Task Plugin 渠道 + 自写 comfy 插件**」，让面板的自定义参数（画幅、戏种）无损到达适配器，并把任务持久化、轮询、计费、成片代理交给宿主。

相关文档：[[本机ComfyUI模型对外接入-2026-09-26]]（现行链路与运维手册）、[[韭菜盒子RH渠道MiniMaxH3视频API对外接入-2026-09-21]]（`metadata.rh_aiapp` 的来路）。
官方契约：[docs/plugin-api/v1.md](https://github.com/QuantumNous/new-api/blob/main/docs/plugin-api/v1.md)、[README.md](https://github.com/QuantumNous/new-api/blob/main/docs/plugin-api/README.md)。

---

## 0. 为什么要换（根因，已查实）

2026-10-01 排「面板选了 4:3，成片还是 9:16」，三段证据都落定：

| 环节 | 证据 | 结论 |
|---|---|---|
| App 发了没有 | 直接跑 `buildCreationRunPlan` + `buildCreationSubmitRequest`：`videoParams.aspectRatio = "4:3 (Standard)"`；面板 LocalStorage 里 `jc_cp_state_v3.ar` 也是 `4:3 (Standard)` | ✅ 发了 |
| 适配器收得下吗 | `ImageGenerationRequest` 已开 `ConfigDict(extra="allow")`，`model_dump()` 保留 `aspect_ratio` / `extra_fields` / `metadata`；探针直连时三种都能落到节点 29 | ✅ 收得下 |
| 适配器实际收到 | `GET /v1/tasks/{id}` 的归一化 `values` 是 `aspect_ratio: "9:16 (Portrait Widescreen)"` = **适配器自己的默认值** | ❌ 没收到 |

结论：**NewAPI 在 type 1 渠道只转发 `TaskSubmitReq` 认得的字段**（`model` / `prompt` / `image` / `images` / `duration` / `size` / `mode` / `seconds` / `input_reference` / `metadata`），
`aspect_ratio`、`extra_fields`、`resolution` 一律丢弃。副作用：

- 画幅只能靠适配器 `defaults` 兜底 → 面板切不了画幅；
- **戏种（文戏/武戏）从上线起就一直没生效**（`mode` 同样走 `extra_fields`，历史里 `戏种` 恒为 0）；
- 现在靠 `metadata` 镜像规避（2026-10-01 的临时修法），能救活但仍是绕过。

插件通道里 `decodeRequest` 拿到的是**客户端原始 body**，`requestBody` 由插件决定 —— 这个过滤在插件路径上不存在。

---

## 1. 官方能力（rc.40 已具备）

| 项 | 事实 |
|---|---|
| 版本 | `https://api.jiucaihezi.studio/api/status` → `"version":"v1.0.0-rc.40"` |
| 插件子系统在位 | `GET /api/plugin/task/runtime/status` → **401**（需 root token），不是 404 |
| 插件形态 | 单文件同步 ES module，无 `fetch`/`fs`/`require`/`eval`/环境变量；宿主限时限并发、限目标主机 |
| 上传 | 管理员页，或 `POST /api/plugin/task` `{"source":"…","remark":"…"}`；同 key+version 不同源码会被拒；可激活/回滚 |
| 本地校验 | `new-api plugin lint plugin.js`、`--fixture`；管理员页有 Sandbox 可对单个 hook 干跑（不触上游） |
| 渠道 | **type 61「Task Plugin」**：选 plugin key + 显式 Base URL + 配模型；`meta.baseUrl` 可在管理员留空时作默认值 |
| 宿主协议 | `openai_video`：`POST /v1/videos`（JSON 或 multipart）创建、`GET /v1/videos/:task_id` 查询、`GET\|HEAD /v1/videos/:task_id/content` 取成片 |
| 宿主负责 | 渠道选择、请求发送、任务持久化、轮询与失败判定、用量校验与结算、成片代理与 Range |
| 计费 | `usageSchema` 声明用量字段；表达式用 `u("key")` 读事实（见 `pkg/billingexpr/expr.md`），管理员页有任务用量定价编辑器 |

> ⚠️ 官方 README 原话：**"The plugin contract is currently unreleased"** —— v1 仍可能演进。缓解见 §7。

---

## 2. 目标与非目标

**目标（可验证）**

1. 面板所选画幅、戏种无损到达工作流节点（不再依赖 `defaults` 兜底）。
2. 任务行由宿主持久化：面板能看到任务历史，不因适配器重启整条消失。
3. 计费走官方用量事实（`seconds`），与现在一致为 0.2 元/秒。
4. 成片下载仍走 `GET /v1/videos/{id}/content`，Range 可用。
5. **App 与创作面板不改**（模型名与端点形状不变）。

**非目标（明确不做）**

- 不改 `comfy-adapter` 的职责：它继续做模板渲染、ComfyUI 提交、Topaz、静态文件。
- **不解决**「适配器任务表只在内存」：宿主轮询适配器期间适配器重启，`404` 会被宿主判为 `FAILURE` 并退款。要根治得单独给适配器加任务持久化（另立任务）。
- 不动 `rh-adapter` / `boluo` / `seed-audio` 等兄弟适配器（同构收编是后续更大的事）。

---

## 3. 架构对照

```text
现在（type 1 OpenAI 渠道 140）
  面板 → NewAPI(渠道140) → frps:8796 → comfy-adapter → ComfyUI
              ↑
        只转发 TaskSubmitReq 字段：aspect_ratio / extra_fields 在这里被丢
        任务表在 comfy-adapter 内存里

目标（type 61 Task Plugin 渠道）
  面板 → NewAPI(渠道<新>) ──comfy 插件──> frps:8796 → comfy-adapter → ComfyUI
              ↑                    ↑
        原始 body 交给插件     requestBody 由插件决定（无损透传）
        任务行/计费/成片代理/轮询由宿主拥有
```

关键取舍：插件是**翻译层**，不是执行层。ComfyUI 编排继续留在适配器。

---

## 4. 插件实现

**已落地**：`newapi-plugins/comfy.plugin.js`（夹具 `newapi-plugins/__tests__/comfy.test.mjs`，10 项全绿，已接入 `pnpm run test:focused`）。
按 [[适配器收编任务插件总方案-2026-10-01]] §3 的统一约定，插件统一放 `newapi-plugins/`，不再随各自适配器走。

下面代码块是**当时的草案**，仅作设计留痕：一切以仓库文件为准，不要照抄。
草案与实现在这几处不同（都是对照官方文档与 boluo 插件校准的结果）：

| 项 | 草案 | 实现 | 原因 |
|---|---|---|---|
| `ctx.model` | 未用 | `decodeRequest` 返回 `model: ctx.model` | 宿主按它把任务行归给哪个模型 |
| 失败原因 | `result.reason` | 读响应体的 `fail_reason` / `error` / `message` | 适配器的失败原因是响应体字段 |
| 未知状态 | 未定 | 一律 `UNKNOWN` | 宿主把 `UNKNOWN` / 空 / 抛错都算轮询失败，不能伪装 `IN_PROGRESS` |
| `extractUsageOnComplete` | 读 `body.duration` | 优先 `body.params.duration` | `params` 是适配器归一化（clamp + 17n+5）后的实际值 |
| 时长校验 | 无 | 非 number / 非正数直接 400 | 快速失败，不占额度 |
| `meta.models` | 待定 | `['jc-minimax-h3', 'jc-minimax-h3-ref2v']` | 即面板 body 的 `model`（`creationModelRegistry` 四个条目共用这两个名字） |
| `metadata.url` | 待定 | **不返回** | 适配器给的是内网 `frps:8796` 地址，不能外泄 |

```js
// NewAPI Task Plugin v1 —— 本机 ComfyUI（经 comfy-adapter）
export const meta = {
  apiVersion: 1,
  key: "comfy",
  name: "本机 ComfyUI",
  version: "0.1.0",
  author: { name: "jiucaihezi" },
  description: { en: "Local ComfyUI via comfy-adapter", zh: "经 comfy-adapter 驱动本机 ComfyUI" },
  // 与渠道里的对外模型名一致；映射成适配器内部 id 由渠道 model_mapping 负责
  models: ["jc-minimax-h3", "jc-minimax-h3-ref2v"],
  fetchMode: "per_task",
  protocols: ["openai_video"],            // 接管 /v1/videos 三条路由
  baseUrl: "http://frps:8796",            // 渠道留空时作默认 Base URL
  usageSchema: {
    seconds: {
      type: "number",
      unit: "second",
      description: { en: "Video generation unit price", zh: "视频生成单价" },
    },
  },
  usageExamples: [{ label: "5 秒", facts: { seconds: 5 } }],
};

// comfy-adapter 的状态机：queued -> running -> succeeded / failed / cancelled
const ADAPTER_STATUS = {
  queued: { status: "SUBMITTED" },
  running: { status: "IN_PROGRESS", progress: "50%" },
  succeeded: { status: "SUCCESS", progress: "100%" },
  failed: { status: "FAILURE", progress: "100%" },
  cancelled: { status: "FAILURE", progress: "100%" },
};

function bearer(ctx) {
  return { Authorization: "Bearer " + ctx.apiKey, Accept: "application/json" };
}

export const protocols = {
  openai_video: {
    // ★ 本方案的核心：客户端 body 原样进 requestBody，
    //   aspect_ratio / mode（戏种）等自定义字段不会再被 DTO 过滤掉。
    decodeRequest: function (ctx) {
      if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
      const req = ctx.body.value;
      if (!req || typeof req !== "object" || Array.isArray(req)) throw new Error("request body must be an object");
      if (!String(req.prompt || "").trim()) throw new Error("field prompt is required");
      const hasImage = Boolean(req.first_frame || req.last_frame || req.image ||
        (Array.isArray(req.images) && req.images.length));
      return {
        kind: "submit",
        model: ctx.model,
        action: hasImage ? "image_to_video" : "text_to_video",
        requestBody: req,
      };
    },
    render: function (ctx, task) {
      const status = {
        SUBMITTED: "queued",
        IN_PROGRESS: "in_progress",
        SUCCESS: "completed",
        FAILURE: "failed",
      }[task.status] || "unknown";
      return {
        id: task.task_id,
        object: "video",
        model: "",
        status: status,
        progress: Number(String(task.progress || "0").replace("%", "")),
        created_at: task.created_at,
      };
    },
  },
};

export function buildSubmitRequest(ctx) {
  const body = Object.assign({}, ctx.requestBody);
  body.model = ctx.upstreamModel || ctx.model;   // 发给适配器的是内部 id
  return {
    url: ctx.baseUrl + "/v1/videos",
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, bearer(ctx)),
    body: body,
    action: ctx.action,
  };
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp.body || {};
  if (!body.id) throw new Error("comfy-adapter did not return a task id");
  return { taskId: String(body.id), taskData: body };
}

export function buildQueryRequest(ctx) {
  return {
    url: ctx.baseUrl + "/v1/videos/" + encodeURIComponent(ctx.taskId),
    method: "GET",
    headers: bearer(ctx),
  };
}

export function parseTaskResult(ctx, body) {
  const raw = String((body && body.status) || "").toLowerCase();
  const mapped = ADAPTER_STATUS[raw];
  // 不认识的**不能**当 IN_PROGRESS：宿主把 UNKNOWN/空/hook 抛错都算轮询失败
  if (!mapped) return { status: "UNKNOWN" };
  const out = { status: mapped.status };
  if (mapped.progress) out.progress = mapped.progress;
  if (mapped.status === "FAILURE") {
    out.reason = String((body && (body.fail_reason || body.error || body.message)) || ("comfy-adapter status: " + raw));
  }
  return out;
}

export function listArtifacts(task) {
  return task.status === "SUCCESS"
    ? [{ key: "video", type: "video", mimeType: "video/mp4" }]
    : [];
}

// 照抄官方 sora 插件的成片代理写法：宿主代取，内部地址不外泄
export function buildContentRequest(ctx) {
  if (ctx.artifactKey !== "video") throw new Error("artifact_not_found");
  return {
    url: ctx.baseUrl + "/v1/videos/" + encodeURIComponent(ctx.upstreamTaskId) + "/content",
    method: ctx.clientRequest.method,
    headers: { Authorization: "Bearer " + ctx.apiKey },
  };
}

// 预留额度用请求时长；面板必带 duration
export function extractUsage(ctx) {
  const seconds = Number(ctx.requestBody && ctx.requestBody.duration);
  return Number.isFinite(seconds) && seconds > 0 ? { seconds: seconds } : { seconds: 5 };
}

// 结算用实际时长（适配器的 values.duration 是真跑的值，已被 clamp 到 1~28）
export function extractUsageOnComplete(ctx, result, body) {
  if (!body || typeof body !== "object") return null;
  const seconds = Number(body.duration);
  return Number.isFinite(seconds) && seconds > 0 ? { seconds: seconds } : null;
}
```

**仍待宿主编译验证的点**（插件体量小，失败无副作用，随上传时的 lint / Sandbox 一次校准）：

- `render` 里 `progress` 两吃：上游给 `"50%"` 取整成数字，给数字也过。
- `parseTaskResult` 的 `reason` 字段名按内置插件写法取；宿主若不认，只会少一条失败说明，不影响状态。
- `ctx.upstreamTaskId` / `ctx.artifactKey` / `ctx.clientRequest.method` 是 content hook 的传入项，按 v1 文档写，上传后由 Sandbox 干跑确认。

---

## 5. 落地步骤

| # | 步骤 | 判定 |
|---|---|---|
| 1 | 写 `newapi-plugins/comfy.plugin.js` | ✅ 已入库，10 项夹具全绿 |
| 2 | 本地 `new-api plugin lint` / Sandbox dry-run | 无报错 |
| 3 | 管理员页上传并激活（key=`comfy`, version=`0.1.0`） | 插件列表可见 |
| 4 | 建 **type 61「Task Plugin」**渠道：plugin key `comfy`、Base URL `http://frps:8796`、密钥同渠道 140、模型 `jc-minimax-h3` / `jc-minimax-h3-ref2v`、映射到适配器 id | 保存成功 |
| 5 | 定价：任务用量模式，`seconds` 单价 **0.2**（表达式 `tier("base", u("seconds") * 0.2)`；系数是美元单价）；分组与现渠道一致 | 定价页显示正常 |
| 6 | 面板切到新渠道验收（§6），**旧渠道 140 原样保留** | 见 §6 |
| 7 | 验收通过后，把旧渠道停用（不删，留回滚） | — |

**回滚**：把面板模型指回渠道 140（或在新渠道上禁用插件）即可，适配器与旧渠道都不动。

---

## 6. 验收清单（对应 §2 的目标）

| 项 | 判定方式 | 通过标准 |
|---|---|---|
| 画幅无损 | 提交后读 `GET http://127.0.0.1:8188/history?max_items=10` 里该任务的**节点 29** `inputs.aspect_ratio` | 与面板所选**完全一致**（例如 `4:3 (Standard)`），不再是 `9:16` 默认值 |
| 戏种无损 | 同上，节点 `65` 的 `index` | 选武戏 → `1`；选文戏 → `0`（现在恒为 0） |
| 参考图 | `comfy-adapter/logs/adapter.log` 的 `reference_images 数量 N` | 与面板所选张数一致（1~6） |
| 任务持久化 | 提交后**重启适配器**，面板仍能查到该任务行 | 任务行存在（轮询可能 404 判失败——见 §7 已知边界） |
| 计费 | NewAPI 用量日志的 `usage_facts.seconds` 与实扣 | `秒数 × 0.2`，与渠道 140 一致；`last_elapsed_seconds` 级差异不算问题 |
| 成片 | 面板出片并播放 | 成片可播；`GET /v1/videos/{id}/content` 200，`Range: bytes=0-1023` → 206 |
| 状态映射 | 中途查 `GET /v1/videos/{id}` | `queued`→`queued`、`running`→`in_progress`、成功→`completed` |
| 失败路径 | 故意给不可达参考图 | 任务 `failed`、面板报错、计费退回 |
| App/面板 | — | **不需要改代码**（本项是约束，不是改动） |

> 计费与成片两项必须在**真实出片**上验收，`dry-run` 与 `app.py --check` 都不能替代。

---

## 7. 风险与未决项

| 项 | 说明 | 处置 |
|---|---|---|
| 契约未冻结 | 官方 README 明写 "currently unreleased" | 插件体量小、无外部依赖；旧渠道保留，一键切回；升 NewAPI 前先跑 Sandbox |
| **`metadata.url` 取不取** | 现在面板靠 `metadata.url` + `/content` 双路；插件通道下 provider 的 `data[].url` 是**内网地址**（`http://frps:8796/...`），不能外泄 | 建议：render 只回状态不回 URL，成片走宿主的 `/content` 代理；同时更新 `comfy-adapter/tools/verify_newapi_contract.py` 里「completed 带 metadata.url」这条断言 |
| 参考图上传链路 | 面板现在走 `assetFlow: newapi-upload`，适配器侧收到的是 `adapter/uploads/*.png`；换通道后这条上传链路是否照旧未验证 | 列为验收项（§6 参考图行）；异常时在 `decodeRequest` 里补处理 |
| 适配器任务表只在内存 | 宿主轮询期间适配器重启 → `404` → 宿主判 `FAILURE` 并退款 | 本次**不解决**；单独立项给适配器加任务持久化 |
| 插件即管理员级信任 | 插件能影响带凭据的上游请求 | 只上传自写插件；升级前看源码 diff |
| 旧的 `metadata` 规避 | 插件通道下不再需要（但仍无害） | 保留代码不动，避免双轨行为不一致；实施后再评估删掉 |

---

## 8. 维护规则

- 实施完成后：更新 [[hot.md]]、[[log.md]] 与 [[来源索引]]，并把本节合同登记到 [[CLAUDE]] 的开发入口表。
- 本文档只描述**待审方案**；未实施前不得在其它文档里写成「已通过」。
