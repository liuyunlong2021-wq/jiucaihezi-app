---
name: voice-bound-shot-video
description: Use when generating a single talking-head or dialogue shot from a first frame, a minimal motion tag, a clean voice audio file, and dialogue text. This skill is for voice-locked shot rendering in the xiaolagumanju pipeline.
---

# Voice Bound Shot Video

## Overview

把单个镜头的首帧图、极简动作提示、干净人声音频、对白文本，交给指定的 RunningHub AI 应用，生成一个音色和说话内容绑定的单镜头视频。

这个 skill 的定位是：

- 单镜头视频生成器
- 对白镜头专用渲染器
- 声音绑定的视频生成节点

它不负责整片分镜选择，不负责全片拼接，也不负责自动决定哪个镜头该走这条链路。

## When to Use

适用于这些镜头：

- 单人近景或中近景说话
- 单人坐着说话、站着说话、缓慢走动说话
- 角色出镜且说话内容需要和指定音频绑定
- 口型、音色、说话节奏比大动作更重要的镜头

不建议用于这些镜头：

- 激烈动作镜头
- 多人同时说话
- 远景说话镜头
- 强遮挡、背影、极侧脸镜头
- 嘴型并不关键的环境镜头或反应镜头

## Input

输入建议通过一个 request json 统一描述，至少包含：

- `shot_id`
- `first_frame_path`
- `voice_audio_path`
- `dialogue_text`
- `width`
- `height`

同时必须提供下面二选一：

- `motion_tag`
- `motion_prompt_cn`

可选字段：

- `character_id`
- `speaker_name`
- `project_id`
- `notes`

## Output

建议落盘这些文件：

- `shots/<shot_id>/input/request.json`
- `shots/<shot_id>/outputs/<shot_id>_voice_bound.mp4`
- `shots/<shot_id>/outputs/response.json`
- `shots/<shot_id>/manifests/voice_bound_result.json`

## Core Principles

1. 提示词必须极简，只表达说话主体；如果剧本没有明确要求动作，就不要额外补动作。
2. 默认不提示坐、站、走等姿态信息，只写 `男人在说话`、`女人在说话` 这一级别。
3. 只有当剧本或镜头控制明确写出 `走着说`、`边走边说` 之类的动作要求时，才允许加入动作描述。
4. 首帧图负责角色外观、构图、服装和背景控制。
5. 音频优先使用干净人声，不建议直接使用混有 BGM 和环境音的最终混音。
6. `dialogue_text` 必须和音频语义一致，避免明显错字或不一致。
7. 此 skill 只负责生成单镜头视频，不负责镜头选择、批量调度和成片拼接。
8. 若 `motion_tag` 和 `motion_prompt_cn` 冲突，以标准化后的 `motion_prompt_cn` 为准。

## Motion Tag Standard

第一版建议把 `无动作说话` 作为默认入口：

- `male_talk_neutral`
- `female_talk_neutral`
- `male_talk_walk_slow`
- `female_talk_walk_slow`
- `male_talk_emotional_low`
- `female_talk_emotional_low`

推荐映射：

- `male_talk_neutral` -> `男人在说话`
- `female_talk_neutral` -> `女人在说话`
- `male_talk_walk_slow` -> `男人一边缓慢走动一边说话`
- `female_talk_walk_slow` -> `女人一边缓慢走动一边说话`
- `male_talk_emotional_low` -> `男人在说话，情绪低压但克制`
- `female_talk_emotional_low` -> `女人在说话，情绪低压但克制`

## Request Shape

参考 `request.schema.json`。

最小请求示例：

```json
{
  "shot_id": "shot_001",
  "first_frame_path": "shots/shot_001/input/first_frame.png",
  "voice_audio_path": "shots/shot_001/input/voice_clean.wav",
  "dialogue_text": "你终于回来了。",
  "motion_tag": "male_talk_stand_calm",
  "width": 736,
  "height": 1280
}
```

## Result Shape

参考 `result.schema.json`。

最小结果示例：

```json
{
  "shot_id": "shot_001",
  "render_route": "voice_bound_shot_video",
  "status": "success",
  "input": {
    "first_frame": "shots/shot_001/input/first_frame.png",
    "voice_audio": "shots/shot_001/input/voice_clean.wav",
    "dialogue_text": "你终于回来了。",
    "motion_tag": "male_talk_stand_calm",
    "motion_prompt_cn": "男人站着说话，情绪克制",
    "width": 736,
    "height": 1280
  },
  "output": {
    "video": "shots/shot_001/outputs/shot_001_voice_bound.mp4"
  },
  "runtime": {
    "provider": "runninghub",
    "workflow_type": "voice_bound_video_app",
    "app_url": "https://www.runninghub.cn/ai-detail/2036019863617015809"
  }
}
```

## Suggested Execution Flow

1. 读取 request json。
2. 检查首帧图、音频文件、对白文本、宽高是否齐全。
3. 若只提供 `motion_tag`，先映射出标准 `motion_prompt_cn`。
4. 组装 RunningHub AI 应用请求。
5. 提交任务并等待结果。
6. 把视频、原始响应、标准结果 manifest 一并落盘。
7. 返回标准结果路径，供主链继续读取。

## Constraints

1. 只处理单镜头。
2. 提示词必须短，不能写成长段视觉描述。
3. 优先使用 clean voice 音频。
4. 输出 manifest 必须能被主链直接读取。
5. 如果镜头明显不适合此链路，应在结果里标记 `status: unsupported` 或 `status: failed`，并写明原因。
