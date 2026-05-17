---
name: banana-storyboard-edit-prompt
description: Use when one or more split storyboard panel images such as `storyboards/frames/.../panel_004.png` need Nano Banana Pro image editing instead of rerunning the whole Banana storyboard batch. This skill writes structured Chinese edit prompts for panel-level character, scene, prop, or fused repairs while explicitly preserving locked elements and continuity.
---

# Banana Storyboard Edit Prompt

## Overview

This skill converts a bad split storyboard panel image into a Nano Banana Pro image-edit request.

It is not a full storyboard regeneration stage.

It is not for directly editing an unsplit storyboard grid page.

Its job is only:

1. read the existing split panel image and its shot context
2. identify what must stay unchanged
3. write a structured edit prompt in command-sentence form
4. package the panel image and optional reference images for single-shot repair

## When To Use

Use this skill when:

- one `storyboards/frames/.../panel_XXX.png` is wrong but the rest of the batch is fine
- the storyboard grid has already been split and the user wants to repair `panel_004.png`, `panel_005.png`, or any other specific panel individually
- a single shot needs local character repair, scene repair, prop repair, or fusion repair
- rerunning the entire `storyboards/` batch would waste time or money
- the user wants to keep the current shot continuity and only adjust one panel

Do not use this skill to redesign the whole scene page.

Do not use this skill to directly repaint the unsplit 3x3 storyboard page.

If the whole 3x3 batch is broken, go back to `banana-grid-shot-prompt`.

If the user says "第四张和第五张有问题", interpret that as separate split panel targets, for example:

- `storyboards/frames/<batch_id>/panel_004.png`
- `storyboards/frames/<batch_id>/panel_005.png`

and generate separate edit items for each panel.

## Authority

Follow:

- `${OPENCLAW_HOME:-~/.openclaw}/agents/flashxiaolagu制作/production-optimization-spec.md`
- current project `analysis/shot-design.json`
- current project `prompts/banana-grid-shot-prompts.json`
- [nano-banana-edit-rules.md](references/nano-banana-edit-rules.md)

If there is a conflict, project continuity and the user's concrete edit instruction win.

## Input

- the target split panel image path, usually `storyboards/frames/<batch_id>/panel_XXX.png`
- `analysis/shot-design.json`
- `prompts/banana-grid-shot-prompts.json`
- optional reference assets from:
  - `assets/characters/`
  - `assets/scenes/`
  - `assets/props/`
- the user's local edit goal

Do not treat the unsplit storyboard page as the default input unit.

## Output

- `prompts/banana-storyboard-edit-prompts.md`
- `prompts/banana-storyboard-edit-prompts.json`

For one-off repairs, it is also acceptable to output a single JSON edit item directly in chat.

If multiple split panels are bad, output multiple edit items, one per panel.

## Core Rules

### 1. Single-panel repair first

Default to repairing one split panel image at a time.

The default source of truth is the extracted panel file under `storyboards/frames/.../panel_XXX.png`, not the unsplit storyboard grid page.

Do not escalate to batch rerender unless:

- the broken frame is structurally unusable
- continuity across several adjacent panels is already broken
- the user explicitly wants a larger rerun

If several panels are bad, repair them as several independent panel edit items, not as one page-level repaint.

### 2. Assembly only

Do not invent:

- a new shot beat
- a new dramatic event
- a new emotional turning point
- a new camera grammar not supported by the source panel

The edit must still belong to the same shot.

### 3. Command sentence first

All edit prompts should use explicit command sentences, not vague wishes.

Good:

- `保持角色面部特征、表情和姿势不变，将旗袍替换为酒红色丝绸旗袍。`

Bad:

- `让这个角色看起来更适合这个场景。`

### 4. Locked elements must be explicit

Always name the elements that must remain unchanged.

Typical locked elements:

- face
- expression
- pose
- camera angle
- composition
- body proportion
- lighting direction
- shadow logic
- existing story beat

### 5. Fusion must look natural

When adding or replacing character / scene / prop elements, explicitly require:

- matching light direction
- matching shadow
- matching texture
- matching perspective
- matching color temperature
- natural integration into the original image

### 6. Edit scope must be declared

Each request should choose one primary scope:

- `character_edit`
- `scene_edit`
- `prop_edit`
- `fusion_edit`
- `polish_edit`

`fusion_edit` is for multi-element synchronized repair.

### 7. Keep the prompt layered

