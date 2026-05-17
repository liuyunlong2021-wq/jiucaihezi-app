---
name: film-engineering-book
description: Use when converting raw script into a material engineering book before shot design. This stage translates audience-facing script into production-facing reusable material units such as dialogue coverage, action chain fragments, reveals, inserts, resets, and reactions for downstream shot design.
---

# Film Engineering Book

## Overview

This skill sits between raw script and `film-shot-design`.

Its job is not to design final camera prompts.

Its job is to convert the audience-facing script into a production-facing material engineering book.

Think of it as the bridge between:

- what the audience reads in the script
- what the production system needs as usable material units

One scene should become many reusable material units.

One unit is not just "one sentence".

One unit is:

- one editable material purpose
- one clear visual-emotional function
- one downstream-readable payload for `film-shot-design`

This stage exists to stop a common failure:

- the raw script only describes story outcome
- downstream has to guess where the usable cuts are
- the final storyboard loses edit rhythm, coverage logic, and emotional escalation

For example:

- a two-person dialogue scene may need geography, over-shoulder exchange, singles, reaction pickup, and close emphasis
- an action beat may need prep, release, travel, impact, and victim reaction
- a prop-evidence beat may need draw, throw, insert, pickup, and reaction

In live action these might be covered by shooting many angles first and deciding in the edit.

In this workflow, the material engineering book pre-decides the usable material structure earlier, so downstream tools do not need to guess the cut logic.

## Authority

Follow:

- `${OPENCLAW_HOME:-~/.openclaw}/agents/flashxiaolagu制作/production-optimization-spec.md`

Read [coverage-patterns.md](references/coverage-patterns.md) when the scene contains:

- confrontation dialogue
- action exchange
- reveal / intrusion / discovery
- evidence prop handling
- entry / exit / seal beats

## Input

- raw script text
- `analysis/film-type-analysis.json`
- scene / character / prop analysis when available

If `scene-analysis.json` provides stable zone language such as `门口`, `床边`, `桌窗区`, or `对峙走道`, reuse that wording instead of inventing a new zone name.

## Output

- `analysis/engineering-book.md`
- `analysis/engineering-book.json`

`engineering-book.md` is the fast human review sheet.

`engineering-book.json` is the machine-readable source of truth for downstream automation.

If they conflict, `engineering-book.json` wins, but the markdown must still be complete enough for a human to audit the split logic quickly.

## Core Positioning

Default rule for vertical short-drama:

- one reusable material purpose = one unit

This means the unit is defined by production usefulness, not by sentence boundaries.

A single script sentence may become several units.

A single dialogue line may also become several units if the edit needs several cut points.

The "one dominant attentional center" rule is still useful, but it is only a validation rule.

It is not the whole product definition.

## Core Rules

1. One reusable material purpose should usually become one unit.
2. One sentence can produce multiple units.
3. One long dialogue line can be split into multiple dialogue fragments when the edit needs separate cuts.
4. Standard support coverage may be added when it is required for editability, geography clarity, or emotional escalation.
5. Do not invent a new plot event, a new emotional turn, or a new action result that is not grounded in the script.

## What this stage must hand to downstream

Every unit should give `film-shot-design` enough information to understand:

- what this unit is about
- who or what dominates it
- what action happens
- what dialogue fragment belongs to it
- what prop is in focus
- where it happens in the scene
- what the start state is
- what the end state is
- why the editor would cut to this unit

## Working Method

Build the engineering book in this order:

1. read the scene as an editable event chain, not as prose
2. mark every visible action, reaction, reveal, dialogue turn, insert, geography reset need, and exit / seal beat
3. split the marked content into material fragments
4. assign a practical `coverage_role` to each fragment
5. fill the unit payload: subject, action, dialogue fragment, prop focus, scene zone, start state, end state, editorial intent
6. only after the base units are clean, add support coverage units when they are truly required
7. verify that each unit can be handed to `film-shot-design` without reopening story interpretation

The preferred reveal chain is still:

1. trigger
2. reaction
3. reveal
4. optional geography reset
5. response

The preferred action chain is usually:

1. prep
2. release
3. travel
4. impact
5. reaction / aftermath

The preferred evidence chain is usually:

1. reach / draw
2. throw / place
3. insert
4. pickup
5. reaction

## What counts as a new material unit

Create a new unit when any of these changes:

- editorial purpose changes
- dominant subject changes
- viewer attention target changes
- action phase changes, such as prep -> release -> impact
- dialogue speaker changes and the exchange matters
- a long line needs a separate dialogue fragment cut point
- prop becomes the visual focus
- geography needs a dedicated reset
- reaction and reveal are both important
- motion segment and its result are both important

## Support coverage rule

This stage may add support coverage, but only when it solves a real editing or continuity need.

Allowed examples:

- geography reset wide
- over-shoulder answer shot
- reaction pickup
- prop insert
- entry or exit seal beat

Not allowed:

- inventing a new story beat
- inventing a new emotional reversal
- inventing a new action result
- padding coverage with no editorial purpose

## Short-drama no-merge defaults

In current vertical short-drama mainline, do not merge these by default:

- action trigger + reveal
- reaction + reveal
- one character reaction + another character dialogue answer
- one long line's first emotional fragment + its later escalation fragment
- pull prop + prop insert
- move into space + confrontation line
- action prep + action impact

## Recommended reveal chain

When the script contains intrusion, discovery, or shock, prefer this chain:

1. event trigger
2. reaction
3. reveal
4. optional master/geography reset
5. response dialogue

The master shot is optional support coverage.

It must not be used to replace the reaction or reveal shots that carry the dramatic beat.

