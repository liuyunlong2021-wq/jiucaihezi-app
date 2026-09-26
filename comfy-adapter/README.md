# comfy-adapter

把本地 ComfyUI 包装成 **OpenAI 兼容**的图片生成 API，供远端 new-api 中转站通过 frp 隧道调用。

```
调用方 → Cloudflare → nginx:443 → new-api:3000
                                    └─ 渠道 base_url: http://127.0.0.1:8791
                                         └─ frps(云端 Docker) ⇄ 隧道:7000 ⇄ frpc(本地)
                                              └─ comfy-adapter:9000 → ComfyUI:8188 → RTX 4090
```

---

## 快速开始

```bat
cd D:\ComfyUI-aki-v3\comfy-adapter
run.bat check        :: 自检：模板校验 + ComfyUI 连通性 + 节点类存在性
run.bat              :: 启动服务（监听 127.0.0.1:9000）
run.bat models       :: 列出已注册模型
```

改配置只需要动 `config.yaml`，**不用改代码**。

---

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/health` | 存活 + ComfyUI 状态 + 队列 + 任务统计 + 存储信息（ComfyUI 挂掉返回 503） |
| `GET` | `/v1/models` | OpenAI 模型列表 |
| `GET` | `/v1/models/{id}` | 单个模型卡片 |
| `POST` | `/v1/images/generations` | OpenAI Images API（带 `images` 数组则走编辑；带 `async` 变异步） |
| `POST` | `/v1/images/edits` | OpenAI 图片编辑（单图 / 多图参考，multipart 或 JSON） |
| `POST` | `/v1/videos/generations` · `/v1/videos` | 视频生成（默认异步） |
| `GET` | `/v1/videos/{id}` | 视频任务状态（NewAPI / 创作面板的轮询合同；完成时带 `metadata.url`） |
| `GET` | `/v1/videos/{id}/content` | 成片下载（**支持 Range**） |
| `POST` | `/v1/tasks` | 通用异步入口（无论模型默认是否异步，一律异步） |
| `GET` | `/v1/tasks` | 任务列表 + 统计 |
| `GET` | `/v1/tasks/{id}` | 查任务状态 / 取结果 |
| `POST` | `/v1/tasks/{id}/cancel` · `DELETE /v1/tasks/{id}` | 取消任务 |
| `GET` | `/files/{name}` | 产物下载（图片/视频/音频，**支持 Range**；24h 后自动删除；不加鉴权，名字是 64 位随机） |

鉴权：`Authorization: Bearer <api_key>` 或 `X-API-Key`。
`/files/`、`/v1/videos/{id}`、`/v1/videos/{id}/content` 不加鉴权 —— 与 `rh-adapter` 一致，
NewAPI 在它自己的边界上做鉴权和计费（前两者靠任务 id，后者就是产物文件）。
`config.yaml` 里 `auth.api_keys` 留空 = 关闭校验（仅供本机调试）。

### 请求示例

```bash
curl -X POST http://127.0.0.1:9000/v1/images/generations ^
  -H "Authorization: Bearer change-me-please" ^
  -H "Content-Type: application/json" ^
  -d "{\"model\":\"qwen-image-2.1\",\"prompt\":\"a red panda in a bamboo forest, cinematic\",\"size\":\"1024x1024\",\"n\":1,\"response_format\":\"b64_json\"}"
```

标准字段：`model` / `prompt` / `n` / `size` / `response_format`
非标准扩展（可选）：`width` / `height`（优先于 `size`）、`seed`、`steps`、`negative_prompt`、`quality`、`style`、`user`

### 响应

```json
{
  "created": 1758790000,
  "model": "qwen-image-2.1",
  "data": [{ "b64_json": "iVBORw0KGgo..." }],
  "elapsed_seconds": 12.34,
  "prompt_id": "…",
  "params": { "width": 1024, "height": 1024, "seed": 123456789 }
}
```

`elapsed_seconds` / `prompt_id` / `params` 是排障用的扩展字段，标准客户端会忽略。

### 错误码

| 码 | 场景 |
|---|---|
| 400 | 参数非法 / 模型不存在 / 模板绑定错误 |
| 401 | API Key 不对 |
| 429 | 队列满、排队超时（`error.type = rate_limit_error`） |
| 502 | ComfyUI 执行失败（含节点级报错） |
| 503 | 连不上 ComfyUI |
| 504 | 生成超时 |

---

## 异步任务（推荐用于大图 / 视频 / 冷启动）

**为什么需要**：Cloudflare 免费版有 **100 秒硬超时**。同步模式下请求要一直挂着等 GPU 出图，
大图 + 冷启动很容易踩线（报 524）。异步模式把"等"这件事从 HTTP 连接里拿出来：

```
提交（20 毫秒返回 task_id）
  → Cloudflare 连接立刻结束，完全没有超时风险
  → 客户端自己轮询 GET /v1/tasks/{id}
