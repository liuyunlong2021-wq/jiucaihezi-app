# 渲染协议 v2.1

## 架构

```
视频 → [ffmpeg提取音频] → audio.aac
     → [hyperframes remove-background] → person_alpha.webm
     → [Whisper转录] → subtitle_raw.srt
     → [AI校准] → subtitle_corrected.srt
     → [pipeline.py] → captions.json + highlights.json + render_plan.json
     → [hyperframes init] → output/ (HF项目骨架)
     → [composer.py] → output/index.html (GSAP + vignette + grain)
     → [hyperframes render] → 成片_final.mp4
```

## 图层堆叠（从上到下）

| z-index | 层                     | 来源                          |
| ------- | ---------------------- | ----------------------------- |
| 25      | vignette 暗角          | CSS radial-gradient，聚焦中心 |
| 24      | grain-overlay 胶片颗粒 | CSS SVG 噪点，去塑料感        |
| 20      | 导轨字幕 (rail)        | GSAP 逐条淡入淡出，底部常驻   |
| 10      | 人物视频               | WebM VP9+alpha，遮挡下方特效  |
| 3       | 包装元素               | GSAP 类型化入场（6种）        |
| 2       | 高光卡片               | GSAP 类型化入场（4种）        |
| 0       | 背景                   | 主题色渐变                    |

## 动画引擎

- **GSAP 3.x** CDN 引入，暂停时间线 (`paused: true`)
- 注册到 `window.__timelines.main`
- HyperFrames `beginFrame` API 逐帧 seek → GSAP `tl.seek(frameTime)`

## 内联 HF 效果

| 效果          | 实现                                                                         | 来源                           |
| ------------- | ---------------------------------------------------------------------------- | ------------------------------ |
| vignette      | `radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)` | HF catalog vignette block      |
| grain-overlay | SVG feTurbulence 噪点，opacity 0.06，128px repeat                            | HF catalog grain-overlay block |
| shimmer-sweep | `@keyframes shimmer` 光扫动画                                                | HF catalog shimmer-sweep block |

## 音视频处理

- 音频：ffmpeg 从原视频提取 `-vn -acodec aac -b:a 192k`
- 去背景：`npx hyperframes remove-background` (u2net_human_seg)
- 合成中：`<audio data-track-index="4">` 嵌入音轨

## 输出文件

| 文件                           | 说明                    |
| ------------------------------ | ----------------------- |
| `subtitle_raw.srt`             | Whisper 原始（只读）    |
| `subtitle_corrected.srt`       | AI 校准后               |
| `captions.json`                | 标准化字幕              |
| `highlights.json`              | 高光候选                |
| `render_plan.json`             | 高光+包装计划（可编辑） |
| `subtitle_quality_report.json` | 术语复核报告            |
| `{name}_audio.aac`             | 提取的音频              |
| `{name}_person.webm`           | 透明人物                |
| `output/index.html`            | HF 合成                 |
| `output/hyperframes.json`      | HF 项目配置             |
| `{name}_final.mp4`             | 成片（有声）            |
