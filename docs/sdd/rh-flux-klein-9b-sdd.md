# SDD: RH 新模型批量接入 + 参数全链路修复 + UI 净化

> **日期**: 2026-06-22
> **分支**: `RH-flux`
> **状态**: v3 — 补全 rh-adapter 后端闭环节点 + 字段命名冲突规则
> **前置**: `CLAUDE.md`、`AGENTS.md`、`docs/model-registry-matrix.md`

---

## 一、概述

三件事，按依赖顺序：

1. **修参数闭环**（最优先）— 前端 plan/runtime + rh-adapter schema/service/payload，确保用户选的每个参数都到达 RH 官方 API
2. **接入 8 个新模型** — 全部 RH 渠道
3. **UI 净化** — 显示层去后缀 + 改名 + 隐藏渠道标签

提示词携带功能**拆分到独立分支**，不在本 SDD 范围。

---

## 二、全部新模型 (8 个)

| # | 模型 ID | 显示 Label | 任务 | 模式 | RH 端点 |
|---|---------|-----------|------|------|---------|
| 1 | `rh-flux-klein-edit` | FLUX Klein 9B 编辑 | image | image-to-image | `rhart-image/f-2-klein-9b/edit` |
| 2 | `rh-flux-klein-text` | FLUX Klein 9B 文生图 | image | text-to-image | `rhart-image/f-2-klein-9b/text-to-image` |
| 3 | `rh-flux-klein-lora` | FLUX Klein 9B LoRA | image | text-to-image | `rhart-image/f-2-klein-9b/text-to-image-lora` |
| 4 | `rh-midjourney-v81` | Midjourney V8.1 | image | text-to-image | `youchuan/text-to-image-v81` |
| 5 | `rh-grok-image-text` | Grok Image 4.2 文生图 | image | text-to-image | `rhart-image-g/text-to-image` |
| 6 | `rh-grok-image-image` | Grok Image 4.2 图生图 | image | image-to-image | `rhart-image-g/image-to-image` |
| 7 | `rh-ltx23-text-video` | LTX 2.3 文生视频 | video | text-to-video | `rhart-video/ltx-2.3/text-to-video` |
| 8 | `rh-ltx23-image-video` | LTX 2.3 图生视频 | video | image-to-video | `rhart-video/ltx-2.3/image-to-video` |

**命名原则**：真名（非 RH 营销名）+ 显示层去 `· RunningHub` 后缀 + 渠道标签隐藏。

---

## 三、⚠️ 字段命名冲突规则

### 规则 1: `model` 已被 NewAPI 路由占用

`model` 在整个系统中是 NewAPI 路由模型名（如 `rh-grok-image-text`）。任何 RH API 参数如果恰好也叫 `model`，前端和后端都必须用不同名称。

| 场景 | 前端字段名 | rh-adapter 映射到 RH payload |
|------|-----------|---------------------------|
| Grok Image 4.2 子版本 (g-3/g-4/g-4.1/g-4.2) | `variant` | `model` |

**前端注册代码**里用 `{ key: 'variant', ... }`，**rh-adapter `image.py`** 在 Grok 端点分支里 `payload["model"] = inputs.get("variant")`。

### 规则 2: `customHight` 是 RH 官方拼写（typo），故意保持

RH 官方 API 使用 `customHight`（不是 `customHeight`）。**全链路（前后端）保持 `customHight`**，不纠正拼写。在 `schemas.py`、`creationModelRegistry.ts`、`capabilities.json` 中统一使用 `customHight`，并加注释 `# RH upstream typo: "customHight" not "customHeight"`。

---

## 四、各模型独有参数（需全链路透传）

### 4.1 FLUX Klein 9B

| 参数 | 前端 key | RH 官方 key | 类型 |
|------|---------|------------|------|
| 图片 | `images` | `imageUrl` | IMAGE (1张) |
| 比例 | `aspectRatio` | `aspectRatio` | LIST |
| 输出格式 | `outputFormat` | `outputFormat` | LIST |
| 自定义宽 | `customWidth` | `customWidth` | INT (256-1536) |
| 自定义高 | `customHight` | `customHight` | INT (256-1536) ⚠️ RH typo |
| LoRA 名 | `lora` | `lora` | STRING |
| LoRA 强度 | `lora_strength` | `lora_strength` | FLOAT (-100~100) |

> **customWidth/customHight 展示规则**: 仅在 `aspectRatio=custom` 时 UI 显示这两个字段。预设比例时隐藏。前端 `CreationModelSpec.fields` 中正常注册，UI 组件根据 `aspectRatio` 当前值 v-if 控制。

### 4.2 Midjourney V8.1

