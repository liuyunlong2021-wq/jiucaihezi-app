---
name: film-scene-asset
description: Use when turning script locations into a final empty-environment master-shot scene asset for the current Banana/Veo short-drama pipeline. This stage must inherit the selected type-analysis style and lighting, lock one reusable camera truth, and exhaustively enumerate everything visible in that master shot for downstream prompt assembly.
---

# Scene Asset

## Overview

This skill must not write a vague location essay.

Its job is to output one reusable empty-plate `master shot` scene packet.

That packet is the final scene truth used by downstream prompt translation.

Think of it as:

- not a loose room description
- not a mood board
- not a generic architecture summary
- but a production-facing scene control contract

It must output a dual-layer structure:

- `control_table`
- `production_bible`

Rules:

- downstream automation reads only `control_table`
- `production_bible` is only for lightweight human review and reuse
- if the two layers conflict, `control_table` wins
- the scene must be analyzed as the final reusable empty-environment `master shot` view of the location

## Authority

This skill should follow the active project spec first.

Current mainline reference:

- `${OPENCLAW_HOME:-~/.openclaw}/agents/flashxiaolagu制作/production-optimization-spec.md`

Read [master-shot-checklist.md](references/master-shot-checklist.md) when:

- writing `master_shot_environment_manifest`
- translating `StyleDesign` into room-specific light behavior
- deciding zone naming
- checking whether the master shot is truly reusable

If the user is explicitly running another preserved baseline with its own local spec, that local spec can override this reference.

## Core Principles

- the core deliverable is one stable empty-environment master-shot view that already contains the decisive spatial truth of the room
- the scene must inherit the selected `RatioDesign` and `StyleDesign` from `film-type-analysis`
- `StyleDesign` already absorbs lighting, so this skill must translate that selected style into concrete room light behavior
- write only what is visible or spatially implied by that master shot, not a generic room summary
- the master shot must preserve the decisive axis side and the key confrontation or action corridor the scene needs
- the output must be detailed enough that downstream prompt assembly can reconstruct the scene without re-reading the whole script
- zone names must stay practical and reusable across downstream stages such as `film-engineering-book` and `film-shot-design`
- `control_table` keeps only structural, visual, reusable, generation-facing data
- `production_bible` stays lightweight and must not add new hard layout facts

## When to Use

- at project start, after `film-type-analysis`
- when turning script locations into reusable scene control data
- when downstream prompts need one final empty-plate master-shot environment truth

## Input

- full script text
- `analysis/film-type-analysis.json`

Optional context when available:

- project naming or scene numbering
- prior locked continuity notes

This skill must read the selected option from `film-type-analysis` and explicitly inherit:

- `selected_option.ratio_design`
- `selected_option.style_design`

`style_design` is mandatory because it carries the final light / color / contrast design.
`ratio_design` is mandatory because the room master shot must lock the same framing logic as the selected project branch.

If `selected_option` is missing, or if either inherited field is missing, stop and request a corrected `film-type-analysis.json` instead of guessing.

## Output

- `analysis/scene-analysis.md`
- `analysis/scene-analysis.json`

## Working Method

Build the scene asset in this order:

1. read the scene from a production angle and identify what dramatic use the room must support
2. inherit the selected `ratio_design` and `style_design`
3. choose one final reusable empty-plate master shot that best preserves the scene's decisive confrontation or action geography
4. define practical reusable zone names for the visible play areas
5. convert the selected `style_design` into concrete room light behavior for this exact view
6. enumerate the environment from foreground to background and from floor to ceiling, as it appears in this master shot
7. lock axis continuity and extraction targets
8. keep `production_bible` short and secondary

The result should feel like a ready-to-use scene master packet, not like a prose summary.

## Required Structure

Each scene must contain:

- `scene_id`
- `name`
- `control_table`
- `production_bible`

### `control_table` keep only

- `scene_narrative_identity`
- `style_inheritance`
- `human_presence_policy`
- `master_shot_camera_design`
- `master_shot_subject_blocking`
- `scene_zone_map`
- `master_shot_lighting_design`
- `master_shot_environment_manifest`
- `axis_continuity_locks`
- `background_extract_targets`

### `production_bible` keep only

- `narrative_support_note`
- `continuity_watchlist`
- `off_frame_inference_note`

## What To Remove

Do not keep these as default persisted output:

- generic atmosphere prose without visible support
- vague statements like "warm and lived-in" without concrete objects or material evidence
- long shooting-theory explanations
- duplicated story-support paragraphs
- a second competing room description outside the master-shot truth
- generic lighting phrases that ignore the selected `StyleDesign`

## Required JSON Shape

