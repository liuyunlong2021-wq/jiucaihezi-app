---
name: JC-manju-shengchan
description: 剧本到成片全流程编排器。一键驱动：风格分析→角色/场景/道具资产+生图→工程手册→分镜设计+九宫格+视频prompt→TTS音色→配音绑定→视频合成。当用户说"把剧本拍成片""剧本到视频""一键生成短剧""拍这部戏""film pipeline""script to film"时使用。
triggers:
  - "剧本到成片"
  - "剧本到视频"
  - "一键生成短剧"
  - "拍这部戏"
  - "film pipeline"
  - "script to film"
  - "全流程"
  - "影视流水线"
  - "从剧本开始"
---

# Film Pipeline — 剧本到成片

## Overview

This is the top-level orchestrator for the xiaolagumanju short-drama pipeline.

It does NOT contain the logic of any stage.
It only defines the sequence, data flow, and handoff contracts between stages.

## Pipeline Stages

```
📜 剧本
 │
 ├─[1]─ JC-manju-fengge       → analysis/film-type-analysis.json
 │       选定风格、比例、节奏
 │
 ├─[2]─ JC-manju-juese        → analysis/character-analysis.json
 │       角色分析 + Banana生图prompt     + prompts/banana-character-prompts.json
 │
 ├─[3]─ JC-manju-changjing    → analysis/scene-analysis.json
 │       场景分析 + Banana生图prompt     + prompts/banana-scene-prompts.json
 │
 ├─[4]─ JC-manju-daoju        → analysis/prop-analysis.json
 │       道具分析 + Banana生图prompt     + prompts/banana-prop-prompts.json
 │
 ├─[5]─ JC-manju-chaijie      → analysis/engineering-book.json
 │       剧本→物料单元拆解
 │
 ├─[6]─ JC-manju-fenjing      → analysis/shot-design.json
 │       分镜 + 九宫格 + 视频prompt     + prompts/banana-grid-shot-prompts.json
 │                                      + prompts/grok-video-prompts.json
 │                                      + prompts/veo-video-prompts.json
 │                                      + prompts/ltx-video-prompts.json
 │
 ├─[*]─ JC-meitichuangzuo      → 媒体创作引擎
 │       NewAPI 全渠道路由（T8/RH/火山），提交/轮询/下载
 │
 ├─[*]─ banana-storyboard-edit-prompt → 分镜面板修复
 │       已有 storyboard 图片局部修图，保连续性
 │
 ├─[7]─ JC-manju-yinse        → prompts/tts-voice-design.json
 │       角色→TTS音色设计
 │
 ├─[8]─ JC-manju-peiyin       → 对话镜头 + 配音绑定
 │       需要首帧图 + 音频文件
 │
 └─[9]─ JC-manju-hecheng      → 🎬 成片
         拼接 + 字幕
```

## Execution Order

### Phase 1: 风格锁定 (必须先跑)

1. **JC-manju-fengge** — 输入剧本，输出风格选项让用户选择。这是所有后续阶段的源头。

### Phase 2: 资产分析 (可并行)

2. **JC-manju-juese** — 依赖 Phase 1 的 `ratio_design` + `style_design`
3. **JC-manju-changjing** — 同上
4. **JC-manju-daoju** — 同上

### Phase 3: 剧本拆解

5. **JC-manju-chaijie** — 将剧本转为物料单元，供分镜使用

### Phase 4: 分镜与生图 (核心)

6. **JC-manju-fenjing** — 依赖 Phase 1 风格 + Phase 3 工程手册。输出分镜 + 九宫格 + 视频 prompt

### Phase 5: 配音

7. **JC-manju-yinse** — 设计每个角色的 TTS 音色

### Phase 6: 合成

8. **JC-manju-peiyin** — 对话镜头绑定配音（需要 Phase 4 的首帧图 + Phase 5 的音色 + Phase 7 的音频）
9. **JC-manju-hecheng** — 拼接所有镜头 + 添加字幕 → 成片

## Data Flow Contract

每个阶段的输出目录约定：

```
project/
  analysis/
    film-type-analysis.json      ← [1]
    character-analysis.json      ← [2]
    scene-analysis.json          ← [3]
    prop-analysis.json           ← [4]
    engineering-book.json        ← [5]
    shot-design.json             ← [6]
  prompts/
    banana-character-prompts.json ← [2]
    banana-scene-prompts.json     ← [3]
    banana-prop-prompts.json      ← [4]
    banana-grid-shot-prompts.json ← [6]
    grok-video-prompts.json       ← [6]
    veo-video-prompts.json        ← [6]
    ltx-video-prompts.json        ← [6]
    tts-voice-design.json         ← [7]
```

## 使用方式

```commands
一键拍片: 请用 Film Pipeline 帮我把剧本拍成片：
剧本：[粘贴完整剧本]

按阶段逐步执行，每完成一个阶段向我确认后再继续。
```

```commands
继续流水线: 从当前阶段继续执行 Film Pipeline
```

```commands
单阶段执行: 只跑 Film Pipeline 的第 [N] 阶段：[阶段名]
```

## Constraints

1. 每个阶段完成后必须向用户确认输出摘要，再进入下一阶段。
2. Phase 2 的三个资产分析可以提示用户是否并行执行。
3. 如果上游阶段输出缺失，停止并报告，不要猜测。
4. 风格选择（Phase 1）必须等用户确认后才能进入 Phase 2。
5. 这是 xiaolagumanju 短剧管线的编排器，不适用于其他项目类型。
