# 韭菜盒子 V7 画布系统抄袭适配方案（SDD）

> 对标：T8-penguin-canvas v1.4.7 · 目标：5大模块全量抄袭适配
> 原则：每处改动标注"抄自 T8 哪段 + 适配到韭菜盒子哪个文件"

---

## 一、API Key 管理体系 — 多 Key 分类隔离

### 1.1 目标

从「单一 sk- Key 通吃」→「3+7 类 Key 分类隔离」

### 1.2 T8 原版设计

```
settings.json:
  zhenzhenApiKey      ← 贞贞工坊通用（图像/视频/音频）
  rhApiKey            ← RunningHub 独立
  llmApiKey           ← LLM 独立（额度隔离）

  // 7 类分类子 Key（未填 fallback zhenzhenApiKey）
  gptImageApiKey / nanoBananaApiKey / mjApiKey
  veoApiKey / grokApiKey / seedanceApiKey / sunoApiKey
```

后端 `pickApiKey(settings, hint)` 按模型名/endpoint 路由选择 Key。

### 1.3 适配方案

#### 1.3.1 新建 `src/services/apiKeyRouter.ts`

抄自 T8 `backend/src/routes/proxy.js` 的 `pickApiKey` 逻辑，前端化：

```ts
// src/services/apiKeyRouter.ts
import { getItem, setItem } from '@/utils/idb'

const KEY_STORE_PREFIX = 'jc_api_key_'

export interface ApiKeySet {
  main: string           // 主 Key（韭菜盒子通用）
  rh?: string            // RunningHub 独立
  llm?: string           // LLM 独立
  // 分类子 Key
  gptImage?: string
  nanoBanana?: string
  mj?: string
  veo?: string
  grok?: string
  seedance?: string
  suno?: string
}

/** 按模型名/渠道路由选择 Key */
export function pickApiKey(keys: ApiKeySet, hint: string): string {
  // 1. 分类 Key 优先
  const classified = CLASSIFIED_KEY_MAP[hint]
  if (classified && keys[classified]) return keys[classified]!

  // 2. 渠道专属 Key
  if (hint === 'runninghub' && keys.rh) return keys.rh
  if (hint === 'llm' && keys.llm) return keys.llm

  // 3. fallback 主 Key
  return keys.main
}

const CLASSIFIED_KEY_MAP: Record<string, keyof ApiKeySet> = {
  'gpt-image': 'gptImage', 'gpt-image-2': 'gptImage',
  'nano-banana': 'nanoBanana', 'nano-banana-2k': 'nanoBanana', 'nano-banana-4k': 'nanoBanana',
  'midjourney': 'mj',
  'veo': 'veo', 'veo3.1': 'veo',
  'grok': 'grok', 'grok-video': 'grok',
  'seedance': 'seedance', 'seedance-2': 'seedance',
  'suno': 'suno',
}

export async function loadApiKeys(): Promise<ApiKeySet> {
  const raw = await getItem('jcApiKeys')
  if (raw) return JSON.parse(raw)
  // 兼容旧版：单 Key 迁移
  const legacy = localStorage.getItem('jcApiKey') || ''
  return { main: legacy }
}

export async function saveApiKeys(keys: ApiKeySet): Promise<void> {
  await setItem('jcApiKeys', JSON.stringify(keys))
  // 同步主 Key 到 Keychain
  if (keys.main) {
    const { setApiKey } = await import('@/services/newApiClient')
    await setApiKey(keys.main)
  }
}
```

#### 1.3.2 改造 `src/utils/api.ts` — `resolveApiConfig` 增加 keyHint

```diff
// src/utils/api.ts resolveApiConfig
- apiKey: getGatewaySessionToken(),
+ apiKey: pickApiKey(await loadApiKeys(), options.keyHint || 'main'),
```

#### 1.3.3 改造 `src/api/media-generation.ts` — `ensureConfig` 增加 keyHint

```diff
// src/api/media-generation.ts
-async function ensureConfig(): Promise<{ apiKey: string; apiBase: string }>
+async function ensureConfig(hint: string = 'main'): Promise<{ apiKey: string; apiBase: string }>
-  const apiKey = getApiKey()
+  const keys = await loadApiKeys()
+  const apiKey = pickApiKey(keys, hint)
```

