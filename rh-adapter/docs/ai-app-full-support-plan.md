# rh-adapter + 创作面板：AI 应用全能力补齐方案

> **目标**：使韭菜盒子支持 OpenClaw_RH_Skills 同等的"运行任意 RunningHub AI 应用"能力。
> **基线**：rh-adapter 已有 80% 能力（节点发现、文件上传、任务提交/轮询、智能匹配、ad-hoc webappId）。
> **分两部分**：后端 3 差距 + 前端 3 阶段。互不依赖，可独立交付。
> **不改代码，只描述精确变更。任何 AI 工具可据此直接实施。**

---

# 第一部分：后端（rh-adapter）3 差距补齐

## 现状速览

| 文件 | 角色 |
|------|------|
| `src/models/schemas.py` | Pydantic 请求模型，有 `ImageRequest`/`VideoRequest`/`AudioRequest` |
| `src/models/mapping.py` | 模型→endpoint 映射，含 `custom:True` 的 AI App 模型 |
| `src/services/image.py` | 图片生成服务，含 `_submit_via_app`（AI App 路由） |
| `src/services/video.py` | 视频生成服务，含 `_submit_via_app`（仅预注册模型） |
| `src/services/ai_app.py` | AI App 节点发现 + 智能匹配 |
| `src/services/rh_client.py` | RH HTTP 客户端，含 `submit_ai_app`/`poll_ai_app`/`upload_ai_app_file` |
| `src/main.py` | FastAPI 路由 |
| `public/skills/JC-瞬间创作/scripts/jc_media.py` | LLM 调用的 CLI 脚本 |

---

## 差距 1（核心）：显式 `nodeId:fieldName` 精确修改

### 问题

`jc_media.py app-run --node "52:prompt=cat"` 把节点修改放在 `extra_fields.nodes = {"52:prompt": "cat"}`，
但这条路径在服务端断裂：

1. `ImageRequest.restore_rh_fields_from_extra_fields` 未恢复 `nodeInfoList`
2. `image.py` 的 `_submit_via_app` 不读 `extra_fields.nodes`
3. `video.py` 的 `_submit_via_app` 同样不读

### 变更 1.1：`src/models/schemas.py` — `ImageRequest`

在 `restore_rh_fields_from_extra_fields` 的 `fill()` 调用列表末尾，`fill("duration")` 之后，新增两行：

```
fill("webappId")
fill("nodeInfoList")
```

同时在该 validator 中添加 `extra_fields.nodes` → `nodeInfoList` 的格式转换逻辑。
`extra_fields.nodes` 是 dict 格式 `{"nodeId:fieldName": "value"}`，需转为 `[{"nodeId": "N", "fieldName": "F", "fieldValue": "V"}]`：

在 `return merged` 之前插入：

```python
# extra_fields.nodes → nodeInfoList 格式桥接
raw_nodes = extra.get("nodes")
if raw_nodes is not None and isinstance(raw_nodes, dict):
    converted = []
    for key, value in raw_nodes.items():
        if isinstance(key, str) and ":" in key:
            nid, fname = key.split(":", 1)
            converted.append({"nodeId": nid.strip(), "fieldName": fname.strip(), "fieldValue": str(value)})
    if converted and not merged.get("nodeInfoList"):
        merged["nodeInfoList"] = converted
```

### 变更 1.2：`src/services/image.py` — `_submit_via_app`

当前逻辑：
```python
if request.nodeInfoList:
    node_list = await resolve_ai_app_node_media(...)
else:
    node_list = await _build_discovered_nodes(...)
```