```json
{
  "scenes": [
    {
      "scene_id": "scene_001",
      "name": "小泽的公寓卧室",
      "control_table": {
        "scene_narrative_identity": "这是一个单身理工男在自己狭窄卧室里，被突然闯入的母女堵到床边、发生强对峙的晨间公寓空间；用于生成可复用的空场景 master plate。",
        "style_inheritance": {
          "ratio_design": "9:16",
          "style_design": "[窗光] + [青橙色调] + [高反差] + [电影数字质感]",
          "inheritance_note": "场景图必须完整继承已选风格，不得改写成无关布光或另一套色调。"
        },
        "human_presence_policy": {
          "mode": "no_people",
          "reason": "这是可复用空场景底板，人物必须在角色层和分镜层单独进入。"
        },
        "master_shot_camera_design": {
          "shot_size": "带完整环境关系的叙事全景 master shot",
          "camera_height": "平视略高机位，约1.45米",
          "camera_side_of_axis": "站在主对峙轴线的窗侧这一面，斜向门口",
          "composition_logic": "门、床、窗、走道四个核心锚点同时成立",
          "frame_must_include": [
            "左后房门与完整门框",
            "右前床边与可落道具的床面",
            "右后窗与书桌",
            "门到床之间的完整留白走道"
          ],
          "stable_reference_reason": "这个视角一次性保住闯入、受击、推进、落道具四类动作所需空间真相。"
        },
        "master_shot_subject_blocking": {
          "xiaoze_position": "画面右前床沿",
          "woman_position": "画面左后门口内侧半步",
          "girl_position": "女人右前方半步，位于走道上",
          "visible_corridor": "门口到床边之间必须留出完整可见走道",
          "facing_relation": "门口人物看向右前床边，床边人物回看左后门口"
        },
        "scene_zone_map": {
          "door_zone": "左后房门和门边墙面",
          "bed_zone": "右前双人床、床沿、床头柜",
          "report_drop_zone": "床面中央到床沿区域",
          "walkway_zone": "门到床之间的留白地面",
          "desk_window_zone": "右后窗、窗帘、书桌和椅子"
        },
        "master_shot_lighting_design": {
          "source_style_design": "[窗光] + [青橙色调] + [高反差] + [电影数字质感]",
          "key_light_source": "右后窗晨间自然光",
          "fill_behavior": "室内环境反弹光较弱，床边暗部允许压低但保留细节",
          "practical_light_policy": "台灯可见但默认不作为主光",
          "color_temperature_balance": "窗光偏冷，室内木色和床品带轻微暖色回弹",
          "contrast_goal": "中高反差，不能拍成均匀平光",
          "exposure_rule": "窗外不过曝炸白，室内暗部不死黑"
        },
        "master_shot_environment_manifest": {
          "foreground": "右前床沿、床面、床头柜、台灯、少量生活杂物",
          "midground": "门到床的对峙走道和床区主体",
          "background": "左后房门、右后窗、书桌、衣柜或收纳区",
          "visible_environment_details": {
            "bed_zone": "1.5米双人床、灰系床品、略皱的睡醒痕迹",
            "door_zone": "深木色房门、银色门把手、简洁门框",
            "window_desk_zone": "窄窗、纱帘和遮光帘、浅木书桌、黑色办公椅、电脑和书本",
            "storage_zone": "简易衣柜、开放收纳格、少量挂放衣物",
            "floor_ceiling_zone": "木地板、拖鞋、少量随手物、白色平顶和普通吸顶灯"
          }
        },
        "axis_continuity_locks": [
          "门必须始终在左后侧",
          "床必须始终在右前侧",
          "窗和书桌必须始终在右后侧",
          "门到床之间的走道必须可见"
        ],
        "background_extract_targets": [
          {
            "target_id": "door_only_bg",
            "description": "房门、门框、门边墙面和少量地板"
          },
          {
            "target_id": "bed_only_bg",
            "description": "床、床头柜、台灯和床头墙面"
          }
        ]
      },
      "production_bible": {
        "narrative_support_note": "这是一个自带冲突路径的终极对峙视角。",
        "continuity_watchlist": [
          "不要把空间做成酒店房间或豪宅卧室"
        ],
        "off_frame_inference_note": "画外可能存在其他生活空间，但不参与本场 master-shot 真相。"
      }
    }
  ]
}
```

## Writing Rules

### 0. `scene_narrative_identity` comes first

Write one decisive sentence that tells the model what kind of space this is in story terms.

It should state:

- whose space it is
- what dramatic function it serves in this scene
- what the core confrontation, intrusion, waiting, or action use of the room is
- that this is the reusable empty-plate master shot when relevant

This sentence should become the highest-weight summary inherited by downstream prompt translation.

### 0.3. `style_inheritance` is mandatory

This field must explicitly restate the selected upstream style contract.

It must mirror the selected option exactly, not approximately.

