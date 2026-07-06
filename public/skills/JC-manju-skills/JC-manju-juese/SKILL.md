---
name: JC-manju-juese
description: "Use when analyzing script characters for the current Banana/Veo short-drama pipeline. Output a triple-layer character asset spec: control_table (automation), production_bible (human review), and banana_prompts (Banana Pro JSON for image generation)."
triggers:
  - "角色分析"
  - "人物设定"
  - "角色资产"
  - "character asset"
  - "角色卡"
  - "banana角色"
  - "角色生图"
  - "banana character"
  - "角色转图"
---

# Character Asset

## Overview

This skill no longer writes long character analysis.

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

- infer only what is visually necessary and script-grounded
- keep only fields that directly stabilize asset generation and continuity
- remove personality prose, repeated explanation, and non-visual duplication
- keep the default asset state reusable, neutral, and easy to cut out
- `production_bible` must never introduce new hard facts that are missing from `control_table`
- keep character identity locks upstream; board layout and aspect-ratio composition are handled in the Banana Prompt Generation section below

## When to Use

- at project start, after `film-type-analysis`
- when building stable character assets for image and video continuity
- when downstream prompts need hard visual control fields

## Input

- full script text
- `analysis/film-type-analysis.json`

## Output

- `analysis/character-analysis.md`
- `analysis/character-analysis.json`
- `prompts/banana-character-prompts.json` — Banana Pro JSON prompts for image generation

## Required Structure

Each character must contain:

- `char_id`
- `name`
- `control_table`
- `production_bible`

### control_table keep only

- `age_range`
- `face_structure`
- `hair`
- `costume_layers`
- `shoes_socks`
- `body_type`
- `stable_expression_baseline`
- `stable_asset_pose_baseline`
- optional advanced locks only when they materially stabilize downstream asset generation:
  - `portrait_eye_lock`
  - `beauty_calibration`
  - `height_reference_cm`

### production_bible keep only

- `identity_label`
- `recognition_locks`
- `continuity_watchlist`
- `scene_state_notes`

## What To Remove

Do not keep these as default persisted output:

- long personality analysis
- long script-evidence blocks
- emotional interpretation
- repeated description of the same face / costume facts
- long continuity paragraphs

## Writing Rules

### 1. face_structure must stay executable

Use compact visible fields only, such as:

- face shape
- eye shape
- iris color
- eyebrows
- nose
- mouth
- chin
- ears / ear accessories
- skin tone

### 2. hair must stay reusable

Keep only:

- length
- style
- parting / bangs
- color
- stable hair accessories

### 3. body_type must stay screen-readable

Keep only:

- height impression
- build
- shoulder line
- silhouette-relevant stable detail only if visible

### 4. costume_layers must stay layered

Keep only the default visible layers:

- upper layers
- lower layers
- stable accessories if they visually belong to the character baseline

### 5. stable baselines must be explicit

`stable_expression_baseline` must be a neutral reusable expression.

`stable_asset_pose_baseline` must default to:

- natural front-facing standing pose
- calm neutral expression
- both hands visible
- full body visible
- no story prop in hand unless it is part of the stable identity
- white / clean background for cutout reuse

### 6. production_bible must stay lightweight

Use only short bullets or short noun phrases.

Do not turn it back into a long production essay.

### 7. portrait_eye_lock is optional but useful

Use `portrait_eye_lock` only when portrait consistency matters or the role has a known risk of drifting into closed-eye beauty shots.

Good examples:

- `双眼清晰睁开，瞳孔完整可见`
- `眼神平静清醒，不要闭眼，不要眯眼`

This is a character-level visual lock, so it belongs upstream when needed.

### 8. beauty_calibration must stay restrained

Use `beauty_calibration` only when the role clearly needs elevated beauty control for downstream asset generation, such as:

- 知性优雅
- 高知感
- 高级美感
- 明星相
- 富养感 / 高门第感

Recommended compact values:

- `natural`
- `refined`
- `refined_star_presence`

Do not use it to invent a different face.

