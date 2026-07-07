---
name: JC-manju-skills
description: 韭菜盒子短剧生产全流程 Skill 管线——剧本到成片一键编排。覆盖：风格分析→角色/场景/道具资产+生图→工程手册→分镜设计+九宫格+视频prompt→TTS音色→配音绑定→视频合成。可从任意环节切入，说"帮我做分镜"即从分镜开始。当用户说"短剧""漫剧""剧本到成片""一键生成短剧""分镜""配音""角色设计""场景设计""道具设计""视频合成""剧本拆解""音色设计""故事板""媒体生成""拍这部戏""film pipeline""全流程"时使用。
triggers:
  - "短剧"
  - "漫剧"
  - "剧本到成片"
  - "剧本到视频"
  - "一键生成短剧"
  - "拍这部戏"
  - "film pipeline"
  - "script to film"
  - "全流程"
  - "影视流水线"
  - "从剧本开始"
  - "分镜"
  - "配音"
  - "角色设计"
  - "场景设计"
  - "道具设计"
  - "视频合成"
  - "剧本拆解"
  - "音色设计"
  - "故事板"
  - "媒体生成"
  - "动画制作"
---

# 短剧生产管线

## 使用方式

**可从任意环节切入。** 说一句就能定位：

| 用户说什么 | 进入哪个环节 |
|-----------|-------------|
| "剧本到成片""一键生成短剧""拍这部戏" | 全流程一键编排 |
| "先看看什么风格合适" | 阶段1：风格分析 |
| "分析这个剧本的角色" | 阶段2：角色分析 |
| "设计场景" | 阶段2：场景分析 |
| "分析道具" | 阶段2：道具分析 |
| "拆解剧本" | 阶段3：工程手册 |
| "做分镜/镜头设计" | 阶段4：分镜设计 + 九宫格 + 视频 prompt |
| "设计音色" | 阶段5：音色设计 |
| "配音视频/对口型" | 阶段6：配音绑定 |
| "合成视频" | 阶段7：视频合成 |
| "修改某张故事板图" | 辅助：banana 修图 |
| "生成图片/视频/音频" | 辅助：JC-meitichuangzuo 媒体引擎 |

## 完整管线

```
📜 剧本
 │
 ├─[1]─ 风格分析 → analysis/film-type-analysis.json
 │       选定风格、比例、节奏
 │
 ├─[2]─ 角色分析 → analysis/character-analysis.json
 │       场景分析 → analysis/scene-analysis.json
 │       道具分析 → analysis/prop-analysis.json
 │       （以上三者可并行，依赖阶段1的 ratio_design + style_design）
 │
 ├─[3]─ 工程手册 → analysis/engineering-book.json
 │       剧本→物料单元拆解（对话/动作链/reveal/insert/reset/reaction）
 │
 ├─[4]─ 分镜设计 → analysis/shot-design.json
 │       九宫格故事板 + Grok/Veo/LTX 视频 prompt
 │
 ├─[5]─ 音色设计 → prompts/tts-voice-design.json
 │
 ├─[6]─ 配音绑定 → 对话镜头（需首帧图 + 音频文件）
 │
 └─[7]─ 视频合成 → 🎬 成片（拼接 + 字幕）

辅助:
 ├─[*]─ JC-meitichuangzuo → NewAPI 全渠道路由（T8/RH/火山），提交/轮询/下载
 └─[*]─ banana-storyboard-edit-prompt → 故事板面板局部修图，保连续性
```

## 执行顺序

### Phase 1: 风格锁定（必须先跑）

风格分析 — 输入剧本，输出风格选项让用户选择。这是所有后续阶段的源头。

### Phase 2: 资产分析（可并行）

角色/场景/道具分析。依赖 Phase 1 的 ratio_design + style_design。

### Phase 3: 剧本拆解 → Phase 4: 分镜 → Phase 5: 音色 → Phase 6: 配音 → Phase 7: 合成

各阶段串行，上阶段输出为下阶段输入。`JC-meitichuangzuo` 是底层媒体引擎，负责实际调用 NewAPI 生成图片/视频/音频，其余阶段发 prompt 给它执行。