```

### 用法

```bash
# 1) 提交（三种入口等价）
curl -X POST .../v1/images/generations -H "Authorization: Bearer <key>" \
     -d '{"model":"qwen-image-2.1","prompt":"...","size":"1920x1080","async":true}'
# HTTP 200（必须回 200：NewAPI 只把 200 当中继成功）
# {"id":"task_20260925_f9de4afb2cd6","task_id":"task_20260925_f9de4afb2cd6",
#  "object":"generation.task","status":"queued",
#  "created_at":1790328000,"status_url":"/v1/tasks/task_20260925_f9de4afb2cd6"}

# 2) 轮询
curl .../v1/tasks/task_20260925_f9de4afb2cd6 -H "Authorization: Bearer <key>"
# {"id":"...","status":"running","queued_seconds":8.4,"elapsed_seconds":3.1,...}
# {"id":"...","status":"succeeded","queued_seconds":8.4,"elapsed_seconds":8.2,
#  "data":[{"b64_json":"..."}], "prompt_id":"...", "params":{...}}
```

`async=true` 三种传法都支持：
- `/v1/images/generations` JSON 体里 `"async": true`
- `/v1/images/edits` multipart 表单字段 `async=true`
- `POST /v1/tasks`（通用入口）

### 状态机与时间口径

```
queued ──► running ──► succeeded
   │          │     └► failed
   └──────────┴───────► cancelled
```

| 字段 | 含义 |
|---|---|
| `queued_seconds` | **排队时长**（等并发名额），开跑后固定 |
| `elapsed_seconds` | **实际执行时长**（不含排队），未开跑时为 `null` |

两个字段分开是刻意的 —— 并发为 1 时排队可能比执行还久，混在一起就没法判断是机器慢还是队列长。

### 测试脚本

```bash
python tools/smoke_test.py --async-mode --steps 20 --prompt "..."   # 单任务异步全流程
python tools/batch_test.py --n 4 --steps 20                          # 并发 + 排队 + 吞吐
```

### 怎么接到 new-api

new-api 目前**没有**官方任务插件体系（线上 `v1.0.0-rc.20` 探测 `/api/plugin/task` 返回 404；
`QuantumNous/new-api` 的新版才刚加，见 `docs/plugin-api/`）。所以在升级到带插件体系的版本之前，
异步接口只能让 nginx **直连适配层**（绕开 new-api，鉴权靠适配层自己的 api_key）：

```nginx
location /v1/tasks {
    proxy_pass http://127.0.0.1:8791;   # frp 隧道出口
    proxy_set_header Host $host;
}
location /files/ {
    proxy_pass http://127.0.0.1:8791;
    proxy_set_header Host $host;
}
```

> 一旦 new-api 升级到带 task plugin 的版本，就可以写一个单文件 JS 插件走官方任务体系，
> 那时计费、额度、日志都能统一到 new-api 里 —— 这是更正统的路线，但**不是现在的阻塞项**。

---

## 现有模型

| id | 类型 | 底模 | 步数 | 说明 |
|---|---|---|---|---|
| `qwen-image-2.1` | 图片 | `qwen-image-2.1-UC-fp8` | 40 | 不给图 = 文生图；给图 = 单图/多图编辑（≤10 张） |
| `minimax-h3` | **视频** | `minimax_h3_hybrid_fl2va_ref2va_b25-49` | 4 | **音视频同步**；文生/图生/首尾帧/参考生视频 |
| `minimax-h3-ref2v` | **视频** | 同上 | 8+5 | **双采 + 潜空间上采样**；参考生视频，参考图 1~9 张 |

### 实测性能（4090 48G，模型热态）

| 场景 | 参数 | 耗时 |
|---|---|---|
| 文生图 | 1024×1024，20 步 | **8.2s**（连跑 4 张 7.8~8.4s） |
| 文生图 | 1024×1024，40 步 | 21~26s |
| 文生图 | 1920×1080，40 步 | 36.1s |
| **文生视频** | 768×448，22 帧(0.9s)，4 步 | **5.6s** |
| **文生视频** | **1344×768，124 帧(5.2s)，4 步** | **110s** ⬅ 主力规格 |
| 图片吞吐 | 连续提交 4 个任务 | **6.97 张/分钟** |

> 视频约 **21 倍实时**（5.2 秒视频要 110 秒）。**同步绝对不可能** —— Cloudflare 免费版
> 100 秒硬超时，110 秒必挂。所以 `minimax-h3` **默认异步**（`async: true`）。

> ⚠️ **冷启动惩罚约 5 倍**：ComfyUI 刚起、或刚跑过别的模型时，第一张会额外花 10~30s
> 加载权重（日志里 `prepared for dynamic VRAM loading`）。40s vs 8s 的差距就是这么来的。
> 所以：**别频繁重启 ComfyUI，也别来回切模型**。

---

## 视频（`minimax-h3`）

MiniMax H3 是**音视频同步生成** —— 输出的 mp4 自带 AAC 音轨，不是无声视频。

一个模型覆盖四种模式，**靠你给不给图、给几张图自动判断**（`task_type: auto`）：

| 你给的输入 | 自动判定 | 模式 |
|---|---|---|
| 只给 prompt | `T2VA` | 文生视频 |
| `first_frame` | `I2VA` | 图生视频（首帧） |
| `first_frame` + `last_frame` | `FL2VA` | 首尾帧 |
| `images`（1~10 张） | `Ref2VA` | 参考生视频 |
| 首尾帧 + 参考图 | `Hybrid` | 混合 |

### 用法（默认就是异步）

```bash
# 1) 提交 —— 20ms 返回 task_id
curl -X POST .../v1/videos/generations -H "Authorization: Bearer <key>" \
     -H "Content-Type: application/json" \
     -d '{"model":"minimax-h3","prompt":"一只橘猫从窗台跳下来，慢镜头",
          "size":"1344x768","length":124,"steps":4}'

