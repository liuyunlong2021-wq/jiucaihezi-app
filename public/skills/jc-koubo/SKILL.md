---
name: jc-koubo
description: Use when a user asks to add subtitles, highlighted captions, or polished spoken-video text effects to a talking-head or voiceover video.
triggers:
  - 做口播
  - 上字幕
  - 加花字
  - 口播成片
  - 抖音字幕
  - 做一条口播
  - 字幕包装
---

# 口播成片

## 7步流程

### 第1步：Whisper 转录

```bash
python3 scripts/transcribe_whisper.py <视频路径> --model small
```

→ `subtitle_raw.srt`

### 第2步：AI 校准字幕

读 `subtitle_raw.srt`，逐条修正错译。东北话保留原味，AI术语统一写法。

→ `subtitle_corrected.srt`

校准规则：`references/caption-rules.md`

### 第3步：删停顿

看 `subtitle_corrected.srt` 的时间戳。两条字幕间空白超过1秒 → 那段画面裁掉（保留0.35秒）。

用 `scripts/trim_pauses.py` 的 `create_paced_media()`。产出 `*_paced.mp4` + 重映射的 `subtitle_paced.srt`。

### 第4步：ASS 常驻字幕烧录

俊雅锐宋 92px 白字，4px 黑色描边（#151210），2px 阴影，底部25%，≤11字/行语义断行，居中，去标点。

FFmpeg 烧到 `*_paced.mp4` → `*_captioned.mp4`。**这层字幕是烧死的，永远可见，不可改。**

### 第5步：AI 分析字幕 → 生成高光计划

**这是 HyperFrames 的输入数据。AI 逐条分析字幕内容，产出 `render_plan.json`。**

分析规则（详细：`references/highlight-design.md`）：

**提取密度：**

- 前15秒：每条字幕都出高光
- 15-30秒：每2-3条出1条
- 30秒后：每3-5条出1条（结尾必出）

**每条高光记录包含：**

```json
{
  "id": "hl_000",
  "start": 0.0,
  "end": 2.8,
  "highlight_text": "提炼的短文案≤16字",
  "position": "top",
  "animation": "bounceIn",
  "stickers": [
    { "type": "question", "icon": "?" },
    { "type": "spark", "icon": "✦" }
  ]
}
```

| 字段             | 说明                                              |
| ---------------- | ------------------------------------------------- |
| `start/end`      | 从 SRT 时间戳取，最长2.8秒                        |
| `highlight_text` | 从原字幕提炼，≤16字，去标点                       |
| `position`       | `"top"`(上方1/3) 或 `"bottom"`(下方1/3)，相邻交替 |
| `animation`      | 入场动画类型，见下方动画库                        |
| `stickers`       | 1-2个包装元素，见下方包装库                       |

**随机轮换机制：**

`animation` 按顺序轮换 bounceIn → fadeIn → slideLeft → elasticIn → 循环。每条高光取下一个，永不连续重复。

`stickers` 从6种包装中随机选1-2种（不重复），且与上一条高光的 sticker 至少有一种不同。

`position` 严格交替 top → bottom → top → bottom。

**产出：AI 写 `render_plan.json` 到视频同目录。**

### 第6步：HyperFrames 合成

```bash
python3 scripts/composer.py captions.json highlights.json render_plan.json <视频> <音频> output/
```

composer.py 读取 render_plan.json，生成 `output/index.html`：

```
图层（从上到下）：
  z-index 25  暗角 vignette        ← CSS radial-gradient
  z-index 24  胶片颗粒 grain        ← SVG feTurbulence 噪点
  z-index 20  包装贴纸 stickers     ← GSAP tl.set/tl.to，跟随高光
  z-index 19  高光卡片              ← GSAP tl.set/tl.to，上1/3或下1/3
  z-index 10  人物视频              ← 已烧字幕的 _captioned.mp4
  z-index 0   背景                  ← 纯色
```

**高光卡片不压人物：**

- position=top → 距顶120px，在画面上方1/3
- position=bottom → 距底700px，在画面下方1/3
- 永远不会出现在中间1/3（人脸的640-1280px区域）
- 卡片背景是半透明深色块 + 白色大字，有透明感

**HyperFrames 全部能力释放：**

- GSAP 暂停时间线 (`window.__timelines.main`) → seek-safe
- `data-track-index` 多轨道并行
- vignette + grain 内联 CSS 效果
- `<audio>` 音轨
- `hyperframes init` 项目骨架 → lint/preview/snapshot

### 第7步：渲染

```bash
cd output && npx hyperframes render -o ../成片_final.mp4
```

---

## 效果全目录

详见 `references/effects-catalog.md`。

| 类别         | 数量 | 轮换方式                                             |
| ------------ | ---- | ---------------------------------------------------- |
| 卡片入场动画 | 16种 | 1→16顺序轮换，永不重复                               |
| 卡片视觉风格 | 8种  | 每3条换一种，循环                                    |
| 包装元素     | 20种 | 按字幕内容触发匹配，选1-2种                          |
| 图层氛围效果 | 5种  | 全部默认启用（vignette/grain/shimmer/scanline/glow） |

## 按需读取

| 文件                             | 什么时候读                |
| -------------------------------- | ------------------------- | ----------- |
| `references/caption-rules.md`    | 第2步校准字幕前           |
| `references/highlight-design.md` | 第5步生成高光计划前       |
| `references/effects-catalog.md`  | 第5步选择动画/包装/风格时 | ## 按需读取 |

| 文件                             | 什么时候读          |
| -------------------------------- | ------------------- |
| `references/caption-rules.md`    | 第2步校准字幕前     |
| `references/highlight-design.md` | 第5步生成高光计划前 |

## 铁律

1. 常驻字幕 = ASS + FFmpeg 烧录，不可改
2. 高光卡片永远在上1/3或下1/3，不压人脸
3. 动画轮换：按顺序取下一个，不重复
4. 包装随机：至少与上一条有一种不同
5. 前15秒每条字幕都出高光
6. 东北话保留原味
