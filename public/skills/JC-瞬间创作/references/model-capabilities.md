# 模型能力表

> **唯一事实源。** LLM 只能从这张表里推荐参数。用户选模型 → 只能从该行选比例/分辨率/时长。
> 自动生成脚本：`node scripts/build-model-capabilities.mjs`

## 图片模型（11 个）

| # | 模型 | 价格 | 模式 | 比例 | 分辨率 |
|---|------|------|------|------|--------|
| ⭐1 | GPT Image 2 官方版 `rh-gpt2-official` | ¥0.25 | 文生图/图生图 | 3:2, 1:1, 2:3, 5:4, 4:5, 16:9, 9:16, 21:9, 3:4, 4:3 | 1k, 2k, 4k |
| 2 | GPT Image 2 `gpt-image-2` | ¥0.15 | 文生图/图生图 | 3:2, 1:1, 2:3, 5:4, 4:5, 16:9, 9:16, 21:9, 3:4, 4:3 | 1k, 2k, 4k |
| 3 | 全能图片PRO `rh-pro-image` | ¥0.50 | 文生图 | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 5:4, 4:5, 21:9 | 1k, 2k, 4k |
| 4 | 全能图片V2 `rh-image-v2` | ¥0.30 | 文生图 | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 5:4, 4:5, 21:9 | 1k, 2k, 4k |
| 5 | 悠船 v7 (MJ风格) `rh-midjourney-v81` | ¥1.00 | 文生图 | 1:1, 16:9, 9:16, 3:4, 4:3, 3:2, 2:3 | — |
| 6 | Seedream v5 `z-image-turbo` | ¥0.05 | 文生图 | 1:1, 3:4, 4:3, 9:16, 16:9, 2:3, 3:2 | — |
| 7 | Flux Klein 文生 `rh-flux-klein-text` | ¥0.10 | 文生图 | 1:1, 3:4, 4:3, 9:16, 16:9 | — |
| 8 | Flux Klein 图生 `rh-flux-klein-edit` | ¥0.10 | 图生图 | 保持原图比例 | — |
| 9 | Grok Image 文生 `rh-grok-image-text` | ¥0.10 | 文生图 | 1:1, 4:3, 3:4, 16:9, 9:16 | — |
| 10 | Grok Image 图生 `rh-grok-image-image` | ¥0.10 | 图生图 | 保持原图比例 | — |
| 11 | Gemini 3.1 Flash `gemini-3.1-flash-image-preview` | ¥0.10 | 文生图 | 1:1, 16:9, 9:16, 4:3, 3:4 | — |

## 视频模型（14 个）

| # | 模型 | 价格 | 模式 | 比例 | 分辨率 | 时长(s) | 参考图 |
|---|------|------|------|------|--------|---------|--------|
| ⭐1 | Seedance 2.0 Mini 图生 `rh-seedance2-mini-image` | ¥0.70/s | 图生视频 | adaptive, 16:9, 4:3, 1:1, 3:4, 9:16, 21:9 | 480p, 720p, 1080p(native), 1080p, 2k, 4k | 4-15 | ≤1 张 |
| 2 | Seedance 2.0 Mini 文生 `rh-seedance2-mini-text` | ¥0.70/s | 文生视频 | adaptive, 16:9, 4:3, 1:1, 3:4, 9:16, 21:9 | 480p, 720p, 1080p(native), 1080p, 2k, 4k | 4-15 | — |
| 3 | Seedance 2.0 Mini 多模态 `rh-seedance2-mini` | ¥1.20/s | 多模态 | adaptive, 16:9, 4:3, 1:1, 3:4, 9:16, 21:9 | 480p, 720p, 1080p(native), 1080p, 2k, 4k | 4-15 | ≤9 图+≤3 视频 |
| 4 | Seedance 2.0 Fast 图生 `rh-seedance2-fast-image` | ¥1.10/s | 图生视频 | adaptive, 16:9, 4:3, 1:1, 3:4, 9:16, 21:9 | 480p, 720p, 1080p(native), 1080p, 2k, 4k | 4-15 | ≤1 张 |
| 5 | Seedance 2.0 Fast 文生 `rh-seedance2-fast-text` | ¥1.10/s | 文生视频 | adaptive, 16:9, 4:3, 1:1, 3:4, 9:16, 21:9 | 480p, 720p, 1080p(native), 1080p, 2k, 4k | 4-15 | — |
| 6 | Seedance 2.0 Fast 多模态 `rh-seedance2-fast` | ¥2.00/s | 多模态 | adaptive, 16:9, 4:3, 1:1, 3:4, 9:16, 21:9 | 480p, 720p, 1080p(native), 1080p, 2k, 4k | 4-15 | ≤9 图+≤3 视频 |
| 7 | Seedance 2.0 Std 图生 `rh-seedance2-image` | ¥1.50/s | 图生视频 | adaptive, 16:9, 4:3, 1:1, 3:4, 9:16, 21:9 | 480p, 720p, 1080p(native), 1080p, 2k, 4k | 4-15 | ≤1 张 |
| 8 | Seedance 2.0 Std 文生 `rh-seedance2-text` | ¥1.50/s | 文生视频 | adaptive, 16:9, 4:3, 1:1, 3:4, 9:16, 21:9 | 480p, 720p, 1080p(native), 1080p, 2k, 4k | 4-15 | — |
| 9 | Veo 3.1 Fast 图生 `veo3.1-fast` | ¥0.40/s | 图生视频 | 16:9, 9:16 | 720p, 1080p, 4k | 8 | ≤3 张 |
| 10 | Veo 3.1 Fast 文生 `veo3.1-fast` | ¥0.40/s | 文生视频 | 16:9, 9:16 | 720p, 1080p, 4k | 8 | — |
| 11 | Grok Video 图生 `rh-grok-image-video` | ¥0.08/s | 图生视频 | 2:3, 3:2, 1:1, 16:9, 9:16 | 720p, 480p | 6-30 | ≤7 张 |
| 12 | Grok Video 文生 `rh-grok-text-video` | ¥0.08/s | 文生视频 | 2:3, 3:2, 1:1, 16:9, 9:16 | 720p, 480p | 6-30 | — |
| 13 | Sora 2 图生 `rh-sora2-image` | ¥1.20/s | 图生视频 | 16:9, 9:16, 1:1 | 480p, 720p | 4, 8, 12 | ≤1 张 |
| 14 | Sora 2 文生 `rh-sora2-text` | ¥1.20/s | 文生视频 | 16:9, 9:16, 1:1 | 480p, 720p | 4, 8, 12 | — |

