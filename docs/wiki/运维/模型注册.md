# RH 模型注册手册 — 通用流程 & 排障

> **最后更新**: 2026-07-10
> **覆盖模型**: Seedance 2.0 (9个) + Sora2 (4个)
> **一句话**: 新增 RH 模型，改 4 个文件 + 服务器重建 + NewAPI 配模型名。

---

## 一、涉及文件（5 层，缺一不可）

| # | 文件 | 作用 | 改什么 |
|---|---|---|---|
| 1 | `rh-adapter/src/models/mapping.py` | 模型名 → RH 端点映射 | `VIDEO_MODELS` 字典 |
| 2 | `rh-adapter/src/models/capabilities.json` | RH 端点参数白名单 | `endpoints[]` 数组 + `total` |
| 3 | `rh-adapter/src/services/standard_payload.py` | 请求构造（特殊参数注入） | 条件逻辑 |
| 4 | `src/runtime/creation/creationModelRegistry.ts` | 前端模型下拉 + 定价 + 时长 | `CREATION_MODEL_REGISTRY` 数组 |
| 5 | `src/data/mediaModelCapabilities.ts` | 前端模型能力声明 | `MEDIA_MODEL_CAPABILITIES` 数组 |

> **UI 层**: `src/components/creation/CreationPanel.vue`（时长控件渲染规则，一般不需要改）

---

## 二、新增模型标准步骤

### Step 1: mapping.py — 端点映射

```python
"rh-xxx": {
    "endpoint": "rhart-video-s/xxx",
    "label": "XXX",
    "output_type": "video",
},
```

### Step 2: capabilities.json — 参数白名单

从 RH 官方文档复制端点参数 JSON，插入 `endpoints[]` 数组末尾，更新 `total`。**死路**: 只改 mapping.py 不改 capabilities.json → HTTP 500。

### Step 3: creationModelRegistry.ts — 前端注册

```typescript
runninghubStandard({
  id: 'runninghub/api/rh-xxx',
  model: 'rh-xxx',
  label: '模型名',          // UI 自动剥离 · RunningHub 后缀
  task: 'video',
  mode: 'text-to-video',    // 或 image-to-video / workflow / video-edit
  price: 0.12,              // ¥/秒
  notes: ['docs/notes/RH-XXX.md'],
  // === 时长（三选一）===
  // A) 连续范围（滑条）:
  duration: { min: 4, max: 15 },
  // B) 离散值（按钮组，≤3个）:
  duration: { allowedValues: [4,8,12], min: 4, max: 12 },
  // C) 无时长:
  // 不传 duration

  // === 文件 ===
  // 文生: 不传 files
  // 图生: files: { images: { min: 1, max: 1 } }
  // 多模态: files: { images: {min:0,max:9}, videos: {min:0,max:1}, audios: {min:0,max:1} }
  // 角色上传: files: { videos: { min: 1, max: 1 } }

  // === 分辨率 ===
  resolutions: ['720p'],    // 指定固定值
  // resolutions: [],        // 不需要分辨率选择的模型
  // 不传 → 默认所有分辨率

  // === 自定义字段（覆盖默认） ===
  fields: promptFields([
    { key: 'duration', label: '时长', kind: 'select', defaultValue: '10', options: options(['10','15']) },
    { key: 'aspectRatio', label: '比例', kind: 'select', defaultValue: '9:16', options: options(['9:16','16:9']) },
  ]),
}),
```

### Step 4: mediaModelCapabilities.ts — 能力声明

```typescript
{
  id: 'rh-xxx',
  label: '模型名',
  task: 'video',
  model: 'rh-xxx',
  provider: 'gateway-video',
  maxFiles: 1,
  acceptedFiles: ['image'],
  fields: [
    { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
    { key: 'images', label: '参考图片', kind: 'images', required: true },
  ],
},
```

### Step 5: 部署

```bash
# 本地
git add -A && git commit -m "feat: 新增 XXX 模型" && git push

# 服务器（必须 rebuild，不能 restart！Dockerfile COPY 烤进镜像）
cd /opt/jiucai-repo && git pull && cp -r rh-adapter/* /opt/rh-adapter/ && cd /opt/rh-adapter && docker compose up -d --force-recreate --build rh-adapter

# 验证端点
docker exec rh-adapter-rh-adapter-1 python3 -c "
from src.models.mapping import VIDEO_MODELS
for k,v in VIDEO_MODELS.items():
    if 'xxx' in k:
        print(f'{k} → {v[\"endpoint\"]}')
"

# NewAPI 管理后台 → channel 61 → 添加模型名
```

### 4.8 NewAPI 模型广场（描述+价格）

数据库表 `models`，唯一约束 `(model_name, deleted_at)`（软删除）。