# 2) 轮询
curl .../v1/tasks/task_20260925_96cdad35dc33 -H "Authorization: Bearer <key>"
# status: queued -> running -> succeeded
# data: [{"url":"http://.../files/20260925-xxxx.mp4","content_type":"video/mp4","kind":"video"}]
```

`/v1/videos` 是同义的 Sora 风格别名，用哪个都行。

**产出永远返回 URL**（不返回 `b64_json`）：一个 5 秒 mp4 有 1~10MB，转 base64 会再膨胀 33%，
塞进 JSON 里既浪费带宽又容易撞上各层大小限制。`/files/` 支持 **Range 请求**，所以浏览器里
的视频播放器能正常拖进度条。

### 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `size` / `width` / `height` | 1344×768 | 对齐到 **32** 的倍数 |
| `length` | 124 | 帧数 @24fps。**124 帧 = 5.2 秒**；节点会自动对齐到 `17n+5` |
| `duration` | — | 秒数。模板声明了 `duration_fps`（本模型是 24）时按它换算成 `length`，省得调用方自己乘 |
| `steps` | 4 | Turbo LoRA 是 4 步版，加大收益不大但会成倍变慢 |
| `task_type` | `auto` | 一般不用动，除非要强制某种模式 |
| `first_frame` / `last_frame` | — | data URL / http(s) URL |
| `images` | — | 参考图，≤10 张。单张也可以用 `image`（OpenAI 习惯两种写法，这里都收） |

> `n` 对视频无效（视频一次只有一个产出）。`shift_video` / `shift_audio`（默认 12.0 / 3.0）
> 是双时钟采样器的偏移量，除非你清楚在调什么，别动。

---

## 双采参考生视频（`minimax-h3-ref2v`）

你自己的那份「文武双修均衡版」工作流，**采样参数一个没改**，只是接到了 API 上。

链路：LOW 首采（8 步）→ **1.5× 潜空间上采样** → HIGH 精修（5 步）→ 音视频同步解码。

### 用法

```bash
curl -X POST .../v1/videos/generations -H "Authorization: Bearer <key>" \
     -H "Content-Type: application/json" \
     -d '{"model":"minimax-h3-ref2v",
          "prompt":"<你的提示词>",
          "duration":15,
          "mode":0,
          "images":["data:image/png;base64,...", "https://..."]}'