It only calibrates how polished and screen-ready the beauty level should be.

### 9. height_reference_cm is optional and must be grounded

Only add `height_reference_cm` when:

- the script explicitly gives a height
- the user gives a height
- downstream compositing requires a confirmed technical height reference

Do not guess a numeric height from vague prose.

If no confirmed numeric height exists, keep only `body_type.height_impression`.

### 10. Layout decisions live in Banana Prompt Generation

Layout decisions (board ratio, panel positions, reference-sheet composition) are handled in the Banana Prompt Generation section below, not in `control_table`.

## Output Format

### Markdown

```markdown
## character_001

**Control Table**
- age_range: 25岁左右
- face_structure:
  - 脸型：鹅蛋脸
  - 眼型：偏长杏眼
  - 瞳色：深棕
  - 眉毛：平直细眉
  - 鼻子：鼻梁细直，鼻尖小巧
  - 嘴：上薄下中等，嘴角自然下压
  - 下巴：圆润偏窄
  - 耳朵：耳垂小，细金耳钉
  - 肤色：自然白偏暖
- hair:
  - 长度：锁骨长度
  - 发型：顺直，三七侧分
  - 发色：深棕黑
- body_type:
  - 身高感：中等偏高
  - 体型：纤细但不单薄
  - 肩线：窄肩
- costume_layers:
  - 上装：米白针织开衫 + 浅杏圆领内搭
  - 下装：浅灰蓝高腰半裙
  - 稳定配饰：细金耳钉、细金项链、细表带腕表
- shoes_socks:
  - 裸色短袜
  - 浅米色低跟鞋
- stable_expression_baseline: 自然平静表情
- stable_asset_pose_baseline: 自然正面站姿，双手可见，全身完整，白底可抠图
- portrait_eye_lock: 双眼清晰睁开，瞳孔完整可见
- beauty_calibration: refined

**Production Bible**
- identity_label: 独立设计师 / 女主角
- recognition_locks:
  - 偏长杏眼
  - 锁骨长度深棕直发
  - 米白到浅杏色层叠穿搭
- continuity_watchlist:
  - 不要浓妆
  - 不要丢掉耳钉和腕表
  - 不要把针织外套改成西装
- scene_state_notes: 无
```

### JSON

```json
{
  "characters": [
    {
      "char_id": "character_001",
      "name": "林晓",
      "control_table": {
        "age_range": "25岁左右",
        "face_structure": {
          "face_shape": "鹅蛋脸",
          "eye_shape": "偏长杏眼",
          "iris_color": "深棕",
          "eyebrows": "平直细眉",
          "nose": "鼻梁细直，鼻尖小巧",
          "mouth": "上薄下中等，嘴角自然下压",
          "chin": "圆润偏窄",
          "ears": "耳垂小，细金耳钉",
          "skin_tone": "自然白偏暖"
        },
        "hair": {
          "length": "锁骨长度",
          "style": "顺直，三七侧分",
          "color": "深棕黑",
          "hair_accessories": []
        },
        "body_type": {
          "height_impression": "中等偏高",
          "build": "纤细但不单薄",
          "shoulder_line": "窄肩"
        },
        "costume_layers": {
          "upper_layers": [
            "米白色针织开衫",
            "浅杏色圆领内搭"
          ],
          "lower_layers": [
            "浅灰蓝高腰半裙"
          ],
          "stable_accessories": [
            "细金耳钉",
            "细金项链",
            "细表带腕表"
          ]
        },
        "shoes_socks": [
          "裸色短袜",
          "浅米色低跟鞋"
        ],
        "stable_expression_baseline": "自然平静表情",
        "stable_asset_pose_baseline": "自然正面站姿，双手可见，全身完整，白底可抠图",
        "portrait_eye_lock": "双眼清晰睁开，瞳孔完整可见",
        "beauty_calibration": "refined"
      },
      "production_bible": {
        "identity_label": "独立设计师 / 女主角",
        "recognition_locks": [
          "偏长杏眼",
          "锁骨长度深棕直发",
          "米白到浅杏色层叠穿搭"
        ],
        "continuity_watchlist": [
          "不要浓妆或夸张笑容",
          "不要丢掉耳钉和腕表",
          "不要把针织外套误生成为西装"
        ],
        "scene_state_notes": []
      }
    }
  ]
}
```

