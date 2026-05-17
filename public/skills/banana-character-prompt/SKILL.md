---
name: banana-character-prompt
description: Use when converting character analysis results into Banana JSON prompts for text-to-image generation. This model benefits from explicit detail, reference-sheet layout, and strong negative constraints.
---

# Banana Pro Character Prompt Generation

## Overview

Converts character analysis JSON into Banana prompt JSON for generating reusable character asset sheets.

This model is detail-hungry.

So the prompt should not be overly minimal.

It should:

- preserve all hard visual facts from analysis
- keep pure white background
- keep neutral expression
- keep eyes clearly open unless the role explicitly requires closed eyes
- keep full-body visibility
- prefer a multi-panel reference-sheet layout
- include a strong negative prompt

## When to Use

Use this skill when:
- Have completed character analysis (film-character-asset output)
- Need to generate Banana Pro prompts for character assets
- Ready to create character reference images
- Need JSON format prompts (not natural language)
- After film-character-asset, before calling image generation API

## Input

- `analysis/character-analysis.json` - Character analysis results
- `analysis/film-type-analysis.json` - Type analysis

This stage must inherit:

- `selected_option.ratio_design`
- `selected_option.style_design`

Authority order:

1. `character-analysis.json` hard visual facts and control locks
2. `film-type-analysis.json -> selected_option` for branch ratio and branch style metadata

If the selected option is missing `ratio_design` or `style_design`, stop and request a corrected upstream file instead of guessing.

## Output

- `prompts/banana-character-prompts.json` - Banana Pro JSON prompts

## Quick Reference

| JSON Field | Content | Fixed/Variable |
|------------|---------|----------------|
| subject.identity | "occupation, around XX years old" | Variable |
| subject.face | Structure, eyes, nose, lips, skin, expression | Variable + Fixed expression |
| hair | Style, color, texture | Variable |
| clothing_layers | Layer, description, material, decoration | Variable |
| accessories | Accessory list | Variable |
| lighting.setup | "soft studio lighting" | Fixed |
| lighting.background | "pure white background, no gradient, no texture" | Fixed |
| technical_specs | "8K resolution, photorealistic PBR textures, zero distortion" | Fixed |
| layout_instruction | aspect-ratio-aware premium editorial character reference board | Fixed |
| negative_prompt | artifact / stylization / anatomy exclusions | Fixed |

## Implementation

### Step 1: Read Character Analysis

Extract from character-analysis.json:
- Basic info (identity, age)
- Appearance (hair, body, face)
- Costume style (style, colors, items)
- Visual identifiers (signature colors, accessories)
- State changes (how many costumes to generate)
- Optional advanced locks when present:
  - `control_table.portrait_eye_lock`
  - `control_table.beauty_calibration`
  - `control_table.height_reference_cm`

### Step 2: Build JSON Structure

For each character state, create JSON object following Banana Pro format:

```json
{
  "ratio_design": "9:16",
  "style_design": "[窗光] + [青橙色调] + [高反差] + [电影数字质感]",
  "characters": [
    {
      "char_id": "character_001",
      "name": "角色名",
      "state": "默认状态",
      "ratio_design": "9:16",
      "style_design": "[窗光] + [青橙色调] + [高反差] + [电影数字质感]",
      "prompt": {
        "subject": {
          "identity": "occupation, around XX years old",
          "face": {
            "structure": "face shape description",
            "eyes": "eye shape, pupil color, lashes",
            "nose": "nose bridge, tip, wings",
            "lips": "lip shape, thickness, color",
            "skin_micro": "skin tone, texture, details",
            "expression": "neutral expression"
          },
          "body": {
            "build": "body type, proportions",
            "posture": "natural standing posture"
          }
        },
        "hair": {
          "style": "hair style",
          "color": "hair color",
          "texture": "hair texture"
        },
        "clothing_layers": [
          {
            "layer": "top/bottom/outerwear",
            "description": "style, color, cut",
            "material": "fabric, texture",
            "decoration": "decorative details"
          }
        ],
        "accessories": "accessory list or none",
        "lighting": {
          "setup": "soft even studio lighting",
          "background": "pure white background"
        },
        "technical_specs": "8K resolution, photorealistic PBR textures, zero distortion",
        "layout_instruction": "Premium editorial character reference board, balanced 2x2 grid on pure white background with generous clean margins and elegant visual hierarchy. Panel 1: full-body front view, centered, full feet visible. Panel 2: full-body three-quarter view. Panel 3: full-body rear view. Panel 4: refined close-up portrait from upper chest up showing skin texture and facial micro-details. Keep face, body, hair, and costume fully consistent across panels. Soft even studio lighting, very subtle grounding shadow only, flat clean composition, isolated on pure white background, no text, no labels.",
        "negative_prompt": "文字、字幕、水印、logo、卡通、动漫、3D渲染、插画、油画、模糊、低画质、塑料皮肤、无毛孔皮肤、美颜滤镜、蜡像质感、CGI感、过饱和、镜头光晕、多余手指、肢体变形、肢体缺失、手指融合、解剖错误、复杂背景、排版混乱、面板错位、边距不均、主体过小、主体被裁切、脚部缺失、头顶缺失"
      }
    }
  ]
}
```

### Step 3: Detail Filling Rules

**identity**: Format as "occupation, around XX years old" in English

**face**:
- Infer from analysis or reasonable defaults
- expression: Always "neutral expression"
- unless explicitly requested otherwise, eyes should be clearly open and both pupils should remain visible in the portrait panel

### Step 3D: Beauty Uplift Rule

If `control_table.beauty_calibration` exists, treat it as the upstream authority.

Suggested mapping:

- `natural` -> stay realistic and attractive, but do not actively elevate beauty
- `refined` -> use restrained premium beauty wording
- `refined_star_presence` -> allow stronger star-presence phrasing while staying photorealistic

When the role is an elegant, wealthy, glamorous, or high-status woman, it is acceptable to lift the beauty level while staying photorealistic.

Target qualities:

- refined star presence
- memorable screen face
- elegant bone structure
- polished but realistic luxury beauty
- not influencer-style, not over-retouched, not plastic

Prefer wording such as:

- `refined star-quality beauty`
- `memorable screen presence`
- `elegant high-end facial harmony`
- `polished but realistic complexion`

Avoid wording such as:

- perfect doll face
- anime beauty
- exaggerated glamour
- heavy makeup mask
- influencer face

Beauty uplift should primarily live in:

- `subject.identity`
- `subject.face.structure`
- `subject.face.eyes`
- `subject.face.skin_micro`

Do not break realism, age fit, or role consistency just to make the character prettier.

**body**:
- Translate body type from analysis
- posture: Always "natural standing posture"

**hair**:
- Translate hair style from analysis
- Infer color if not specified (young→black/brown)

**clothing_layers**:
- Extract from costume style items
- Use signature colors from visual identifiers
- Infer materials from style (business→wool, casual→denim)

**accessories**:
- Extract from visual identifiers
- If none, use "none"

**lighting** (FIXED):
- setup: "soft studio lighting"
- background: "pure white background, no gradient, no texture"

The selected `style_design` should not replace this white-background studio-light setup.
Carry the selected style as branch metadata, but keep asset-sheet lighting neutral and stable.

**technical_specs** (FIXED):
- "8K resolution, photorealistic PBR textures, zero distortion"

**layout_instruction** (FIXED):
- use a premium editorial reference board instead of a stiff utility strip
- choose layout based on the inherited `ratio_design`
- for portrait boards, prefer a balanced 2x2 layout with generous white space
- for landscape boards, prefer one large full-body anchor panel plus three supporting panels
- include front full body, three-quarter full body, rear full body, and one face detail panel unless a height-reference mode needs a different emphasis
- keep consistent panel scale, clean margins, and subtle visual hierarchy
- do not silently switch portrait and landscape layouts

**negative_prompt** (FIXED):
- include strong exclusions for text, watermark, stylization, CGI feel, anatomy errors, complex background, and ugly panel layout