改为：
```python
explicit_nodes = request.nodeInfoList  # 已被 schema validator 从 extra_fields.nodes 恢复

if explicit_nodes:
    # 显式模式：①先智能匹配（文件/比例/分辨率），②再覆盖显式节点，③最后上传媒体
    discovered = await fetch_ai_app_node_info(client, api_key, wid)
    discovered = await apply_ai_app_inputs(
        client, api_key, discovered,
        prompt="",  # 留空，显式节点自己管 prompt，避免智能匹配抢走
        images=request.images or [],
        ratio=request.aspect_ratio,
        size=request.size,
    )
    for mod in explicit_nodes:
        nid = str(mod.get("nodeId", ""))
        fname = str(mod.get("fieldName", ""))
        fval = str(mod.get("fieldValue", ""))
        if not nid or not fname:
            continue
        matched = False
        for node in discovered:
            if str(node.get("nodeId", "")) == nid and node.get("fieldName") == fname:
                node["fieldValue"] = fval
                matched = True
                break
        if not matched:
            logger.warning("Explicit node not found: nodeId=%s fieldName=%s", nid, fname)
    # apply_ai_app_inputs 内部已 upload 过一次，但显式覆盖可能引入新 data URI，再调一次（幂等）
    node_list = await resolve_ai_app_node_media(client, api_key, discovered)
else:
    node_list = await _build_discovered_nodes(client, api_key, wid, request)
```

> 为什么先调 `apply_ai_app_inputs` 再覆盖？因为用户可能同时传 `--node`（精确修改）和 `--file`（上传文件）。
> 智能匹配负责把文件/比例/分辨率映射到对应节点，显式覆盖负责精确值。两者互补，不互斥。

### 变更 1.3：`src/services/video.py` — `_submit_via_app`

与 1.2 完全相同的改动。当前逻辑：

```python
if request.nodeInfoList:
    node_list = await resolve_ai_app_node_media(...)
else:
    node_list = await _build_discovered_nodes(...)
```

改为与 1.2 相同结构：先 `apply_ai_app_inputs`（prompt=""，images/videos/audios/duration/ratio 传实际值），再覆盖显式节点，最后 `resolve_ai_app_node_media`。

```python
explicit_nodes = request.nodeInfoList

if explicit_nodes:
    discovered = await fetch_ai_app_node_info(client, api_key, wid)
    discovered = await apply_ai_app_inputs(
        client, api_key, discovered,
        prompt="",
        images=request.images or [],
        videos=[request.video] if request.video else [],
        audios=[request.audio] if request.audio else [],
        duration=request.duration,
        ratio=request.ratio,
    )
    for mod in explicit_nodes:
        nid = str(mod.get("nodeId", ""))
        fname = str(mod.get("fieldName", ""))
        fval = str(mod.get("fieldValue", ""))
        if not nid or not fname:
            continue
        for node in discovered:
            if str(node.get("nodeId", "")) == nid and node.get("fieldName") == fname:
                node["fieldValue"] = fval
                break
    node_list = await resolve_ai_app_node_media(client, api_key, discovered)
else:
    node_list = await _build_discovered_nodes(client, api_key, wid, request)
```

### 变更 1.4：`src/models/schemas.py` — `VideoRequest`

`VideoRequest` 当前有 `nodeInfoList`、`webappId`、`extra_fields` 字段，但缺少 `model_validator`。
需要添加 validator，仅恢复 AI App 相关字段（`ratio`/`resolution`/`duration`/`images` 等是顶层字段，NewAPI 不放在 `extra_fields`，无需 fill）：

在 `VideoRequest` 类中，`extra_fields` 字段之后、类结束之前，新增：

```python
@model_validator(mode="before")
@classmethod
def restore_rh_fields_from_extra_fields(cls, data: Any) -> Any:
    if not isinstance(data, dict):
        return data
    extra = data.get("extra_fields") or data.get("extraFields")
    if not isinstance(extra, dict):
        return data
    merged = dict(data)
    def fill(target: str) -> None:
        if target in merged and merged.get(target) not in (None, ""):
            return
        value = extra.get(target)
        if value not in (None, ""):
            merged[target] = value
    fill("webappId")
    fill("nodeInfoList")
    # extra_fields.nodes → nodeInfoList 格式桥接
    raw_nodes = extra.get("nodes")
    if raw_nodes is not None and isinstance(raw_nodes, dict):
        converted = []
        for key, value in raw_nodes.items():
            if isinstance(key, str) and ":" in key:
                nid, fname = key.split(":", 1)
                converted.append({"nodeId": nid.strip(), "fieldName": fname.strip(), "fieldValue": str(value)})
        if converted and not merged.get("nodeInfoList"):
            merged["nodeInfoList"] = converted
    return merged
```

