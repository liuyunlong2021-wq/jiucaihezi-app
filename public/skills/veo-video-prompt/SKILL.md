---
name: veo-video-prompt
description: Use when converting shot-design results into Veo-friendly image-to-video or start-end-to-video prompts for the current flashxiaolagu mainline. This skill is assembly-only and should respect the actual endpoint constraints.
---

# Veo Video Prompt

## Overview

This skill converts `shot-design.json` into structured Veo video prompt data.

It is not a creative rewrite stage.

Its job is only:

1. read shot-design
2. decide first-frame mode or start-end mode
3. assemble prompt text using Veo rules
4. point to the exact frame images needed by the execution script

## Authority

Follow:

- `${OPENCLAW_HOME:-~/.openclaw}/agents/flashxiaolagu制作/production-optimization-spec.md`
- `${OPENCLAW_HOME:-~/.openclaw}/agents/drama-producer/knowledge/03-translation/veo-translation.md`

If there is a conflict, the current flash spec wins.

## Input

- `analysis/film-type-analysis.json`
- `analysis/shot-design.json`
- `prompts/banana-grid-shot-prompts.json`
- split storyboard frame image paths

This stage must inherit:

- `selected_option.ratio_design`
- `selected_option.style_design`

Authority order for ratio:

1. `shot-design.json` shot-level `aspect_ratio` when present
2. selected `film-type-analysis` option `ratio_design`

If these sources disagree, flag the mismatch instead of guessing.

## Output

- `prompts/veo-video-prompts.md`
- `prompts/veo-video-prompts.json`

## Core Rules

### 1. Assembly only

Do not invent:

- new actions
- new dialogue
- new scene changes
- new subject relations

### 2. Mode selection is explicit

If `shot-design.json` already provides explicit video routing fields, use them as the authority:

- `video_frame_strategy`
- `video_generation_mode`

Only fall back to local routing judgment when those fields are absent.

Each shot must choose one mode:

- `image_to_video`
- `start_end_to_video`

The frame image mapping should come from the storyboard slot packing, not from guesswork.

The final prompt JSON must keep the inherited ratio explicit through each shot's `aspect_ratio`.

### 3. Mode routing rule

Use `image_to_video` when:

- motion is short
- blocking change is small
- expression or local gesture is the main point

Use `start_end_to_video` when:

- movement distance is large
- body blocking changes a lot
- the shot needs clear start and end staging anchors

If a shot is marked `start_end_to_video`, this stage must require both:

- `first_frame_image`
- `last_frame_image`

Do not silently downgrade it to first-frame-only mode.

Current execution reality:

- `t8star` is the default mainline provider
- current validated `t8star` executor only covers `image_to_video`
- if a shot genuinely needs `start_end_to_video`, keep that routing explicit and flag that it needs a compatibility provider or later provider-contract validation

### 4. Dialogue policy depends on the provider route

For Veo-family prompts:

- if the first-pass goal is simply to validate motion, prefer silent action prompts
- if the provider route is conservative or unproven for Chinese speech, translate Chinese lines into natural English or omit speech
- if the provider route is explicitly validated for direct Mandarin performance, keep Chinese dialogue in a structured form such as `Says in Mandarin: '...'`
- if the original line is already English, keep it unless the execution route is intentionally silent

Current preferred Mandarin dialogue pattern for validated `t8star` tests:

- `[人物特征]，[环境描述]，[人物动作]，[镜头运动]，[人物说："对话内容"]，(no subtitles)，(no Ambient)，(no Background music)`

### 5. Duration follows the actual endpoint constraint

Current tested constraint for `rhart-video-v3.1-fast`:

- `duration=8`

If the final edit needs shorter shots, trim them after generation.

## Prompt Writing Rules

Each prompt should be built from:

- subject
- action progression
- scene context
- camera behavior
- style / atmosphere
- translated dialogue only when necessary

The style / atmosphere wording must stay aligned with the inherited selected `style_design`, not drift into a different look.

Keep the wording compact and executable.

For current flash mainline validation:

- prioritize motion clarity
- keep prompts silent by default
- only keep translated dialogue when speech is truly necessary for the shot goal
- preserve provider / cost / risk metadata when the upstream shot spec already provides it

## Frame Mapping Rule

Read `prompts/banana-grid-shot-prompts.json` and use its `frame_registry` as the primary source for:

- batch id
- panel index
- expected first-frame image path
- expected last-frame image path

If split storyboard images already exist on disk, the expected paths should follow the splitter convention:

- `storyboards/frames/<batch_id>/panel_001.png`

and so on.

If `frame_registry` and split output disagree, flag the mismatch instead of guessing.

## Start-End Template

When a shot has large movement distance or obvious blocking change, prefer a start-end structure conceptually equivalent to:

```text
Generate an 8-second transition video.
Start frame: [describe the opening state]
End frame: [describe the ending state]
Transition: [describe the middle change]
Camera movement: [describe the lens or camera move]
Dialogue: [translate Chinese to natural English only if needed]
Sound: [optional, but current flash validation usually omits this]
```

The final JSON prompt does not need to literally keep these labels,
but it should preserve the same logic:

- opening state
- ending state
- middle transition
- camera movement
- dialogue policy

### Recommended assembly fields for drafting

When building a `start_end_to_video` item, it is useful to draft the prompt internally with these fields first:

- `start_frame_description`
- `end_frame_description`
- `transition_description`
- `camera_movement`
- `dialogue`
- `sound_effects`

Then compress them into the final prompt string without inventing new content.

Current flash mainline usually keeps:

- `dialogue` empty on the first validation pass unless speech is necessary
- `sound_effects` empty on the first validation pass unless the chosen endpoint explicitly needs them

## Practical Rule

For current flash mainline validation:

- silent motion prompt first
- spoken audio second
- if dialogue causes safety rejection, keep the motion video silent and solve speech later in post

## Pattern Library

When the shot intent matches a known tested pattern, keep the prompt structure aligned with that pattern instead of improvising:

- `cut_within_8s`: one shot generation can shift from wider coverage to a medium shot when the timing split is explicit
- `zoom_only`: specify optical zoom and explicitly avoid dolly push when testing zoom capability
- `rack_focus`: specify that focus transfers from the subject to the distant background rather than asking for generic push-in movement
- `reflection_tilt_up_requires_start_end`: if the opening frame does not clearly contain the face, prefer `start_end_to_video`
- `background_lock_follow`: when testing long-take continuity, explicitly freeze architectural structure and forbid new pillars, walls, or occluding objects
- `dialogue_mandarin_structured`: for routes that support it, use `[character description] ... Says in Mandarin: '...'` structure instead of loose conversational prose

## Manual Test-Spec Mode

If the current task is not full `shot-design.json` assembly but a direct model capability test set, this skill may still emit structured prompt JSON.

In that case:

- keep one test goal per shot
- attach `test_goal`, `prompt_pattern`, `risk_tags`, `provider`, `cost_class`, and `canary_required` when known
- prefer the simplest prompt that isolates the target capability
- avoid mixing zoom, focus, dialogue, continuity, and complex blocking in the same first-pass test unless the test explicitly requires it

## Validation Checklist

- every shot has `shot_id`
- every shot has `mode`
- every shot has `endpoint`
- every shot has `first_frame_image`
- `start_end_to_video` shots also have `last_frame_image`
- `start_end_to_video` shots must not be downgraded to `image_to_video`
- every shot has `prompt`
- every shot has `duration_seconds`
- every shot has `aspect_ratio`
- every shot has `resolution`
- every shot `aspect_ratio` matches shot-design or the selected type-analysis ratio
