---
name: JC-meitichuangzuo
description: 韭菜盒子媒体创作引擎 — 统一的图片/视频/音频生成执行层。接收上游 skill 产出的完整提示词和模型选择，通过 NewAPI 全渠道路由（T8/RH/火山）提交任务、轮询、下载结果。程序化调用，无交互菜单。
triggers:
  - "生成图片"
  - "生成视频"
  - "生成音频"
  - "jc_media"
  - "媒体生成"
  - "媒体创作"
  - "视频编辑"
  - "图生视频"
  - "文生视频"
  - "图片生成"
  - "查询模型"
  - "批量生成"
---

# 韭菜盒子媒体创作引擎

## 定位

这是 film pipeline 的**执行层**，不是对话层。

上游 skill（`film-shot-design`、`ltx-video-action`、`banana-character-prompt` 等）产出完整提示词和模型选择后，交给本 skill 执行。本 skill 不做模型推荐、不做提示词优化、不做对话交互。

## 调用方式

### 模式 1：提交 + 等待（默认，单任务）

```bash
python3 {baseDir}/scripts/jc_media.py run \
  --type image|video|audio \
  --model <model_id> \
  --prompt "完整提示词" \
  --input ./ref.png \
  --output ./result.png
```

### 模式 2：仅提交（不等待，用于批量并发）

```bash
# 连续提交 10 个任务，每个瞬间返回 task_id
python3 scripts/jc_media.py submit --type image --model rh-pro-image --prompt "猫" 
# → {"status":"submitted","task_id":"abc123","model":"rh-pro-image"}

python3 scripts/jc_media.py submit --type image --model rh-pro-image --prompt "狗"
# → {"status":"submitted","task_id":"def456","model":"rh-pro-image"}
```

### 模式 3：批量轮询 + 下载

```bash
python3 scripts/jc_media.py poll \
  --task-ids "abc123,def456,ghi789" \
  --output-dir ./output/
```

### 模式 4：检查连接

```bash
python3 scripts/jc_media.py check
# → rh-adapter: {"status":"ok","message":"rh-adapter ready, 32 models",...}
# → NewAPI:   {"status":"ok","message":"NewAPI ready, 68 models",...}
```

### 模式 5：模型发现（推荐先跑）

```bash
# 列出全部可用模型（按类型筛选）
python3 scripts/jc_media.py list                    # 全部
python3 scripts/jc_media.py list --type video       # 只看视频模型
# → {"status":"ok","count":13,"models":[{"id":"rh-video-v31-fast","label":"全能视频V3.1-Fast","type":"video","params":["prompt","ratio","resolution",...]},...]}

# 查看某个模型的参数规格
python3 scripts/jc_media.py info rh-grok-video-edit
# → {"status":"ok","model":{"id":"rh-grok-video-edit","label":"Grok Video 视频编辑","type":"video","params":[{"name":"prompt","type":"STRING",...}]}}
```

### 模式 6：传模型参数

```bash
python3 scripts/jc_media.py run \
  --type video --model rh-ltx23-text-video \
  --prompt "..." --output ./out.mp4 \
  --params ratio=16:9 duration=5 resolution=720p
```

### 模式 7：视频编辑（传参考视频）

```bash
python3 scripts/jc_media.py run \
  --type video --model rh-grok-video-edit \
  --prompt "添加墨镜" --input-video "https://..." \
  --output ./edited.mp4
```

## 模型 ID 速查

> 来源：rh-adapter `mapping.py`，与 `jc_media.py list` 输出同步维护。
> **优先使用 `--list` 动态获取**，下表仅作离线速查。

### 图片 (--type image) — 全部 RH

| 中文名 | model_id |
|--------|----------|
| 全能图片PRO | `rh-pro-image` |
| 全能图片V2 | `rh-image-v2` |
| GPT2.0 图生图 | `rh-gpt2-image` |
| GPT2.0 文生图 | `rh-gpt2-text` |
| Midjourney V8.1 | `rh-midjourney-v81` |
| Grok Image 文生图 | `rh-grok-image-text` |
| Grok Image 图生图 | `rh-grok-image-image` |
| FLUX Klein 9B 编辑 | `rh-flux-klein-edit` |
| FLUX Klein 9B 文生图 | `rh-flux-klein-text` |
| FLUX Klein 9B LoRA | `rh-flux-klein-lora` |
| Z Image Turbo | `z-image-turbo` |

### 视频 (--type video) — RH + 火山

| 中文名 | model_id | 渠道 |
|--------|----------|------|
| **LTX 2.3 图生视频** | `rh-ltx23-image-video` | RH ★ |
| **LTX 2.3 文生视频** | `rh-ltx23-text-video` | RH ★ |
| 全能视频V3.1 Fast | `rh-video-v31-fast` | RH |
| Grok Video 文生视频 | `rh-grok-text-video` | RH |
| Grok Video 图生视频 | `rh-grok-image-video` | RH |
| **Grok Video 视频编辑** | `rh-grok-video-edit` | RH ★ 需传 `--input-video` |
| 极速数字人 | `rh-aiapp-fast-digital-human` | RH AI App |
| 数字人 | `rh-aiapp-digital-human` | RH AI App |
| 我是导演 | `rh-aiapp-director` | RH AI App |
| Seedance 2.0 | `doubao-seedance-2-0-260128` | 火山（最高品质） |
| Seedance 2.0 Fast | `doubao-seedance-2-0-fast-260128` | 火山（兼顾成本速度） |
| Seedance 2.0 Mini | `doubao-seedance-2-0-mini-260615` | 火山（最低成本） |

### 音频 (--type audio) — 全部 RH

