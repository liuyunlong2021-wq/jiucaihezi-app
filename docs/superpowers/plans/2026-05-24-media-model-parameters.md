# Media Model Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Creation Panel and Canvas use the confirmed media model set, remove performance mode concepts, and expose model-specific parameters while preserving explicit user model choice.

**Architecture:** Add one shared model capability catalog under `src/data/mediaModelCapabilities.ts`. Rebuild `creationModels.ts`, Creation Panel controls, Canvas media node controls, and media API payload mapping from that catalog so removed models cannot leak back through separate hard-coded lists.

**Tech Stack:** Vue 3, TypeScript, Pinia, node:test, Vite.

---

### Task 1: Shared Capability Catalog

**Files:**
- Create: `src/data/mediaModelCapabilities.ts`
- Test: `src/data/__tests__/mediaModelCapabilities.test.ts`

- [ ] Define the approved model catalog with only GPT Image 2, Nano Banana 2K/4K, Grok Video 3, Veo Fast, 模仿, 极速数字人, 数字人, Suno 自定义歌曲, 声音克隆, 声音设计.
- [ ] Include option arrays for `size`, `aspect_ratio`, `ratio`, `resolution`, `duration`, `mv`, `language`, and workflow dimensions.
- [ ] Add node command test that asserts deleted models are absent and renamed models are present.

### Task 2: Creation Panel Model Definitions

**Files:**
- Modify: `src/data/creationModels.ts`
- Modify: `src/composables/useCreation.ts`

- [ ] Rebuild task labels around `image`, `video`, `digital-human`, and `audio`.
- [ ] Map `RH_CREATION_MODELS` from the shared capability catalog.
- [ ] Add state for `negativeTags`, `text`, `voicePrompt`, `width`, `height`, `value`, `language`, and file accept rules.
- [ ] Keep user model selection explicit and remove any performance-mode concept.

### Task 3: Creation Panel UI Controls

**Files:**
- Modify: `src/components/creation/CreationPanel.vue`

- [ ] Render only controls supported by the selected model.
- [ ] Keep model dropdown visible.
- [ ] Add Suno custom-song fields only: title, tags, negative tags, mv, prompt.
- [ ] Add RunningHub workflow fields for 模仿, 数字人, 极速数字人, 声音克隆, 声音设计.

### Task 4: API Payload Mapping

**Files:**
- Modify: `src/api/media-generation.ts`
- Modify: `src/stores/mediaTaskStore.ts`

- [ ] Remove Creation/Canvas dependency on Seedance branches.
- [ ] Add Nano Banana 2K/4K image generation path.
- [ ] Add RunningHub-compatible video/audio workflow payload parameters used by Web/Gateway.
- [ ] Preserve all reference images for image generation and video generation where supported.
- [ ] Keep NewAPI model names explicit in frontend requests.

### Task 5: Canvas Media Nodes

**Files:**
- Modify: `src/types/canvas.ts`
- Modify: `src/components/canvas/nodes/CanvasImageGenNode.vue`
- Modify: `src/components/canvas/nodes/CanvasVideoGenNode.vue`
- Modify: `src/components/canvas/nodes/CanvasAudioGenNode.vue`
- Modify: `src/components/canvas/utils/canvasNodeFactory.ts`
- Modify: `src/components/canvas/runtime/canvasMediaRuntime.ts`

- [ ] Replace hard-coded media model options with catalog options.
- [ ] Default video node to `grok-video-3`, not Seedance.
- [ ] Show model-specific fields inside current node UI without adding a new inspector in this pass.
- [ ] Pass workflow text/audio/image/dimension parameters into generation calls.

### Task 6: Verification

**Files:**
- No production files.

- [ ] Run the catalog node test.
- [ ] Run `pnpm build`.
- [ ] Report exact verification results.