### 变更 1.5：`src/services/video.py` — `generate_video`

当前仅检查 `is_ai_app_model(model)`（预注册模型）。需要加上 ad-hoc webappId 透传：

```python
webapp_id = (request.extra_fields or {}).get("webappId") or get_webapp_id(model)
if is_ai_app_model(model) or webapp_id:
    return await _submit_via_app(client, request, key, webapp_id=webapp_id)
```

同时修改 `_submit_via_app` 签名，新增可选参数 `webapp_id: str = ""`：

```python
async def _submit_via_app(
    client: httpx.AsyncClient,
    request: VideoRequest,
    api_key: str,
    webapp_id: str = "",
) -> dict:
    wid = webapp_id or get_webapp_id(request.model)
    if not wid:
        raise RHError(f"No webapp ID for model: {request.model}")
    # ... 后续不变
```

---

## 差距 2：AI 应用浏览/列表接口

### 问题

没有 `/api/runninghub/app-list` 端点。OpenClaw 有 `--list --sort RECOMMEND/HOTTEST/NEWEST`。

> 注：rh-adapter 的 catch-all proxy `/{path:path}` 理论上能转发 `GET /openapi/v2/aiapp/list`，
> 但这是未文档化的内部路径，应该封装为语义清晰的端点。

### 变更 2.1：`src/services/rh_client.py` — 新增 `list_ai_apps()`

在 `submit_ai_app` 函数附近（约 L310 附近）新增：

```python
async def list_ai_apps(
    client: httpx.AsyncClient,
    api_key: str,
    sort: str = "RECOMMEND",
    size: int = 10,
    page: int = 1,
    days: int = 7,
) -> dict:
    """List RunningHub AI Applications (ComfyUI workflows)."""
    url = "https://www.runninghub.cn/openapi/v2/aiapp/list"
    payload = {
        "apiKey": api_key,
        "sort": sort,
        "size": min(size, 50),
        "page": page,
        "days": days,
    }
    data = await _get(client, url, payload, api_key, timeout=30)
    return data
```

### 变更 2.2：`src/main.py` — 新增路由

在 `app_info` 路由之后、图片生成路由之前，新增：

```python
@app.get("/api/runninghub/app-list")
async def app_list(
    sort: str = "RECOMMEND",
    size: int = 10,
    page: int = 1,
    days: int = 7,
):
    """Browse AI Applications: sort=RECOMMEND|HOTTEST|NEWEST."""
    if not RUNNINGHUB_API_KEY:
        raise HTTPException(500, "RUNNINGHUB_API_KEY not configured")
    if sort not in ("RECOMMEND", "HOTTEST", "NEWEST"):
        raise HTTPException(400, "sort must be RECOMMEND, HOTTEST, or NEWEST")
    client = await get_client()
    from .services.rh_client import list_ai_apps
    data = await list_ai_apps(client, RUNNINGHUB_API_KEY, sort=sort, size=size, page=page, days=days)
    return data
```

### 变更 2.3：`public/skills/JC-瞬间创作/scripts/jc_media.py` — 新增 `app-list` 子命令

在 CLI 定义区域，`app-info` 子命令附近，新增：

```python
p_alst = sub.add_parser("app-list", help="浏览 AI 应用列表")
p_alst.add_argument("--sort", choices=["RECOMMEND", "HOTTEST", "NEWEST"], default="RECOMMEND")
p_alst.add_argument("--size", type=int, default=10)
p_alst.add_argument("--page", type=int, default=1)
p_alst.add_argument("--days", type=int, default=7)
p_alst.add_argument("--api-key", help="NewAPI Key")
p_alst.add_argument("--host", default=DEFAULT_HOST)
```

在处理分支中新增：

```python
elif args.mode == "app-list":
    headers = {"Authorization": f"Bearer {api_key}"}
    params = f"sort={args.sort}&size={args.size}&page={args.page}&days={args.days}"
    result = _curl("GET", f"{host}/api/runninghub/app-list?{params}", headers, timeout=15)
    _print_json(result)
```

