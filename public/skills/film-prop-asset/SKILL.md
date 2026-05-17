---
name: film-prop-asset
description: Use when analyzing script props for the current Banana/Veo short-drama pipeline. Output a dual-layer prop asset spec that is specific enough for detail-hungry downstream image models.
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
