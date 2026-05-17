---
name: banana-prop-prompt
description: Use when converting prop analysis results into Banana JSON prompts for the current Banana/Veo pipeline. This stage should preserve visible structure, layout blocks, multi-view detail, and generation-critical markings.
---

# Banana Prop Prompt Generation

## Overview

This skill is part of the current Banana + Veo mainline.

The prompt should preserve:

- shape and dimensions
- visible markings
- document or cover layout
- front / side / back information when useful
- a clean white-background reference-sheet presentation when helpful

## Authority

Follow the active project spec first.

Current mainline reference:

- `${OPENCLAW_HOME:-~/.openclaw}/agents/flashxiaolagu制作/production-optimization-spec.md`

## Input

- `analysis/prop-analysis.json`
- `analysis/film-type-analysis.json`

This stage must inherit:

- `selected_option.ratio_design`
- `selected_option.style_design`

Authority order:

1. `prop-analysis.json` visible structure, layout blocks, markings, and multi-view needs
2. `film-type-analysis.json -> selected_option` for branch ratio and branch style metadata

If the selected option is missing `ratio_design` or `style_design`, stop and request a corrected upstream file instead of guessing.

## Output

- `prompts/banana-prop-prompts.md`
- `prompts/banana-prop-prompts.json`

## Required JSON Shape

```json
{
  "ratio_design": "16:9",
  "style_design": "[窗光] + [青橙色调] + [高反差] + [电影数字质感]",
  "props": [
    {
      "prop_id": "prop_001",
      "prop_name": "道具名称",
      "category": "文件/报告",
      "ratio_design": "16:9",
      "style_design": "[窗光] + [青橙色调] + [高反差] + [电影数字质感]",
      "prompt": {
        "type": "麦格芬/象征/功能",
        "description": "形状、材质、颜色、细节",
        "lighting": {
          "setup": "中性摄影棚柔光",
          "background": "纯白色无缝背景"
        },
        "camera_angle": "主要观看角度",
        "technical_specs": "8K resolution, photorealistic PBR textures, zero distortion",
        "style_reference": "camera / lens / material reference if useful",
        "layout_instruction": "multi-panel prop reference sheet",
        "negative_prompt": "artifact / stylization exclusions"
      }
    }
  ]
}
```

## Writing Rules

### 1. `description` must stay concrete

Keep:

- shape
- thickness
- material
- surface finish
- visible text blocks
- stamps, barcodes, logos, wear marks

### 2. books, reports, and packages must preserve side information

If side information matters, include it in the description and layout plan:

- front
- back
- spine / thickness
- macro material or print detail

### 3. `layout_instruction` should match the prop type

Recommended patterns:

- ordinary hero prop: front + side + macro detail
- book / packaging: front + spine/side + back or macro detail
- document: readable front layout sheet or front + detail panels

It should also respect the inherited `ratio_design`:

- portrait ratio -> compact stacked reference board
- landscape ratio -> wider left-to-right reference board
- do not silently swap portrait and landscape board logic

### 4. `technical_specs` stays fixed

Use:

- `8K resolution, photorealistic PBR textures, zero distortion`

The selected `style_design` should remain branch metadata.
Do not replace the neutral white-background reference-sheet lighting with scene-style lighting.

### 5. `negative_prompt` is required

Exclude:

- text corruption
- watermark
- stylization
- CGI feel
- plastic toy look
- unrealistic glossy material

## Inheritance Checklist

Before writing the final JSON, verify:

- top-level `ratio_design` matches the selected type-analysis option
- top-level `style_design` matches the selected type-analysis option
- every prop item repeats the same inherited `ratio_design` / `style_design`
- `layout_instruction` matches the inherited ratio branch
- studio reference lighting stays neutral and is not overwritten by scene-style lighting

## Constraints

1. Output must be valid JSON.
2. The prompt must preserve visible structure and markings.
3. Top-level and per-prop `ratio_design` / `style_design` must match the selected type-analysis option.
4. Hero props should usually use a multi-panel layout.
5. `layout_instruction` must follow the inherited ratio branch.
6. Negative prompt is required.
7. Output both markdown and json.
