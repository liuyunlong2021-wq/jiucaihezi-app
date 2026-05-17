---
name: banana-grid-shot-prompt
description: Use when converting shot-design results into Banana 3x3 storyboard grid JSON prompts for the current flashxiaolagu mainline. This skill is assembly-only and should write short natural-language cinematic beats, not rigid keyword chains.
---

# Banana Grid Shot Prompt

## Overview

This skill converts `shot-design.json` into machine-readable 3x3 storyboard grid prompt batches.

It is not a creative writing stage.

Its job is only:

1. read shot-design
2. compress each panel into a short cinematic beat
3. group panels into 3x3 batches
4. preserve reference image mapping and global constraints

## Authority

Follow:

- `${OPENCLAW_HOME:-~/.openclaw}/agents/flashxiaolagu制作/production-optimization-spec.md`
- `${OPENCLAW_HOME:-~/.openclaw}/agents/drama-producer/knowledge/03-translation/banana-pro-translation.md`

If there is a conflict, the current flash spec wins.

## Input

- `analysis/film-type-analysis.json`
- `analysis/shot-design.json`
- generated asset paths for characters / scenes / props

This stage must inherit:

- `selected_option.ratio_design`
- `selected_option.style_design`

If `shot-design.json` already carries explicit per-shot `aspect_ratio`, that shot-level value is the authority for that shot.
If upstream ratio data is missing or contradictory, stop and flag the mismatch instead of guessing.

## Output

- `prompts/banana-grid-shot-prompts.md`
- `prompts/banana-grid-shot-prompts.json`

## Core Rules

### 1. Assembly only

Do not invent:

- new shots
- new staging logic
- new emotions not present in shot-design
- new camera grammar not present in shot-design

### 2. 3x3 is the default batch

Each batch should target:

- `grid_layout: 3x3`
- `grid_aspect_ratio`: inherited project ratio

Pack slots into exact 3x3 batches whenever possible.

Default rule:

- the project ratio comes from the selected type-analysis option
- `grid_aspect_ratio` must match that inherited ratio
- do not hard-code `9:16`

If the scene contains `start_end_to_video` shots, their extra end-frame slots are part of the same sequence and should be included before considering any filler shot.

### 3. Each panel stays short, but natural

Each `prompt_text` should usually stay within about 20-35 English words.

It should read like a tiny cinematic action beat, not like a rigid tag chain.

### 4. Reference images must be explicit in JSON, not spammed in every prompt

The JSON output must include structured reference image paths.

But inside each `prompt_text`, do not mechanically repeat `图1 / 图2 / 图3` unless it is truly necessary to disambiguate.

This model has semantic understanding.

Reference image paths must match the actual asset files on disk.
Do not blindly switch `.jpg` to `.png` or the reverse.

### 5. Global constraint is mandatory

Every batch must include a strong shared constraint string covering:

- borderless seamless grid
- no black border
- no black frame
- no panel line
- no subtitles
- no watermark
- no timecode
- stable light / color / contrast from `StyleDesign`
- preserve axis and continuity from the established scene references

### 6. Video routing must flow through this stage

If a shot in `shot-design.json` is marked:

- `video_generation_mode: image_to_video`

then this stage should emit one slot:

- `slot_type: first_frame`

If a shot is marked:

- `video_generation_mode: start_end_to_video`

then this stage should emit two slots in story order:

- `slot_type: first_frame`
- `slot_type: last_frame`

The end frame is not optional in that case, because downstream video generation needs a real image anchor.

### 7. Frame registry is required

The JSON output must also include a machine-readable `frame_registry` section.

For each `shot_id`, it should record:

- `video_generation_mode`
- `first_frame.batch_id`
- `first_frame.panel_index`
- `first_frame.expected_frame_image`
- `last_frame.batch_id`
- `last_frame.panel_index`
- `last_frame.expected_frame_image`

if a last frame exists.

This registry is the handoff contract to `veo-video-prompt`.

The top-level JSON should also explicitly restate:

- `ratio_design`
- `style_design`

so downstream stages do not need to guess which project branch was selected.

### 8. Final batch should avoid empty panels

If all required `first_frame` and `last_frame` slots are packed and the final 3x3 batch is still short, you may add a `continuity_hold` slot as a last resort.

Rules:

- it must come from an existing shot already present in `shot-design.json`
- it must be derived from that shot's existing first-frame or last-frame state
- it must not invent a new beat, new action, or new shot
- it must not change `video_generation_mode`
- it exists only to avoid an empty ninth panel in the final grid page

## Prompt Compression Rules

Each `prompt_text` should contain only what is necessary:

- shot size
- the visual action beat
- who or what dominates the frame
- optional camera height or angle if important
- short atmosphere phrase if helpful

Avoid:

- rigid `图1 图2 图3` repetition in every slot
- pseudo-Qwen coordinate language
- over-specified mechanical geometry when the model can infer the shot from story semantics
- long explanation paragraphs

## Validation Checklist

- batch layout is always `3x3`
- every batch has `reference_images`
- every batch has `global_constraint`
- every batch has inherited `grid_aspect_ratio`
- `start_end_to_video` shots have both first-frame and last-frame slots
- `frame_registry` exists and matches the slot packing
- any `continuity_hold` slot is derived from an existing shot state and does not alter video routing
- every slot has `slot_index`
- every slot has `source_shot_id`
- every slot has `slot_type`
- every slot has short English `prompt_text`
- no batch exceeds 9 slots
- top-level `ratio_design` and `style_design` match the selected type-analysis option
