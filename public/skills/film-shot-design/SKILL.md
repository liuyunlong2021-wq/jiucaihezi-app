---
name: film-shot-design
description: Use when converting script content and engineering-book material units into executable shot design for xiaolagumanju. This skill must inherit pacing, respect the material engineering book, and output only downstream-useful shot control data.
---

# Shot Design

## Overview

This skill is no longer a long-form director analysis sheet.

Its job is to output short, precise, generation-facing shot control data.
It must absorb the old frame-design responsibilities, so each shot already contains:

- script reference
- generation strategy
- duration
- first frame
- last frame
- executable shot prompt
- explicit video routing

If `engineering-book.json` exists, that file is the upstream material engineering book.

It already decided what reusable material units exist.

This skill should turn those units into final shot control.

It should not rebuild the scene logic from raw script unless the engineering book is absent.

## Core Principles

- inherit the selected `PacingDesign` before splitting shots
- split shots by executable visual change, not by prose explanation
- treat the engineering book as the material source of truth when available
- keep only fields that downstream tools directly use
- remove repeated narrative explanation
- each shot must describe a clear start state and end state
- choose generation strategy early instead of forcing every shot into the same image workflow
- every shot must point back to the exact script sentence or line range it came from
- every shot must explicitly declare whether downstream video should use first-frame only or first-and-last-frame mode

## Shot Design Method

Build shot design in three passes:

1. read `engineering-book.json` and treat each material unit as one candidate shot by default
2. convert each selected unit into final shot control by inheriting its coverage role, action, dialogue fragment, scene zone, prop focus, and state change
3. add only the support coverage that is truly needed, such as `master reset` for axis or geography clarity, or merge only when there is a positive reason

If a shot description still reads like:

- `A 起身 + B 出现在门口`
- `A 看到文件 + 文件特写`
- `A 推进空间 + B 宣告关系`

then the split is usually still too coarse.

## When to Use

Use this skill when:
- `film-type-analysis` is completed and one option has been selected
- character / scene / prop analysis are ready
- asset generation planning needs executable shot instructions
- downstream image and video generation need first frame, last frame, and shot prompt control

## Input

- script text
- `analysis/film-type-analysis.json`
- `analysis/character-analysis.json`
- `analysis/scene-analysis.json`
- `analysis/prop-analysis.json`
- `analysis/engineering-book.json` when available

## Output

- `analysis/shot-design.md`
- `analysis/shot-design.json`

## Mandatory Inheritance

This skill must inherit the selected fields from `film-type-analysis`:

- `ratio_design`
- `style_design`
- `pacing_design`

`pacing_design` is mandatory and must control shot split density.
`ratio_design` is mandatory and should become the default `aspect_ratio` for every shot.
`style_design` is mandatory and should remain visible in frame descriptions and shot prompts.

If `selected_option` is missing any of these fields, stop and request a corrected upstream file instead of improvising.

## Engineering-book contract

If `engineering-book.json` exists, this skill should directly inherit from each source unit:

- `coverage_role`
- `dominant_subject`
- `support_subjects`
- `action`
- `dialogue`
- `scene_zone`
- `prop_focus`
- `start_state`
- `end_state`
- `editorial_intent`
- `priority`

The engineering book already translated the audience-facing script into production-facing material units.

Shot design should focus on:

- final camera wording
- duration
- generation strategy
- frame descriptions
- downstream routing

It should not redo the same split logic from scratch.

## Pacing-Driven Split Logic

### Fast pacing

Use when `pacing_design` indicates fast short-drama rhythm.

Rules:
- default shot length: `1-3s`
- split micro-actions into separate shots
- split reaction, turn, look shift, pick-up, push, door open, evidence insert as needed
- close-up / medium close-up / medium shot priority
- one important reaction may become its own shot

### Medium pacing

Rules:
- default shot length: `2-5s`
- do not merge adjacent readable actions unless they truly share the same dominant subject, same attention target, same emotional beat, and same camera logic
- keep key inserts and key reactions

### Vertical short-drama correction

For vertical short-drama and movie-short-drama workflows, use this correction on top of pacing:

- fine split is preferred over coarse merge
- one material unit with one dominant attentional beat should usually become one shot
- if the viewer would naturally cut from one subject to another, split
- if a reaction and a reveal are both important, they must not be collapsed into one shot
- master or wide coverage can be added as support, but must not replace the reveal/reaction chain

### Cinematic / slow pacing

Rules:
- default shot length: `3-6s` or longer
- reduce cut density
- allow more internal motion inside one shot
- prioritize pause, gaze relation, and composition

## Shot Split Rule

A new shot should be created when any of these changes occur:
- subject priority changes
- attentional center changes
- visual action changes
- reaction level changes
- space relation changes
- prop information becomes the visual focus
- dialogue beat needs a dedicated reaction or insert
- pacing rules require extra fragmentation

### Hard no-merge examples

