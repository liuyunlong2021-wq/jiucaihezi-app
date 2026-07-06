# CLAUDE.md — JC-manju-skills

## 这是什么

韭菜盒子短剧生产全流程 Skill 管线。12 个 Skill，覆盖「剧本 → 风格分析 → 角色/场景/道具资产 + Banana 生图 → 工程手册 → 分镜 + 九宫格 + Grok/Veo/LTX 视频 prompt → TTS 音色 → 配音绑定 → 视频合成」全链路。

## 目录结构

```
JC-manju-skills/
├── JC-manju-shengchan/        # 🎬 全流程编排器（入口 Skill）
├── JC-manju-fengge/           # 风格分析（比例/色调/节奏）
├── JC-manju-juese/            # 角色资产 + Banana Pro 生图 prompt
├── JC-manju-changjing/        # 场景空镜主镜头 + Banana Pro 生图 prompt
├── JC-manju-daoju/            # 道具多角度资产 + Banana Pro 生图 prompt
├── JC-manju-chaijie/          # 剧本 → 物料单元工程手册
├── JC-manju-fenjing/          # 分镜设计 + 3×3 九宫格 + Grok/Veo/LTX 视频 prompt
├── JC-manju-yinse/            # Qwen TTS 角色音色设计
├── JC-manju-peiyin/           # 对话镜头绑定配音（口型同步）
├── JC-manju-hecheng/          # 视频拼接 + 字幕合成
├── JC-meitichuangzuo/         # 媒体创作引擎（NewAPI 全渠道路由 T8/RH/火山）
├── banana-storyboard-edit-prompt/  # 分镜面板局部修图
├── assets/                    # logo.svg + guanfangweixin.jpg
├── README.md
├── LICENSE                    # CC BY-NC 4.0
└── CLAUDE.md                  # 本文件
```

## Skill 规范

每个 Skill 目录结构：
```
Skill名/
├── SKILL.md          # 必须：YAML frontmatter (name/description/triggers) + Markdown 正文
├── references/       # 可选：参考资料
└── scripts/          # 可选：执行脚本
```

### SKILL.md 格式

```yaml
---
name: JC-manju-xxx
description: 中文描述，说明做什么、什么时候触发
triggers:
  - "触发词1"
  - "触发词2"
---
# 标题
## 正文
```

## 管线数据流

```
film-type-analysis.json → 所有下游继承 ratio_design + style_design
character-analysis.json → banana prompt → 生图
scene-analysis.json      → banana prompt → 生图
prop-analysis.json       → banana prompt → 生图
engineering-book.json    → shot-design.json → grid + video prompts
tts-voice-design.json    → voice-bound-shot → video-composer → 成片
```

## 开发规则

1. **每个 Skill 独立可触发**：用户可以单独调用任意 Skill，不只走编排器
2. **SKILL.md 优先中文**：面向国内用户，description 和正文都中文
3. **改名规则**：全部 `JC-manju-拼音` 格式
4. **新增 Skill**：先在此文件更新目录结构，再更新 README.md 的 Skill 清单
5. **许可证**：CC BY-NC 4.0，商用需授权
6. **来源标注**：如果用第三方 Skill 改的，在对应 SKILL.md 中标注来源
