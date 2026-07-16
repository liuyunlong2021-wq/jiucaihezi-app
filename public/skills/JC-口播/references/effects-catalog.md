# 高光效果全目录

HyperFrames = HTML+CSS+GSAP 引擎。以下是 composer.py 可实现的全量效果。

## 卡片入场动画（16种）

| # | animation | 描述 | GSAP |
|---|---|---|---|
| 1 | `bounceIn` | 弹入+缩放回弹 | `{y:-80, scale:0.8, duration:0.6, ease:"back.out(1.7)"}` |
| 2 | `fadeIn` | 上方淡入 | `{y:40, opacity:0, duration:0.5, ease:"power2.out"}` |
| 3 | `slideLeft` | 左侧滑入 | `{x:-80, opacity:0, duration:0.45, ease:"power3.out"}` |
| 4 | `slideRight` | 右侧滑入 | `{x:80, opacity:0, duration:0.45, ease:"power3.out"}` |
| 5 | `slideUp` | 下方升入 | `{y:80, opacity:0, duration:0.5, ease:"power2.out"}` |
| 6 | `elasticIn` | 弹性缩放入场 | `{scale:0.3, opacity:0, duration:0.7, ease:"elastic.out(1,0.5)"}` |
| 7 | `zoomIn` | 中心缩放 | `{scale:0.1, opacity:0, duration:0.5, ease:"power3.out"}` |
| 8 | `rotateIn` | 旋转+缩放 | `{rotation:-15, scale:0.5, opacity:0, duration:0.55, ease:"back.out(1.5)"}` |
| 9 | `flipX` | 水平翻转 | `{rotationX:90, opacity:0, duration:0.5, ease:"power2.out"}` |
| 10 | `swingIn` | 摇摆荡入 | `{rotation:-30, y:-60, opacity:0, duration:0.7, ease:"elastic.out(1,0.4)"}` |
| 11 | `whoosh` | 呼啸入（模糊+缩放） | `{scale:1.5, opacity:0, filter:"blur(10px)", duration:0.5, ease:"power3.out"}` |
| 12 | `glitchIn` | 故障闪烁入 | 先 opacity:1 scale:1.05 0.05s → opacity:0 → 0.1s → opacity:1 scale:1 |
| 13 | `dropIn` | 坠落弹跳 | `{y:-300, opacity:0, duration:0.65, ease:"bounce.out"}` |
| 14 | `expandIn` | 水平展开 | `{scaleX:0, opacity:0, duration:0.45, ease:"power3.inOut"}` |
| 15 | `vortexIn` | 旋转缩放组合 | `{rotation:180, scale:0, opacity:0, duration:0.6, ease:"back.out(1.4)"}` |
| 16 | `typewriter` | 逐字显现 | `{clipPath:"inset(0 100% 0 0)", duration:0.8, ease:"steps(8)"}` |

**轮换规则：** 从1到16顺序轮换，到16后回到1。永不连续重复。

## 卡片视觉风格（8种）

| # | style | CSS 实现 |
|---|---|---|
| 1 | `accentBar` | 顶部短横条+左对齐大字 |
| 2 | `neonGlow` | `text-shadow: 0 0 20px accent, 0 0 40px accent` 霓虹发光 |
| 3 | `boxed` | `border: 3px solid accent` + padding，加框 |
| 4 | `underline` | `border-bottom: 4px solid accent` 下划线强调 |
| 5 | `highlighter` | `background: linear-gradient(transparent 60%, accent 60%)` 荧光笔 |
| 6 | `twoTone` | 前半 accent 色，后半白色，双色文字 |
| 7 | `pill` | `border-radius: 999px` 胶囊容器 |
| 8 | `outlined` | `-webkit-text-stroke: 2px accent; color: transparent` 描边空心字 |

**轮换规则：** 每3条高光换一种风格，循环。

## 包装元素（20种）

| # | type | 视觉 | 触发条件 |
|---|---|---|---|
| 1 | `question` | `?` 圆形贴纸 | 含"为什么/怎么/哪个/吗/？" |
| 2 | `data_badge` | 数字牌 | 含数字/比例 |
| 3 | `contrast_arrow` | `↗` 箭头 | 含"不是/但是/其实/不如" |
| 4 | `step_badge` | `STEP` 标签 | 含"第一/步骤/先/再" |
| 5 | `case_tag` | `案例` 胶囊 | 含"比如/案例/我朋友" |
| 6 | `spark` | `✦` 火花 | 默认兜底 |
| 7 | `exclamation` | `❗` 感叹号 | 含感叹/强调语气 |
| 8 | `checkmark` | `✅` 打勾 | 含肯定/完成/好 |
| 9 | `fire` | `🔥` 火焰 | 含"炸/爆/燃/牛/强" |
| 10 | `star` | `⭐` 星星 | 含"棒/厉害/优秀/顶级" |
| 11 | `bulb` | `💡` 灯泡 | 含"想法/灵感/发现/注意" |
| 12 | `target` | `🎯` 靶心 | 含"目标/核心/关键/重点" |
| 13 | `rocket` | `🚀` 火箭 | 含"增长/起飞/突破/冲" |
| 14 | `warning` | `⚠️` 警告 | 含"小心/注意/危险/别" |
| 15 | `brain` | `🧠` 大脑 | 含"AI/智能/算法/模型/学习" |
| 16 | `chart` | `📊` 图表 | 含"数据/增长/趋势/统计" |
| 17 | `lock` | `🔒` 锁 | 含"安全/加密/保护/隐私" |
| 18 | `megaphone` | `📢` 喇叭 | 含"宣布/告诉/分享/传播" |
| 19 | `stopwatch` | `⏱` 秒表 | 含"快/时间/效率/速度" |
| 20 | `crown` | `👑` 皇冠 | 含"最好/第一/冠军/王者/最" |

**选法：** 按触发条件匹配，最多选2种。至少1种（无匹配用spark）。与上一条至少1种不同。

## 图层氛围效果（5种，全部默认启用）

| 效果 | 实现 |
|---|---|
| vignette 暗角 | `radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)` |
| grain 胶片颗粒 | SVG `feTurbulence` 噪点, opacity 0.06 |
| shimmer 光扫 | `@keyframes shimmer` 4s循环，在高光卡片上 |
| scanline 扫描线 | CSS `repeating-linear-gradient` 半透明横纹 |
| glow 发光 | `box-shadow: 0 0 30px accent` 卡片边缘发光 |

## GSAP 核心机制

所有动画使用 `tl.set()` + `tl.to()`（不用 `gsap.from`）：
```js
window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });
tl.set("#card_0", {opacity:0, y:-80, scale:0.8}, 0.0);
tl.to("#card_0", {opacity:1, y:0, scale:1, duration:0.6, ease:"back.out(1.7)"}, 0.0);
tl.to("#card_0", {opacity:0, duration:0.22, ease:"power2.in"}, 2.58);
window.__timelines.main = tl;
```

HyperFrames `beginFrame` API 逐帧 seek → `tl.seek(time)` → 确定性渲染。
