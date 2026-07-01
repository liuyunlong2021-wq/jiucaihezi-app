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

如果图片在对话中生成但未落盘：

```bash
python3 scripts/extract_latest_image_from_session.py --out-dir output/panorama --name <slug>
```

## 关键约束

- **2:1 宽高比是硬要求**：等距柱状投影必须是 2:1（如 4096×2048、2048×1024）
- **左右边缘无缝**：prompt 中必须明确要求左右边缘无缝衔接
- **避免普通镜头语言**：不要写特写、浅景深、单一正面构图——这些在 360 环景中没有意义
- **降级说明**：如果源图不是真正的 360 环景（只是普通广角），规格化只能改比例不能变几何，最终回复要诚实说明

## 与 multi-style-image-generator 的关系

`multi-style-image-generator` 是完整的「风格化生图 + 360 环景」skill。本 skill 是对其中 360 环景部分的精简独立版：

- 只想「把这张图变成 360 环景」→ 用本 skill
- 想「原神风格 + 360 环景」→ 用 `multi-style-image-generator`

## 输出模式

- 给出环景图路径 + 预览 HTML 路径
- 如果用户要求动态效果，也给出动态预览 HTML
- 如果无法落盘，诚实说明并建议走 CLI fallback

## 指令

```commands
生成一张 360 度环景图：[场景描述]
把这张图转成 360 环景预览：[图片路径]
生成动态 360 环景预览（巡游+粒子）：[图片路径]
从对话中提取最新图片并生成 360 环景预览
把这张非 2:1 图片规格化为环景比例：[图片路径]
```