Do not merge these by default:

- `角色起身` + `门口出现新人物`
- `角色看到某物` + `某物的 reveal`
- `人物掏出文件` + `文件落下特写`
- `人物推进空间` + `推进后的权力宣告`
- `角色反应` + `对方新的信息投喂`

### Engineering-book-first rule

If `engineering-book.json` exists:

- treat each `unit` as one candidate shot by default
- merge only when there is a positive reason, not because the units are adjacent
- if you merge, the merged shot must still preserve one clear dominant attentional center
- `source_unit_ids` becomes required for every shot

### Support coverage rule

`master_reset` or support geography shots are allowed, but only as additional support coverage.

They must not replace:

- the trigger shot
- the first reaction shot
- the reveal shot
- the prop insert shot

Coverage can be added, but dramatic beats must not be collapsed away.

## generation_strategy is mandatory

Each shot must be assigned one of these strategies:

- `background_extract_first`
- `mastershot_first`
- `scene_view_direct`

### Strategy routing

Use `background_extract_first` when:
- the shot needs a clean extracted background first
- the background area must stay very close to the scene master
- the model struggles when background and subject are generated together

Use `mastershot_first` when:
- pose, gaze, or subject relation matters more than background variation
- sleeping, sitting, bed reaction, and door confrontation need to be stabilized first
- a later derived-view step will control angle more reliably

Use `scene_view_direct` when:
- space continuity matters most
- pose precision is not the main difficulty
- the shot can be generated directly from a clean fixed scene view

## Minimum Shot Schema

Each shot should only keep:

- `shot_id`
- `script_reference`
- `aspect_ratio`
- `duration_seconds`
- `generation_strategy`
- `background_target`
- `subject`
- `support_subjects`
- `first_frame_cn`
- `last_frame_cn`
- `shot_prompt_cn`
- `dialogue`
- `video_frame_strategy`
- `video_generation_mode`

Optional only if directly useful:
- `prop_focus`
- `mastershot_goal`
- `derived_view_goal`
- `video_mode_reason`
- `source_unit_ids`
- `source_coverage_role`
- `source_editorial_intent`
- `split_decision_note`

## Field Writing Rules

### script_reference

This field is mandatory because the human reviewer must be able to see exactly which script line or beat created the shot.

Recommended structure:

```json
{
  "line_start": 17,
  "line_end": 19,
  "source_excerpt": "△ 女人走进来，把小女孩推到他面前。女人（直接）：这是你女儿。"
}
```

### aspect_ratio

This field is mandatory.

Default rule:

- every shot inherits the selected `ratio_design`
- write it explicitly as `aspect_ratio`
- do not silently switch portrait shots into landscape, or landscape shots into portrait

Only deviate when the project intentionally contains a justified special-format shot, and then explain the exception in review notes.

### source_unit_ids

If `engineering-book.json` is available, list the exact unit ids that produced the shot.

Default expectation:

- one shot -> one source unit

Merge is exceptional, not default.

If `engineering-book.json` exists, this field should be treated as required.

### source_coverage_role

Optional but recommended when `engineering-book.json` exists.

Use the upstream unit `coverage_role` to make the audit trail easier to read.

### first_frame_cn

Must describe:
- camera angle / size
- subject state at the start
- visible relation to the background
- selected style design

### last_frame_cn

Must describe:
- the final state inside the same shot
- what changed from the first frame
- same visual world and style design

### shot_prompt_cn

Must be the compact executable Chinese prompt string for downstream use.

If the source unit came from a split dialogue fragment, keep only that fragment in the shot dialogue.

Do not silently restore the full original line.

Recommended format:

`镜头/机位描述，人物动作；(如有对白) 人物说：对白。风格：StyleDesign`

### dialogue

Keep only the actual dialogue line if the shot carries spoken text.

### video_frame_strategy

Mandatory values:

- `first_frame_only`
- `first_and_last_frame`

This is the human-readable analysis field.

### video_generation_mode

Mandatory values:

- `image_to_video`
- `start_end_to_video`

This is the downstream machine-readable routing field.

The two fields must match:

- `first_frame_only` -> `image_to_video`
- `first_and_last_frame` -> `start_end_to_video`

### video_mode_reason

Use one short sentence explaining why the shot should use the chosen video route.

### split_decision_note

Use one short sentence explaining why this shot exists as its own shot.

Examples:

- `起床反应和门口 reveal 不能合镜`
- `此处需要单独的空间重置全景`
- `证据道具成为唯一视觉中心`

## What To Remove

Do not output these by default:
- `Narrative Target`
- `Narrative Intent`
- `Core Event`
- `Emotional Tone`
- `Camera Change Reason`
- long `Continuity Locks`
- repeated `Script Content`
- repeated emotional explanation

If a later workflow truly needs one of these, re-add only that exact field.

## Writing Rules

### Action must include start state

Bad:
- `小泽从床上惊醒并转头看向门口`

