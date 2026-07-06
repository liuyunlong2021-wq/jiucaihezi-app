# 🎬 Storyboard & Shot Grid

Range: No. 163–164 · Count: 2

Load this file only when the request matches this category. For cross-cutting writing rules, pair it with `craft.md`.

### No. 163 · 3×3 storyboard grid (Banana Pro style)

- Metadata: Storyboard · `portrait` · `1080x1920` · prompt template (no reference image) · Source: banana-grid-shot-prompt skill

```text
Generate a seamless borderless 3x3 storyboard grid, [aspect ratio]. Each panel is a continuous cinematic sequence from the same scene with consistent lighting, color, and spatial continuity.

Panel composition rules:
- Each panel = one short cinematic beat (20-35 words), not a rigid tag chain
- Include shot size and the visual action beat
- State who or what dominates the frame
- Add camera height/angle only when important
- Short atmosphere phrase if helpful

Global constraints:
- Borderless seamless grid, no black border, no black frame, no panel lines
- No subtitles, no watermark, no timecode
- Stable light / color / contrast from [StyleDesign]
- Preserve axis and continuity across all 9 panels

Reference images: [list of character/scene/prop asset paths]

Panel 1: [shot size] [action beat] [dominant subject]
Panel 2: [shot size] [action beat] [dominant subject]
...
Panel 9: [shot size] [action beat] [dominant subject]

Style: [StyleDesign]
```

### No. 164 · Storyboard grid with start/end frame pairs

- Metadata: Storyboard · `portrait` · `1080x1920` · prompt template (no reference image) · Source: banana-grid-shot-prompt skill

```text
Generate a seamless borderless 3x3 storyboard grid, [aspect ratio]. This batch includes start_end_to_video shots that each occupy TWO consecutive panels (first-frame → last-frame).

Shot packing rules:
- image_to_video shots: one slot (first_frame)
- start_end_to_video shots: two consecutive slots (first_frame → last_frame)
- End-frame slot describes the final state: what changed, where the subject moved, what new element entered frame
- If the final batch has empty panels, add a continuity_hold slot derived from an existing shot state (same framing, subtle micro-change) — never invent new action

Global constraints:
- Borderless seamless grid, no black border, no black frame, no panel lines
- No subtitles, no watermark, no timecode
- Stable light / color / contrast from [StyleDesign]
- Preserve axis and continuity from established scene references

Panel 1 (first_frame, shot_001): [shot size] [start action beat]
Panel 2 (last_frame, shot_001): [shot size] [end action beat]
Panel 3 (first_frame, shot_002): [shot size] [action beat]
...

Style: [StyleDesign]
```