### Step 3A: Eye Visibility Rule

If `control_table.portrait_eye_lock` exists, use it as the strongest authority for portrait-eye wording.

For elegant or restrained female roles, avoid wording that can drift into closed-eye beauty shots.

Do not use:

- lowered eyelids
- eyes closed
- downcast eyes
- meditative gaze

Prefer:

- eyes clearly open
- calm intelligent gaze
- both pupils clearly visible
- elegant and self-possessed presence

If the portrait panel is important, reinforce eye visibility in both:

- `subject.face.eyes`
- `layout_instruction`

and add matching exclusions to `negative_prompt`:

- `闭眼`
- `眯眼`
- `低头闭目`
- `看不见瞳孔`

### Step 3B: Aspect Ratio Layout Recipes

**Portrait 9:16 board**

- use a balanced 2x2 editorial board
- if beauty is the priority, prefer the close-up portrait in the top-left panel
- keep the remaining three panels as full-body front, full-body three-quarter, and full-body rear
- maintain generous white space so the board still feels premium instead of cramped

Recommended portrait `layout_instruction` pattern:

`Premium editorial character reference board, balanced 2x2 grid on pure white background with generous clean margins and elegant visual hierarchy. Top-left panel must be the refined close-up portrait from upper chest up. Top-right panel: full-body front view, centered, full feet visible. Bottom-left panel: full-body three-quarter view. Bottom-right panel: full-body rear view. Keep face, body, hair, and costume fully consistent across panels. Soft even studio lighting, very subtle grounding shadow only, flat clean composition, isolated on pure white background.`

**Landscape 16:9 board**

- use a left-to-right reading order with the close-up portrait on the far left
- place supporting three-quarter / rear panels in the middle area
- place the full-body anchor panel on the far right
- if height-reference mode is enabled, attach the clean vertical ruler to the far-right full-body panel
- keep the board elegant and airy rather than symmetric for its own sake

Recommended landscape `layout_instruction` pattern:

`Premium editorial character reference board, cinematic 16:9 landscape layout on pure white background. Far left: refined close-up portrait from upper chest up, elegant and clear. Middle upper area: full-body three-quarter view. Middle lower area: full-body rear view or clean outfit-detail support panel. Far right: one large full-body front-view anchor panel, centered, full feet visible. Keep consistent facial identity, body proportions, hairstyle, and costume across all panels. Generous margins, elegant spacing, soft even studio lighting, very subtle grounding shadow only, no clutter, no labels unless height-reference mode is explicitly requested.`

### Step 3C: Height Reference Mode

Use this only when downstream compositing or multi-character scale matching matters.

In height-reference mode:

- keep one dominant full-body front-view panel
- place a clean vertical height ruler beside that panel
- if `control_table.height_reference_cm` exists, use that exact value for the single subtle height label
- if no confirmed numeric height exists, keep the ruler but do not invent a fake centimeter number
- keep all other panels free of text
- treat the height marker as a technical reference, not a design decoration

Recommended landscape height-reference pattern:

`Premium editorial character reference board, cinematic 16:9 landscape layout on pure white background. Far left: refined close-up portrait from upper chest up with both eyes clearly open and visible. Middle upper area: full-body three-quarter view. Middle lower area: full-body rear view. Far right: one large full-body front-view anchor panel, centered, full feet visible, with a clean vertical height ruler beside the figure and one subtle confirmed height label when available. Keep consistent face, body, hair, and costume across all panels. Elegant spacing, soft even studio lighting, very subtle grounding shadow only, only one allowed text label for the height reference.`

### Step 4: Multi-State Handling

If character has multiple states:
- Generate separate JSON object for each state
- Keep face, body, hair consistent
- Only change clothing_layers
- Add "state_name" field to identify state

## Branch Inheritance Checklist

Before writing the final JSON, verify:

- top-level `ratio_design` matches the selected type-analysis option
- top-level `style_design` matches the selected type-analysis option
- every character item repeats the same inherited `ratio_design` / `style_design`
- `layout_instruction` follows the inherited ratio branch
- white-background studio lighting stays fixed and is not replaced by scene-style lighting