| 参数 | 前端 key | RH 官方 key | 类型 |
|------|---------|------------|------|
| 提示词 | `prompt` | `prompt` | STRING (1-8192) |
| 原生 2K | `hd` | `hd` | BOOLEAN |
| 比例 | `aspectRatio` | `aspectRatio` | LIST |
| 垫图 | `images` → `imageUrl` | `imageUrl` | IMAGE |
| 质量 | `quality` | `quality` | LIST (1\|4) |
| 风格化 | `stylize` | `stylize` | INT (0-1000) |
| 混沌 | `chaos` | `chaos` | INT (0-100) |
| 原始模式 | `raw` | `raw` | BOOLEAN |
| 图像权重 | `iw` | `iw` | INT (0-3) |
| 风格参考 | `sref` | `sref` | IMAGE |
| 风格权重 | `sw` | `sw` | INT (0-1000) |
| 风格版本 | `sv` | `sv` | INT (固定6) |

> **全部 11 个参数均注册在 `CreationModelSpec.fields` 中**，确保透传链路完整。
> UI 策略：前 6 个外露；`raw`, `iw`, `sref`, `sw`, `sv` 收入「高级选项 ▸」折叠区。
> 验收要求：无论 UI 是否折叠，用户填了值的字段必须全部进入最终 RH payload。

### 4.3 Grok Image 4.2

| 参数 | 前端 key | RH 官方 key | 类型 |
|------|---------|------------|------|
| 子版本 | `variant` ⚠️ | `model` | LIST (g-3/g-4/g-4.1/g-4.2) |
| 提示词 | `prompt` | `prompt` | STRING |
| 尺寸(像素) | `aspectRatio` | `aspectRatio` | LIST (960x960,...) |
| 参考图 | `images` → `imageUrl` | `imageUrl` | IMAGE |

### 4.4 LTX 2.3 视频

| 参数 | 前端 key | RH 官方 key | 类型 |
|------|---------|------------|------|
| 提示词 | `prompt` | `prompt` | STRING |
| 分辨率 | `resolution` | `resolution` | LIST (1080p/720p/480p) |
| 比例 | `aspectRatio` | `aspectRatio` | LIST (16:9/9:16) |
| 时长 | `duration` | `duration` | INT (文生5-15, 图生5-20) |
| 参考图 | `images` → `imageUrl` | `imageUrl` | IMAGE (仅图生) |

---

## 五、全链路参数闭环

### 数据流

```
用户 UI 填参数
  → CreationPanel 收集 params
    → buildCreationRunPlan → CreationRunPlan
      → normalizeRunningHubParams → normalizedParams (Phase 1a)
        → executeRunningHubImageRequest / VideoRequest → body (Phase 1b)
          → NewAPI POST /v1/images/generations
            → rh-adapter ImageRequest (schemas.py) → restore from extra_fields (Phase 1c)
              → image.py generate_image → inputs dict → build_standard_payload (Phase 1d)
                → capabilities.json 查 params → fields 逐个映射
                  → RunningHub POST /openapi/v2/.../{endpoint}
```

### 当前断裂点（全部需修）

| # | 位置 | 问题 |
|---|------|------|
| ❶ | `creationMediaPlan.ts` `normalizeRunningHubParams()` | 白名单只含 ~30 个字段，MJ `hd/quality/stylize/chaos/raw/iw/sref/sw/sv`、Grok `variant`、FLUX `customWidth/customHight` 不在白名单 → 丢弃 |
| ❷ | `creationMediaRuntime.ts` `executeRunningHubImageRequest()` | `extraFields` 手写 5 个字段，新字段不进入 body |
| ❸ | `schemas.py` `ImageRequest` | 无 `hd/quality/stylize/...` 字段定义；`restore_rh_fields_from_extra_fields` 只恢复 7 个字段 |
| ❹ | `schemas.py` `VideoRequest` | 无 `resolution/aspectRatio` 之外的 LTX 特有字段 |
| ❺ | `image.py` `generate_image()` inputs dict | 只传 `prompt/aspectRatio/resolution/lora/outputFormat/images`，新字段不传入 `build_standard_payload` |

---

## 六、分 Phase 实施

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
 caps     参数全链路    模型注册     UI净化      测试验证
           ❶❷❸❹❺
