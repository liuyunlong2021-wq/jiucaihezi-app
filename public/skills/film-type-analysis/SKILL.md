---
name: film-type-analysis
description: Use when starting a new film/drama project and need multiple style options for the user to choose from before all downstream work. This stage decides ratio, style design, and pacing design, and absorbs lighting design into the same output.
---

# Film Type Analysis

## Overview

This skill is the only upstream stage that should output multiple options for human selection.

Its job is not to write long analysis. Its job is to propose several executable production directions, so the user can choose the whole project's tone before downstream work starts.

After the user chooses one option, all later stages should execute in a single path.

## When to Use

Use this skill when:
- starting a new project
- deciding the project's overall production direction
- deciding ratio, style, and pacing before character / scene / prop analysis
- deciding how aggressively `shot-design` should split actions into shots

## Input

- full script text
- target platform if known
- user preference if known, such as economy / premium / documentary / cinematic

## Output

Two files in project directory:
- `analysis/film-type-analysis.md`
- `analysis/film-type-analysis.json`

## Core Rule

This stage must output multiple options.

Each option must only contain three decisive production decisions:
- `RatioDesign`
- `StyleDesign`
- `PacingDesign`

For the JSON file, these decisions must be written with exact snake_case keys:
- `ratio_design`
- `style_design`
- `pacing_design`

Independent lighting analysis is removed.
Lighting must be absorbed into `StyleDesign`.

`ratio_design` is mandatory for every option.
It is not optional, and it must never be omitted, null, or left ambiguous.

## What To Remove

Do not persist long explanations unless the user explicitly asks.

Remove or avoid these as default output:
- target audience analysis
- emotional needs analysis
- long genre explanation
- repeated story summary
- long visual style prose
- separate lighting document

## Implementation

### Step 1: Read the script as production input

Judge the script from a production angle:
- is it vertical short drama or horizontal film
- is it realistic, cinematic, commercial, period, suspense, etc.
- should it move fast or hold longer
- does it need dense reaction cutting or slower composition-led staging

### Step 2: Produce multiple executable options

Default to 3-5 options, not just one answer.

Each option should be a usable production preset.

### Step 3: Make each option executable

Every option must include:

- `option_id`
- `RatioDesign`
- `StyleDesign`
- `PacingDesign`

#### RatioDesign

Examples:
- `9:16`
- `16:9`

Rule:
- every option must explicitly choose one ratio
- if platform is unclear, still infer and write the most usable ratio
- do not output an option without `ratio_design`

#### StyleDesign

Use short structured tags, not long explanation paragraphs.

Examples:
- `[窗光] + [自然冷暖对比] + [中高反差] + [阿莱Alexa质感]`
- `[伦勃朗布光] + [冷蓝色调] + [高反差] + [富士胶片色彩质感]`
- `[环境自然光] + [青橙色调] + [中高反差] + [电影数字质感]`

#### PacingDesign

Must be directly usable by downstream `shot-design`.

Examples:
- `快节奏，1-3秒一镜，近景特写优先，小动作拆镜`
- `中节奏，2-5秒一镜，动作可合并，关键反应保留`
- `电影节奏，3-6秒一镜，强调停顿、构图和视线关系`

### Step 4: Recommend one option

You may recommend one option, but still provide alternatives.
The user is expected to choose here.

Before the user chooses, `selected_option` should stay `null`.

### Step 5: Downstream inheritance rule

After the user chooses one option, only the selected option should be inherited downstream.

Downstream should read:
- `selected_option.ratio_design`
- `selected_option.style_design`
- `selected_option.pacing_design`

Nothing else is required.

## JSON Contract

The JSON file should use this exact structure:

- top level `options`: array
- each option must contain:
  - `option_id`
  - `name`
  - `recommended`
  - `ratio_design`
  - `style_design`
  - `pacing_design`
- top level `selected_option`: `null` before human selection

Do not rename these keys.
Do not switch to camelCase.
Do not output uppercase field names in JSON.

## Output Format

### Markdown

```markdown
# Film Type Analysis

## Option 1: 纪实短剧（推荐）
- RatioDesign: 9:16
- StyleDesign: [窗光] + [自然冷暖对比] + [中高反差] + [阿莱Alexa质感]
- PacingDesign: 快节奏，1-3秒一镜，近景特写优先，小动作拆镜

## Option 2: 电影短剧
- RatioDesign: 9:16
- StyleDesign: [窗光] + [青橙色调] + [高反差] + [电影数字质感]
- PacingDesign: 中快节奏，2-4秒一镜，关键反应加强

## Option 3: 电影
- RatioDesign: 16:9
- StyleDesign: [窗光] + [青橙色调] + [高反差] + [胶片感]
- PacingDesign: 电影节奏，3-6秒一镜，构图和停顿优先
```

### JSON

```json
{
  "options": [
    {
      "option_id": "option_1",
      "name": "纪实短剧",
      "recommended": true,
      "ratio_design": "9:16",
      "style_design": "[窗光] + [自然冷暖对比] + [中高反差] + [阿莱Alexa质感]",
      "pacing_design": "快节奏，1-3秒一镜，近景特写优先，小动作拆镜"
    },
    {
      "option_id": "option_2",
      "name": "电影短剧",
      "recommended": false,
      "ratio_design": "9:16",
      "style_design": "[窗光] + [青橙色调] + [高反差] + [电影数字质感]",
      "pacing_design": "中快节奏，2-4秒一镜，关键反应加强"
    },
    {
      "option_id": "option_3",
      "name": "电影",
      "recommended": false,
      "ratio_design": "16:9",
      "style_design": "[窗光] + [青橙色调] + [高反差] + [胶片感]",
      "pacing_design": "电影节奏，3-6秒一镜，构图和停顿优先"
    }
  ],
  "selected_option": null
}
```

## Pacing Inheritance Requirement

`film-shot-design` must inherit the chosen `PacingDesign` before splitting shots.

This is mandatory.

Examples:
- if pacing is fast, split micro-actions into separate shots
- if pacing is medium, merge adjacent readable actions
- if pacing is cinematic, reduce cut density and preserve longer internal motion

## Constraints

1. This stage must output multiple options.
2. Options must be concise and executable.
3. Every JSON option must include `option_id` and `ratio_design`.
4. `StyleDesign` must absorb lighting design.
5. Do not output long analysis by default.
6. Downstream should inherit only the selected option.

## Final Self-Check Before Writing JSON

Verify all of the following:

- `options` has at least 2 entries
- every option has `option_id`
- every option has `ratio_design`
- every option has `style_design`
- every option has `pacing_design`
- `selected_option` is `null` unless the user already explicitly selected one in this same task
