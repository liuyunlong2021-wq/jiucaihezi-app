---
name: qwen-tts-voice-design
description: Use when converting script text, dialogue, or character information into Qwen TTS voice design prompts. This skill should infer suitable voice identity, emotional tone, speaking rhythm, and optional scene flavor for each speaker, then output concise natural-language voice design prompts that can be passed to Qwen3-TTS.
---

# Qwen TTS Voice Design

## Overview

This skill writes Qwen3-TTS voice design prompts from script text, dialogue, and role context.

Its job is not to write dialogue content.
Its job is to decide how each speaker should sound.

The output should be directly usable for Qwen TTS voice design.

## Core Concept

Qwen3-TTS voice design is a natural-language voice specification task.
You are describing a voice, not selecting a preset.

The prompt should make the model understand:
- who is speaking
- what their voice baseline is
- what emotional state they are in
- how fast or slow they speak
- whether there are pauses, breath, hesitation, or other expressive texture

## When to Use

Use this skill when:
- script text exists
- dialogue lines exist
- character roles exist
- TTS generation is planned
- you need one or more reusable voice design prompts for speakers

## Input

Possible inputs:
- script text
- `analysis/character-analysis.json`
- `analysis/shot-design.json`
- role labels
- dialogue lines
- scene context

You do not need all of them.
Read the minimum useful input.

## Output

Suggested outputs:
- `prompts/qwen-tts-voice-design.md`
- `prompts/qwen-tts-voice-design.json`

Each role should get a reusable base voice design prompt.
If a scene clearly requires a temporary emotional override, add a scene-use variant.

## Prompt Structure

Default structure:

`[声音特征描述] + [情感/语气] + [语速/节奏] + [特殊效果]`

This is the minimum required structure.

When useful, you may also add:
- scene flavor
- speaking identity cue
- social impression cue

## Required Dimensions

Each voice design prompt should consider:

1. gender / age feel
2. timbre quality
3. emotional baseline
4. speaking speed and rhythm
5. optional breathing / hesitation / tail shape
6. optional scene flavor if it improves precision

## Voice Design Rules

### 1. Start from role identity

Infer a stable voice baseline from the role:
- age feel
- social identity
- temperament visible in script
- power relation in dialogue

Do not make every voice dramatic.

### 2. Separate baseline from scene emotion

The base voice should be reusable.
Do not overfit all prompts to one moment unless asked.

Example:
- base voice: calm, cold, restrained female professional
- scene variant: same voice, but more cutting and emotionally distant

### 3. Keep descriptions concrete

Bad:
- nice female voice
- normal male voice

Good:
- 30岁左右女性，声音冷静克制，音色偏薄但清晰，语速平稳，情绪压得很低，带一点不耐烦

### 4. Use special effects sparingly

Only add effects when script supports them:
- breathiness
- slight tremble
- hesitation pause
- tail rise
- restrained anger
- suppressed crying

### 5. Match rhythm to dialogue type

Examples:
- confrontation: clipped rhythm, low warmth, direct delivery
- panic: faster tempo, broken phrasing, unstable breath
- child speech: lighter tone, shorter phrasing, clearer innocence
- report-style line: even pace, low emotion swing

## Character Inference Hints

### Adult female

Possible ranges:
- gentle and warm
- cold and restrained
- sharp and efficient
- exhausted but steady

### Adult male

Possible ranges:
- calm and rational
- tense and defensive
- tired and groggy
- mature and low-toned

### Child

Possible ranges:
- timid and soft
- lively and bright
- sticky and dependent
- confused and tentative

## Scene Variant Rule

If the same character speaks very differently in a specific moment, create:
- `base_voice_prompt`
- `scene_voice_prompt`

Do not overwrite the reusable base voice unless the user wants scene-only design.

## Multi-Role Output Rule

For multi-character dialogue, output each role separately.
Keep role naming stable.

Example format:
- `xiaoze`
- `woman`
- `girl`

Do not rename the same person across files.

## Output Format

### Markdown

```markdown
## xiaoze

**Base Voice Design**:
30岁左右男性声音，带一点刚睡醒的疲惫感，音色偏低但不厚重，语气带理性底色，语速中等偏慢，句子起步略迟钝，情绪紧张时会突然加快，带少量呼吸感。

**Scene Variant**:
30岁左右男性声音，刚从睡梦中被惊醒，音色偏低，带明显疲惫和慌乱，语速忽快忽慢，有短暂停顿和不稳定呼吸，像在强行整理思绪。
```

### JSON

```json
{
  "voices": [
    {
      "role_id": "xiaoze",
      "name": "小泽",
      "base_voice_prompt": "30岁左右男性声音，带一点刚睡醒的疲惫感，音色偏低但不厚重，语气带理性底色，语速中等偏慢，句子起步略迟钝，情绪紧张时会突然加快，带少量呼吸感。",
      "scene_variant": "30岁左右男性声音，刚从睡梦中被惊醒，音色偏低，带明显疲惫和慌乱，语速忽快忽慢，有短暂停顿和不稳定呼吸，像在强行整理思绪。"
    }
  ]
}
```

## Good Prompt Patterns

- `30岁左右知性女性声音，音色温暖柔和，语气克制，语速适中偏慢，像在安静房间里近距离说话，带一点自然呼吸感。`
- `40多岁男性声音，低沉稳重，吐字清晰，语速均匀，不带明显情绪波动，像在冷静地下判断。`
- `6岁左右小女孩声音，音色轻软，语气怯生生，语速偏慢，句尾略轻，带一点犹豫停顿。`

## Constraints

1. Output voice design prompts, not dialogue text.
2. Keep prompts natural-language and directly usable for Qwen TTS.
3. Make role voices distinguishable.
4. Prefer reusable base prompts plus optional scene variants.
5. Do not invent extreme emotion unless script supports it.
6. If role evidence is weak, stay conservative rather than theatrical.