A good Nano Banana Pro edit prompt usually has these layers:

1. preserve clause
2. direct edit command
3. integration clause
4. optional atmosphere / narrative clause
5. optional technical refinement clause

### 8. Use references deliberately

If reference images are used, keep their roles explicit in JSON.

Recommended image order:

1. target frame to edit
2. optional character reference
3. optional scene reference
4. optional prop reference

Do not spam references when the edit is simple.

### 9. Chinese prompt output is preferred

For this skill, prompts should default to Chinese command sentences because the edit intent is more controllable in the current workflow.

Only preserve English when the user explicitly provides English text that must appear unchanged.

## Suggested Workflow

### Step 1: Locate the exact bad frame

Record:

- `shot_id`
- `batch_id`
- `panel_index`
- `source_frame_image`

Use `prompts/banana-grid-shot-prompts.json -> frame_registry` as the routing source when available.

If the user starts from wording such as "第四张" or "第五张", first resolve that wording to the split panel path, for example:

- panel 4 -> `storyboards/frames/<batch_id>/panel_004.png`
- panel 5 -> `storyboards/frames/<batch_id>/panel_005.png`

Do not edit the full storyboard page unless the user explicitly asks for page-level work.

### Step 2: Freeze what cannot change

Write a short `preserve_elements` list.

Typical example:

- keep face
- keep pose
- keep camera framing
- keep bedroom morning light

### Step 3: Classify the edit

Choose one:

- character correction
- costume / styling correction
- scene replacement or enhancement
- prop addition / replacement
- multi-element fusion
- fine polish

### Step 4: Build the edit prompt

Default prompt structure:

```text
保持[必须保留元素]不变，
将[需要修改的元素]修改为[具体新描述]，
确保[光线/阴影/纹理/透视/色调]与原图一致，
使其自然融入画面，
[如有需要，再补一句叙事或氛围目标]。
```

For more complex edits, use the layered or synchronized pattern from [nano-banana-edit-rules.md](references/nano-banana-edit-rules.md).

### Step 5: Validate continuity

Before finalizing, check:

- does the edited panel still belong to the same shot beat
- does the character still match the asset identity
- does the scene still match adjacent panels
- does the prop logic still make sense

## Output Contract

Each edit item should include:

- `edit_id`
- `shot_id`
- `source_batch_id`
- `source_panel_index`
- `source_frame_image`
- `edit_scope`
- `edit_reason`
- `preserve_elements`
- `reference_images`
- `prompt`
- `continuity_note`
- `target_output_image`

Recommended JSON shape:

```json
{
  "edit_id": "shot_009_panel_004_v2",
  "shot_id": "shot_009",
  "source_batch_id": "scene_001_batch_002",
  "source_panel_index": 4,
  "source_frame_image": "storyboards/frames/scene_001_batch_002/panel_004.png",
  "edit_scope": "fusion_edit",
  "edit_reason": "女人表情和小女孩站位都不够压迫",
  "preserve_elements": [
    "保持女人面部特征不变",
    "保持小女孩身份不变",
    "保持镜头景别和卧室空间关系不变"
  ],
  "reference_images": [
    {
      "role": "base_frame",
      "path": "storyboards/frames/scene_001_batch_002/panel_004.png"
    },
    {
      "role": "character_reference",
      "path": "assets/characters/character_woman.png"
    }
  ],
  "prompt": "保持女人面部特征、小女孩身份、镜头景别和卧室空间关系不变，将女人的表情调整为更冷硬直接，将小女孩的位置微调到更靠前一点，确保光线方向、阴影投射、人物透视和卧室清晨色调与原图一致，使两人的压迫关系自然融入画面。",
  "continuity_note": "必须继续服务于“这是你女儿”这拍的压迫宣告，不可改成新动作段。",
  "target_output_image": "storyboards/frames-edited/shot_009_panel_004_v2.png"
}
```

If two panels need repair, output two separate JSON items rather than merging them into one page-level instruction.

## Validation Checklist

- edit target is a split panel image, not an unsplit storyboard page, unless the user explicitly expands scope
- each bad panel gets its own edit item
- preserve clause is explicit
- the prompt starts with direct edit instructions, not vague description
- changed elements are concrete and limited
- continuity with `shot-design.json` is preserved
- reference image roles are explicit
- integration requirements mention light, shadow, texture, or perspective when relevant
- no accidental whole-shot rewrite
