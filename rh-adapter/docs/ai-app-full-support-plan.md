# rh-adapter：AI 应用全能力补齐方案

> **目标**：使 rh-adapter 支持 OpenClaw_RH_Skills 同等的"运行任意 RunningHub AI 应用"能力。
> **基线**：rh-adapter 已有 80% 能力（节点发现、文件上传、任务提交/轮询、智能匹配、ad-hoc webappId），
> 本方案补齐剩余 3 个差距。
> **不改代码，只描述精确变更。任何 AI 工具可据此直接实施。**

---

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
    # 显式模式：先发现全量节点（获取 fieldType 等元数据），再覆盖用户指定的 fieldValue
    discovered = await fetch_ai_app_node_info(client, api_key, wid)
    for mod in explicit_nodes:
        nid = mod.get("nodeId", "")
        fname = mod.get("fieldName", "")
        fval = mod.get("fieldValue", "")
        if not nid or not fname:
            continue
        matched = False
        for node in discovered:
            if str(node.get("nodeId", "")) == str(nid) and node.get("fieldName") == fname:
                node["fieldValue"] = fval
                matched = True
                break
        if not matched:
            logger.warning("Explicit node not found in discovered nodes: nodeId=%s fieldName=%s", nid, fname)
    node_list = await resolve_ai_app_node_media(client, api_key, discovered)
else:
    node_list = await _build_discovered_nodes(client, api_key, wid, request)
```

### 变更 1.3：`src/services/video.py` — `_submit_via_app`

与 1.2 完全相同的改动。当前逻辑：

```python
if request.nodeInfoList:
    node_list = await resolve_ai_app_node_media(...)
else:
    node_list = await _build_discovered_nodes(...)
```

改为与 1.2 相同结构（复制上面 explicit_nodes 分支 + else 分支）。

### 变更 1.4：`src/models/schemas.py` — `VideoRequest`

`VideoRequest` 当前有 `nodeInfoList`、`webappId`、`extra_fields` 字段，但缺少 `model_validator`。
需要添加与 `ImageRequest` 相同结构的 `restore_rh_fields_from_extra_fields` validator：

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
    def fill(target: str, *aliases: str) -> None:
        if any(alias in merged and merged.get(alias) not in (None, "") for alias in (target, *aliases)):
            return
        for alias in (target, *aliases):
            value = extra.get(alias)
            if value not in (None, ""):
                merged[target] = value
                return
    fill("ratio", "aspect_ratio", "aspectRatio")
    fill("resolution")
    fill("duration")
    fill("images")
    fill("video")
    fill("audio")
    fill("text")
    fill("width")
    fill("height")
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

## 变更清单总览

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

---

## 验收检查

- [ ] `jc_media.py app-run --webapp-id X --node "52:prompt=cat" --node "39:steps=20"` → 节点值被精确修改
- [ ] `jc_media.py app-run --webapp-id X --node "52:prompt=cat" --file ./ref.png` → 文件上传 + 节点修改同时生效
- [ ] `jc_media.py app-list --sort HOTTEST --size 5` → 返回 JSON 应用列表
- [ ] `jc_media.py app-run --type video --webapp-id X --node "52:prompt=xxx"` → 走 `/v1/videos` 端点
- [ ] 视频 AI App 轮询正确带 `?ai_app=true`
- [ ] 旧路径（预注册 AI App 模型 + 智能匹配）不受影响
- [ ] 旧路径（标准模型 API）不受影响