| 中文名 | model_id |
|--------|----------|
| Suno v5.5 一句话成歌 | `rh-suno-v55-single` |
| Suno v5.5 自定义成歌 | `rh-suno-v55-custom` |
| Suno 创作歌词 | `rh-suno-lyrics` |
| 语音合成HD | `rh-speech-hd` |
| 语音合成快速 | `rh-speech-turbo` |
| 音乐生成 | `rh-music` |
| 声音克隆 | `rh-voice-clone` |
| 声音克隆 AI App | `rh-aiapp-voice-clone` |
| 设计语音 | `rh-aiapp-voice-design` |

### film pipeline 常用映射

| 上游 Skill | 产出 | → 本 skill 的 --model |
|------------|------|----------------------|
| `banana-character-prompt` | 角色图 prompt | `rh-pro-image` / `rh-image-v2` |
| `banana-scene-prompt` | 场景图 prompt | `rh-pro-image` |
| `banana-prop-prompt` | 道具图 prompt | `rh-pro-image` |
| `ltx-video-action` | LTX 视频 prompt | `rh-ltx23-image-video` |
| `grok-video-prompt` | Grok 视频 prompt | `rh-grok-image-video` |
| `grok-video-prompt` | Grok 视频编辑 | `rh-grok-video-edit` (需 `--input-video`) |
| `qwen-tts-voice-design` | TTS 参数 | `rh-speech-hd` / `rh-speech-turbo` |

## CRITICAL RULES

1. **ALWAYS use the script** — never curl API directly.
2. **先 `--list` 再选模型** — 模型可能新增/下线，不要凭记忆硬编码。
3. **`--info <model>` 看参数** — 不同模型支持的 ratio/resolution/duration 不同。
4. **上游已决定模型** — 不展示模型菜单，直接用 `--model` 传入。
5. **ALWAYS JSON 输出** — 输出机器可读 JSON，供上游解析。
6. **下载到指定路径** — `--output` 必须是指定文件路径。

## JSON 输出格式

成功:
```json
{"status": "ok", "files": ["/path/to/result.png"], "cost": 0.5, "duration": 14}
```

失败:
```json
{"status": "error", "error": "INSUFFICIENT_BALANCE", "message": "余额不足"}
```

## 鉴权

脚本按以下顺序查找 Key：
1. `--api-key` 命令行参数
2. `JC_API_KEY` 环境变量
3. 占位 Key `jc-auto`（rh-adapter 代理模式，仅本地测试）

生产环境由韭菜盒子桌面端在启动 OpenCode 时注入 `JC_API_KEY`。

## 代理模式 vs 直连模式

| 模式 | JC_MEDIA_HOST | Key | 可用渠道 |
|------|--------------|-----|---------|
| 本地测试 | `http://127.0.0.1:8789` | jc-auto | RH（rh-adapter） |
| 生产 | `https://api.jiucaihezi.studio` | sk-xxx | RH + 火山（NewAPI 路由） |

> ⚠️ 火山 Seedance（`seedance-2-0`、`seedance-2-0-pro`）**必须走生产模式**（NewAPI 路由），本地 rh-adapter 不支持。

## 指令

```commands
查询可用模型: 请用媒体创作引擎查询可用模型：
jc_media list [--type image|video|audio]
先列出可用模型，再选合适的。
查看模型参数: 请用媒体创作引擎查看模型参数：
jc_media info [model_id]
确认模型支持的 ratio/resolution/duration 等参数后再生成。
生成图片: 请用媒体创作引擎帮我生成图片：
提示词：[完整画面描述]
模型：[model_id，先 jc_media list --type image 查询]
参考图：[可选，图片路径或URL]
参数：[可选，如 --params ratio=16:9 resolution=2k]
输出路径：[文件路径]
图生图: 请用媒体创作引擎帮我在参考图基础上生成新图：
提示词：[画面修改描述]
参考图：[图片路径]
模型：[如 rh-grok-image-image / rh-flux-klein-edit]
输出路径：[文件路径]
生成视频: 请用媒体创作引擎帮我生成视频：
提示词：[完整视频描述]
模型：[model_id，先 jc_media list --type video 查询]
参数：[如 --params duration=5 ratio=16:9]
输出路径：[文件路径]
图生视频: 请用媒体创作引擎帮我把这张图生成视频：
提示词：[动作描述]
参考图：[图片路径]
模型：[如 rh-ltx23-image-video / rh-grok-image-video / rh-video-v31-fast]
参数：[如 --params duration=4 motion_bucket_id=127]
输出路径：[文件路径]
视频编辑: 请用媒体创作引擎帮我编辑视频：
提示词：[编辑描述，如添加墨镜/转漫画风格]
参考视频URL：[视频公网URL]
模型：[rh-grok-video-edit]
参数：[可选，如 --params ratio=16:9]
输出路径：[文件路径]
注意：--input-video 必须是公网可访问的URL。
生成音频: 请用媒体创作引擎帮我生成音频：
提示词/歌词：[内容]
模型：[model_id，先 jc_media list --type audio 查询，如 rh-suno-v55-single / rh-speech-hd]
输出路径：[文件路径]
批量并发生成: 请用媒体创作引擎批量生成：
1. 每个任务用 submit 模式提交：
   jc_media submit --type [image|video|audio] --model xxx --prompt "..." --params ...
   记录返回的 task_id
2. 全部提交后批量轮询：
   jc_media poll --task-ids "id1,id2,id3" --type [image|video|audio] --output-dir ./output/
检查连接: 请用媒体创作引擎检查连接状态：
jc_media check [--host http://127.0.0.1:8789|https://api.jiucaihezi.studio]
```
