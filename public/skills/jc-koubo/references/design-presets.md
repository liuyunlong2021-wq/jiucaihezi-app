# 设计预设 v2.1

## 主题色板（5 套）

| 主题      | 背景           | 文字         | 点缀             | 适用           |
| --------- | -------------- | ------------ | ---------------- | -------------- |
| `indigo`  | #0a1f3d 深蓝   | #f1f3f5 冷白 | #4a90d9 科技蓝   | AI/技术/知识   |
| `classic` | #18181a 黑灰   | #f1efea 暖白 | #d4a574 暖金     | 通用/严肃/人文 |
| `klein`   | #0a0a0a 极致黑 | #fafaf8 白   | #002FA7 克莱因蓝 | 前卫/艺术/观点 |
| `lemon`   | #0a0a0a 极致黑 | #fafaf8 白   | #FFD500 亮黄     | 能量/态度/年轻 |
| `orange`  | #0a0a0a 极致黑 | #fafaf8 白   | #FF6B35 橙红     | 热情/行动/激励 |

## HF 内联效果

| 效果           | 说明                                    | z-index          |
| -------------- | --------------------------------------- | ---------------- |
| vignette 暗角  | CSS radial-gradient，四周变暗，聚焦中心 | 25               |
| grain 胶片颗粒 | SVG feTurbulence 噪点纹理，去塑料感     | 24               |
| shimmer 光扫   | @keyframes 光带扫过，科技质感           | 用于高光卡片内部 |

## 动画预设

### 高光卡片入场

| 类型        | GSAP                                                                 |
| ----------- | -------------------------------------------------------------------- |
| open 开场   | `{y:-80, scale:0.8, opacity:0, duration:0.60, ease:"back.out(1.7)"}` |
| hook 钩子   | `{y:40, opacity:0, duration:0.50, ease:"power2.out"}`                |
| middle 中段 | `{x:-60, opacity:0, duration:0.45, ease:"power3.out"}`               |
| ending 结尾 | `{scale:0.3, opacity:0, duration:0.70, ease:"elastic.out(1,0.5)"}`   |

### 包装元素入场

| 元素     | kind             | GSAP                                                          |
| -------- | ---------------- | ------------------------------------------------------------- |
| 问号贴纸 | question_sticker | `{scale:0.2, rotation:15, duration:0.40, ease:"back.out(2)"}` |
| 数据牌   | data_badge       | `{scaleX:0, duration:0.35, ease:"power3.out"}`                |
| 反差箭头 | contrast_arrow   | `{x:-40, duration:0.30, ease:"power3.out"}`                   |
| 步骤标   | step_badge       | `{scale:0.5, duration:0.40, ease:"back.out(2)"}`              |
| 案例标签 | case_tag         | `{scale:0.1, duration:0.45, ease:"elastic.out(1,0.4)"}`       |
| 关键词   | keyword_spark    | `{scale:0.3, duration:0.35, ease:"back.out(1.5)"}`            |

### 导轨字幕

- 入场：`{opacity:0, y:10, duration:0.22, ease:"power2.out"}`
- 退场：`{opacity:0, duration:0.18, ease:"power2.in"}`

## 排版

| 元素          | 字体        | 字号   | 字重 |
| ------------- | ----------- | ------ | ---- |
| 导轨字幕      | PingFang SC | 60px   | 700  |
| 开场/结尾卡片 | PingFang SC | 76px   | 800  |
| 钩子卡片      | PingFang SC | 64px   | 800  |
| 中段卡片      | PingFang SC | 54px   | 800  |
| 点缀条        | —           | 52×5px | —    |

## 安全区

- 高光卡片：上边距 120px，左右各 8%
- 导轨字幕：底部 22%，左右 70px
- 包装元素：高光卡片右上角，错位排列，最多 2 件