## Constraints

1. Downstream automation reads only `control_table`.
2. `production_bible` must stay lightweight.
3. `banana_prompts` inherits `ratio_design` and `style_design` from `film-type-analysis` selected option.

---

## Banana Pro Prompt Generation

This section converts `control_table` fields into machine-readable Banana Pro JSON prompts for character asset image generation.

### Input

- `analysis/character-analysis.json` (the `control_table` fields)
- `analysis/film-type-analysis.json` (for `selected_option.ratio_design` and `selected_option.style_design`)

### Output

- `prompts/banana-character-prompts.json`

### Quick Reference

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

### JSON Structure

For each character state, generate:

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

### Detail Filling Rules

**identity**: Format as "occupation, around XX years old" in English.

**face**: Infer from `control_table.face_structure`. Expression: always "neutral expression". Unless `control_table` explicitly requests otherwise, eyes should be clearly open and both pupils visible.

**body**: Translate from `control_table.body_type`. Posture: always "natural standing posture".

**hair**: Translate from `control_table.hair`.

**clothing_layers**: Extract from `control_table.costume_layers`. Infer materials from style context.

**accessories**: From `control_table.costume_layers.stable_accessories`. If none: "none".

**lighting** (FIXED): setup: "soft studio lighting", background: "pure white background, no gradient, no texture". The selected `style_design` is carried as branch metadata only — asset-sheet lighting stays neutral.

**technical_specs** (FIXED): "8K resolution, photorealistic PBR textures, zero distortion".

**negative_prompt** (FIXED): strong exclusions for text, watermark, stylization, CGI feel, anatomy errors, complex background, ugly panel layout.

### Beauty Uplift Rule

If `control_table.beauty_calibration` exists:
- `natural` → stay realistic, do not actively elevate
- `refined` → restrained premium beauty wording
- `refined_star_presence` → stronger star-presence phrasing while staying photorealistic

Target: refined star presence, memorable screen face, elegant bone structure, polished but realistic. Avoid: perfect doll face, anime beauty, exaggerated glamour, heavy makeup, influencer face.

Beauty uplift lives in: `subject.identity`, `subject.face.structure`, `subject.face.eyes`, `subject.face.skin_micro`.

### Eye Visibility Rule

If `control_table.portrait_eye_lock` exists, use it as the strongest authority. For elegant female roles, avoid: lowered eyelids, eyes closed, downcast eyes, meditative gaze. Prefer: eyes clearly open, calm intelligent gaze, both pupils clearly visible. Add to negative_prompt: `闭眼`, `眯眼`, `低头闭目`, `看不见瞳孔`.

### Aspect Ratio Layout Recipes

**Portrait 9:16 board**: Balanced 2x2 editorial board. Top-left: refined close-up portrait from upper chest up. Top-right: full-body front view. Bottom-left: full-body three-quarter view. Bottom-right: full-body rear view. Generous white space.

**Landscape 16:9 board**: Left-to-right reading. Far left: close-up portrait. Middle: three-quarter + rear views. Far right: large full-body front anchor panel. Elegant and airy.

### Height Reference Mode

Only when downstream compositing or multi-character scale matching requires it: attach a clean vertical ruler to the full-body panel. Do not enable by default.
3. If the two layers conflict, `control_table` wins.
4. Output both markdown and json.
5. `portrait_eye_lock` / `beauty_calibration` / `height_reference_cm` are optional, not mandatory.
6. Layout and aspect-ratio composition instructions must stay downstream.

## 指令

```commands
角色资产规格: 请用角色资产 Skill 帮我把剧本角色转为资产规格：
角色名：[角色名]
剧本片段：[粘贴相关剧本]
输出 Banana图生图+Veo图生视频 双层规格。
```
