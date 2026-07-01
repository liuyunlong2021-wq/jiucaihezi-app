---
name: 360环景工作流
description: 360° 等距柱状投影全景图生成与预览。输入任意图片或 prompt → 输出 2:1 环景图 + 交互式 WebGL 预览 HTML + 动态增强版（巡游/粒子/云雾）。与 JC-meitichuangzuo 媒体引擎配合：后者管生成，本 skill 管环景预览。
triggers:
  - 360环景
  - 360全景
  - 全景图
  - VR全景
  - 等距柱状投影
  - 环景照
  - equirectangular
  - 环景预览
  - 360 panorama
  - 交互全景
---

# 360° 环景工作流

把任意图片或 AI 生成的图像变成可交互的 360° 全景预览。

## 自带脚本

| 脚本 | 用途 |
|------|------|
| `scripts/create_panorama_viewer.py <image> --embed-image` | 生成全屏 WebGL 交互式 360 预览 HTML |
| `scripts/create_dynamic_panorama_viewer.py <image>` | 生成动态增强版（自动巡游 + 粒子 + 云雾 + FOV 呼吸） |
| `scripts/normalize_equirectangular_aspect.py <image>` | 将非 2:1 图片规格化为 2:1 等距柱状图 |
| `scripts/extract_latest_image_from_session.py --out-dir <dir>` | 从当前 session 提取最新生成图片落盘 |

## 工作流

### 1. 生成环景图

如果用户还没有环景图，先生成一张。最终 prompt 必须包含：

```
360度等距柱状投影图像。2:1 宽高比，例如 4096x2048 或 2048x1024，左右边缘无缝衔接。
```

配合 JC-meitichuangzuo 媒体引擎：
```bash
python3 public/skills/JC-meitichuangzuo/scripts/jc_media.py run \
  --host http://127.0.0.1:8789 \
  --model <模型名> \
  --params "prompt=360度等距柱状投影图像。2:1宽高比4096x2048，左右边缘无缝衔接。<场景描述>"
```

### 2. 规格化比例

生成的图片如果不是 2:1，先规格化：

```bash
python3 scripts/normalize_equirectangular_aspect.py <图片路径>
# 输出: <stem>-2x1.png
```

### 3. 生成交互预览

```bash
# 静态交互预览（WebGL 方向采样）
python3 scripts/create_panorama_viewer.py <2:1图片路径> --embed-image

# 动态增强版（巡游 + 粒子 + 云雾 + 光晕）
python3 scripts/create_dynamic_panorama_viewer.py <2:1图片路径>
```

### 4. 从 session 提取图片

如果图片在对话中生成但未落盘，运行提取脚本。该脚本同时查找两类图片载荷：
`data:image/...;base64,...` 形式的 data URI，以及图像生成事件中 `payload.result` 里的裸 PNG/JPEG/WebP/GIF base64。

```bash
python3 scripts/extract_latest_image_from_session.py --out-dir output/panorama --name <slug>
```

**提取排查**：如果脚本没有找到图片但对话里确实刚生成了图，先在当前 session JSONL 中查真实图片头：
- PNG 前缀：`iVBORw0KGgo`
- JPEG 前缀：`/9j/`
- WebP 前缀：`UklGR`
- GIF 前缀：`R0lGOD`

若命中 `payload.result` 这类裸 base64 字段，可直接 base64 解码为图片。不要把文档里的 `data:image/...;base64,...` 占位文本当作真实图片。

## 关键约束

- **2:1 宽高比是硬要求**：等距柱状投影必须是 2:1（如 4096×2048、2048×1024）
- **左右边缘无缝**：prompt 中必须明确要求左右边缘无缝衔接
- **避免普通镜头语言**：不要写特写镜头、浅景深、单一正面构图、裁切主体——这些在 360 环景中没有意义
- **比例规格化的局限**：规格化只能保证文件比例正确，不能把普通广角图变成几何上真实的 360 环景。如有明显非全景内容，最终回复要简短说明"已规格化为 2:1，但源图可能仍非严格无缝环景"
- **降级**：不要把"对话里能看到图片"等同于"session 里一定有可提取图片载荷"。如果既没有本地图片路径，也无法从 session 日志提取图片，就不要假装已创建交互预览。直接说明当前没有可落盘数据，建议走 CLI/API fallback

## 与 multi-style-image-generator 的关系

`multi-style-image-generator` 是完整的「风格化生图 + 360 环景」skill。本 skill 是对其中 360 环景部分的精简独立版：

- 只想「把这张图变成 360 环景」→ 用本 skill
- 想「原神风格 + 360 环景」→ 用 `multi-style-image-generator`

## 输出模式

- **静态预览**：给出 2:1 环景图路径 + 交互预览 HTML 路径。在桌面环境可用浏览器工具时，也可以直接打开该 HTML
- **动态增强**：用户要求"动态、动起来、自动巡游、云雾粒子"等时，运行 `create_dynamic_panorama_viewer.py` 生成动态增强版 HTML。最终说明它不是视频，建筑和主体不会真实变形，只是实时特效增强
- **无法落盘**：诚实说明当前只能展示静态图，建议走 CLI/API fallback 确保落盘和 360 HTML 生成

## 指令

```commands
生成一张 360 度环景图：[场景描述]
把这张图转成 360 环景预览：[图片路径]
生成动态 360 环景预览（巡游+粒子）：[图片路径]
从对话中提取最新图片并生成 360 环景预览
把这张非 2:1 图片规格化为环景比例：[图片路径]
```
