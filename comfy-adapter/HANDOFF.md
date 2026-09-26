# comfy-adapter 交接说明

> 交接时间：2026-09-26
> 交接原因：本机适配层开发完成，转移至部署工作区继续
> 项目位置：`D:\ComfyUI-aki-v3\comfy-adapter\`

> **2026-09-26 后续（入仓 + 对接创作面板）** —— 以下内容晚于上面那次交接，已在本仓完成：
> - 源码已纳入主仓库 `comfy-adapter/`，本机运行目录改指仓库副本；排除 `.venv/`、`config.yaml`（含真实密钥）、`static/`、`tools/out/`。
> - 补了 NewAPI/创作面板认的视频轮询合同：`GET /v1/videos/{id}` 与 `GET /v1/videos/{id}/content`（支持 Range）。原生 `/v1/tasks/*` 保持不变。
> - `duration`（秒）会被换算成 H3 的 `length`（帧）—— 模板在 meta 里声明 `duration_fps: 24`；`minimax-h3-ref2v` 本身就是秒参数，不受影响。
> - `resolution` 收到非数值（创作面板会残留别的模型的 `'720p'`/`'2k'`）时不再 422，改为丢弃并记日志。
> - 单张参考图现在也认 JSON 的 `image` 字段（面板单图时发的是 `image` 而不是 `images`）。
> - 对外公开模型名带 `jc-` 前缀（`jc-qwen-image-2.1` / `jc-minimax-h3` / `jc-minimax-h3-ref2v`），由 NewAPI 模型映射回适配器 id。
> - 剩余未做仍是原来的第 1~6 条（真实密钥、public_base_url、开机自启、隧道、NewAPI 渠道、推 GitHub）。

---

## 一、这是什么

把本机 ComfyUI 包装成 **OpenAI 兼容 API**，供 new-api 中转站调用。

```
客户 → Cloudflare → nginx:443 → new-api:3000 → 渠道(base_url) → 隧道 → 本机 comfy-adapter:9000 → ComfyUI:8188 → RTX 4090
```

⚠️ **本适配层必须跑在有 GPU 的这台 Windows 机器上，不能部署到 VPS。**

---

## 二、当前进度

### ✅ 已完成

| 项 | 状态 |
|---|---|
| 独立项目 + 独立 venv | `comfy-adapter\.venv`（与 ComfyUI 环境隔离） |
| 依赖 | fastapi / uvicorn[standard] / httpx / PyYAML / python-multipart |
| 3 个模型 | `qwen-image-2.1`、`minimax-h3`、`minimax-h3-ref2v` |
| 图片接口 | 文生图 + 单图/多图编辑（multipart + JSON 双模） |
| 异步任务 | 提交 202 → 轮询 → 取消 → 删除 |
| 视频接口 | T2V / I2V / FL2V / Ref2V，音视频同步 |
| 产出服务 | `/files/{name}`，支持 Range（视频可拖进度条） |
| 24h 自动清理 | 产物 + 任务记录 + 后台 sweeper |
| 自检 | `app.py --check`（模板/连通性/节点类/模型文件，共 4 步） |
| 错误路径回归 | 12/12 通过 |
| 仓库友好文件 | `.gitignore`、`config.example.yaml` |

### ❌ 未完成（部署阶段要做）

1. `config.yaml` 里 **`auth.api_keys` 还是占位符** `change-me-please`
2. `server.public_base_url` 还是 `http://127.0.0.1:9000`，需改成对外地址
3. **开机自启未配置**
4. **隧道未部署**（frp 或 Cloudflare Tunnel）
5. **new-api 渠道未配置**
6. **未推 GitHub**

### 🟡 当前运行状态

- ComfyUI：0.37.2 @ `127.0.0.1:8188`，**手动启动**（见「五、关键坑」第 4 条）
- comfy-adapter：@ `127.0.0.1:9000`，正在运行
- GPU：RTX 4090 48GB

---

## 三、接口清单

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 含 ComfyUI 状态、队列、任务统计、存储信息 |
| GET | `/v1/models`、`/v1/models/{id}` | 模型卡片（含 capabilities/defaults/constraints/supports） |
| POST | `/v1/images/generations` | 带 `images` 数组即走编辑；`async: true` 切异步 |
| POST | `/v1/images/edits` | multipart 或 JSON 双模 |
| POST | `/v1/videos/generations`、`/v1/videos` | 视频，**默认异步** |
| POST | `/v1/tasks` | 通用异步入口 |
| GET | `/v1/tasks`、`/v1/tasks/{id}` | 任务列表 / 详情 |
| POST | `/v1/tasks/{id}/cancel`、DELETE `/v1/tasks/{id}` | 取消 / 删除 |
| GET/HEAD | `/files/{name}` | 支持 Range、Cache-Control、目录穿越防护 |

**错误码映射**：400 参数/模型 · 401 密钥 · 429 队列满 · 502 ComfyUI 执行失败 · 503 连不上 · 504 超时。
FastAPI 原生 422 也被转成 OpenAI 错误体。

**鉴权**：`Authorization: Bearer <config.yaml 里的 api_keys>`。
填占位符时鉴权**仍然开启**，启动日志会告警。

---

## 四、实测性能（部署时用来估容量 / 设限流）

### 图片

| 场景 | 参数 | 耗时 |
|---|---|---|
| 文生图 | 1024²，20 步 | **8.2s**（连跑 4 张 7.8~8.4s） |
| 文生图 | 1024²，40 步 | 21~26s |
| 文生图 | 1920×1080，40 步 | 36.1s |
| 单图编辑 | 1024² | 20~27s |
| 双图融合 | 1024² | 42.2s |

**异步并发**（20 步 1024²，连提 4 个）：排队 0/8.4/16.1/24.4s（严格串行），单张 8.2s，**吞吐 6.97 张/分钟**，提交响应 **20ms** 返回 202。

### 视频 · `minimax-h3`（单采 4 步）

| 场景 | 参数 | 耗时 |
|---|---|---|
| 文生视频 | 768×448，22 帧，4 步 | **5.6s** |
| 图生视频 | 同上 + 首帧 | **7.9s** |
| **文生视频（主力规格）** | **1344×768，124 帧(5.2s)，4 步** | **110s** |

约 **21 倍实时**。

### 视频 · `minimax-h3-ref2v`（双采 + 潜空间上采样）

**2.33 秒时长（56 帧）**：

| 参考图张数 | 耗时 |
|---|---|
| 1 张 | **78.7s** |
| 3 张 | **88.1s** |
| **6 张** | **98.4s** |
| 9 张 | **> 1800s 超时失败 ❌** |

> ⚠️ **1~6 张线性缓增，7~9 张直接击穿显存**（47~48GB / 48GB）。
> **建议卡在 6 张以内。**

产物规格：`hevc (Main 10) yuv420p10le` + **`aac (LC)` 音轨**（音视频同步生成）。

---

## 五、关键坑（必读，部署时最容易踩）

### 1. 9 张参考图会顶爆显存，且 ComfyUI 无法中断

显存冲到 47~48GB 后触发严重 CPU offload，1800s 都跑不完。
此时 `POST /interrupt` **完全无效** —— 卡在 SolAttn 自定义 kernel 内部，只在采样步之间检查中断标志。
`/queue` 一直 `running`、不进 history、显存不释放，**只能杀 backend 进程**。

### 2. `task_type` 前端显示名 ≠ API 值

| | 值 |
|---|---|
| 用户画布 `widgets_values` 里存的 | `"Ref2VA — 参考生音视频"` |
| API 实际要求的 | `"Ref2VA"` |

直接提交报 `value_not_in_list`。已修正，并写进 `meta.set` 强制覆盖。

### 3. 底座文件名的坑

用户工作流写的是 `minimax_h3_hybrid_fl2va_ref2va_b25-49-int8_r.safetensors`，**本机没有**，
只有 `minimax_h3_hybrid_fl2va_ref2va_b25-49.safetensors`。

经实测核对，**两者 dtype 分布逐项一致**（都是 I8 91.9% + BF16 7.6%，19.53 GB，400 个量化 scale 张量），
**属于同一精度**，替换不损失画质。

### 4. ComfyUI 必须带模型路径启动

Comfy Desktop 靠 `settings.json` 的 `modelsDirs` 注入共享模型目录
（`D:\Comfy-Desktop\ComfyUI-Shared\models`）。**命令行直接跑 `main.py` 会看不到模型**
（`vae_name` 选项只剩 `pixel_space`）。

已在 ComfyUI 目录下放了一份 `adapter-model-paths.yaml`，命令行启动时这样用：

```powershell
cd D:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI
& ".venv\Scripts\python.exe" main.py --enable-manager `
    --extra-model-paths-config "D:\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\adapter-model-paths.yaml" `
    --input-directory  "D:\Comfy-Desktop\ComfyUI-Shared\input" `
    --output-directory "D:\Comfy-Desktop\ComfyUI-Shared\output"
```

> **用 Desktop 界面启动则不用管这个文件。**

### 5. 冷启动惩罚约 5 倍

ComfyUI 刚起、或刚跑过别的模型时，第一张会额外花 10~30s 加载权重
（日志：`prepared for dynamic VRAM loading`）。40s vs 8s 的差距就是这么来的。

**别频繁重启 ComfyUI，也别来回切模型。**

### 6. Cloudflare 100 秒超时

- 图片同步 8~26s ✅ 安全
- 视频必须走异步（提交立即返回 202）✅ 安全
- `/files/` 下载是大文件 GET，不受 100s 限制 ✅

### 7. PowerShell 测试陷阱

`curl.exe -d '{"a":"b"}'` 会被吃掉引号 → **测 API 一律用 Python 脚本**
（`tools/smoke_test.py`、`tools/test_errors.py`）。
另外终端跑长命令要**单行**，多行会被吞掉。

---

## 六、模型定义

### `minimax-h3`（单采，插件官方 12 节点配方）

`workflows/minimax-h3-video.json` + `.meta.json`

一个模型覆盖四种模式，靠给不给图自动判定（`task_type: auto`）：

| 输入 | 模式 |
|---|---|
| 只给 prompt | `T2VA` 文生视频 |
| `first_frame` | `I2VA` 图生视频 |
| `first_frame` + `last_frame` | `FL2VA` 首尾帧 |
| `images`(1~10) | `Ref2VA` 参考生视频 |

参数：`width/height`（默认 1344×768，对齐 32）、`length`（默认 124 帧）、`steps`（默认 4）、`seed`。

### `minimax-h3-ref2v`（双采，用户自己的「文武双修均衡版」）

`workflows/minimax-h3-ref2v.json` + `.meta.json`

**所有采样参数与用户工作流完全一致，一个未改**：

| 环节 | 参数 |
|---|---|
| LOW 首采 | 8 步，shift 12/3，`dual_clock_euler` + `native_flow` |
| 双采计划 | `base_steps 9 / coarse 4 / refine 5` |
| 潜空间上采样 | `3d_fp16` / `scale_by 1.5` / `preserve_source` / `offload_after` |
| HIGH 精修 | shift 12/3，tail/bias/STG/restart 全关 |
| SolAttn | `tau 1.3` / `start 0.2` / `end 0.9` / `min_tokens 12288` |
| 7 个 LoRA | 权重逐一对上（Combat 0.7/0.49、Motion_Repair 0.7/0.2、电影质感 0.5/0.2、lms 0.4…） |

**对外参数**：

| 参数 | 默认 | 说明 |
|---|---|---|
| `prompt` | 模板自带用户的长提示词 | 不给就用工作流原本那段 |
| `duration` | **15**（秒） | 内部用工作流的 `ComfyMathExpression` 对齐成 `17n+5` 帧；范围 1~15 |
| `mode` | **0** | `0`=文戏（lms LoRA 0.4 / 首采 0.4MP）、`1`=武戏（0.8 / 0.5MP） |
| `images` | **必填** | 参考图 1~6 张（模板支持 9，但 7+ 会爆显存） |
| `seed` | 随机 | |

> ⚠️ **不要传 `size`/`width`/`height`** —— 宽高由工作流自带的 `ResolutionSelector`
> 按 `mode` 算，再经 1.5× 上采样得到精修尺寸（文戏 → 1312×736）。

**一张参考图会连到两个节点**（双采必须两遍都拿到参考图，否则报
`REF2VA requires at least one reference media input`）：

```
LoadImage ─┬─→ node 7  (LOW  conditioning)   ref_images.ref_image_0 …
           └─→ node 14 (HIGH conditioning)   ref_images.ref_image_0 …
```

### `qwen-image-2.1`

`workflows/qwen-image-2.1.json` + `.meta.json`

不给图 = 文生图；给图 = 单图/多图编辑（≤10 张）。
`multiple_of: 8`（1080 能整除，用 16 的话 1080 会被改成 1088）。
`max_pixels: 2100000`（4032×3024 手机原图 → 1672×1256）。

---

## 七、目录结构

```
comfy-adapter/
├── app.py                  入口（--check / --list-models）
├── config.yaml             实际配置（含真实密钥，已 gitignore）
├── config.example.yaml     模板（供仓库用）
├── run.bat                 run.bat / run.bat check / run.bat models
├── requirements.txt
├── README.md               完整文档（含部署章节）
├── .gitignore
├── adp/                    9 个模块
│   ├── api.py              FastAPI 路由 + 错误映射
│   ├── service.py          并发闸门 + 排队 + 提交 + 等结果
│   ├── template.py         模板引擎（bind / dynamic_blocks / set / normalize / render）
│   ├── tasks.py            内存态任务表（TTL 24h）
│   ├── images.py           参考图解析（data URL / http URL / 上传字节）
│   ├── comfy_client.py     ComfyUI 客户端（上传/提交/轮询/取产物）
│   ├── storage.py          产物落盘 + TTL 清理
│   └── config.py
├── workflows/
│   ├── qwen-image-2.1.json / .meta.json
│   ├── minimax-h3-video.json / .meta.json
│   ├── minimax-h3-ref2v.json / .meta.json
│   └── reference/          原始工作流存档（溯源用）
├── tools/
│   ├── ui_to_api.py        ★ UI 画布 → API 模板（自动剪枝 + 自动纠 combo 值）
│   ├── check_nodes.py      ★ 批量校验节点类是否注册
│   ├── check_precision.py  ★ 读 safetensors header 判断量化精度
│   ├── fetch_history.py    ★ 从 /history 挖实际提交的 API prompt
│   ├── submit_api.py       直接提交 API prompt 给 ComfyUI 验证
│   ├── dry_run.py          干跑：只看归一化 + 渲染，不占显卡
│   ├── smoke_test.py       端到端冒烟（--duration/--mode/--ref-image/--ref-glob/--video）
│   ├── test_errors.py      错误路径回归（12 项）
│   ├── batch_test.py       并发/排队/吞吐
│   ├── video_info.py       查 mp4 规格 + 抽帧
│   ├── dump_node_info.py   查节点输入规格
│   ├── inspect_api.py / inspect_wf.py
│   └── out/                测试产出（已 gitignore）
└── static/                 落盘产物（24h 自动删，已 gitignore）
```

---

## 八、部署阶段待办

### 第 1 步：本机固化

```bat
cd D:\ComfyUI-aki-v3\comfy-adapter
copy config.example.yaml config.yaml    :: 如果还没有
run.bat check                            :: 自检，必须全绿
```

改 `config.yaml`：

```yaml
auth:
  api_keys: ["<python -c \"import secrets;print(secrets.token_hex(24))\" 生成>"]
server:
  public_base_url: "https://<对外地址>"
limits:
  max_concurrency: 1
  max_queue: 4
```

**开机自启**：

```powershell
$exe = "D:\ComfyUI-aki-v3\comfy-adapter\.venv\Scripts\pythonw.exe"
$action  = New-ScheduledTaskAction -Execute $exe `
           -Argument "`"D:\ComfyUI-aki-v3\comfy-adapter\app.py`"" `
           -WorkingDirectory "D:\ComfyUI-aki-v3\comfy-adapter"
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "comfy-adapter" -Action $action -Trigger $trigger -RunLevel Highest
```

### 第 2 步：打通隧道（二选一）

**A. frp**（与现有架构一致）

VPS：装 frps（Docker），需云控制台**放行 7000**。
本机：装 frpc，`transport.protocol = "kcp"`（⚠️ 跨境 345ms，默认 TCP-over-TCP 会塌陷）。

**B. Cloudflare Tunnel**（更快，不用碰 VPS）

本机装 `cloudflared`，映射到 `comfy.jiucaihezi.studio`，自动 HTTPS。
不需要 SSH、不需要放行端口、跨境线路由 CF 优化。

> 两条路的出口都建议**只绑 127.0.0.1**，不直接暴露。

### 第 3 步：new-api 建渠道

| 项 | 值 |
|---|---|
| 类型 | OpenAI（图片）/ 视频按 new-api 支持的类型 |
| Base URL | 隧道出口地址（如 `http://127.0.0.1:8791` 或 `https://<隧道域名>`） |
| 密钥 | `config.yaml` 里的 `auth.api_keys` |
| 模型 | `qwen-image-2.1`、`minimax-h3`、`minimax-h3-ref2v` |
| 分组 | 建议新建 `comfy` 分组，方便定价和限流 |

**视频走异步**：本适配层的 `/v1/videos/generations` 提交后立即返回 **202 + task_id**，
查询走 `GET /v1/tasks/{id}`。new-api 的异步视频中转就是这套模式。

### 第 4 步：验证

```bash
# 图片（同步）
curl -X POST https://api.jiucaihezi.studio/v1/images/generations \
  -H "Authorization: Bearer <newapi token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-image-2.1","prompt":"一只戴墨镜的柴犬","size":"1024x1024"}'

# 视频（异步）
curl -X POST https://api.jiucaihezi.studio/v1/videos/generations \
  -H "Authorization: Bearer <newapi token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"minimax-h3","prompt":"一只橘猫从窗台跳下来","length":124}'
# → 202 + task_id，再查 GET /v1/tasks/{task_id}
```

---

## 九、阻塞 / 待确认

| # | 事项 | 说明 |
|---|---|---|
| 1 | **服务器 2026-10-06 到期** | 只剩 **10 天**；不续费则必须走 Cloudflare Tunnel 方案 |
| 2 | SSH 无免密密钥 | 本机 `ssh root@47.82.86.196` 报 `Permission denied (publickey,password)` |
| 3 | new-api 版本 | 线上探测 `/api/status` 为 `rc.20`，运维文档写 `rc.30`，请核实 |
| 4 | VPS 端口探测结果 | 22 OPEN(345ms)、443 OPEN(323ms)、**7000 closed（无 frps）**、8791 closed、3000 closed |
| 5 | 本机网络 | **WLAN + 双层 NAT**（192.168.0.80 → 网关 192.168.1.1），公网出口 `58.208.246.161`；当服务器用建议换有线 |
| 6 | 参考图上限 | 建议卡 **6 张**（9 张会击穿显存） |

---

## 十、快速排障

| 现象 | 检查 |
|---|---|
| `/health` 返回 503 | ComfyUI 没起来 → `curl http://127.0.0.1:8188/system_stats` |
| `--check` 第 4 步报缺模型文件 | 看它列出的「可选」列表，改模板里对应的 `*_name` |
| 提交报 `Prompt outputs failed validation` | 用 `tools/ui_to_api.py` 的 combo 校验查；或 `tools/submit_api.py` 拿详细 node_errors |
| 提交报 `value_not_in_list` | 前端中文 label 混进了模板，见「五、关键坑」第 2 条 |
| 任务永远 running | `curl http://127.0.0.1:8188/queue` 看 ComfyUI 队列；显存满时见第 1 条 |
| 视频拖不动进度条 | `/files/` 的 Range 支持，已实现 |
| multipart 报 500 | `python-multipart` 没装（Starlette 只在解析时才报错） |

---

## 十一、自检命令

```bat
cd D:\ComfyUI-aki-v3\comfy-adapter
.venv\Scripts\python.exe app.py --check
```

4 步校验：模板静态 → ComfyUI 连通 → 节点类注册 → **模型文件存在性**。
全绿才算可部署。

---

**交接人**：GitHub Copilot
**接手方**：部署工作区
