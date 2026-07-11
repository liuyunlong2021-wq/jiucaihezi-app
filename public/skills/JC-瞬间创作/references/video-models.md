# 视频模型菜单

> 当用户说「做视频」「生成视频」「图生视频」「文生视频」等 → 读本文件，展示菜单，等用户选。

## 展示规则

**必须按以下格式展示，一字不改：**

```
做视频的话，这几个模型不错：

⭐1. Seedance 2.0 Mini 多模态 — 韭菜盒子推荐，图+视频+音频多输入，支持真人 ¥1.20/s
2. Seedance 2.0 Mini 文生视频 — 纯文字生视频 ¥0.70/s
3. Seedance 2.0 Mini 图生视频 — 图片生成视频 ¥0.70/s
4. Seedance 2.0 Fast 多模态 — 更快更强 ¥2.00/s
5. Seedance 2.0 Fast 文生视频 — ¥1.10/s
6. Seedance 2.0 Fast 图生视频 — ¥1.10/s
7. Seedance 2.0 Std 文生视频 — 最高画质 ¥1.50/s
8. Seedance 2.0 Std 图生视频 — 最高画质 ¥1.50/s
9. Veo 3.1 Fast — Google 出品，速度之王 ¥0.40/s
10. Grok Video 文生视频 — xAI 出品，想象力超强 ¥0.08/s
11. Grok Video 图生视频 — ¥0.08/s
12. Sora 2 文生视频 — OpenAI 出品 ¥1.20/s
13. Sora 2 图生视频 — ¥1.20/s
14. Sora 2 真人图生 — 真人专用 ¥1.00/s

选个数字就行，不选默认用 ⭐1～
```

## 别做

- ❌ 不要改顺序
- ❌ 不要改名（尤其不要把 Seedance 叫成 Sparkvideo）
- ❌ 不要自己加模型
- ❌ 不要展示 endpoint ID

## 执行参数（内部用，不展示给用户）

| 菜单编号 | 模型 ID (`--model`) | 价格 |
|---------|---------------------|------|
| 1 | `rh-seedance2-mini` | ¥1.20/s |
| 2 | `rh-seedance2-mini-text` | ¥0.70/s |
| 3 | `rh-seedance2-mini-image` | ¥0.70/s |
| 4 | `rh-seedance2-fast` | ¥2.00/s |
| 5 | `rh-seedance2-fast-text` | ¥1.10/s |
| 6 | `rh-seedance2-fast-image` | ¥1.10/s |
| 7 | `rh-seedance2-text` | ¥1.50/s |
| 8 | `rh-seedance2-image` | ¥1.50/s |
| 9 | `veo3.1-fast` | ¥0.40/s |
| 10 | `rh-grok-text-video` | ¥0.08/s |
| 11 | `rh-grok-image-video` | ¥0.08/s |
| 12 | `rh-sora2-text` | ¥1.20/s |
| 13 | `rh-sora2-image` | ¥1.20/s |
| 14 | `rh-sora2-realistic` | ¥1.00/s |