```

### 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `prompt` | 模板自带你的长提示词 | 不给就用工作流里原本那段 |
| `duration` | **15**（秒） | 内部按 `max(5, 24a) + (5 - …%17)%17` 对齐成帧；范围 1~15 |
| `mode` | **0** | `0` = 文戏（lms LoRA 0.4 / 首采 0.4MP）、`1` = 武戏（0.8 / 0.5MP） |
| `images` | **必填** | 参考图 1~9 张（data URL / http URL） |
| `seed` | 随机 | |

⚠️ **不要传 `size` / `width` / `height`** —— 宽高由工作流自带的 `ResolutionSelector`
按 `mode` 算首采尺寸，再经 1.5× 上采样得到精修尺寸（文戏 → 1312×736）。

### 一张参考图会连到两个节点

双采工作流必须让 **LOW 和 HIGH 两遍都拿到参考图**，否则报
`REF2VA requires at least one reference media input`。适配层会自动把每张图
接到 `node 7` 和 `node 14` 两处（0 基槽位 `ref_image_0`…）。

### 实测性能（4090 48G）

| 参考图张数 | 时长 | 耗时 |
|---|---|---|
| **1 张** | 2.33s（56 帧） | **78.7s** ✅ |
| **3 张** | 2.33s（56 帧） | **88.1s** ✅ |
| 9 张 | 2.33s（56 帧） | **> 30 分钟，超时失败** ❌ |

> ⚠️ **9 张会顶爆显存**：实测显存冲到 **47~48GB / 48GB**，触发严重 CPU offload，
> 1800 秒都跑不完。而且此时 ComfyUI 的 `POST /interrupt` **无效** ——
> 卡在自定义 attention kernel 内部，只能杀后端进程。
> **建议参考图控制在 3~5 张以内**，`job_timeout` 留在 1800s 别调小。

---

## 尺寸怎么控制

三个约束叠加生效（都在 meta 的 `constraints` 里）：

| 约束 | 当前值 | 作用 |
|---|---|---|
| `multiple_of` | 8 | 宽高必须对齐到 8 的倍数（1920、1080 都能整除） |
| `min_size` / `max_size` | 256 / 2048 | 单边范围 |
| `max_pixels` | 2 100 000 | **总像素上限**，约 2.1MP（1920×1080 = 2.07MP，刚好过关） |

超过 `max_pixels` 会**按比例缩小**（保持宽高比），不会拒绝请求：

```bash
python tools/dry_run.py --size 1920x1080 --prompt x   # → 1920 x 1080  = 2.07 MP  ✅ 原样通过
python tools/dry_run.py --size 4032x3024 --prompt x   # → 1672 x 1256  = 2.10 MP  ⬅ 手机原图被钳
```

`tools/dry_run.py` 只做归一化和模板渲染，**不提交任务、不占显卡**，调参数时随便试。

### 关于参考图的缩放（`resolution`）

参考图喂给模型前会被缩放到大约 `resolution × resolution` 像素。不显式传 `resolution` 时按
$\sqrt{宽 \times 高}$ 自动推导（对齐到 32 的倍数），让参考图面积与输出画布一致 ——
ComfyUI 核心节点的 tooltip 明确写了：尺寸不匹配会让编辑产生偏移。

> 注意：**输出宽高比由 `size` 决定**，参考图自身的宽高比只影响它被缩放后的形状。

---

## 图片编辑（单图 / 多图）

用**同一个模型 id** `qwen-image-2.1`，带参考图就是编辑。

### 方式一：multipart（标准 OpenAI 客户端用法）

```bash
curl -X POST http://127.0.0.1:9000/v1/images/edits \
  -H "Authorization: Bearer <api_key>" \
  -F "model=qwen-image-2.1" \
  -F "prompt=把猫的圆框眼镜换成黑色墨镜，背景换成夜晚星空" \
  -F "image=@a.png" \
  -F "image=@b.png" \
  -F "size=1024x1024"