---

## 差距 3：`_app_submit` 视频路由 + `VideoRequest` AI App 路径

### 问题

1. `jc_media.py` 的 `_app_submit` 写死走 `POST /v1/images/generations`，视频产出的 AI 应用也走图片端点
2. 视频 AI 应用的轮询需要走 `ai_app=true` 标记

### 变更 3.1：`public/skills/JC-瞬间创作/scripts/jc_media.py` — `_app_submit`

当前写死：
```python
return _curl("POST", f"{host}/v1/images/generations", headers, payload)
```

改为按 `--type` 参数选择端点：

```python
# 新增 --type 参数到 app-run 子命令
p_arun.add_argument("--type", choices=["image", "video"], default="image",
                    help="输出类型（影响 NewAPI 计费路由）")

# _app_submit 中：
def _app_submit(api_key: str, host: str, args) -> dict:
    payload = { ... }  # 不变
    endpoint = "/v1/videos" if getattr(args, "type", "image") == "video" else "/v1/images/generations"
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
    return _curl("POST", f"{host}{endpoint}", headers, payload)
```

同时更新 `model-capabilities.md` 文档中 AI 应用的运行示例，标注 `--type video` 用于视频产出类应用。

### 变更 3.2：确认视频 AI App 轮询正确

`main.py` 的 `/tasks/{task_id}?ai_app=true` 已支持 AI App 轮询（调用 `query_ai_app_task`）。
`jc_media.py` 的 `poll_task` 需要在轮询 AI App 任务时带 `?ai_app=true`。

当前 `poll_task`：
```python
def poll_task(api_key, task_id, host, type_="") -> dict:
    ...
    return _curl("GET", f"{host}/tasks/{task_id}", headers)
```

`_poll_and_download` 调用 `poll_task` 时传了 `type_` 但 `poll_task` 没用它。需要改造：

`poll_task` 签名加 `ai_app: bool = False`：

```python
def poll_task(api_key, task_id, host, type_="", ai_app=False) -> dict:
    headers = {"Authorization": f"Bearer {api_key}"}
    suffix = "?ai_app=true" if ai_app else ""
    ...
    return _curl("GET", f"{host}/tasks/{task_id}{suffix}", headers)
```

`_poll_and_download` 签名同样加 `ai_app: bool = False`，透传下去。

`app-run` 分支调用 `_poll_and_download` 时传 `ai_app=True`。

---

## 变更清单总览（后端部分）

```
rh-adapter/src/
  models/schemas.py          ← 1.1 ImageRequest fill(webappId/nodeInfoList) + nodes→nodeInfoList 桥接
                             ← 1.4 VideoRequest 新增 model_validator（含同样桥接）
  services/image.py          ← 1.2 _submit_via_app 显式节点覆盖分支
  services/video.py          ← 1.3 _submit_via_app 显式节点覆盖分支
                             ← 1.5 generate_video 加 ad-hoc webappId 路由
  services/rh_client.py      ← 2.1 新增 list_ai_apps()
  main.py                    ← 2.2 新增 GET /api/runninghub/app-list

public/skills/JC-瞬间创作/
  scripts/jc_media.py        ← 2.3 新增 app-list 子命令
                             ← 3.1 _app_submit 加 --type 参数
                             ← 3.2 poll_task 加 ai_app 参数
  references/model-capabilities.md ← 3.1 更新 AI 应用示例
```

## 验收检查（后端部分）

- [ ] `jc_media.py app-run --webapp-id X --node "52:prompt=cat" --node "39:steps=20"` → 节点值被精确修改
- [ ] `jc_media.py app-run --webapp-id X --node "52:prompt=cat" --file ./ref.png` → 文件上传 + 节点修改同时生效
- [ ] `jc_media.py app-list --sort HOTTEST --size 5` → 返回 JSON 应用列表
- [ ] `jc_media.py app-run --type video --webapp-id X --node "52:prompt=xxx"` → 走 `/v1/videos` 端点
- [ ] 视频 AI App 轮询正确带 `?ai_app=true`
- [ ] 旧路径（预注册 AI App 模型 + 智能匹配）不受影响
- [ ] 旧路径（标准模型 API）不受影响