#### 1.3.4 改造 `src/components/settings/SettingsPanel.vue` — 多 Key 输入

在现有「API 配置」section 下方新增「分类 API Key」折叠区：

```vue
<!-- 分类独立 API Key（可选）· 默认折叠 -->
<details class="sp-section">
  <summary class="sp-section-title" style="cursor:pointer">
    分类独立 API Key（可选，未填则使用通用 Key）
  </summary>
  <div v-for="item in classifiedKeys" :key="item.field" class="sp-key-row" style="margin-top:8px">
    <label class="sp-label" style="min-width:120px">{{ item.label }}</label>
    <input v-model="item.value" type="password" placeholder="未设置 · 使用通用 Key"
           class="sp-input" style="flex:1" />
  </div>
</details>
```

#### 1.3.5 各生成节点传递 keyHint

| 节点 | keyHint |
|------|---------|
| ImageGen (GPT Image 2) | `'gpt-image'` |
| ImageGen (Nano Banana) | `'nano-banana'` |
| VideoGen (Veo) | `'veo'` |
| VideoGen (Grok) | `'grok'` |
| VideoGen (Seedance) | `'seedance'` |
| AudioGen (Suno) | `'suno'` |
| RunningHub 节点 | `'runninghub'` |
| LLM 节点 | `'llm'` |

---

## 二、RunningHub 集成智能化

### 2.1 目标

从「手动填 webappId + nodeInfoList」→「自动拉 apiCallDemo + 智能表单 + @ 提及」

### 2.2 T8 原版设计

- 输入 webappId → 调 `GET /api/webapp/apiCallDemo` → 返回 `nodeInfoList: [{nodeId, fieldName, fieldType, description, options}]`
- `extractFieldOptions` 从 9 种候选 key 提取下拉选项
- `KNOWN_FIELD_OPTIONS` 词典兜底（aspectRatio/resolution 等常见字段）
- 媒体字段勾选「从上游自动获取」→ 自动从连接的上游节点提取 url
- `computeFreshValuesNow` 同步快照防 React state 异步陷阱

### 2.3 适配方案

#### 2.3.1 新建 `src/components/canvas/runtime/canvasRhSmart.ts`

```ts
// src/components/canvas/runtime/canvasRhSmart.ts
// 抄自 T8 RunningHubNode.tsx: resolveNodeInfoList + computeFreshValuesNow

interface RhFieldMeta {
  nodeId: string
  fieldName: string
  fieldType: 'text' | 'number' | 'image' | 'video' | 'audio' | 'select'
  description?: string
  options?: { label: string; value: string }[]
  defaultValue?: string
}

/** 从 apiCallDemo 解析字段元数据 */
export function parseRhApiCallDemo(data: any): RhFieldMeta[] {
  const list = data?.nodeInfoList || data?.data?.nodeInfoList || []
  return list.map((item: any) => ({
    nodeId: String(item.nodeId || ''),
    fieldName: String(item.fieldName || ''),
    fieldType: inferFieldType(item),
    description: item.description || '',
    options: extractFieldOptions(item),
    defaultValue: extractDefaultValue(item),
  }))
}

/** 字段类型推断：9 种候选 + KNOWN_FIELD_OPTIONS 词典兜底 */
function inferFieldType(item: any): RhFieldMeta['fieldType'] {
  const ft = (item.fieldType || item.type || '').toUpperCase()
  if (['IMAGE', 'VIDEO', 'AUDIO', 'FILE'].includes(ft)) return ft.toLowerCase() as any
  if (['LIST', 'SELECT', 'DROPDOWN', 'COMBO', 'ENUM'].includes(ft)) return 'select'
  if (['NUMBER', 'INT', 'FLOAT', 'INTEGER'].includes(ft)) return 'number'
  // 词典兜底
  const name = (item.fieldName || '').toLowerCase()
  if (/aspect.?ratio|ratio|resolution|size|mode|quality|precision|scheduler|sampler|instanceType/.test(name)) return 'select'
  return 'text'
}

function extractFieldOptions(item: any): { label: string; value: string }[] {
  const candidates = [item.options, item.list, item.values, item.enum, item.choices, item.items, item.selectOptions, item.dropdown, item.fieldData]
  for (const c of candidates) {
    if (Array.isArray(c) && c.length) {
      return c.map((o: any) => ({
        label: o.label || o.name || String(o.value || o),
        value: o.value || o,
      }))
    }
  }
  return []
}

function extractDefaultValue(item: any): string {
  return item.defaultValue || item.default || item.value || ''
}

/** 提交前同步快照：从上游节点收集媒体 url → fileName */
export async function resolveRhNodeInfoList(
  fields: RhFieldMeta[],
  upstreamUrls: Map<string, string>,  // fieldName → upstream url
  uploadAsset: (url: string) => Promise<string>,  // url → RH fileName
): Promise<{ nodeId: string; fieldName: string; fieldValue: string }[]> {
  const out: any[] = []
  for (const f of fields) {
    let value = f.defaultValue || ''
    // 媒体字段：优先用上游 url
    if (['image', 'video', 'audio'].includes(f.fieldType)) {
      const upUrl = upstreamUrls.get(f.fieldName)
      if (upUrl) {
        value = await uploadAsset(upUrl)
      }
    }
    out.push({ nodeId: f.nodeId, fieldName: f.fieldName, fieldValue: String(value) })
  }
  return out
}
```

