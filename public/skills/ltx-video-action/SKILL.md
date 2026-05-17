---
name: ltx-video-action
description: Use when converting the new shot-design output into LTX 2.3 image-to-video prompts for xiaolagumanju. This skill should read only compact downstream-useful fields such as first frame, last frame, shot prompt, dialogue, and duration, and should calculate final video duration from dialogue length at execution time.
---

# LTX Video Action

## Overview

This skill only does one thing:
turn compact shot-design output into usable LTX 2.3 video prompts.

It must now separate two prompt modes:
- static dialogue shots
- motion shots

Prompt rules are no longer freeform.
They must be execution-facing and stable enough for low-cost video generation.

## Core Rule

Use only these inherited fields when possible:
- `first_frame_cn`
- `last_frame_cn`
- `shot_prompt_cn`
- `dialogue`
- `duration_seconds`

Do not depend on long narrative explanation.

## Duration Rule

### Execution Rule

When running `economy.video.ltx23`:
- if prompt contains dialogue in `The character says, ...` format
- always pass `--auto-dialogue-duration`
- always still pass a base `duration=` node
- let execution layer raise final duration automatically

### Base Formula

`final_duration_seconds = max(base_duration_seconds, ceil(dialogue_char_count / 5) + 1)`

This rule is already implemented in `runninghub_app.py` by `--auto-dialogue-duration`.
Do not manually stretch prompt wording to solve timing.

## Prompt Structure Iron Law

All prompts must be written as one English paragraph in this strict order:

`[Setup] + [Action Description] + [Camera] + [Audio]`

Rules:
- setup, environment, and action must be pure English
- output must be plain text paragraph only
- do not use markdown code fences in final prompt text

## Dialogue Rule

### If there is no dialogue

Prompt must not contain:
- `says`
- `speaks`
- `voice`
- any speech instruction

### If there is Chinese dialogue

Must use exactly this format:

`用标准普通话说：The character says, 中文台词 in a [Tone] voice.`

### If there is English dialogue

Must use exactly this format:

`The character says, "English dialogue" in a [Tone] voice.`

Do not improvise other dialogue formats.

## Shot Type Split

### 1. Static Dialogue Shot

Use when:
- character mainly stands, sits, or holds position
- main purpose is speaking or reacting in place
- strong motion is not required

Prompt rule:
- keep wording short
- minimize motion description
- do not force 3-4 body actions if image does not support them
- prefer near-static behavior
- camera usually stays steady

Recommended shape:
- `[Setup]`
- optional minimal `[Action Description]`
- `[Camera]`
- `[Audio]`

Example:

`A medium shot shows a woman and a little girl standing at the doorway. The camera holds steady. 用标准普通话说：The character says, 小泽？ in a cold and restrained voice.`

### 2. Motion Shot

Use when:
- there is clear visible physical change
- standing up, turning, leaning, pushing, picking up, walking, or gesture change is central

Prompt rule:
- use `First ... then ... before ... finally ...`
- chain 3-4 believable micro-actions
- do not invent elements absent from the source image
- motion must stay consistent with the source frame

Example:

`A close shot opens on the man sitting at the bedside. First he stiffens and lifts his upper body slightly, then his eyes lock toward the doorway, before his shoulders tense as one hand presses into the mattress, finally he freezes in a shocked half-seated posture. The camera holds steady. 用标准普通话说：The character says, 你……你谁啊？怎么进来的？ in a tense and defensive voice.`

## Visual Fidelity Rule

Strictly preserve image truth.
Do not invent:
- extra characters
- extra props
- extra room zones
- off-screen actions not supported by the image
- large blocking change when the image is static

## Camera Rule

Default to static camera:
- `The camera holds steady.`
- `The camera remains fixed.`

Do not add camera motion unless shot design clearly requires it.

## Output JSON Rule

Each shot record should include:
- `shot_id`
- `image_path`
- `ltx_prompt`
- `base_duration_seconds`
- `resolution`
- `workflow_alias`
- `output_path`

Optional:
- `prompt_mode`: `static_dialogue` or `motion`
- `dialogue_char_count`
- `final_duration_seconds`

## Command Rule

For dialogue shots, execution should look like:

```bash
python3 ~/.openclaw/skills/runninghub/scripts/runninghub_app.py \
  --workflow economy.video.ltx23 \
  --profile personal \
  --auto-dialogue-duration \
  --file image=/abs/path/shot.png \
  --node 'prompt=A medium shot shows a woman and a little girl standing at the doorway. The camera holds steady. 用标准普通话说：The character says, 小泽？ in a cold and restrained voice.' \
  --node duration=2 \
  --node width=736 \
  --node height=1280 \
  -o /abs/path/out.mp4
```

## Constraints

1. Read only compact effective shot fields.
2. Default to `static_dialogue` when a shot is mainly speaking in place.
3. Use `motion` mode only when visible motion is truly needed.
4. Chinese dialogue must follow the exact mandated format.
5. Dialogue shots should default to `--auto-dialogue-duration` at execution.
6. Keep prompts short, hard, and image-faithful.
7. Output both markdown and json if files are produced downstream.