## Output Format

```json
{
  "ratio_design": "9:16",
  "style_design": "[窗光] + [青橙色调] + [中高反差] + [阿莱Alexa质感]",
  "characters": [
    {
      "char_id": "character_001",
      "name": "林晓",
      "state": "默认状态",
      "ratio_design": "9:16",
      "style_design": "[窗光] + [青橙色调] + [中高反差] + [阿莱Alexa质感]",
      "prompt": {
        "subject": {
          "identity": "independent designer, around 25 years old",
          "face": {
            "structure": "oval face, delicate features",
            "eyes": "almond-shaped eyes, dark brown pupils, long natural lashes",
            "nose": "high nose bridge, refined tip",
            "lips": "full lips, natural pink color",
            "skin_micro": "fair smooth skin, fine pores, natural texture",
            "expression": "neutral expression"
          },
          "body": {
            "build": "slender build, balanced proportions",
            "posture": "natural standing posture"
          }
        },
        "hair": {
          "style": "long hair, slightly wavy",
          "color": "dark brown",
          "texture": "smooth and glossy"
        },
        "clothing_layers": [
          {
            "layer": "top",
            "description": "beige knit sweater, V-neck, long sleeves",
            "material": "soft wool blend, fine knit texture",
            "decoration": "minimal design"
          },
          {
            "layer": "bottom",
            "description": "light pink long skirt, ankle length, flowing",
            "material": "linen fabric, natural drape",
            "decoration": "simple waistband"
          }
        ],
        "accessories": "simple silver necklace",
        "lighting": {
          "setup": "soft even studio lighting",
          "background": "pure white background"
        },
        "technical_specs": "8K resolution, photorealistic, full-body portrait",
        "layout_instruction": "Premium editorial character reference board, balanced 2x2 grid on pure white background with generous clean margins and elegant visual hierarchy. Panel 1: full-body front view, centered, full feet visible. Panel 2: full-body three-quarter view. Panel 3: full-body rear view. Panel 4: refined close-up portrait from upper chest up showing skin texture and facial micro-details. Keep face, body, hair, and costume fully consistent across panels. Soft even studio lighting, very subtle grounding shadow only, flat clean composition, isolated on pure white background, no text, no labels."
      }
    }
  ]
}
```

## Common Mistakes

❌ **Prompt过于简略**: Don't collapse the prompt into a bare one-line asset label
✓ **细节保留**: This model rewards explicit face / costume / accessory detail

❌ **Changing fixed fields**: Don't remove lighting, background, technical_specs, layout_instruction, or negative_prompt
✓ **Keep fixed**: Always use exact fixed values for these fields

❌ **Invalid JSON**: Don't create malformed JSON with syntax errors
✓ **Valid JSON**: Ensure proper quotes, commas, brackets

❌ **Inventing details**: Don't add character features not in analysis
✓ **Analysis-based**: Extract from analysis, infer reasonably from identity

❌ **Non-neutral expression**: Don't use "smiling" or "serious"
✓ **Neutral only**: Always "neutral expression"

❌ **Crowded ugly layout**: Don't allow cramped panels, uneven spacing, or cropped feet
✓ **Editorial board**: Keep a balanced 2x2 board with clear white space and stable scale

## Constraints

1. **Valid JSON**: Output must be syntactically correct JSON
2. **Analysis-based**: All content from character analysis or reasonable inference
3. **Inherited branch metadata**: top-level and per-character `ratio_design` / `style_design` must match the selected type-analysis option
4. **Fixed constraints**: lighting, technical_specs, layout_instruction must use exact fixed values
5. **Layout follows ratio**: portrait and landscape board recipes must follow the inherited `ratio_design`
6. **Full-body requirement**: first three panels must keep full-body visibility with feet intact
7. **Neutral expression**: expression must include "neutral expression"
8. **White background**: background must be pure white with no gradient or texture
9. **English output**: All JSON content in English
10. **Negative prompt required**: must include a strong negative prompt