```

文件字段名支持 `image` / `image[]` / `images`，可重复传多张。`mask` 字段会被忽略并打日志（当前模板不支持局部重绘）。

### 方式二：JSON（`images` 支持 data URL / http URL）

```bash
# 走 /v1/images/generations，带 images 数组即视为编辑
curl -X POST http://127.0.0.1:9000/v1/images/generations \
  -H "Authorization: Bearer <api_key>" -H "Content-Type: application/json" \
  -d '{"model":"qwen-image-2.1","prompt":"改成清晨","images":["https://example.com/a.png"]}'
```

`images` 每项可以是：
- `data:image/png;base64,....`
- `https://...`（适配层拉取，受 `edit.fetch_url_timeout` / `max_image_bytes` 限制）
- 已在 ComfyUI input 目录里的相对路径（高级用法）

### 行为说明

- **不传尺寸时沿用第一张参考图的宽高**（OpenAI 编辑接口惯例），再走上面的三重约束。
- **上传去重**：参考图按内容 SHA-256 命名上传到 ComfyUI 的 `input/adapter/uploads/`，同一张图重复提交不会重复占盘。
- **上限 10 张**（`edit.max_reference_images`）。底层节点 `TextEncodeQwenImage21` 本身支持到 16 张。

---

## 加一个新模型（三步）

1. **导出 API 格式工作流**
   ComfyUI 里 `设置 → 启用开发模式选项`，然后菜单 `工作流 → 导出 (API)`，保存成 `workflows/我的模型.json`。

2. **写元信息 `workflows/我的模型.meta.json`**

   ```json
   {
     "id": "my-model",
     "display_name": "我的模型",
     "template": "我的模型.json",
     "defaults": { "width": 1024, "height": 1024, "steps": 20 },
     "bind": {
       "prompt": [{ "node": "5", "input": "text" }],
       "width":  [{ "node": "7", "input": "width" }],
       "height": [{ "node": "7", "input": "height" }],
       "seed":   [{ "node": "8", "input": "seed" }]
     },
     "constraints": { "multiple_of": 16, "min_size": 256, "max_size": 2048 }
   }
   ```

   `node` 就是 API JSON 里的顶层 key（字符串 id）。一个参数可以绑定到多个节点：
   `"prompt": [{"node":"5","input":"text"},{"node":"6","input":"text"}]`

3. 把 meta 路径加进 `config.yaml` 的 `models`，然后 `run.bat check`。

> 没导出 API 格式也能救：`tools/inspect_wf.py` 可以把 UI 格式工作流（含 subgraph 子图）压成可读摘要，
> `tools/dump_node_info.py <类名>` 可以查任意节点类的输入名、类型、取值范围。

---

## 目录结构

```
comfy-adapter/
  app.py                  入口（--check / --list-models）
  config.yaml             全部可调项
  adp/
    config.py             配置加载
    comfy_client.py       ComfyUI HTTP 客户端（提交/轮询/取图/传图/错误解析）
    template.py           模板 + 参数绑定 + 动态块 + 归一化 + 渲染
    images.py             参考图解析（data URL / http URL / 上传字节）
    service.py            并发闸门、排队、上传参考图、统计
    tasks.py              异步任务注册表（状态机 + 过期回收）
    storage.py            图片落盘与过期清理
    api.py                FastAPI 路由与错误映射
  workflows/              API 格式模板 + meta
    qwen-image-2.1.json / .meta.json        图片：文生图 + 编辑（同一套模板）
    minimax-h3-video.json / .meta.json      视频：文生/图生/首尾帧/参考生视频
    reference/                              从 /history 挖出来的原始参考（不是模板）
  tools/
    fetch_history.py      从 ComfyUI /history 挖出实际跑过的 API 格式 prompt
    inspect_wf.py         工作流结构检查（UI 格式，展开 subgraph）
    inspect_api.py        工作流结构检查（API 格式）
    dump_node_info.py     查节点类输入规格（--raw 看自动增长输入上限）
    submit_api.py         直接提交一份 API prompt 给 ComfyUI 验证（不用接适配层）
    dry_run.py            干跑：只看参数归一化和模板渲染，不占显卡
    smoke_test.py         端到端冒烟（--edits 编辑 / --async-mode 异步 / --length 视频）
    batch_test.py         并发/排队/吞吐测试
    test_errors.py        错误路径回归
    out/                  冒烟测试产出的图片与视频
  static/                 response_format=url 时落盘（24h 自动删除）
  .venv/                  独立虚拟环境
```

---

## 产物存哪、走哪条路（**不用买对象存储**）