---

# 第二部分：前端（创作面板）AI 应用适配

> **策略**：最大程度复用现有 UI 基建（模型选择器、genericModelFields、任务提交/历史），不另起炉灶。

## 现状可复用盘点

| 现有能力 | AI 应用怎么用 |
|----------|-------------|
| 任务选择器（图片/视频/音频） | 新增「AI 应用」任务类型 |
| 模型选择器 + dropdown | AI 应用作为模型出现（预注册的已有，如数字人） |
| `genericModelFields` 动态表单 | AI 应用的每个 `apiCallDemo` 节点 → 一个 field（STRING→文本框, IMAGE→文件上传, LIST→下拉, BOOLEAN→开关, INT/FLOAT→数字） |
| 提示词输入框 (`showPromptInput`) | AI 应用的主 prompt 节点仍用此框 |
| 文件上传（参考图拖拽） | AI 应用的 IMAGE/VIDEO/AUDIO 节点用现有的文件上传 |
| 发送按钮 → `mediaTaskStore.submitTask()` | 同路径，payload 加 `extra_fields.webappId` + `extra_fields.nodes` |
| 进度条 + 历史 Modal | 不做任何改动，直接复用 |

## ⚠️ 阶段 A 前置修正：运行时 `'ai-app'` 任务类型 + 通用 nodeInfoList

> 以下 3 处修正是阶段 A 能跑的前提。**不改这些，创作面板提交 AI 应用会在运行时直接报错。**

### 修正 X1：`src/runtime/creation/creationMediaRuntime.ts` L18 + L33 — taskType 映射

**L18 类型**保持不变（`'ai-app'` 运行时映射为 `'video'`，不污染类型系统）：

```typescript
taskType: 'image' | 'video' | 'audio'  // 不变
```

**L33** 加 `'ai-app'` 分支：

```typescript
// 改前
taskType: plan.task === 'image' ? 'image' : plan.task === 'video' || plan.task === 'digital-human' ? 'video' : 'audio',

// 改后
taskType: plan.task === 'image' ? 'image'
  : plan.task === 'video' || plan.task === 'digital-human' || plan.task === 'ai-app' ? 'video'
  : 'audio',
```

### 修正 X2：`src/runtime/creation/creationMediaRuntime.ts` — `buildRhAiAppNodeInfoList` 加 `case 'rh-aiapp'`

在 switch 的 default 之前新增：

```typescript
case 'rh-aiapp': {
  // 通用 AI 应用：从 normalizedParams 提取含 ":" 的键作为 nodeInfoList
  // ⚠️ 注意：不要从 videoParams/audioParams 读——那些是语义字段（model/prompt/ratio），
  //   不含 "52:prompt" 格式的键。X4 让 normalizedParams 保留了这些键。
  const params = request.plan.debug.normalizedParams || {}
  const nodes: Array<Record<string, string>> = []
  for (const [key, value] of Object.entries(params)) {
    if (typeof key === 'string' && key.includes(':') && value !== undefined && value !== null && value !== '') {
      const [nodeId, fieldName] = key.split(':', 2)
      if (nodeId && fieldName) {
        nodes.push({ nodeId, fieldName, fieldValue: String(value) })
      }
    }
  }
  return compactNodeInfoList(nodes)
}
```

### 修正 X3：`src/runtime/creation/creationMediaTypes.ts` — `CreationTask` 类型

在 `CreationTask` union 中加 `'ai-app'`（当前为 `'image' | 'video' | 'audio' | 'digital-human'`，需改为包含 `'ai-app'`）。

### 修正 X4：`src/runtime/creation/creationMediaPlan.ts` — `normalizeRunningHubParams` AI App 跳过白名单

`normalizeRunningHubParams`（约 L235）有白名单过滤——只保留 base 键 + spec.fields 键，其余全删。
`rh-aiapp` 的 `spec.fields = []`，`discoverAiAppNodes` 产生的 `"52:prompt"` 等键会被当作「残留参数」清除，
导致 X2 的 nodeInfoList 构建收到空数据。