```

---

### Phase 0: capabilities 快照补齐

**目标**: `runninghubStandard()` 和 `build_standard_payload()` 能读到新模型的官方参数能力。

| 文件 | 操作 |
|------|------|
| `rh-adapter/src/models/capabilities.json` | 新增 8 个 endpoint 条目，每个条目含完整 `params` 数组 |
| `src/data/rhCapabilities.json` | 同步新增 8 个 endpoint 条目（前端副本） |

**capabilities.json 新增条目示例** (Midjourney V8.1):

```json
{
  "endpoint": "youchuan/text-to-image-v81",
  "name_cn": "Midjourney V8.1",
  "task": "text-to-image",
  "output_type": "image",
  "params": [
    {"key":"prompt","type":"STRING","required":true,"maxLength":8192},
    {"key":"hd","type":"BOOLEAN","required":true},
    {"key":"aspectRatio","type":"LIST","options":["1:1","4:3","3:2","16:9","3:4","2:3","9:16"]},
    {"key":"imageUrl","type":"IMAGE","maxSizeMB":20},
    {"key":"quality","type":"LIST","options":["1","4"]},
    {"key":"stylize","type":"INT","min":0,"max":1000},
    {"key":"chaos","type":"INT","min":0,"max":100},
    {"key":"raw","type":"BOOLEAN"},
    {"key":"iw","type":"INT","min":0,"max":3},
    {"key":"sref","type":"IMAGE","maxSizeMB":20},
    {"key":"sw","type":"INT","min":0,"max":1000},
    {"key":"sv","type":"INT","min":6,"max":6}
  ]
}
```

其余 7 个端点同样补齐（按 §4 参数表）。

**验证**: 前端 `getRhEndpointCapability('youchuan/text-to-image-v81')` 返回非空且有 12 个 params。

**预估**: 20 min

---

### Phase 1: 参数全链路修复（5 个断裂点）

#### 1a: 前端 — `normalizeRunningHubParams()` 自动透传

**文件**: `src/runtime/creation/creationMediaPlan.ts`

**问题**: 白名单 30 个字段，新字段丢弃。

**改法**: 保留现有白名单保证向后兼容，追加 for-loop 从 `spec.fields` 自动透传：

```typescript
// 追加在 return compact(base) 之前:
for (const field of spec.fields || []) {
  if (!(field.key in base) && field.key in params && params[field.key] !== undefined) {
    base[field.key] = params[field.key]
  }
}
```

#### 1b: 前端 — `executeRunningHubImageRequest()` extraFields 动态化

**文件**: `src/runtime/creation/creationMediaRuntime.ts`

**问题**: `extraFields` 手写 5 个字段。

**改法**: 从 `request.plan.debug.normalizedParams` 动态读取，排除已在 body 顶层的键：

```typescript
const TOP_LEVEL_KEYS = new Set(['model','prompt','aspectRatio','aspect_ratio','ratio','images','extra_fields'])
const extraFields: Record<string, unknown> = {}
for (const [k, v] of Object.entries(request.plan.debug.normalizedParams || {})) {
  if (!TOP_LEVEL_KEYS.has(k) && v !== undefined && v !== null && v !== '') {
    extraFields[k] = v
  }
}
```

同样处理 `executeRunningHubVideoRequest()` 的 body 构建——追加 `extra_fields` 字段到 body。

#### 1c: rh-adapter — `schemas.py` 恢复新字段

**文件**: `rh-adapter/src/models/schemas.py`

**问题**: `restore_rh_fields_from_extra_fields` 只恢复 7 个字段。

**改法**: 在 `fill(...)` 调用列表中追加新字段：

```python
# 新增恢复:
fill("hd")
fill("quality")
fill("stylize")
fill("chaos")
fill("raw")
fill("iw")
fill("sref")
fill("sw")
fill("sv")
fill("variant")
fill("customWidth")
fill("customHight")  # RH upstream typo, not "customHeight"
fill("duration")
```

> **Pydantic 限制**: `BaseModel` 不允许对未定义的 field 做 `getattr(request, 'hd')`。
> **正确做法**: `image.py` / `video.py` 的 service 函数**直接从 `request.extra_fields` dict 读取**新字段，不依赖 Pydantic model 属性访问：
> ```python
> extra = request.extra_fields or {}
> inputs["hd"] = extra.get("hd")
> inputs["quality"] = extra.get("quality")
> # ... 同理所有新字段
> ```

#### 1d: rh-adapter — `image.py` / `video.py` 透传新字段

**文件**: `rh-adapter/src/services/image.py`

**问题**: `generate_image()` 的 inputs dict 只含 10 个字段。

**改法**: 在 inputs dict 中追加从 `request` 解析出的新字段：

```python
payload = await build_standard_payload(client, key, endpoint, {
    "prompt": request.prompt,
    "aspectRatio": aspect_ratio,
    "resolution": request.resolution,
    "lora": request.lora,
    "lora_strength": request.lora_strength,
    "outputFormat": request.output_format,
    "images": images,
    # ↓ 新增 — 从 raw_data / extra_fields 恢复的字段
    "hd": getattr(request, 'hd', None),
    "quality": getattr(request, 'quality', None),
    "stylize": getattr(request, 'stylize', None),
    "chaos": getattr(request, 'chaos', None),
    "raw": getattr(request, 'raw', None),
    "iw": getattr(request, 'iw', None),
    "sref": getattr(request, 'sref', None),
    "sw": getattr(request, 'sw', None),
    "sv": getattr(request, 'sv', None),
    "variant": getattr(request, 'variant', None),
    "customWidth": getattr(request, 'customWidth', None),
    "customHight": getattr(request, 'customHight', None),  # RH typo
})
```

**Grok `variant` → `model` 映射**: 在 `build_standard_payload` 返回前，对 Grok 端点做字段重命名：

```python
# 在 image.py generate_image() 中, build_standard_payload 返回后:
if endpoint.startswith("rhart-image-g/"):
    variant = payload.pop("variant", None)
    if variant:
        payload["model"] = variant
