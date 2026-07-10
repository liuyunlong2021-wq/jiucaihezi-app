# Seedance 2.0 9 模型 — 完整注册 & 排障手册

> **最后更新**: 2026-07-10
> **事实源**: `docs/notes/runninghub-seedance9模型完整文档.md`（RH 官方文档）
> **一句话**: 新增/修补 Seedance 模型，改 4 个文件 + 服务器重建，缺一不可。

---

## 一、9 模型速查表

| # | 模型名 (NewAPI) | RH 端点 | 模式 | 档位 | 720p官方价/秒 | 售价/秒 | 利润 |
|---|---|---|---|---|---|---|---|
| 1 | `rh-seedance2-mini` | `sparkvideo-2.0-mini/multimodal-video` | 多模态 | Mini | ¥0.6 | ¥0.8 | ~25% |
| 2 | `rh-seedance2-mini-text` | `sparkvideo-2.0-mini/text-to-video` | 文生视频 | Mini | ¥0.6 | ¥0.8 | ~25% |
| 3 | `rh-seedance2-mini-image` | `sparkvideo-2.0-mini/image-to-video` | 图生视频 | Mini | ¥0.6 | ¥0.8 | ~25% |
| 4 | `rh-seedance2-fast` | `sparkvideo-2.0-fast/multimodal-video` | 多模态 | Fast | ¥1.0 | ¥1.3 | ~25% |
| 5 | `rh-seedance2-fast-text` | `sparkvideo-2.0-fast/text-to-video` | 文生视频 | Fast | ¥1.0 | ¥1.3 | ~25% |
| 6 | `rh-seedance2-fast-image` | `sparkvideo-2.0-fast/image-to-video` | 图生视频 | Fast | ¥1.0 | ¥1.3 | ~25% |
| 7 | `rh-seedance2` | `sparkvideo-2.0/multimodal-video` | 多模态 | Standard | ¥1.2 | ¥1.5 | ~25% |
| 8 | `rh-seedance2-text` | `sparkvideo-2.0/text-to-video` | 文生视频 | Standard | ¥1.2 | ¥1.5 | ~25% |
| 9 | `rh-seedance2-image` | `sparkvideo-2.0/image-to-video` | 图生视频 | Standard | ¥1.2 | ¥1.5 | ~25% |

> **多模态最低计费**: 输出5秒 → 最低计费9秒。实际成本比文生/图生高约50%，售价已折算此因素。

---

## 二、涉及文件（4 个，缺一不可）

| 文件 | 作用 | 改什么 |
|------|------|--------|
| `rh-adapter/src/models/mapping.py` | 模型名 → RH 端点映射 | `VIDEO_MODELS` 字典 |
| `rh-adapter/src/models/capabilities.json` | RH 端点参数白名单 | `endpoints[]` 数组 + `total` |
| `src/runtime/creation/creationModelRegistry.ts` | 前端模型下拉列表 | `CREATION_MODEL_REGISTRY` 数组 |
| `src/data/mediaModelCapabilities.ts` | 前端模型能力声明 | `MEDIA_MODEL_CAPABILITIES` 数组 |

### 额外（本次踩坑新增）

| 文件 | 作用 |
|------|------|
| `rh-adapter/src/services/standard_payload.py` | **`realPersonMode: True` 自动注入**（所有 sparkvideo 端点） |

---

## 三、排障记录

### 坑 1: capabilities.json 缺 Mini 端点
- **现象**: HTTP 500 `Endpoint not found in official RunningHub capabilities: sparkvideo-2.0-mini/image-to-video`
- **原因**: `capabilities.json` 只有 Standard + Fast 6 个端点，缺 Mini 3 个
- **修复**: 补全 3 个 Mini 端点，`total` 362→365
- **教训**: 新增端点时 `mapping.py` 和 `capabilities.json` 必须同步更新

### 坑 2: realPersonMode 未传
- **现象**: 17s 返回 `Current mode does not support real-person content. To enable it, set realPersonMode to true`，前端持续轮询 23 分钟
- **原因**: Seedance 2.0 处理真人内容需要 `realPersonMode: True`，RH 官方参数但未通过 capabilities 透传
- **修复**: `standard_payload.py` 对所有 `sparkvideo` 端点自动注入 `realPersonMode: True`
- **注意**: 名人/公众人物/IP角色即使开了此开关也不支持（RH 平台策略）