在函数开头插入 AI App 快速通道：

```typescript
function normalizeRunningHubParams(spec: CreationModelSpec, params: Record<string, unknown>): Record<string, unknown> {
  // AI App：不做白名单过滤，全量透传（nodeId:fieldName 键在运行时由 buildRhAiAppNodeInfoList 解析）
  if (spec.apiStyle === 'rh-aiapp') {
    const allParams: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '' &&
          !(Array.isArray(value) && (value as any[]).length === 0)) {
        allParams[key] = value
      }
    }
    return allParams
  }
  // ... 原有逻辑不变
```

## 阶段 A（最小可行）：ad-hoc webappId 输入 + 节点发现

用户手动输入 webappId → 点「发现节点」→ 节点变表单 → 填参 → 提交。

**改动文件：3 个**

### A1. `src/data/mediaModelCapabilities.ts` + `src/runtime/creation/creationModelRegistry.ts` — 注册 AI 应用任务类型

#### mediaModelCapabilities.ts

在 `MEDIA_TASK_LABELS` 中加一条：
```typescript
'ai-app': 'AI 应用',
```

在模型列表里加一个虚拟模型 `rh-aiapp-adhoc`：
```typescript
{
  id: 'rh-aiapp-adhoc',
  label: '自定义 AI 应用',
  task: 'ai-app',
  model: 'rh-aiapp',
  provider: 'runninghub-video',
  fields: [],  // 空，运行时动态填充
}
```

#### ⚠️ creationModelRegistry.ts（必须同步）

`mediaModelCapabilities.ts` 只是能力表，创作面板的模型选择器实际从 `CREATION_MODEL_REGISTRY`（`creationModelRegistry.ts` L276）读取。
必须在 `CREATION_MODEL_REGISTRY` 数组末尾新增一条：

```typescript
runninghubStandard({
  id: 'runninghub/aiapp/rh-aiapp',
  model: 'rh-aiapp',
  label: 'AI 应用（自定义）· RunningHub 工作流',
  task: 'ai-app' as CreationTask,
  mode: 'workflow',
  price: 1.0,
  apiStyle: 'rh-aiapp',
  contractStatus: 'partial',
  fields: [],  // 空，运行时通过 discoverAiAppNodes 动态填充
}),
```

### A2. `src/composables/useCreation.ts` — 新增 AI 应用节点发现 + 动态字段

新增两个函数：