## 音频 / 数字人（9 个）

| # | 模型 | 价格 | 用途 |
|---|------|------|------|
| 1 | TTS 标清 `rh-speech-turbo` | ¥0.50 | 文字转语音（快） |
| 2 | TTS 高清 `rh-speech-hd` | ¥0.50 | 文字转语音（质） |
| 3 | 音乐生成 `rh-music` | ¥0.50 | AI 音乐 |
| 4 | Suno 单曲 `rh-suno-v55-single` | ¥1.00 | Suno 音乐 |
| 5 | Suno 自定义 `rh-suno-v55-custom` | ¥1.00 | Suno 自定义风格 |
| 6 | Suno 写歌词 `rh-suno-lyrics` | ¥0.02 | AI 歌词 |
| 7 | 数字人快速 `rh-digital-human-fast` | ¥0.15 | 照片+音频→说话视频 |
| 8 | 数字人标准 `rh-digital-human` | ¥0.20 | 数字人（高质量） |
| 9 | 声音克隆 `rh-voice-clone` | ¥0.15 | 克隆声音 |

---

## 比例推荐规则

| 题材 | 推荐比例 |
|------|---------|
| 人像/单人/半身 | 3:4 |
| 全身/氛围感/短片 | 9:16 |
| 风景/城市/横屏 | 16:9 |
| 社交/头像/产品 | 1:1 |
| 海报/封面 | 2:3 |

## 分辨率推荐规则

| 分辨率 | 场景 |
|--------|------|
| 480p/1k | 快速预览/草稿 |
| 720p/2k | 日常使用/社交分享 |
| 1080p/4k | 高质量出片/壁纸（贵约 2×） |

---

## 图片提示词规则

**融入 GPT Image 2 全套技法：**

一段中文，按以下结构组织：

> 主体 + 场景 + 光影 + 材质 + 构图 + 风格锚 + 画质 + 情绪

- **场景密度 > 形容词**：用 5-12 个具体名词，不用 `stunning` / `beautiful`
- **材质/灯光/调色板分开写**：`brushed steel, softbox from left, muted teal/rust`
- **风格锚定**：`hyper-realistic commercial photography` / `warm Japanese film grain`
- **画质收尾**：`8K UHD, editorial finish`

示例：
```
用户: "生成一只猫"
→ "一只橘色短毛猫慵懒趴在木质窗台，百叶窗午后阳光形成条纹光影，猫毛被逆光勾勒金色轮廓，浅景深虚化绿植，Fujifilm Pro 400H 胶片色调，4K 超写实，宁静治愈"
```

## 视频提示词规则

**融入 Grok Video image-first 原则：**

一段中文，只写图片给不了的东西：

> 主体动作 + 镜头运动 + 氛围 + 声音

- **不重复图片内容**——模型从参考图已获取主体/构图/色调
- **指令 > 形容词**：`镜头缓慢推进` ✓ / `电影感十足` ✗
- **具体动词**：`缓步走` / `转头看向` / `风吹动发丝`

示例：
```
（参考图：女人在天台）
→ "女人慢慢抬起右手轻抚项链坠，目光望向远方灯海，风吹动发丝和裙角，镜头从侧面缓推至半身，远处车流声隐约"
```

---

## AI 应用（ComfyUI 工作流）

解锁 RunningHub 上任意 AI 应用——模型数量 ∞。

### 浏览应用

```bash
# 在 RunningHub 上搜索：https://www.runninghub.cn/ai-detail/WEBAPP_ID
# 用户提供链接或 webappId 即可使用
```

### 查看节点

```bash
python3 {baseDir}/scripts/jc_media.py app-info WEBAPP_ID
# → 返回可修改的节点列表（fieldName, fieldType, description）
```

### 运行

```bash
python3 {baseDir}/scripts/jc_media.py app-run \
  --webapp-id 1877265245566922800 \
  --node prompt="一只猫" --node steps=20 \
  --file ./ref.png \
  --output ./output.mp4
```

### 交互流程

```
用户: "帮我跑这个应用 https://www.runninghub.cn/ai-detail/1877265245566922800"
→ jc_media.py app-info 1877265245566922800
→ 展示可修改的节点："这个应用可以改这些参数：prompt（提示词）、steps（步数）..."
→ 引导用户填参数
→ jc_media.py app-run --webapp-id ... --node ...
→ "已提交 ✅ 后台生成中～"
```

## 使用规则

1. **用户选模型 → 只能从该行选参数**。不准推荐表里没有的比例/分辨率/时长。
2. **默认推荐 ⭐1**。
3. 执行：`--model <id> --params ratio=X:Y resolution=Z duration=N`
4. **异步执行**（见 SKILL.md）
5. **计费**：https://api.jiucaihezi.studio/usage-logs/common