### 坑 3: Docker restart 不更新映射
- **现象**: `docker compose restart rh-adapter` 后 mapping.py 修改不生效
- **原因**: Dockerfile 有 `COPY src/ ./src/`，mapping.py 烤进镜像
- **修复**: 必须 `docker compose up -d --force-recreate --build rh-adapter`

### 坑 4: 前端 label 歧义
- **现象**: "Seedance 2.0 Mini" 看不出是多模态还是文生还是图生
- **修复**: 多模态加"多模态"后缀：`Mini 多模态` / `Fast 多模态` / `2.0 多模态`

---

## 四、新增/修补模型标准流程

### 4.1 mapping.py
```python
"rh-seedance2-xxx": {
    "endpoint": "rhart-video/sparkvideo-2.0-xxx/xxx",
    "label": "Seedance 2.0 XXX",
    "output_type": "video",
},
```

### 4.2 capabilities.json
从 RH 官方文档复制端点参数，插入到 `endpoints[]` 数组中，更新 `total`。

Mini 端点必须放对应 Fast 端点之后（JSON 顺序影响 `lru_cache` 行为）。

### 4.3 creationModelRegistry.ts
```typescript
runninghubStandard({
  id: 'runninghub/api/rh-seedance2-xxx',
  model: 'rh-seedance2-xxx',
  label: 'Seedance 2.0 XXX · RunningHub',
  task: 'video',
  mode: 'workflow',  // 或 'text-to-video' / 'image-to-video'
  price: 0.8,
  notes: ['docs/notes/runninghub-seedance9模型完整文档.md'],
  // 多模态: files: { images: {min:0,max:9}, videos: {min:0,max:1}, audios: {min:0,max:1} }
  // 图生: files: { images: {min:1,max:1} }
  // 文生: 无 files
  duration: { min: 4, max: 15 },
  resolutions: ['720p'],
}),
```

### 4.4 mediaModelCapabilities.ts
```typescript
{
  id: 'rh-seedance2-xxx',
  label: 'Seedance 2.0 XXX',
  task: 'video',
  model: 'rh-seedance2-xxx',
  provider: 'gateway-video',
  maxFiles: 10,  // 多模态
  acceptedFiles: ['image', 'video', 'audio'],  // 多模态
  fields: [
    { key: 'prompt', label: '提示词', kind: 'prompt', required: true },
    { key: 'images', label: '参考图片', kind: 'images', required: false },
    { key: 'video', label: '参考视频', kind: 'video', required: false },
    { key: 'audio', label: '参考音频', kind: 'audio', required: false },
  ],
},
```

### 4.5 realPersonMode（Seedance 专属）
`standard_payload.py` 已有自动注入逻辑。如果新增非 sparkvideo 但需要 `realPersonMode` 的模型，在此处扩展条件。

### 4.6 部署
```bash
# 本地
git add -A && git commit -m "feat: 新增 Seedance xxx 模型" && git push

# 服务器（必须 rebuild）
cd /opt/jiucai-repo && git pull && cp -r rh-adapter/* /opt/rh-adapter/ && cd /opt/rh-adapter && docker compose up -d --force-recreate --build rh-adapter

# 验证
docker exec rh-adapter-rh-adapter-1 python3 -c "
from src.models.mapping import VIDEO_MODELS
from src.models.capabilities import load_official_capabilities
for k,v in VIDEO_MODELS.items():
    if 'seedance' in k:
        print(f'{k} → {v[\"endpoint\"]}')
"
```

### 4.7 NewAPI channel 61
服务器上更新 NewAPI 数据库 channel 61 的模型列表，加入新模型名。

---

## 五、定价公式

**720p 统一价**（所有档位已锁定 720p）：

| 档位 | 官方 ¥/s | 售价 ¥/s | 5秒总收入 | 5秒成本 | 5秒毛利 | 利润率 |
|------|---------|---------|----------|--------|--------|--------|
| Mini | 0.6 | 0.8 | ¥4.0 | ¥3.0 | ¥1.0 | 25% |
| Fast | 1.0 | 1.3 | ¥6.5 | ¥5.0 | ¥1.5 | 23% |
| Standard | 1.2 | 1.5 | ¥7.5 | ¥6.0 | ¥1.5 | 20% |

> 多模态实际成本因最低计费时长（5s→9s）更高，但售价统一，多模态利润率略低于文生/图生。