素材只活 24 小时（`output.static_ttl: 86400`，后台每 10 分钟清理一次），落在本机磁盘。
真正要选的是**文件走哪条路到用户手里**：

| 方案 | 文件路径 | 谁出流量 | 成本 |
|---|---|---|---|
| **A. 走 VPS**（最省事） | 本地 → frp → VPS nginx → 用户 | **VPS 流量包** | 包内为 0 |
| **B. Cloudflare Tunnel 直出** | 本地 → CF → 用户，**VPS 一个字节都不碰** | Cloudflare | 免费版目前不额外收流量费 |
| C. 本机公网 IP 直连 | 本地 → 用户 | 家宽上行 | 0，但要双层 NAT + DDNS，且暴露机器 |

> **关键**：上传到 VPS 是免费的（入站不计费），**只有下发才吃流量包**。
> 所以先查你的流量包有多大、用了多少 —— 大概率完全够用，不用动。

**方案 A 需要的 nginx 配置**（`public_base_url` 改成 `https://api.jiucaihezi.studio`）：

```nginx
location /files/ {
    proxy_pass http://127.0.0.1:8791;   # frp 隧道出口
    proxy_set_header Host $host;
    # 图片是 24h 随机名，可以放心长缓存
    proxy_buffering off;
}
```

**什么时候需要切到方案 B**：视频跑起来后流量明显上涨、或者 VPS 流量包吃紧了，
再装 `cloudflared` 并把 `public_base_url` 换成隧道域名即可 —— 代码不用改。

---

## 模型模板的两种参数绑定

### 1. 静态绑定 `bind`（参数 → 固定节点输入）

```json
"bind": { "prompt": [{ "node": "5", "input": "text" }] }
```

### 2. 动态块 `dynamic_blocks`（list 参数 → 动态生成节点）

参考图数量是变化的，没法写死在模板里。所以声明一个动态块：

```json
"dynamic_blocks": [{
  "param": "reference_images",       // 固定用这个名字，适配层会把上传结果填进去
  "min_items": 1, "max_items": 10,
  "node_id_format": "ref{i1}",       // {i}=0 基序号, {i1}=1 基序号, {value}=当前项
  "node_template": {
    "class_type": "LoadImage",
    "inputs": { "image": "{value}" }
  },
  "binding": [ { "node": "5", "input": "images.image_{i1}" } ]
}]
```

渲染时会按参考图数量生成 `ref1`、`ref2`… 节点，并接到 `images.image_1`、`images.image_2`…
**没有参考图时一个字都不生成** —— 所以同一套模板同时覆盖文生图和编辑，不需要两个模型 id。

可以先干跑看一眼：

```bash
python tools/dry_run.py --prompt "x" --size 1920x1080 --ref-image 1 --ref-image 2 --ref-image 3
```

> ⚠️ 槽位名是**插件/核心节点自己定的**，必须先查清楚：
> `python tools/dump_node_info.py --raw TextEncodeQwenImage21`
> 本例中核心节点的自动增长输入是 `image_1`..`image_16`（**1 基**），
> 而 minimax 插件的 `ref_images` 是 `ref_image_0`..（**0 基**）—— 两者不一样，别猜。

---

## 部署

> ⚠️ **最容易踩的坑**：`comfy-adapter` 必须跑在**有 GPU 的那台 Windows 机器**上，
> **不能部署到 VPS**。VPS 上没有显卡，也不需要装这个。
> 你的"推送 GitHub → 服务器拉取 → 部署"流程，对适配层来说"服务器"指的是**本机 GPU 机器**。

### 本机（GPU 机器）上

```bat
git clone <你的仓库>
cd comfy-adapter
copy config.example.yaml config.yaml
::  改 config.yaml：auth.api_keys 换成随机密钥、public_base_url 改成对外地址
run.bat check          :: 自检：模板 + ComfyUI 连通性 + 节点类
run.bat                :: 启动
```

`run.bat` 会自动建 `.venv` 并装依赖（走你已配好的 pip 镜像）。

**开机自启**（登录时触发，因为 ComfyUI Desktop 需要一个登录会话）：