```

**文件**: `rh-adapter/src/services/video.py`

**硬要求**（LTX 2.3）: `generate_video()` 的 inputs dict 必须包含以下字段并传入 `build_standard_payload`：
- `images` → `imageUrl`（图生视频必填，1 张）
- `aspectRatio` / `ratio`（必填: 16:9 / 9:16）
- `resolution`（必填: 1080p / 720p / 480p）
- `duration`（必填 INT: 文生 5-15, 图生 5-20）
- `prompt`（必填）

从 `request.extra_fields` 读取这些值，与已有 `VideoRequest` 的 `duration`/`ratio`/`resolution` 字段合并传入 inputs dict。

#### 1e: 回归验证

改完 4 个文件后，跑现有全量测试确认未破坏已有模型：

```bash
pnpm run test:focused:run
cd rh-adapter && python -m pytest
```

**预估**: 60 min（前后端各 30 min）

---

### Phase 2: 模型注册

#### 2a: `rh-adapter/src/models/mapping.py`

**IMAGE_MODELS** +6:

```python
"rh-flux-klein-edit":  {"endpoint":"rhart-image/f-2-klein-9b/edit",            "label":"FLUX Klein 9B 编辑",   "output_type":"image"},
"rh-flux-klein-text":  {"endpoint":"rhart-image/f-2-klein-9b/text-to-image",   "label":"FLUX Klein 9B 文生图", "output_type":"image"},
"rh-flux-klein-lora":  {"endpoint":"rhart-image/f-2-klein-9b/text-to-image-lora","label":"FLUX Klein 9B LoRA",  "output_type":"image"},
"rh-midjourney-v81":   {"endpoint":"youchuan/text-to-image-v81",               "label":"Midjourney V8.1",      "output_type":"image"},
"rh-grok-image-text":  {"endpoint":"rhart-image-g/text-to-image",              "label":"Grok Image 4.2 文生图","output_type":"image"},
"rh-grok-image-image": {"endpoint":"rhart-image-g/image-to-image",             "label":"Grok Image 4.2 图生图","output_type":"image"},
```

**VIDEO_MODELS** +2:

```python
"rh-ltx23-text-video":  {"endpoint":"rhart-video/ltx-2.3/text-to-video",  "label":"LTX 2.3 文生视频","output_type":"video"},
"rh-ltx23-image-video": {"endpoint":"rhart-video/ltx-2.3/image-to-video", "label":"LTX 2.3 图生视频","output_type":"video"},
```

#### 2b: `src/runtime/creation/creationModelRegistry.ts`

新增 8 条 `runninghubStandard({...})`——附录 A。

`label` 使用 canonical 格式（如 `'Midjourney V8.1 · RunningHub'`），显示层去后缀在 Phase 3 做。

**预估**: 20 min

---

### Phase 3: UI 净化（显示层优先）

**原则**: 不改 `CreationModelSpec.label` canonical 值，在渲染层做转换。

#### 3a: 具体改动位置

| 组件 | 文件 | 改动 |
|------|------|------|
| **创作面板模型列表** | `src/components/creation/CreationPanel.vue` | 模型下拉 `<select>` / 模型卡片渲染处，应用 `displayModelLabel()` |
| **创作面板当前模型显示** | 同上 | 顶部「当前模型: xxx」区域 |
| **渠道/模式标签** | 同上 | 「RH 官方 API」标签位置，`v-if="!RH_ONLY_MODE"` 隐藏 |
| **画布模型选择器** | `src/components/canvas/CanvasNodeLibrary.vue` 或画布模型下拉组件 | 画布复用 `listCreationModels()` 获取模型列表，显示层自动跟随 `displayModelLabel()`。**不单独维护模型表**。如果画布有独立的模型名称渲染，统一改为调用同一个 `displayModelLabel()` |

#### 3b: 显示层函数

```typescript
// src/components/creation/ 或 composables/ 中新增
import { RH_ONLY_MODE } from '@/runtime/creation/creationModelRegistry'

const LABEL_OVERRIDES: Record<string, string> = {
  '全能图片 V2 · RunningHub': 'Nano Banana Flash',
  '全能图片 PRO · RunningHub': 'Nano Banana Pro',
  '全能视频 V3.1 Fast · RunningHub': 'Veo 3.1 Fast',
}

