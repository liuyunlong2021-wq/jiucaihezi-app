---
name: banana-scene-prompt
description: Use when converting scene analysis results into Banana JSON prompts for the current Banana/Veo pipeline. This stage should lead with one decisive narrative identity sentence, then give layered scene control rather than one giant brute-force room dump.
---

# Banana Scene Prompt Generation

## Overview

This skill is part of the current Banana + Veo mainline.

Its job is not to summarize a room loosely.

Its job is to turn the final reusable `master shot` scene analysis into one explicit, layered asset prompt.

This model understands semantics.

So do not assume that brute-force enumeration is always the best prompt form.

The best prompt should usually:

- open with one decisive sentence that tells the model what this space is and what dramatic job it serves
- explicitly state whether the scene asset must be empty or may contain only background crowd
- the exact master-shot camera view
- the upstream scene zone naming when available
- the key visible environment anchors
- the exact scene light / color / contrast
- a realistic, detail-rich, professional scene-building tone

## Authority

Follow the active project spec first.

Current mainline reference:

- `${OPENCLAW_HOME:-~/.openclaw}/agents/flashxiaolagu制作/production-optimization-spec.md`

## Input

- `analysis/scene-analysis.json`
- `analysis/film-type-analysis.json`

This stage must inherit:

- `selected_option.ratio_design`
- `selected_option.style_design`

If `scene-analysis.json` already provides:

- `control_table.style_inheritance`
- `control_table.master_shot_lighting_design`
- `control_table.scene_zone_map`

use those fields as the scene-lighting and scene-layout authority instead of reconstructing them loosely.

Authority order:

1. `scene-analysis.json -> control_table.style_inheritance`
2. `film-type-analysis.json -> selected_option`

If these sources disagree on `ratio_design` or `style_design`, stop and flag the mismatch instead of choosing a convenient crop or rewriting the look.

## Output

- `prompts/banana-scene-prompts.md`
- `prompts/banana-scene-prompts.json`

## Required JSON Shape

```json
{
  "ratio_design": "16:9",
  "style_design": "[窗光] + [青橙色调] + [高反差] + [电影数字质感]",
  "scenes": [
    {
      "scene_id": "scene_001",
      "scene_name": "场景名称",
      "prompt": {
        "aspect_ratio": "16:9",
        "scene_identity_sentence": "一句话说明这个空间是谁的空间、承担什么剧情作用",
        "human_presence_rule": "默认 no visible people；特殊场景可允许 background crowd only",
        "master_shot_view": "终极master shot视角描述",
        "foreground_midground_background": "前中后景的关键元素分层",
        "key_visual_elements": "关键环境锚点，不必把所有次级细节都写成长篇穷举",
        "spatial_type": "开放空间/封闭空间/过渡空间",
        "lighting": {
          "setup": "布光方法",
          "color_style": "色彩风格",
          "contrast": "反差影调"
        },
        "shot_language": "镜头类型、构图方式、机位关系",
        "realism_goal": "细节丰富、真实感强、层次明确等约定性目标",
        "technical_specs": "8K resolution, photorealistic PBR textures, environment concept art, single-point perspective, zero lens distortion",
        "style_reference": "match selected style design exactly",
        "negative_prompt": "文字、字幕、水印、logo、卡通、动漫、3D渲染、插画、油画、模糊、低画质、塑料质感、错误透视、空间错位、光影不一致、过曝、复杂畸变"
      }
    }
  ]
}
```

## Writing Rules

### 1. `scene_identity_sentence` comes first

This is the highest-weight opening sentence.

It should tell the model:

- whose room or space this is
- what dramatic use the space serves in this scene
- what kind of human and narrative identity the environment should imply

Example direction:

- "A cramped bachelor bedroom where a half-awake young man is cornered by an unexpected mother-and-child intrusion."

### 1.5. `human_presence_rule` must be explicit

Default wording:

- `empty environment plate, no visible people, no human figure, no character`

Only switch to a crowd-allowed rule when crowd mass is truly part of the environmental identity.

Recommended crowd wording:

- `background crowd only, no singled-out hero person, crowd acts as environmental mass`

### 2. `master_shot_view` is the camera truth

Describe the final reusable master-shot camera view directly.

State:

- what this view covers
- where the bed is
- where the door is
- where the window / desk / wardrobe are
- what confrontation corridor or empty path remains visible
- what framing ratio this view is built for

### 3. `foreground_midground_background` should stay layered

Do not dump one flat paragraph if a layered field is clearer.

Split the visible set into front / middle / back layers when helpful.

### 4. `key_visual_elements` must stay concrete but selective

Mention the decisive visible anchors, not every low-value micro detail.

Prioritize:

- bed, mattress, bedding, pillows, blanket
- wall behind the bed
- bedside table and lamp
- door leaf, handle, frame
- window shape and curtains
- desk, chair, computer, books
- wardrobe, shelf, drying rack, cabinet
- floor, ceiling, ceiling light
- visible clutter and life traces

Let the model complete minor implied detail, but do not omit the anchors that protect continuity.

### 5. `lighting` must inherit the selected scene light exactly

Do not replace scene lighting with generic studio light.

It must match the selected `StyleDesign`.

If `scene-analysis.json` already contains `master_shot_lighting_design`, use that block as the first authority for:

- key light source
- fill behavior
- practical light policy
- color temperature balance
- contrast goal
- exposure behavior

Do not overwrite that block with generic language.

### 5.5. `aspect_ratio` is mandatory

Every scene prompt must explicitly write `prompt.aspect_ratio`.

Default rule:

- it must match `control_table.style_inheritance.ratio_design` when that field exists
- otherwise it must match `selected_option.ratio_design`
- do not silently switch to portrait because Banana is often vertical
- do not silently switch to landscape because a hotel scene looks cinematic

### 6. `shot_language` should feel like a director-level scene setup

Include only the most useful professional control:

- shot size
- camera height or side if important
- composition logic
- master-shot facing relation

If `scene-analysis.json` provides a `scene_zone_map`, keep those zone names stable in your internal reasoning so later stages do not drift.

### 7. `realism_goal` is encouraged

Use short phrases such as:

- rich lived-in detail
- strong realism
- layered visual depth
- believable apartment scale
- tactile materials

### 8. Do not overbuild dead weight

Do not stuff the prompt with low-value abstract explanation if the same control is already carried by:

- the opening sentence
- the master-shot description
- the layered visual anchors
- the lighting block

### 9. `technical_specs` stays fixed

Use:

- `8K resolution, photorealistic PBR textures, environment concept art, single-point perspective, zero lens distortion`

## Inheritance Checklist

Before writing the final JSON, verify:

- top-level `ratio_design` matches the selected type-analysis option
- top-level `style_design` matches the selected type-analysis option
- every `scenes[*].prompt.aspect_ratio` matches the inherited ratio
- `style_reference` matches the inherited style
- if `scene-analysis` provides `style_inheritance`, you did not drift from it

## Constraints

1. Output must be valid JSON.
2. The prompt must begin with a decisive narrative identity sentence.
3. The prompt must explicitly control whether people are forbidden or only background crowd is allowed.
4. The prompt must describe the final master-shot scene view.
5. The prompt must preserve exact scene lighting from the selected style.
6. If scene analysis already provides `master_shot_lighting_design`, that block should be treated as lighting authority.
7. If scene analysis already provides `scene_zone_map`, later wording should not silently rename the zones.
8. Every scene prompt must explicitly carry inherited `aspect_ratio`.
9. The prompt must stay layered and concrete without collapsing into useless brute-force text.
10. Output both markdown and json.