#### 2.3.2 改造 `src/api/media-generation.ts` — 新增 apiCallDemo 拉取

```ts
// 新增函数
export async function fetchRhAppInfo(webappId: string): Promise<RhFieldMeta[]> {
  const config = await ensureConfig('runninghub')
  const resp = await fetch(
    `https://www.runninghub.cn/api/webapp/apiCallDemo?apiKey=${config.apiKey}&webappId=${webappId}`,
    { headers: { 'Host': 'www.runninghub.cn' } }
  )
  const data = await resp.json()
  return parseRhApiCallDemo(data)
}
```

#### 2.3.3 新增 RhSmartNode 画布节点

新建 `src/components/canvas/nodes/CanvasRhSmartNode.vue`：

```
┌─────────────────────────────┐
│ 🔌 RH 智能节点               │
│ webappId: [________] [获取] │  ← 输入 ID → 自动展开表单
├─────────────────────────────┤
│ ☑ 从上游自动获取: image     │  ← 勾选后自动从连接的 image 节点取 url
│ prompt: [_______________]   │
│ resolution: [1k ▾]          │  ← select 下拉（解析自 apiCallDemo）
│ seed: [_______]             │
├─────────────────────────────┤
│ [▶ 运行]  [📋 日志]        │
└─────────────────────────────┘
```

#### 2.3.4 @ 素材提及（抄 T8 MentionPromptInput）

新建 `src/components/canvas/runtime/canvasMentions.ts`：

```ts
// 抄自 T8 src/components/nodes/MentionPromptInput.tsx + mediaMentions.ts
// 核心逻辑：
// 1. 文本输入框监听 @ 字符
// 2. 弹出当前画布上所有上游素材节点（image/video/audio）
// 3. 选中后插入 @image1 / @video1 / @audio1
// 4. 提交时解析为对应 url
```

---

## 三、画布基础操作升级

### 3.1 目标

补全 GroupBox、智能对齐、批量执行、框选区分、落点防重叠

### 3.2 适配清单

| T8 功能 | 抄到韭菜盒子哪个文件 | 改动量 |
|---------|---------------------|--------|
| **Ctrl+拖 = 框选** vs 左键拖 = 平移 | `CanvasWorkspace.vue` — selectionMode 配置 | ~20 行 |
| **GroupBox 打组** | 新建 `nodes/CanvasGroupNode.vue` + `stores/groupBus.ts` | ~300 行 |
| **智能对齐辅助线** | `CanvasWorkspace.vue` — onNodeDrag 拦截 + SVG 虚线渲染 | ~150 行 |
| **批量执行 Kahn 拓扑** | `canvasExecutor.ts` — 已有拓扑排序，只需加串行触发 + 进度 | ~80 行 |
| **落点防重叠** | `canvasNodeFactory.ts` — 阿基米德螺线 + pendingPlacedNodes | ~60 行 |
| **右键画布快速添加** | `CanvasWorkspace.vue` — onPaneContextMenu 菜单 | ~40 行 |
| **框选自动菜单** | `CanvasWorkspace.vue` — 选中 ≥2 节点弹出操作面板 | ~50 行 |
| **14 个快捷键** | `CanvasWorkspace.vue` — keydown 全局监听 | ~60 行 |

### 3.3 GroupBox 核心逻辑（抄 T8 phase13）

```
框选 ≥2 节点 → 右键「打组」
  ↓