export function displayModelLabel(canonicalLabel: string): string {
  const base = LABEL_OVERRIDES[canonicalLabel] || canonicalLabel
  return base.replace(/ · RunningHub( 工作流)?$/, '')
}
```

`CreationPanel.vue` 模板中所有渲染模型名称的地方用 `displayModelLabel(spec.label)` 替代直接 `spec.label`。

#### 3c: 渠道标签

`CreationPanel.vue` 中找到渲染渠道名称的 DOM 节点，加 `v-if="!RH_ONLY_MODE"` 或直接删除。

**预估**: 20 min

---

### Phase 4: 测试与验证

#### 4a: 前端 run-plan payload 单测

对每个新模型族构造 `CreationRunPlan`，调用 `buildCreationSubmitRequest`，断言 `normalizedParams` 包含所有用户字段。

```typescript
// 示例: Midjourney V8.1
const plan = buildCreationRunPlan({
  modelId: 'rh-midjourney-v81',
  params: { prompt: 'test', hd: true, quality: '4', stylize: 500, chaos: 50 }
})
const req = buildCreationSubmitRequest(plan)
expect(req.imageParams.hd).toBe(true)
expect(req.imageParams.quality).toBe('4')
expect(req.imageParams.stylize).toBe(500)
expect(req.imageParams.chaos).toBe(50)
```

#### 4b: 前端 runtime body 单测

```typescript
// 验证 executeRunningHubImageRequest 发出的 body
// Mock apiCall, 捕获实际 body, 断言 extra_fields 含所有新字段
expect(body.extra_fields.hd).toBe(true)
expect(body.extra_fields.stylize).toBe(500)
```

#### 4c: rh-adapter payload 单测

```bash
cd rh-adapter && python -m pytest
```

新增测试:
- `test_midjourney_payload`: 验证 `build_standard_payload` 对 `youchuan/text-to-image-v81` 端点输出包含 `hd`, `quality`, `stylize`, `chaos` 等字段
- `test_grok_variant_mapping`: 验证 `variant=g-4.2` 映射为 payload 的 `model=g-4.2`
- `test_flux_customHight`: 验证 `customHight` 字段透传（非 `customHeight`）

#### 4d: 冒烟测试（pnpm tauri dev）

每个模型至少一次完整链路：

**检查清单**:
- [ ] FLUX Klein 文生图: `aspectRatio`, `outputFormat` 进入 RH payload；`aspectRatio=custom` 时 `customWidth`, `customHight` 进入
- [ ] FLUX Klein LoRA: `lora`, `lora_strength` 进入 RH payload
- [ ] FLUX Klein 编辑: `imageUrl` 正确上传 → 进入 RH payload
- [ ] Midjourney V8.1: 全部 11 个参数（`hd`, `quality`, `stylize`, `chaos`, `raw`, `iw`, `sref`, `sw`, `sv`）进入 RH payload
- [ ] Grok Image 4.2 文生图: `variant=g-4.2` → payload `model=g-4.2`
- [ ] Grok Image 4.2 图生图: `imageUrl` + `variant` 进入 RH payload
- [ ] LTX 2.3 文生视频: `resolution`, `aspectRatio`, `duration` 进入 RH payload
- [ ] LTX 2.3 图生视频: `imageUrl` + `resolution` + `duration` 进入 RH payload
- [ ] 画廊显示正确模型名（无 `· RunningHub` 后缀）
- [ ] 创作面板模型列表显示正确名称

**预估**: 90 min

---

### Phase 5: 收尾

| 内容 | 文件 |
|------|------|
| 更新 `docs/model-registry-matrix.md` | 追加 8 行 + 更新改名模型的显示名 |
| rh-adapter 服务器部署 | `git pull && docker compose up -d --build rh-adapter` |
| NewAPI 后台配置 | §7 |
| 合入 main | — |

---

## 七、价格与 NewAPI 后台配置

### 7.1 预估

| 模型 | USD | 依据 |
|------|:--:|------|
| `rh-flux-klein-edit` | 0.10 | 图生图 + 9B |
| `rh-flux-klein-text` | 0.05 | 纯文生图 |
| `rh-flux-klein-lora` | 0.08 | 文生图 + LoRA |
| `rh-midjourney-v81` | 0.10 | Midjourney V8.1 |
| `rh-grok-image-text` | 0.03 | 低价渠道 |
| `rh-grok-image-image` | 0.05 | 低价 + 图生图 |
| `rh-ltx23-text-video` | 0.50 | 文生视频 5-15s |
| `rh-ltx23-image-video` | 0.50 | 图生视频 5-20s |

### 7.2 NewAPI 管理后台

RH Channel 模型列表追加 8 个模型名，设置定价，enabled: true，路由指向 rh-adapter。

---

## 八、改动文件总览

| 文件 | Phase | 操作 |
|------|:-----:|------|
| `rh-adapter/src/models/capabilities.json` | 0 | +8 endpoint 条目 |
| `src/data/rhCapabilities.json` | 0 | 同步 +8 |
| `src/runtime/creation/creationMediaPlan.ts` | 1 | `normalizeRunningHubParams` 自动透传 |
| `src/runtime/creation/creationMediaRuntime.ts` | 1 | image/video runtime extraFields 动态化 |
| `rh-adapter/src/models/schemas.py` | 1 | `restore_rh_fields_from_extra_fields` +15 fill |
| `rh-adapter/src/services/image.py` | 1 | `generate_image` inputs + Grok variant→model |
| `rh-adapter/src/services/video.py` | 1 | LTX 特有字段透传 |
| `rh-adapter/src/models/mapping.py` | 2 | IMAGE +6, VIDEO +2 |
| `src/runtime/creation/creationModelRegistry.ts` | 2 | +8 runninghubStandard |
| `src/components/creation/CreationPanel.vue` | 3 | 显示层去后缀+改名+隐藏渠道标签 |
| 画布模型选择器（如独立） | 3 | 同步 Phase 3 |
| `docs/model-registry-matrix.md` | 5 | 追加+更新 |
| NewAPI 管理后台 | 5 | 人工配置 |

---

## 九、风险

| 风险 | 缓解 |
|------|------|
| Phase 1 自动透传引入野字段 | 字段来自 `spec.fields`（显式注册），不会引入外部输入 |
| Phase 1 破坏现有模型 | 先跑全量回归 |
| Grok `variant` → `model` 映射遗漏 | `image.py` 明确判断 `endpoint.startswith("rhart-image-g/")` |
| MJ 参数 11 个 UI 臃肿 | 核心 6 个外露 + 5 个折叠「高级选项」 |
| Grok `aspectRatio` 像素尺寸格式 | 自定义 options，不走比例推断逻辑 |
| 低价渠道不稳定 | contractStatus partial + 描述注明 |
| `customHight` 被误改为 `customHeight` | 前后端统一注释 `# RH upstream typo` |
| COS URL 24h 失效 | 已有提醒 banner + 下载按钮 |
| capabilities.json 两端不同步 | 明确 rh-adapter 为权威源，前端为副本 |

