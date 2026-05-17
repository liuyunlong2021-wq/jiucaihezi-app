---
name: film-character-asset
description: "Use when analyzing script characters for the current Banana/Veo short-drama pipeline. Output a dual-layer character asset spec: a slim control_table for downstream automation and a lightweight production_bible for human review and reuse."
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
- keep character identity locks upstream, but keep board layout and aspect-ratio composition downstream in `banana-character-prompt`

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

### 10. Keep layout decisions downstream

Do not persist these in `control_table`:

- 9:16 or 16:9 board layout choice
- close-up panel position
- ruler placement
- reference-sheet composition wording

Those belong to `banana-character-prompt`, because they are generation-format decisions rather than stable character identity.

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
3. If the two layers conflict, `control_table` wins.
4. Output both markdown and json.
5. `portrait_eye_lock` / `beauty_calibration` / `height_reference_cm` are optional, not mandatory.
6. Layout and aspect-ratio composition instructions must stay downstream.