计算 bounding box + 30px padding + 40px 标题栏
  ↓
创建 GroupBoxNode（type='group', zIndex=-1）
  ↓
拖动 GroupBox → 同步偏移 memberIds 子节点
  ↓
组执行 → 仅保留成员内部边 → 拓扑排序 → 串行 runBus
```

---

## 四、节点体系扩展

### 4.1 新增节点清单

| T8 节点 | 韭菜盒子适配 | 文件 | 抄自 |
|---------|------------|------|------|
| **image-compare** | `CanvasCompareNode.vue` | 新建 | T8 ImageCompareNode |
| **relay** | `CanvasRelayNode.vue` | 新建 | T8 RelayNode（全字段透传） |
| **loop** | `CanvasLoopNode.vue` | 新建 | T8 LoopNode（串联/并联） |
| **pick-from-set** | `CanvasPickNode.vue` | 新建 | T8 PickFromSetNode |
| **grid-crop** | `CanvasGridCropNode.vue` | 新建 | T8 GridCropNode（宫格+gap） |
| **frame-pair** | `CanvasFramePairNode.vue` | 新建 | T8 FramePairNode（首尾帧） |
| **cinematic** | `CanvasCinematicNode.vue` | 新建 | T8 CinematicComposer |
| **video-motion** | `CanvasMotionNode.vue` | 新建 | T8 VideoMotionComposer |

### 4.2 中继节点（RelayNode）核心逻辑（抄 T8 phase17）

```
上游任意素材 → RelayNode → 下游任意节点
  - 透传: prompt / imageUrl / videoUrl / audioUrl / imageUrls / urls
  - upstreamSignature useMemo 防 setState 风暴
  - 零上游时主动清空所有字段
  - 节点内指示器: 📝文本 / 🖼图 / 🎬视频 / 🎵音频
```

---

## 五、跨节点素材拖拽（Ctrl+拖缩略图）

### 5.1 目标

从结果节点缩略图 Ctrl+拖 → 投放到下游生成节点 → 自动填入参考图/音频/视频

### 5.2 T8 原版设计（phase15）

```
核心组件:
  stores/dragMaterial.ts        ← zustand store（materialKind/payload/状态机）
  hooks/useMaterialDropTarget   ← 节点注册接收能力
  hooks/useMaterialDragSource   ← 素材元素标记 data-drag-*
  MaterialDragOverlay.tsx       ← createPortal 幽灵缩略图

数据协议:
  data-drag-source / data-drag-kind / data-drag-url / data-drag-preview / data-drag-node-id

接收映射:
  ImageNode: image→referenceImages, text→prompt
  VideoNode: image→localRefImages, text→prompt
  AudioNode: audio→localRefAudio, text→prompt
  LLMNode:   image→pickedFiles, text→prompt
  SeedanceNode: image/video/audio/text 全支持
```

### 5.3 适配方案

#### 5.3.1 新建 `src/composables/useMaterialDrag.ts`

```ts
// 抄自 T8 stores/dragMaterial.ts + hooks/useMaterialDragSource + useMaterialDropTarget
// Vue3 Composition API 重写（T8 用 React hooks + zustand）

interface MaterialPayload {
  kind: 'image' | 'video' | 'audio' | 'text'
  url: string
  preview?: string
  nodeId: string
}