---

## 十、不在本范围

- ❌ 提示词携带 → 独立分支
- ❌ canonical label 迁移 → 后续单独 PR
- ❌ 画布新增节点 → 画布自动跟随 `listCreationModels()`
- ❌ 现有 broken 模型修复

---

## 附录 A: creationModelRegistry.ts 新增代码

```typescript
// ── FLUX.2 Klein 9B 系列 (3 个) ──
runninghubStandard({
  id: 'runninghub/api/rh-flux-klein-edit', model: 'rh-flux-klein-edit',
  label: 'FLUX Klein 9B 编辑 · RunningHub', task: 'image', mode: 'image-to-image',
  price: 0.10, contractStatus: 'partial', notes: ['docs/notes/rh-flux-klein-9b.md'],
  files: { images: { min: 1, max: 1 } },
  fields: promptFields([
    { key: 'images', label: '参考图', kind: 'images', required: true },
    { key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '1:1',
      options: options(['1:1','3:4','4:3','9:16','16:9','2:3','3:2','custom']) },
    { key: 'customWidth', label: '宽度', kind: 'number', defaultValue: 1024, min: 256, max: 1536, step: 16 },
    { key: 'customHight', label: '高度', kind: 'number', defaultValue: 1024, min: 256, max: 1536, step: 16 },  // RH upstream typo
    { key: 'outputFormat', label: '输出格式', kind: 'select', defaultValue: 'png',
      options: options(['png','jpeg','webp(lossless)','webp(lossy)']) },
  ]),
  ratios: ['1:1','3:4','4:3','9:16','16:9','2:3','3:2','custom'],
  contractIssues: ['imageUrl 字段映射需验证。customWidth/customHight 仅 aspectRatio=custom 时 UI 显示。'],
}),
runninghubStandard({
  id: 'runninghub/api/rh-flux-klein-text', model: 'rh-flux-klein-text',
  label: 'FLUX Klein 9B 文生图 · RunningHub', task: 'image', mode: 'text-to-image',
  price: 0.05, contractStatus: 'partial', notes: ['docs/notes/rh-flux-klein-9b.md'],
  fields: promptFields([
    { key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '1:1',
      options: options(['1:1','3:4','4:3','9:16','16:9','2:3','3:2','custom']) },
    { key: 'customWidth', label: '宽度', kind: 'number', defaultValue: 1024, min: 256, max: 1536, step: 16 },
    { key: 'customHight', label: '高度', kind: 'number', defaultValue: 1024, min: 256, max: 1536, step: 16 },  // RH upstream typo
    { key: 'outputFormat', label: '输出格式', kind: 'select', defaultValue: 'png',
      options: options(['png','jpeg','webp(lossless)','webp(lossy)']) },
  ]),
  ratios: ['1:1','3:4','4:3','9:16','16:9','2:3','3:2','custom'],
}),
runninghubStandard({
  id: 'runninghub/api/rh-flux-klein-lora', model: 'rh-flux-klein-lora',
  label: 'FLUX Klein 9B LoRA · RunningHub', task: 'image', mode: 'text-to-image',
  price: 0.08, contractStatus: 'partial', notes: ['docs/notes/rh-flux-klein-9b.md'],
  fields: promptFields([
    { key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '1:1',
      options: options(['1:1','3:4','4:3','9:16','16:9','2:3','3:2','custom']) },
    { key: 'customWidth', label: '宽度', kind: 'number', defaultValue: 1024, min: 256, max: 1536, step: 16 },
    { key: 'customHight', label: '高度', kind: 'number', defaultValue: 1024, min: 256, max: 1536, step: 16 },  // RH upstream typo
    { key: 'outputFormat', label: '输出格式', kind: 'select', defaultValue: 'png',
      options: options(['png','jpeg','webp(lossless)','webp(lossy)']) },
    { key: 'lora', label: 'LoRA', kind: 'text' },
    { key: 'lora_strength', label: 'LoRA 强度', kind: 'number', defaultValue: 0, min: -100, max: 100, step: 0.1 },
  ]),
  ratios: ['1:1','3:4','4:3','9:16','16:9','2:3','3:2','custom'],
}),

// ── Midjourney V8.1 ──
runninghubStandard({
  id: 'runninghub/api/rh-midjourney-v81', model: 'rh-midjourney-v81',
  label: 'Midjourney V8.1 · RunningHub', task: 'image', mode: 'text-to-image',
  price: 0.10, contractStatus: 'partial', notes: ['docs/notes/RH-图片模型.md'],
  files: { images: { min: 0, max: 1 } },
  fields: promptFields([
    { key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '1:1',
      options: options(['1:1','4:3','3:2','16:9','3:4','2:3','9:16']) },
    { key: 'hd', label: '原生 2K', kind: 'boolean', defaultValue: false },
    { key: 'images', label: '垫图', kind: 'images' },
    { key: 'quality', label: '质量', kind: 'select', defaultValue: '1', options: options(['1','4']) },
    { key: 'stylize', label: '风格化', kind: 'number', defaultValue: 100, min: 0, max: 1000, step: 10 },
    { key: 'chaos', label: '混沌', kind: 'number', defaultValue: 0, min: 0, max: 100, step: 1 },
    // 高级参数（UI 折叠，但仍注册以保透传）
    { key: 'raw', label: '原始模式', kind: 'boolean', defaultValue: false },
    { key: 'iw', label: '图像权重', kind: 'number', defaultValue: 1, min: 0, max: 3, step: 1 },
    { key: 'sref', label: '风格参考', kind: 'text' },
    { key: 'sw', label: '风格权重', kind: 'number', defaultValue: 100, min: 0, max: 1000, step: 10 },
    { key: 'sv', label: '风格版本', kind: 'number', defaultValue: 6, min: 6, max: 6 },
  ]),
  ratios: ['1:1','4:3','3:2','16:9','3:4','2:3','9:16'],
  contractIssues: ['全部 11 个参数已注册。高级参数(raw/iw/sref/sw/sv) UI 折叠展示。需验证全部 11 个参数进入 RH payload。'],
}),

// ── Grok Image 4.2（variant 字段避免与 NewAPI model 冲突）──
runninghubStandard({
  id: 'runninghub/api/rh-grok-image-text', model: 'rh-grok-image-text',
  label: 'Grok Image 4.2 文生图 · RunningHub', task: 'image', mode: 'text-to-image',
  price: 0.03, contractStatus: 'partial', notes: ['docs/notes/RH-图片模型.md'],
  fields: promptFields([
    { key: 'variant', label: '版本', kind: 'select', defaultValue: 'g-4.2',
      options: options(['g-3','g-4','g-4.1','g-4.2']) },
    { key: 'aspectRatio', label: '尺寸', kind: 'select', defaultValue: '960x960',
      options: options(['960x960','720x1280','1280x720','1168x784','784x1168']) },
  ]),
  contractIssues: ['低价渠道，不稳定。aspectRatio 为像素尺寸格式。variant→model 映射在 rh-adapter 完成。'],
}),
runninghubStandard({
  id: 'runninghub/api/rh-grok-image-image', model: 'rh-grok-image-image',
  label: 'Grok Image 4.2 图生图 · RunningHub', task: 'image', mode: 'image-to-image',
  price: 0.05, contractStatus: 'partial', notes: ['docs/notes/RH-图片模型.md'],
  files: { images: { min: 1, max: 1 } },
  fields: promptFields([
    { key: 'variant', label: '版本', kind: 'select', defaultValue: 'g-4.2',
      options: options(['g-3','g-4','g-4.1','g-4.2']) },
    { key: 'images', label: '参考图', kind: 'images', required: true },
  ]),
  contractIssues: ['低价渠道，不稳定。imageUrl + variant→model 映射需验证。'],
}),

// ── LTX 2.3 视频 ──
runninghubStandard({
  id: 'runninghub/api/rh-ltx23-text-video', model: 'rh-ltx23-text-video',
  label: 'LTX 2.3 文生视频 · RunningHub', task: 'video', mode: 'text-to-video',
  price: 0.50, contractStatus: 'partial', notes: ['docs/notes/RH-视频模型.md'],
  fields: promptFields([
    { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p',
      options: options(['1080p','720p','480p']) },
    { key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '16:9',
      options: options(['16:9','9:16']) },
    { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 5, max: 15, step: 1 },
  ]),
  duration: { min: 5, max: 15 }, ratios: ['16:9','9:16'], resolutions: ['1080p','720p','480p'],
}),
runninghubStandard({
  id: 'runninghub/api/rh-ltx23-image-video', model: 'rh-ltx23-image-video',
  label: 'LTX 2.3 图生视频 · RunningHub', task: 'video', mode: 'image-to-video',
  price: 0.50, contractStatus: 'partial', notes: ['docs/notes/RH-视频模型.md'],
  files: { images: { min: 1, max: 1 } },
  fields: promptFields([
    { key: 'resolution', label: '分辨率', kind: 'select', defaultValue: '720p',
      options: options(['480p','720p','1080p']) },
    { key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '16:9',
      options: options(['9:16','16:9']) },
    { key: 'duration', label: '时长(秒)', kind: 'number', defaultValue: 5, min: 5, max: 20, step: 1 },
  ]),
  duration: { min: 5, max: 20 }, ratios: ['9:16','16:9'], resolutions: ['480p','720p','1080p'],
}),
```

