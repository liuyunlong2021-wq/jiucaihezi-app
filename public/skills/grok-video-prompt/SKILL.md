---
name: grok-video-prompt
description: Use when converting shot-design results or storyboard first-frame beats into Grok-friendly prompts for `rhart-video-g/image-to-video`, `xai/grok-imagine/image-to-video`, or 全能视频G in the current flashxiaolagu mainline. This skill is assembly-only and enforces the tested Chinese segmented timeline format with `cut` and the fixed ending `无音乐，无音效，无字幕`.
---

# Grok Video Prompt

## Overview

This skill converts `shot-design.json` into structured Grok image-to-video prompt data.

It is not a creative rewrite stage.

Its job is only:

1. read shot-design
2. keep one first-frame image per shot
3. choose a legal Grok endpoint configuration
4. translate the beat into the tested Grok prompt format

## Authority

Follow:

- `${OPENCLAW_HOME:-~/.openclaw}/agents/flashxiaolagu制作/production-optimization-spec.md`
- current project `analysis/shot-design.json`

If there is a conflict, the current flash spec and the actual endpoint limits win.

## Input

- `analysis/film-type-analysis.json`
- `analysis/shot-design.json`
- `prompts/banana-grid-shot-prompts.json`
- split storyboard frame image paths

## Output

- `prompts/grok-video-prompts.md`
- `prompts/grok-video-prompts.json`

## Hard Endpoint Constraints

Current target endpoint:

- `rhart-video-g/image-to-video`

Hard limits:

- only `image_to_video`
- only one input image
- `duration`: `6s` / `10s` / `15s`
- `aspectRatio`: `2:3` / `3:2` / `1:1`
- `resolution`: `720P` / `1080P`

If the source asks for an unsupported value, round to the nearest safe supported value and record why.

For current flash mainline portrait storyboard frames, prefer:

- `aspectRatio: 2:3`
- `resolution: 720P`
- `duration: 6s` by default

Only move up to `10s` or `15s` when the shot clearly needs a longer speaking beat or a longer emotional turn.

## Core Rules

### 1. Assembly only

Do not invent:

- new actions
- new dialogue
- new camera moves
- new characters
- new scene geography

### 2. Single-frame logic only

This route is first-frame-only.

- use `first_frame_image`
- do not require `last_frame_image`
- do not write prompts that depend on a far-away ending pose the first frame cannot support

If `shot-design.json` says the original shot was better suited for start-end generation, compress it into a smaller first-frame-driven motion beat instead of forcing a fake end-state.

### 3. Keep the user's tested Grok format

Every final prompt must use this structure:

```text
根据参考图生成视频：
0-4 秒
[beat 1]

cut
4-6 秒
[beat 2]

无音乐，无音效，无字幕
```

Rules:

- `根据参考图生成视频：` must be the first line
- each time range stays on its own line
- each beat follows directly under its time range
- `cut` stays on its own line
- the final line stays exactly `无音乐，无音效，无字幕`

### 4. Beat writing rules

Write in Chinese.

Each beat should usually be only 1-2 short sentences.

Prefer direct subject-action phrasing anchored to the visible first frame.

If there is spoken dialogue:

- write it as `角色 + 情绪 + 的说：台词`
- preserve the spoken line itself
- do not translate Chinese dialogue into English

If the source line is already English, keep it in English.

If the shot has no dialogue, do not add any.

If the shot has both action and dialogue, keep the action brief and let the speech carry the beat.

### 5. Segment rhythm follows the selected duration

Recommended default splits:

- `6s`: `0-4` -> `cut` -> `4-6`
- `10s`: `0-3` -> `cut` -> `3-7` -> `cut` -> `7-10`
- `15s`: `0-4` -> `cut` -> `4-8` -> `cut` -> `8-12` -> `cut` -> `12-15`

You may adjust the boundaries slightly if the shot clearly needs a longer hold or a faster snap, but the final block must end exactly at the chosen duration.

### 6. Motion scale rule

Because Grok only gets one reference image, prefer:

- reaction
- gaze shift
- mouth movement
- hand movement
- shoulder tension
- small lean
- small forward or backward step

Avoid asking for:

- long-distance blocking travel
- large staging rewrites
- off-screen character entrances not supported by the first frame
- drastic costume or prop changes

When the source shot is mainly a spoken beat, let the dialogue carry the change instead of inventing large body motion.

### 7. Sound policy is fixed

Always end with:

- `无音乐，无音效，无字幕`

Do not request:

- background music
- sound effects
- subtitles
- watermark text

Spoken dialogue is allowed only when it already exists in the source shot.

### 8. Source field priority

When translating a shot, use these fields in this order:

1. `shot_prompt_cn`
2. `dialogue`
3. `first_frame_cn`
4. `last_frame_cn` only as a weak motion hint
5. `split_decision_note`
6. `video_mode_reason`

`last_frame_cn` is never a hard ending contract for this skill.

### 9. Output contract

Each Grok item should include:

- `shot_id`
- `mode`
- `endpoint`
- `first_frame_image`
- `last_frame_image: null`
- `duration_seconds`
- `duration_label`
- `aspect_ratio`
- `resolution`
- `prompt`
- `prompt_segments`
- `translation_note`

Use:

- `mode: image_to_video`
- `endpoint: rhart-video-g/image-to-video`

## Canonical Example

```text
根据参考图生成视频：
0-4 秒
女孩娇嗔的说：你不记得了吗?上周的学术会议

cut
4-6 秒
女孩愤怒的说：你喝多了

无音乐，无音效，无字幕
```

## Validation Checklist

- every shot uses `rhart-video-g/image-to-video`
- every shot has exactly one `first_frame_image`
- every shot keeps `last_frame_image: null`
- duration is one of `6s` / `10s` / `15s`
- aspect ratio is one of `2:3` / `3:2` / `1:1`
- prompt starts with `根据参考图生成视频：`
- every timeline block has valid start and end seconds
- `cut` only appears between beat blocks
- the final line is exactly `无音乐，无音效，无字幕`
- dialogue is preserved instead of being translated away
- no invented beat exceeds what the first frame can plausibly support