```typescript
interface AiAppNode {
  nodeId: string
  nodeName: string
  fieldName: string
  fieldValue: any
  fieldType: string
  description: string
  options?: any[]
}

// AI 应用节点 → genericModelFields 格式
function aiAppNodeToField(node: AiAppNode): CreationFieldSpec {
  const kind: CreationFieldSpec['kind'] =
    node.fieldType === 'IMAGE' || node.fieldType === 'VIDEO' || node.fieldType === 'AUDIO'
      ? 'file'
      : node.fieldType === 'LIST' ? 'select'
      : node.fieldType === 'BOOLEAN' ? 'boolean'
      : node.fieldType === 'INT' || node.fieldType === 'FLOAT' ? 'number'
      : 'text'
  return {
    key: `${node.nodeId}:${node.fieldName}`,
    label: node.description || node.fieldName,
    kind,
    defaultValue: node.fieldValue,
    options: node.options?.map((o: any) => ({ label: String(o), value: o })),
    required: false,
  }
}

// 点击「发现节点」调用
async function discoverAiAppNodes(webappId: string): Promise<CreationFieldSpec[]> {
  const { getApiKey } = await import('@/services/newApiAuth')
  const { DEFAULT_API_BASE_URL } = await import('@/services/newApiClient')
  const apiKey = getApiKey()
  const resp = await fetch(`${DEFAULT_API_BASE_URL}/api/runninghub/app-info?webappId=${webappId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const data = await resp.json()
  const nodes = data.nodeInfoList || []
  return nodes.map(aiAppNodeToField)
}
```

### A3. `src/components/creation/CreationPanel.vue` — UI：webappId 输入 + 发现按钮

在 `cpState` 中新增字段：
```typescript
aiAppWebappId: string       // 用户输入的 webappId
aiAppFields: CreationFieldSpec[]  // 发现的节点字段
aiAppDiscovering: boolean   // 发现中 loading
```

在参数条（`.cp-params`）最前面，当 `cpState.task === 'ai-app'` 时，渲染 webappId 输入 + 发现按钮：

```
┌──────────────────────────────────────────────────────────┐
│  webappId: [________________] [🔍 发现节点]              │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │ prompt   │ │ steps    │ │ seed     │  ← 动态节点字段   │
│  │ [______] │ │ [__20__] │ │ [______] │                 │
│  └──────────┘ └──────────┘ └──────────┘                 │
│                                                          │
│  [提示词输入框]                              [⬆ 发送]     │
└──────────────────────────────────────────────────────────┘
```

关键交互：
1. 用户输入 webappId → 点「发现节点」→ 设置 `cpState.aiAppDiscovering = true`
2. 调用 `discoverAiAppNodes(webappId)` → 得到 fields → 设置 `cpState.aiAppFields`
3. `genericModelFields` computed 改为合并：`[...existingGenericFields, ...cpState.aiAppFields]`
4. 用户填参 → 点发送
5. `buildCurrentCreationParams()` 把 `aiAppFields` 的值收集进 `extra_fields.nodes`：
   ```
   extra_fields.nodes = { "52:prompt": "cat", "39:steps": "20" }
   extra_fields.webappId = cpState.aiAppWebappId
   ```
6. 走现有 `mediaTaskStore.submitTask()` 流程

---

## 阶段 B（浏览发现）：AI 应用市场

用户不输入 webappId，而是浏览热门/推荐应用列表，点一个就自动填好 webappId。

**改动：2 个文件**

### B1. `src/api/media-generation.ts` — 新增 `listAiApps()`

```typescript
export interface AiAppSummary {
  title: string
  description: string
  webappId: string
  coverFile?: string
}

export async function listAiApps(
  sort: 'RECOMMEND' | 'HOTTEST' | 'NEWEST' = 'RECOMMEND',
  size: number = 10,
  page: number = 1,
): Promise<{ apps: AiAppSummary[]; total: number; hasNext: boolean }> {
  const config = await ensureConfig()
  const resp = await fetch(
    `${config.apiBase}/api/runninghub/app-list?sort=${sort}&size=${size}&page=${page}`,
    { headers: { Authorization: `Bearer ${config.apiKey}` } },
  )
  if (!resp.ok) throw new Error(`App list failed: ${resp.status}`)
  return resp.json()
}
```

### B2. `src/components/creation/CreationPanel.vue` — 新增「浏览应用」弹窗

当 `cpState.task === 'ai-app'` 且 `cpState.aiAppWebappId` 为空时，显示浏览区域：

```
┌──────────────────────────────────────────┐
│  🔍 发现 AI 应用                         │
│                                          │
│  [推荐] [最热] [最新]                     │
│                                          │
│  ┌────────┐ ┌────────┐ ┌────────┐       │
│  │ 封面   │ │ 封面   │ │ 封面   │       │
│  │ 应用名  │ │ 应用名  │ │ 应用名  │       │
│  │ 描述    │ │ 描述    │ │ 描述    │       │
│  └────────┘ └────────┘ └────────┘       │
│                                          │
│  或直接输入 webappId: [__________]       │
└──────────────────────────────────────────┘
```

点卡片 → 设置 `cpState.aiAppWebappId = app.webappId` → 自动调 `discoverAiAppNodes` → 进阶段 A 填参流程。

新增 state：
```typescript
aiAppBrowseSort: 'RECOMMEND' | 'HOTTEST' | 'NEWEST'
aiAppBrowseList: AiAppSummary[]
aiAppBrowseLoading: boolean
```

---

## 阶段 C（智能填充）：聊天→创作面板桥接

用户从对话框发 AI 应用链接 → 创作面板自动接收 webappId + 节点值，跳过发现/填参直接提交。

**改动：1 个文件**

### C1. `src/components/creation/CreationPanel.vue` — 接收聊天桥接事件

新增事件监听：
```typescript
onEvent('creation:open-ai-app', (payload: { webappId: string; nodes?: Record<string, string> }) => {
  cpState.aiAppWebappId = payload.webappId
  cpState.task = 'ai-app'
  if (payload.nodes) {
    // 跳过发现，直接用节点值构建 fields
    cpState.aiAppFields = Object.entries(payload.nodes).map(([key, value]) => {
      const [nodeId, fieldName] = key.split(':')
      return { key, label: fieldName, kind: 'text', defaultValue: value, required: false }
    })
  } else {
    discoverAiAppNodes(payload.webappId).then(fields => { cpState.aiAppFields = fields })
  }
  // 自动聚焦到创作面板
  emitEvent('layout:focus-panel', 'creation')
})
```

对应的，`MediaTaskBubble.vue` 的「发送到创作面板」按钮扩展：检测到消息含 `runninghub.cn/ai-detail/` 链接时，emit 此事件而非当前媒体任务事件。

---

## 数据流总览（全链路）

```
用户操作              创作面板                          rh-adapter / RH
───────              ────────                          ──────────────
输入 webappId
   │
   ├─[发现节点]──→  GET /api/runninghub/app-info  ──→  apiCallDemo
   │                 ← nodeInfoList                    ← ComfyUI 节点
   │
   ├─ 渲染表单
   │  (prompt/steps/seed/...)
   │
   ├─[发送]──────→  POST /v1/images/generations   ──→  _submit_via_app
   │                 { model: "rh-aiapp",              → 发现节点→覆盖→上传→提交
   │                   prompt: "...",                  → /task/openapi/ai-app/run
   │                   extra_fields: {
   │                     webappId: "...",
   │                     nodes: {"52:prompt":"cat"}
   │                   }}
   │                 ← { task_id }
   │
   ├─ mediaTaskStore 轮询 ──→  GET /rh/tasks/{id}?ai_app=true
   │                          ← { status, url }
   │
   └─ 结果显示（历史 Modal + 画布）