---

## 附录 B: UI 最终效果

> 显示层去后缀 + 改名映射 + 隐藏渠道标签

### 📷 图片 — 文生图

| 模型 | 参数 |
|------|------|
| Z Image Turbo | 提示词, 比例[1:1▾], LoRA, LoRA强度, 输出格式[png▾] |
| GPT2.0 文生图 | 提示词, 比例[16:9▾], 分辨率[1k▾] |
| Nano Banana Flash | 提示词, 参考图[📎可选] |
| FLUX Klein 9B 文生图 🆕 | 提示词, 比例[1:1▾], 输出格式[png▾] |
| FLUX Klein 9B LoRA 🆕 | 提示词, 比例[1:1▾], LoRA, LoRA强度, 输出格式[png▾] |
| Midjourney V8.1 🆕 | 提示词, 比例[1:1▾], 原生2K[☐], 垫图[📎], 质量[1▾], 风格化, 混沌 [+高级▸] |
| Grok Image 4.2 文生图 🆕 | 提示词, 版本[g-4.2▾], 尺寸[960×960▾] |

### 📷 图片 — 图生图

| 模型 | 参数 |
|------|------|
| GPT2.0 图生图 | 提示词, 比例[16:9▾], 分辨率[1k▾], 参考图[📎必选1-5] |
| Nano Banana Pro | 提示词, 参考图[📎0-8] |
| FLUX Klein 9B 编辑 🆕 | 提示词, 比例[1:1▾], 输出格式[png▾], 参考图[📎必选1] |
| Grok Image 4.2 图生图 🆕 | 提示词, 版本[g-4.2▾], 参考图[📎必选1] |