```powershell
$exe = "D:\ComfyUI-aki-v3\comfy-adapter\.venv\Scripts\pythonw.exe"
$arg = "`"D:\ComfyUI-aki-v3\comfy-adapter\app.py`""
$action  = New-ScheduledTaskAction -Execute $exe -Argument $arg -WorkingDirectory "D:\ComfyUI-aki-v3\comfy-adapter"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "comfy-adapter" -Action $action -Trigger $trigger -RunLevel Highest
```

> 用 `pythonw.exe`（不是 `python.exe`）可以不开黑窗口。
> 日志这时会看不见 —— 想留日志就把 `>> logs.txt 2>&1` 加进 Argument。

### VPS（只有 nginx 和 newapi，不装适配层）

```nginx
# /etc/nginx/sites-enabled/api.jiucaihezi.studio.conf
# 假设 frp 隧道出口在 127.0.0.1:8791
location /files/ {
    proxy_pass http://127.0.0.1:8791;
    proxy_set_header Host $host;
    proxy_buffering off;          # 视频边下边播
    client_max_body_size 50m;     # 参考图上传
}
```

> `/v1/*` 已经统一交给 NewAPI：视频任务用 NewAPI 自己的 `/v1/videos` +
> `/v1/videos/{task_id}` + `/v1/videos/{task_id}/content` 合同轮询与回收，
> 适配器这边只是把这三个路径实现出来（见「接口」表），**不再需要**让客户端直连
> `/v1/tasks` 那一套绕行方案。`/files/` 直连是因为它是给浏览器直接拉的大文件。

### newapi 渠道

| 项 | 值 |
|---|---|
| 类型 | OpenAI（图片）/ 视频任务渠道 |
| Base URL | `http://127.0.0.1:8791`（隧道出口） |
| 密钥 | `config.yaml` 里的 `auth.api_keys` |
| 模型 | `jc-qwen-image-2.1`、`jc-minimax-h3`、`jc-minimax-h3-ref2v` |
| 模型映射 | 把上面的 `jc-*` 映射到适配器的 `qwen-image-2.1` / `minimax-h3` / `minimax-h3-ref2v` |
| 分组 | 建议单独建 `comfy` 分组，方便定价和限流 |

> 公开模型名带 `jc-` 前缀，和创作面板下拉里的显示名一致；适配器内部 id 保持
> `qwen-image-2.1` / `minimax-h3` / `minimax-h3-ref2v` 不变，靠 NewAPI 的模型映射衔接。

**同步 vs 异步**：
- `jc-qwen-image-2.1` 走同步 `/v1/images/generations`（有参考图则走 `/v1/images/edits` 的
  multipart），8~42s 都在 Cloudflare 的 100s 内
- 三个 `jc-minimax-h3*` **必须异步**（110s+），提交 202 后由 NewAPI 轮询
  `/v1/videos/{task_id}`，成片走 `/v1/videos/{task_id}/content`
- ⚠️ `server.public_base_url` 要填成**调用方可达**的隧道地址，否则完成任务时返回的
  `metadata.url` 会是一条死链

> 上表是设计口径，真实通路（隧道 + NewAPI 渠道映射 + 扣费）尚未实测；
> 未实测前不要当成已通过。

---

## 运维要点

- **只监听 127.0.0.1**：`server.host` 默认回环，`8188` 和 `9000` 都绝不暴露公网。
  对外通过 frp 隧道（API）和 nginx 的 `/files/`（产物）。
- **并发**：`limits.max_concurrency: 1`。4090 48G 跑 20GB 模型时并发 2 会触发显存换页，反而更慢。
  实测 4 个任务严格串行，排队时间如实反映在 `queued_seconds` 上。
  队列满直接 429 快速失败，避免请求堆死。
- **别频繁重启 ComfyUI**：第一张图要付 10~30s 的权重加载惩罚（40s vs 8s，差 5 倍）。
- **别来回切模型**：切模型会把对方挤下显存，下次请求又要重新加载。要稳定卖图就固定一个模型常驻。
- **超时**：`comfy.job_timeout: 1800`。冷启动加载 10~20GB 模型可能 3~5 分钟。
- **和 UI 抢显卡**：本服务和 ComfyUI 网页端共用同一个 `8188`，双方任务会串行排队。
  真要隔离，再给 ComfyUI 加一个实例并改 `comfy.base_url`。
- **产物 24h 自动删除**：后台每 10 分钟清理一次 `static/`，任务记录同样 24h 过期。
  不要手工 `rm -rf` `static/`。
- **改代码/配置后必须重启**适配层才生效（uvicorn 没开 reload）。