```

## 变更清单总览（前端部分）

```
src/data/mediaModelCapabilities.ts           ← A1 新增加 ai-app 任务类型 + rh-aiapp-adhoc 虚拟模型
src/runtime/creation/creationModelRegistry.ts ← A1 注册 runninghub/aiapp/rh-aiapp（必须同步，否则模型选择器不显示）
src/runtime/creation/creationMediaTypes.ts    ← X3 CreationTask union 加 'ai-app'
src/runtime/creation/creationMediaPlan.ts     ← X4 normalizeRunningHubParams AI App 跳过白名单
src/runtime/creation/creationMediaRuntime.ts  ← X1 taskType 映射加 ai-app 分支
                                              ← X2 buildRhAiAppNodeInfoList 加 case 'rh-aiapp'
src/composables/useCreation.ts               ← A2 新增 discoverAiAppNodes() + aiAppNodeToField()
src/api/media-generation.ts                  ← B1 新增 listAiApps()
src/components/creation/CreationPanel.vue     ← A3 webappId 输入 + 发现按钮
                                              ← B2 浏览应用弹窗
                                              ← C1 聊天→创作面板桥接事件
src/components/chat/MediaTaskBubble.vue       ← C1 扩展「发送到创作面板」逻辑
```

## 验收检查（前端部分）

- [ ] 任务选择器出现「AI 应用」选项
- [ ] 输入 webappId → 点「发现节点」→ 节点变为表单字段（按 fieldType 渲染正确控件）
- [ ] 修改节点值 → 点发送 → 任务出现在历史列表 → 完成后可预览/下载
- [ ] 浏览应用列表 → 切换 RECOMMEND/HOTTEST/NEWEST → 点卡片自动填 webappId
- [ ] 对话框发 `runninghub.cn/ai-detail/ID` 链接 → 「发送到创作面板」→ 自动接收并渲染
- [ ] 旧流程（选模型→填参→发送）不受影响
- [ ] 预注册 AI App 模型（数字人/我是导演）仍正常工作