// 全局拖拽状态（Pinia 或 composable singleton）
const dragState = reactive({
  active: false,
  payload: null as MaterialPayload | null,
  position: { x: 0, y: 0 },
  acceptTarget: null as string | null,
})

export function useMaterialDragSource(nodeId: string, kind: string, url: string, preview?: string) {
  // 给素材元素加 data-drag-source / data-drag-kind / data-drag-url
  // Ctrl+pointerdown → 启动拖拽
}

export function useMaterialDropTarget(nodeId: string, acceptKinds: string[]) {
  // data-drop-kinds 属性声明接收能力
  // isAccepting computed → 绿色光晕
  // onDrop → 按映射表填入对应字段
}
```

#### 5.3.2 改造现有节点

| 节点 | 素材 source 标记 | 接收能力 |
|------|-----------------|---------|
| ImageResultNode | 输出缩略图标记 `data-drag-source` | — |
| VideoResultNode | 输出缩略图标记 | — |
| AudioResultNode | 输出缩略图标记 | — |
| ImageGenNode | — | image→referenceImages, text→prompt |
| VideoGenNode | — | image→localRefImages, text→prompt |
| AudioGenNode | — | audio→localRefAudio, text→prompt |
| SeedanceGenNode | — | image/video/audio/text 全接收 |
| LLMNode | — | image→pickedFiles, text→prompt |

#### 5.3.3 视觉反馈

- 拖拽中：body cursor=grabbing + user-select:none
- 幽灵缩略图：`createPortal` 或 Vue `<Teleport to="body">`，40×40 跟随鼠标
- 目标节点：边框 emerald-400 + boxShadow 绿色光晕（isAccepting=true）
- ESC 取消拖拽

---

## 六、执行计划（分 5 个 Sprint）

### Sprint 1：API Key 多分类（预计 3h）
- [ ] 新建 `src/services/apiKeyRouter.ts`
- [ ] 改造 `src/utils/api.ts` resolveApiConfig
- [ ] 改造 `src/api/media-generation.ts` ensureConfig
- [ ] 改造 `src/components/settings/SettingsPanel.vue` 加分类 Key 输入
- [ ] 各生成节点传 keyHint

### Sprint 2：RunningHub 智能化（预计 4h）
- [ ] 新建 `src/components/canvas/runtime/canvasRhSmart.ts`
- [ ] 改造 `src/api/media-generation.ts` 加 fetchRhAppInfo
- [ ] 新建 `CanvasRhSmartNode.vue`
- [ ] 新建 `src/components/canvas/runtime/canvasMentions.ts`（@ 提及）
- [ ] LLM/Image/Video/Audio 节点接入 @ 提及

### Sprint 3：画布基础操作（预计 5h）
- [ ] GroupBox：新建 `CanvasGroupNode.vue` + `stores/groupBus.ts`
- [ ] 智能对齐：`CanvasWorkspace.vue` onNodeDrag
- [ ] 批量执行：`canvasExecutor.ts` Kahn 拓扑串行
- [ ] 框选区分 + 右键菜单 + 快捷键

### Sprint 4：新节点（预计 4h）
- [ ] RelayNode、LoopNode、PickNode
- [ ] GridCropNode、FramePairNode
- [ ] CinematicNode、MotionNode
- [ ] ImageCompareNode

### Sprint 5：跨节点素材拖拽（预计 3h）
- [ ] `useMaterialDrag.ts`
- [ ] 结果节点 source 标记
- [ ] 生成节点 drop target
- [ ] 幽灵缩略图 + 视觉反馈

---

## 七、风险点

| 风险 | 缓解 |
|------|------|
| T8 是 React+xyflow，我们是 Vue+VueFlow | API 不同但概念一致，需逐功能手动移植 |
| T8 后端是 Node Express，我们走 NewAPI 直连 | rh.md 中的 API 协议可直接复用 |
| 多 Key 存储增加复杂度 | Keychain 仍存主 Key，子 Key 用 idb（IndexedDB） |
| 新节点与现有画布架构冲突 | 新节点严格对齐 `CanvasNode` 接口，不破坏现有 |