Good:
- `睡梦中的小泽从床上猛然起身，转头看向门口`

### Use executable camera language

Prefer:
- `平视近景`
- `左前方平视特写`
- `45度侧脸俯拍近景`
- `正面低仰角特写`
- `三分构图`
- `荷兰角构图`

Avoid vague explanation paragraphs.

### Keep prompts short and hard

Do not overload one shot with too many instructions.
If too many things must happen, split more shots according to pacing rules.

### Markdown review requirement

`analysis/shot-design.md` must be readable without opening the JSON.

For each shot, the markdown review sheet must expose at least:

- `shot_id`
- `script_reference`
- `source_unit_ids`
- `source_coverage_role`
- `duration_seconds`
- `generation_strategy`
- `video_generation_mode`
- `shot_prompt_cn`
- `split_decision_note`

The human reviewer should be able to see immediately:

- which script line created the shot
- why the shot exists
- whether it uses `image_to_video` or `start_end_to_video`

### Preferred shot chain for reveal scenes

When a scene contains shock, intrusion, or discovery, prefer:

1. trigger shot
2. reaction shot
3. reveal shot
4. optional master reset shot
5. response shot

## Output Format

### Markdown

```markdown
## shot_003

- Duration: 2
- Script Reference: lines 15-15, "小泽（懵）：你……你谁啊？怎么进来的？"
- Source Coverage Role: single_medium_A
- Generation Strategy: mastershot_first
- Background Target: 床区背景
- Subject: 小泽
- Support Subjects: 无
- First Frame: 45度侧脸俯拍近景，小泽坐在床边，视线看向前方，表情惊讶。风格：[窗光] + [青橙色调] + [中高反差] + [阿莱Alexa质感]
- Last Frame: 45度侧脸俯拍近景，小泽仍坐在床边，身体更前倾，表情更紧。风格：[窗光] + [青橙色调] + [中高反差] + [阿莱Alexa质感]
- Shot Prompt: 45度侧脸俯拍近景，小泽惊讶地坐在床边视线看向前方；小泽说：你……你谁啊？怎么进来的？风格：[窗光] + [青橙色调] + [中高反差] + [阿莱Alexa质感]
- Dialogue: 你……你谁啊？怎么进来的？
- Video Frame Strategy: first_frame_only
- Video Generation Mode: image_to_video
- Video Mode Reason: 主要依赖轻微表情和身体张力变化，不需要明确终点锚帧。
```

### JSON

```json
{
  "ratio_design": "9:16",
  "style_design": "[窗光] + [青橙色调] + [中高反差] + [阿莱Alexa质感]",
  "pacing_design": "快节奏，1-3秒一镜，近景特写优先，小动作拆镜",
  "scenes": [
    {
      "scene_id": "scene_001",
      "name": "小泽公寓卧室",
      "shots": [
        {
          "shot_id": "shot_003",
          "source_unit_ids": ["unit_005"],
          "source_coverage_role": "single_medium_A",
          "script_reference": {
            "line_start": 15,
            "line_end": 15,
            "source_excerpt": "小泽（懵）：你……你谁啊？怎么进来的？"
          },
          "aspect_ratio": "9:16",
          "duration_seconds": 2,
          "generation_strategy": "mastershot_first",
          "background_target": "床区背景",
          "subject": "小泽",
          "support_subjects": [],
          "first_frame_cn": "45度侧脸俯拍近景，小泽坐在床边，视线看向前方，表情惊讶。风格：[窗光] + [青橙色调] + [中高反差] + [阿莱Alexa质感]",
          "last_frame_cn": "45度侧脸俯拍近景，小泽仍坐在床边，身体更前倾，表情更紧。风格：[窗光] + [青橙色调] + [中高反差] + [阿莱Alexa质感]",
          "shot_prompt_cn": "45度侧脸俯拍近景，小泽惊讶地坐在床边视线看向前方；小泽说：你……你谁啊？怎么进来的？风格：[窗光] + [青橙色调] + [中高反差] + [阿莱Alexa质感]",
          "dialogue": "你……你谁啊？怎么进来的？",
          "video_frame_strategy": "first_frame_only",
          "video_generation_mode": "image_to_video",
          "video_mode_reason": "主要依赖轻微表情和身体张力变化，不需要明确终点锚帧。"
        }
      ]
    }
  ]
}
```

## Constraints

1. `pacing_design` must control shot splitting.
2. `film-shot-design` absorbs old frame-design responsibilities.
3. Every shot must have `script_reference`.
4. Every shot must have `aspect_ratio`, and it should match the selected `ratio_design` unless an explicit exception is justified.
5. Every shot must have `first_frame_cn` and `last_frame_cn`.
6. Every shot must declare `generation_strategy`.
7. Every shot must declare `video_frame_strategy` and `video_generation_mode`.
8. Only keep fields that downstream tools directly use.
9. Output both markdown and json.