### 🎬 视频

| 模式 | 模型 | 参数 |
|------|------|------|
| 文生视频 | Grok Video 文生视频 | 提示词, 时长6-30s |
| 文生视频 | Seedance 2.0 文生视频 | 提示词, 时长4-15s |
| 文生视频 | LTX 2.3 文生视频 🆕 | 提示词, 分辨率[720p▾], 比例[16:9▾], 时长5-15s |
| 图生视频 | Veo 3.1 Fast | 提示词, 参考图[📎0-3], 时长8s |
| 图生视频 | Grok Video 图生视频 | 提示词, 参考图[📎1-3], 时长6-30s |
| 图生视频 | Seedance 2.0 图生视频 | 提示词, 参考图[📎1-2], 时长4-15s |
| 图生视频 | LTX 2.3 图生视频 🆕 | 提示词, 参考图[📎必选1], 分辨率[720p▾], 比例[16:9▾], 时长5-20s |
| 视频编辑 | Grok Video 视频编辑 | 提示词, 视频[📎必选1] |
| 工作流 | Seedance 2.0 全能参考 | 提示词, 参考图[📎0-9], 参考视频[📎0-1], 参考音频[📎0-1], 时长4-15s |

### 🎵 音频 / 🤖 数字人

（同 v2，无变化）

🆕 = 本次新增 (8个)
