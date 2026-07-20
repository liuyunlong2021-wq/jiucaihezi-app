# 媒体确认卡参数控制与 ZX 参考图视频修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desktop 默认打开对话，媒体确认卡支持橄榄绿主题和卡内参数调整，并修复 ZX Grok 本地参考图视频的 404 提交链路。

**Architecture:** 保持 `ChatPanel` 拥有消息计划、CreationPanel/mediaTaskStore 唯一执行。参数选项和归一规则放在 `mediaPlan.ts`，组件只展示和发事件；ZX 运行时按注册表的渠道合同直接提交 data URL，不恢复旧上传路由。

**Tech Stack:** Vue 3、TypeScript 6、Pinia、Node test、Tauri 2。

---

### Task 1: Desktop 默认打开对话

**Files:**
- Modify: `src/stores/ecommerceWorkbenchStore.ts`
- Test: `src/stores/__tests__/ecommerceWorkbenchStore.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
test('ecommerce workbench starts on collaboration and only opens after an explicit switch', () => {
  setActivePinia(createPinia())
  const store = useEcommerceWorkbenchStore()
  assert.equal(store.surface, 'collaboration')
  store.setSurface('workbench')
  assert.equal(store.surface, 'workbench')
})
```

- [ ] **Step 2: 运行测试并确认旧默认值失败**

Run: `pnpm run test:focused:build && node --test /private/tmp/jc-focused-tests/wave1/src/stores/__tests__/ecommerceWorkbenchStore.test.js`

- [ ] **Step 3: 最小实现**

```ts
const surface = ref<EcommerceSurface>('collaboration')
```

- [ ] **Step 4: 重跑测试，预期通过**

### Task 2: 建立计划参数编辑纯合同

**Files:**
- Modify: `src/runtime/workbench/mediaPlan.ts`
- Test: `src/runtime/workbench/__tests__/mediaPlan.test.ts`

- [ ] **Step 1: 写失败测试**

覆盖三条事实：候选模型与计划类型和参考图数量兼容；换模型保留合法值；不合法参数回退到注册表默认值。

```ts
const controls = getMediaPlanEditorControls(videoPlan)
assert.equal(controls.models.some(model => model.id === 'newapi/zx/grok-1.5-video-6s'), true)

const updated = updateMediaPlanParameters(videoPlan, {
  modelId: 'newapi/zx/grok-1.5-video-10s',
})
assert.equal(updated.modelId, 'newapi/zx/grok-1.5-video-10s')
assert.equal(updated.duration, 10)
```

- [ ] **Step 2: 运行测试并确认导出不存在而失败**

Run: `pnpm run test:focused:build && node --test /private/tmp/jc-focused-tests/wave1/src/runtime/workbench/__tests__/mediaPlan.test.js`

- [ ] **Step 3: 实现最小纯函数**

```ts
export interface MediaPlanParameterPatch {
  modelId?: string
  ratio?: string
  resolution?: string
  duration?: string | number
}

export function getMediaPlanEditorControls(plan: MediaPlan): MediaPlanEditorControls
export function updateMediaPlanParameters(
  plan: MediaPlan,
  patch: MediaPlanParameterPatch,
): MediaPlan
```

函数只读取 `listCreationModels()`、`getCreationModelSpec()` 和现有可用性，最终调用 `validateMediaPlan()`；不复制模型表。

- [ ] **Step 4: 重跑测试，预期通过**

### Task 3: 卡片内调整参数并持久化

**Files:**
- Modify: `src/components/chat/MediaPlanCard.vue`
- Modify: `src/components/chat/MessageBubble.vue`
- Modify: `src/components/chat/ChatPanel.vue`
- Test: `src/components/__tests__/chatMessagePresentation.test.ts`
- Test: `src/runtime/workbench/__tests__/mediaPlan.test.ts`

- [ ] **Step 1: 写失败合同测试**

```ts
assert.match(card, /调整/)
assert.match(card, /media-plan-editor/)
assert.match(card, /updateParameters/)
assert.match(card, /var\(--olive\)/)
assert.doesNotMatch(card, /var\(--accent/)
assert.match(chatPanel, /updateMediaPlanParameters/)
assert.match(chatPanel, /persistCurrentSession/)
```

- [ ] **Step 2: 运行测试并确认缺少调整区而失败**

- [ ] **Step 3: 实现事件链**

```text
MediaPlanCard emit updateParameters(patch)
  -> MessageBubble emit updateMediaPlanParameters(messageId, patch)
  -> ChatPanel 调用纯函数、更新状态、持久化
```

卡片模型使用 select；比例、分辨率使用注册表选项；时长有枚举时用 select，否则用受 min/max 约束的 number input。`submitting/submitted` 禁止调整。

- [ ] **Step 4: 统一样式**

卡片边框和背景使用 `--olive` 的 `color-mix`，主按钮使用 `--olive`，hover 使用 `--olive-dark`。调整按钮使用轻量边框样式。

- [ ] **Step 5: 重跑组件和纯函数测试，预期通过**

### Task 4: 修复 ZX 参考图视频合同

**Files:**
- Modify: `src/runtime/creation/creationModelRegistry.ts`
- Modify: `src/runtime/creation/creationMediaRuntime.ts`
- Test: `src/runtime/creation/__tests__/creationMediaPlan.test.ts`
- Test: `src/runtime/creation/__tests__/creationMediaRuntime.test.ts`

- [ ] **Step 1: 写真实合同失败测试**

```ts
const image = 'data:image/png;base64,aGVsbG8='
// fetch mock 断言：
// 1. 从未请求 /api/creations/uploads
// 2. POST /v1/videos
// 3. body.image === image（产品 NewAPI 合同；不是 ZX 上游 image_url 对象）
// 4. GET /v1/videos/zx_video_001
```

- [ ] **Step 2: 运行测试并确认旧上传 404 链路被捕获**

- [ ] **Step 3: 修正注册表**

三个 ZX Grok 模型保留产品 NewAPI 入口，只修素材流：

```ts
endpoint: '/v1/videos',
assetFlow: 'none',
```

- [ ] **Step 4: 修正运行时**

`executeDirectVideoRequest()` 根据 `assetFlow` 决定是否调用 `uploadCreationAsset()`；ZX 向产品 NewAPI 输出字符串 `image`，轮询沿用产品入口 `/v1/videos/{id}`。NewAPI 渠道负责翻译 ZX 上游的 `image_url` 对象，其他渠道逻辑不变。

- [ ] **Step 5: 重跑 ZX 与全部 Creation 测试，预期通过**

### Task 5: 文档与完整验证

**Files:**
- Modify: `docs/wiki/开发/启动默认对话与媒体确认卡参数编辑及ZX参考图视频修复SDD.md`
- Modify: `docs/wiki/hot.md`
- Modify: `docs/wiki/log.md`

- [ ] **Step 1: 运行完整自动门禁**

```bash
pnpm run test:focused
pnpm exec vue-tsc -b
pnpm run build
pnpm run build:desktop
git diff --check
```

- [ ] **Step 2: 记录真实结果**

SDD 状态改为“代码与自动验证完成，真实 ZX 付费人工验收待完成”，除非本轮确有真实付费成功证据。

- [ ] **Step 3: 审计改动边界**

确认本任务没有恢复 `/api/creations/uploads`、没有新增上传服务、没有改动现有暂存清理和无关 Wiki Skill 文件。