```bash
# 生成 SQL → base64 编码 → 管道直写（避免 heredoc 截断）
python3 -c "
import base64
sql = \"\"\"INSERT INTO models (model_name, description, status) VALUES
('model-name','描述 · 类型 · 价格',1),
...;\"
print(base64.b64encode(sql.encode()).decode())
" | xargs -I{} echo '{}' | base64 -d | docker exec -i \$(docker ps -q -f name=postgres) psql -U newapi -d new-api

# 重启 NewAPI 刷新缓存（~2s）
cd /root/new-api-new && docker compose restart new-api
```

> **教训**: heredoc 大文本通过 SSH 终端会随机截断，base64 编码彻底解决。

---

## 三、时长 UI 渲染规则

`CreationPanel.vue` 中 `durationOptions.length` 决定渲染方式：

| 选项数 | 渲染 | 示例 |
|--------|------|------|
| 0 | 不显示 | 角色上传 |
| 1 | 不显示（`hasDuration=false`） | — |
| 2-3 | **按钮组**（点击切换） | 文生 [10s\|15s]、真人图生 [4s\|8s\|12s] |
| 4+ | **滑条** | Seedance [4s...15s] |

> 2026-07-10 从 `≤2` 改为 `≤3`，Sora2 真人图生 3 值从滑条升级为按钮组。

### 如何控制选项数

`durationValuesFor()` 优先级：
1. `capabilities.duration.allowedValues` — 离散值列表
2. `capabilities.duration.min/max` — 连续范围（step=1）
3. `fields[].options`（kind='select'）— 字段选项
4. `fields[].kind='number'` 的 min/max

**推荐**: 离散值用 `allowedValues`，连续值用 `min/max`，自定义用 `fields`。

---

## 四、定价原则

### 按秒计费（连续时长）
官方 ¥/s × 1.2-1.3 = 售价，利润 20-30%。

### 按次计费（固定时长，如 Sora2 ¥1/次）
售价 = 成本 ÷ 最短时长 × 1.2
- 文生/图生: ¥1/次, 10-15s → ¥0.12/s, 10s 利润 17%, 15s 利润 44%
- 真人图生: ¥3.2-10/次, 4-12s → ¥1.0/s, 利润 17-25%

### 有最低计费时长的模型（如 Seedance 多模态）
有效成本 = 官方价 × 最低计费秒 / 输出秒。售价需覆盖 5s 最差情况。

---

## 五、排障速查

| 现象 | 原因 | 修复 |
|------|------|------|
| HTTP 500 `Endpoint not found in capabilities` | capabilities.json 缺端点 | 补端点 + 更新 total |
| `realPersonMode` 报错 | Seedance 需要真人开关 | `standard_payload.py` 注入 |
| Docker 重启不生效 | restart 不重建镜像 | 必须 `--force-recreate --build` |
| 时长显示滑条而非按钮 | `allowedValues` 未设 / 选项 >3 | 设 `allowedValues` 或改成 ≤3 |
| 不该有分辨率选项 | 未传 `resolutions`，走默认全部 | 传 `resolutions: []` |
| label 带 `· RunningHub` | 正常，`displayModelLabel()` 自动剥离 | 不用管 |

---

## 六、已注册模型清单

### Seedance 2.0 (9 个)

| 模型 | 端点 | 模式 | 售价 |
|------|------|------|------|
| `rh-seedance2-mini` | `sparkvideo-2.0-mini/multimodal-video` | 多模态 | ¥1.2/s |
| `rh-seedance2-mini-text` | `sparkvideo-2.0-mini/text-to-video` | 文生 | ¥0.8/s |
| `rh-seedance2-mini-image` | `sparkvideo-2.0-mini/image-to-video` | 图生 | ¥0.8/s |
| `rh-seedance2-fast` | `sparkvideo-2.0-fast/multimodal-video` | 多模态 | ¥2.0/s |
| `rh-seedance2-fast-text` | `sparkvideo-2.0-fast/text-to-video` | 文生 | ¥1.3/s |
| `rh-seedance2-fast-image` | `sparkvideo-2.0-fast/image-to-video` | 图生 | ¥1.3/s |
| `rh-seedance2` | `sparkvideo-2.0/multimodal-video` | 多模态 | ¥2.3/s |
| `rh-seedance2-text` | `sparkvideo-2.0/text-to-video` | 文生 | ¥1.5/s |
| `rh-seedance2-image` | `sparkvideo-2.0/image-to-video` | 图生 | ¥1.5/s |

### Sora2 (4 个)

| 模型 | 端点 | 模式 | 售价 |
|------|------|------|------|
| `rh-sora2-text` | `rhart-video-s/text-to-video` | 文生 (10/15s) | ¥0.12/s |
| `rh-sora2-image` | `rhart-video-s/image-to-video` | 图生 (10/15s) | ¥0.12/s |
| `rh-sora2-realistic` | `rhart-video-s-official/image-to-video-realistic` | 真人图生 (4/8/12s) | ¥1.0/s |
| `rh-sora2-character` | `rhart-video-s/sora-upload-character` | 角色上传 | ¥0.08/次 |