It should keep:

- `ratio_design`
- `style_design`
- a short `inheritance_note`

Do not reinterpret `style_design` into a different genre, a different light source, or a different contrast system.
Do not replace the selected `ratio_design` with a more convenient local crop guess.

### 0.5. `human_presence_policy` is mandatory

Default rule:

- reusable scene asset = empty environment plate
- no visible people
- no visible human figure
- no visible character silhouette

Only allow people when unfeatured crowd mass is genuinely part of the scene itself.

Recommended machine-friendly values:

- `no_people`
- `background_crowd_only`

If `background_crowd_only` is used, the crowd must be:

- non-hero
- not individually identifiable
- part of the environmental scale, not the dramatic subject layer

### 1. `master_shot_camera_design` must be explicit

It must specify:

- shot size of the master shot
- camera height
- camera side of the axis
- composition logic
- what decisive areas this shot must cover
- why this is the stable downstream reference view

The goal is not just "show the room".

The goal is to lock the one reusable camera truth the whole location should inherit.

### 2. `master_shot_subject_blocking` must be spatial, not emotional

It should state:

- where the bed-side subject would sit or stand
- where the doorway subject would stand
- where the child / support subject would stand if present
- which side each subject faces
- what empty path, confrontation corridor, or action lane must remain visible

Even though the final scene asset is an empty plate, the blocking truth must still be written so downstream knows why the room is composed this way.

### 3. `scene_zone_map` is mandatory

Name the practical reusable play areas of the visible master shot.

Use stable downstream-friendly zone names, such as:

- `door_zone`
- `bed_zone`
- `walkway_zone`
- `desk_window_zone`
- `wardrobe_storage_zone`
- `report_drop_zone`

These names should later be reusable by scene prompts, engineering book units, and shot design.

### 4. `master_shot_lighting_design` must inherit the selected style exactly

This field is mandatory.

It must translate the selected `style_design` into room-specific lighting behavior.

It should specify:

- `source_style_design`
- `key_light_source`
- `fill_behavior`
- `practical_light_policy`
- `color_temperature_balance`
- `contrast_goal`
- `exposure_rule`

Do not replace the selected scene lighting with generic studio light.

Do not write meaningless phrases like:

- `cinematic lighting`
- `nice warm mood`
- `soft movie light`

without explaining how that appears in this exact room and from which direction.

### 5. `master_shot_environment_manifest` must be exhaustive and visible-view-specific

Describe the visible environment as if handing it directly to a detail-hungry image model.

The description must stay tied to this exact master shot.

Prefer layered organization:

- foreground
- midground
- background
- visible environment details by zone

Use [master-shot-checklist.md](references/master-shot-checklist.md) to ensure coverage.

Include concrete details for all major visible elements when they exist:

- bed type, size, frame, bedding, pillows, blanket state
- wall behind the bed, photos, art, switches, marks, shelves
- bedside table, lamp, books, phone, clutter
- door leaf, door color, handle, frame, nearby wall condition
- window shape, curtain type, curtain color, blinds if any
- desk, chair, monitor, laptop, keyboard, stationery, stacked books
- wardrobe, shelf, drying rack, coat stand, storage cabinet
- floor material, floor color, floor condition, objects on the floor
- ceiling, ceiling light, light fixture shape

### 6. `axis_continuity_locks` must protect the room's dramatic logic

State only hard continuity facts, such as:

- door stays on the left rear of the master shot
- bed stays on the right front side
- window / desk stay on the right rear
- the confrontation axis runs from doorway to bedside
- the action corridor must remain visible

### 7. `background_extract_targets` must be directly reusable

Name only practical extraction plates.

Good examples:

- `door_only_bg`
- `bed_only_bg`
- `report_drop_zone_bg`
- `desk_window_bg`
- `walkway_bg`

Each target should include:

- `target_id`
- `description`

The description should explain exactly what visible area must remain in that extracted plate.

### 8. `production_bible` stays short

Use short notes only.

It may explain:

- why this view is narratively important
- what continuity mistakes to avoid
- what can stay off-frame

It must not introduce a second competing layout.

## Output Format

The output should be compact but concrete.

A scene JSON should feel like a ready-to-use master-shot empty-plate packet.

## Constraints

1. Downstream automation reads only `control_table`.
2. The scene must be anchored to one final reusable empty-environment master-shot view.
3. `style_inheritance` is mandatory.
4. `master_shot_lighting_design` is mandatory.
5. `human_presence_policy` is mandatory.
6. `scene_zone_map` is mandatory.
7. `production_bible` must stay lightweight.
8. If the two layers conflict, `control_table` wins.
9. Output both markdown and json.
10. `style_inheritance.ratio_design` and `style_inheritance.style_design` must exactly inherit the selected type-analysis option.
