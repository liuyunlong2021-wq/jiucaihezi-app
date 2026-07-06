---
name: JC-manju-daoju
description: Use when analyzing script props for the current Banana/Veo short-drama pipeline. Output a triple-layer prop asset spec: control_table (automation), production_bible (human review), and banana_prompts (Banana Pro JSON for image generation). Specific enough for detail-hungry downstream image models.
triggers:
  - "道具分析"
  - "道具设定"
  - "道具清单"
  - "prop asset"
  - "物品分析"
  - "banana道具"
  - "道具生图"
---

# Prop Asset

## Overview

This skill must not stop at generic prop labels.

It must output a dual-layer structure:

- `control_table`
- `production_bible`

Rules:

- downstream automation reads only `control_table`
- `production_bible` is only for lightweight human review and reuse
- if the two layers conflict, `control_table` wins

## Authority

This skill should follow the active project spec first.

Current mainline reference:

- `${OPENCLAW_HOME:-~/.openclaw}/agents/flashxiaolagu制作/production-optimization-spec.md`

If the user is explicitly running another preserved baseline with its own local spec, that local spec can override this reference.

## Core Principles

- ordinary props keep only generation-critical structure
- document props must turn layout into reusable blocks
- books and packaging must preserve front / back / side information when visible
- continuity notes stay lightweight
- remove long story explanation and decorative analysis
- `production_bible` must not add new visible structure that is absent from `control_table`

## When to Use

- when a project starts building prop specs
- when key hand-held or insert props need stable generation control
- when file props, books, boxes, posters, or labeled objects need reusable layout facts

## Input

- full script text

## Output

- `analysis/prop-analysis.md`
- `analysis/prop-analysis.json`
- `prompts/banana-prop-prompts.json` — Banana Pro JSON prompts for prop image generation

## Required Structure

Each prop must contain:

- `prop_id`
- `name`
- `category`
- `control_table`
- `production_bible`

### control_table keep only

- `size`
- `structure`
- `view_manifest`
- `visible_markings`
- `layout_blocks`
- `material`
- `condition`

### production_bible keep only

- `story_role_note`
- `hero_view_note`
- `continuity_watchlist`
- `text_handling_note`

## What To Remove

Do not keep these as default persisted output:

- long plot explanation
- decorative analysis that does not affect generation
- emotional meaning paragraphs

## Writing Rules

### 1. `size` must stay measurable

Keep:

- dimensions
- proportion
- page count if file
- handheld / desktop scale if object

### 2. `structure` must stay visible

Keep:

- form
- opening / closing structure
- binding / handle / fastener / fold / hinge details
- shape-relevant color blocks only if needed for recognition

### 3. `view_manifest` is mandatory when side information matters

For any hero prop whose different sides matter, specify the visible design of:

- front
- back
- spine / side thickness
- top / bottom if useful

This is especially important for:

- books
- notebooks
- folders
- medicine boxes
- packaging
- framed items

### 4. `visible_markings` must stay screen-facing

Keep:

- logo
- stamp
- barcode
- serial number
- large readable title block
- cover title / subtitle / author when visible

### 5. `layout_blocks` are mandatory for files

If the prop is a report / contract / poster / ID / certificate, `layout_blocks` must describe:

- page orientation
- header block
- title block
- body block groups
- signature / stamp block
- footer block

If the prop is a book, also describe:

- title
- subtitle
- author
- publisher mark if visible
- front cover graphics
- spine text
- back cover graphics or summary block if visible

### 6. `material` and `condition` must stay short

Keep only:

- material type / finish
- age / freshness
- folds / wear / dirt / damage

### 7. `production_bible` must stay lightweight

Use short notes only.

## Constraints

1. Downstream automation reads only `control_table`.
2. `view_manifest` is required whenever side or reverse information matters.
3. `production_bible` must stay lightweight.
4. If the two layers conflict, `control_table` wins.
5. Output both markdown and json.
6. `banana_prompts` inherits `ratio_design` and `style_design` from `film-type-analysis` selected option.

---

## Banana Pro Prop Prompt Generation

This section converts `control_table` fields into machine-readable Banana Pro JSON prompts for prop asset image generation.

### Input

- `analysis/prop-analysis.json` (the `control_table` fields)
- `analysis/film-type-analysis.json` (for `selected_option.ratio_design` and `selected_option.style_design`)

### Output

- `prompts/banana-prop-prompts.json`

### JSON Structure

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
        "negative_prompt": "text corruption, watermark, stylization, CGI feel, plastic toy look, unrealistic glossy material"
      }
    }
  ]
}
```

### Field Mapping from control_table

| Banana Prompt Field | control_table Source |
|---|---|
| `description` | `structure` + `material` + `condition` + `visible_markings` |
| `type` | `category` |
| `camera_angle` | Infer from `view_manifest` — primary viewing angle |

### Writing Rules

1. **description stays concrete**: shape, thickness, material, surface finish, visible text blocks, stamps, barcodes, logos, wear marks.

2. **books/documents/packaging preserve side info**: front + spine/side + back or macro detail.

3. **layout_instruction matches prop type**:
   - Hero prop: front + side + macro detail
   - Book/packaging: front + spine/side + back
   - Document: readable front layout sheet or front + detail panels
   - Portrait ratio → compact stacked reference board; landscape → wider left-to-right board

4. **lighting stays neutral**: soft studio lighting, pure white seamless background. Do not replace with scene-style lighting — `style_design` is branch metadata only.

5. **technical_specs fixed**: `8K resolution, photorealistic PBR textures, zero distortion`.

6. **negative_prompt required**: text corruption, watermark, stylization, CGI feel, plastic toy look, unrealistic glossy material.

## 指令

```commands
道具资产规格: 请用道具资产 Skill 帮我把剧本中的道具转为资产规格：
道具：[道具名]
剧本描述：[粘贴相关描述]
输出双层道具资产规格。
```