## Coverage role

Use a practical `coverage_role` for every unit.

Choose the closest useful role instead of inventing abstract labels.

Recommended labels:

- `trigger_wide`
- `geography_wide`
- `two_shot`
- `over_shoulder_A_to_B`
- `over_shoulder_B_to_A`
- `single_medium_A`
- `single_medium_B`
- `single_close_A`
- `single_close_B`
- `reaction_pickup_A`
- `reaction_pickup_B`
- `reveal_subject`
- `insert_prop`
- `insert_hand`
- `action_prep`
- `action_release`
- `action_travel`
- `action_impact`
- `transition_move`
- `exit_seal`
- `master_reset`

Use `A / B` only when the pair is stable and obvious in the scene.

If not, use explicit character names in the unit payload and keep the `coverage_role` generic.

## Required JSON Shape

```json
{
  "project_metadata": {
    "ratio_design": "9:16",
    "pacing_design": "中快节奏，2-4秒一镜，关键反应加强",
    "engineering_mode": "material_engineering_book",
    "total_units": 12
  },
  "scenes": [
    {
      "scene_id": "scene_001",
      "name": "场景名",
      "units": [
        {
          "unit_id": "unit_001",
          "beat_id": "beat_001",
          "script_reference": {
            "line_start": 7,
            "line_end": 7,
            "source_excerpt": "△ 砰——门被撞开。"
          },
          "fragment_text": "△ 砰——门被撞开。",
          "unit_type": "action",
          "coverage_role": "trigger_wide",
          "dominant_subject": "房门",
          "support_subjects": [],
          "action": "房门被猛地撞开",
          "dialogue": null,
          "scene_zone": "门口",
          "prop_focus": [],
          "visual_center": "门被撞开瞬间",
          "dramatic_function": "闯入触发点",
          "editorial_intent": "给后续反应和 reveal 提供切点",
          "start_state": "房门关闭，室内保持平静",
          "end_state": "房门向内甩开，闯入感成立",
          "priority": "required",
          "merge_policy": "must_not_merge",
          "split_reason": "动作触发本身就是独立素材目的"
        }
      ]
    }
  ]
}
```

## Field rules

### `unit_type`

Use only practical labels:

- `action`
- `reaction`
- `reveal`
- `dialogue`
- `insert`
- `master_reset`
- `transition`

### `coverage_role`

This field is mandatory.

It defines the material duty of the unit, not the final prompt wording.

`film-shot-design` should inherit this field as the first hint for shot responsibility.

### `fragment_text`

Use the exact fragment that belongs to this unit.

If one source sentence is split into several units, each unit should carry only its own fragment.

Do not repeat the whole sentence in every unit.

### `action`

Keep this concrete and visible.

Examples:

- `小泽猛然坐起`
- `女人把小女孩往前推半步`
- `报告被抛向床面`

### `dialogue`

Use `null` when this unit has no spoken text.

When spoken text exists, use:

```json
{
  "speaker": "小泽",
  "text": "你……你谁啊？"
}
```

If a long line is split into several units, `text` must keep only the exact fragment assigned to this unit.

Do not silently restore the full original line.

### `scene_zone`

Name the practical play area of the scene.

Examples:

- `门口`
- `床边`
- `床前对峙线`
- `桌窗区`
- `过道`

### `prop_focus`

List only the props that are truly important in this unit.

Examples:

- `[]`
- `["亲子鉴定报告"]`
- `["长刀", "刀鞘"]`

### `editorial_intent`

Keep this short and objective.

Examples:

- `建立门口闯入切点`
- `承接宣告后的震惊反应`
- `单独锁定证据 insert`
- `为动作命中提供清晰前置`

### `priority`

Use:

- `required`
- `support`

Default to `required`.

### `merge_policy`

Use:

- `must_not_merge`
- `may_merge`

Default to `must_not_merge` unless there is a strong reason to merge.

### `split_reason`

Keep this short and objective.

Examples:

- `attention shifts from man to doorway reveal`
- `prop becomes the visual focus`
- `speaker changes and needs a response shot`

## Constraints

1. This is an intermediate analysis layer, not final camera prompt design.
2. Each unit must have one clear material purpose.
3. The "one dominant attentional center" rule is a validation rule, not the whole definition.
4. Vertical short-drama bias is toward finer split, not coarse merge.
5. If one sentence contains several usable material centers, split it.
6. Support coverage is allowed only when it has a real editorial purpose.
7. Output both markdown and json.

## Downstream contract

`film-shot-design` should treat this file as the material source of truth.

When `engineering-book.json` exists, shot design should directly inherit:

- `coverage_role`
- `dominant_subject`
- `support_subjects`
- `action`
- `dialogue`
- `scene_zone`
- `prop_focus`
- `start_state`
- `end_state`
- `editorial_intent`
- `priority`

Shot design may still decide:

- exact camera wording
- duration
- generation strategy
- first / last frame phrasing
- video routing

But it should not rebuild the scene logic from scratch.

## Markdown Review Format

`analysis/engineering-book.md` must be short and review-friendly.

For each scene, include:

- scene name
- selected pacing design
- a flat review table ordered by script line

Each row should contain at least:

- `unit_id`
- `beat_id`
- `line_start-line_end`
- `fragment_text`
- `unit_type`
- `coverage_role`
- `dominant_subject`
- `action`
- `dialogue`
- `scene_zone`
- `prop_focus`
- `editorial_intent`
- `priority`
- `merge_policy`
- `split_reason`

The markdown is not for long prose explanation.
It is for fast human inspection of whether the material split is correct and actually usable.
