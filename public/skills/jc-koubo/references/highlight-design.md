# 高光计划生成规则

## AI 任务

读 `subtitle_paced.srt`（或 `subtitle_corrected.srt`，如果没有裁切），逐条分析，生成 `render_plan.json`。

## 密度规则

```
视频总长 ≤ 30秒：每条字幕都出高光
视频总长 > 30秒：
  - 前15秒区域：每条都出
  - 15-30秒区域：每2-3条取1条（跳过填充词如"然后""就是说""你知道吧"）
  - 30秒后区域：每3-5条取1条
  - 最后一条：必出（ending 动画）
```

## 每条高光记录

```json
{
  "id": "hl_000",
  "start": 0.0,
  "end": 2.8,
  "highlight_text": "提炼的短文案",
  "position": "top",
  "animation": "bounceIn",
  "stickers": [
    { "type": "question", "icon": "?" },
    { "type": "spark", "icon": "✦" }
  ]
}
```

### 字段规则

**start/end：**

- 从 SRT 时间戳取 `seg['start']` 和 `seg['end']`
- 如果 `end - start > 2.8`，截断为 `end = start + 2.8`
- 如果 `end - start < 1.0`，跳过不生成

**highlight_text：**

- 从 `seg['text']` 提炼
- 去标点符号
- ≤16字
- 保留核心语义（去掉"然后呢""就是说""你知道吧"等口语填充）
- 例："你是不是跟我一样，脑子里有无数个想法，然后呢也愿意拍" → "脑子里有无数个想法"

**position：**

- 第0条 = `"top"`
- 第1条 = `"bottom"`
- 第2条 = `"top"`
- ...严格交替
- 高光卡片出现在：top=距顶120px，bottom=距底700px（1080×1920画布）

**animation：**

- 按顺序轮换：bounceIn → fadeIn → slideLeft → elasticIn → 回到 bounceIn
- 4种动画，永不连续重复
- 第0条=bounceIn, 第1条=fadeIn, 第2条=slideLeft, 第3条=elasticIn, 第4条=bounceIn...

**stickers：**

- 从6种包装中选1-2种
- 根据字幕内容触发：
  - 含"为什么/怎么/哪个/吗/？" → question
  - 含数字/比例 → data_badge
  - 含"不是/但是/其实/不如/却" → contrast_arrow
  - 含"第一/第二/步骤/先/再" → step_badge
  - 含"比如/案例/我朋友/客户/我女儿" → case_tag
  - 都不匹配 → spark（兜底）
- 如果匹配到2种以上，取前2种
- 如果只匹配到0-1种，补 spark 凑到至少1种
- 与上一条高光的 sticker 至少有一种不同（不同则保持，相同则替换最后一种为 spark）

## 动画不压人物

高光卡片渲染位置：

- `position: "top"` → CSS `top: 120px`，位于画面上方1/3（0-640px）
- `position: "bottom"` → CSS `bottom: 700px`，位于画面下方1/3（1280-1920px）
- 人物面部通常在中间1/3（640-1280px），高光卡片永远不会出现在这个区域

## 完整示例

输入 SRT（7条，48秒视频）：

```
0.0-7.3s  你是不是跟我一样，脑子里有无数个想法，然后呢也愿意拍
7.3-12.0s 话匣子打开在镜头前面根本就不再停了，一顿输出
12.0-19.4s 但是等到了最后一步，哎，我得上传呢，我得让别人看呢，怎么办呢，不会剪辑
19.4-25.4s 或者说像我一样，我不爱剪辑，放到剪辑软件里就犯愁
25.4-33.1s 我又是加字幕，又是删多余的镜头，又要加音乐
33.1-40.3s 然后上的字幕还得有音效，我愁死了，那怎么办，有没有，就是说
40.3-48.4s 哎，现在AI这么强，我就把这个视频，往里头一扔，吧！就出来了，噔！我就发了，有没有啊
```

高光密度计算（48秒 > 30秒）：

- 前15秒（0-15s）：第1、2条 → 2条
- 15-30秒（15-30s）：第3、4、5条中选 → 第3、5条 → 2条
- 30秒后（30-48.4s）：第6、7条中选 → 第7条（结尾必出）→ 1条

产出 render_plan.json：

```json
[
  {
    "id": "hl_000",
    "start": 0.0,
    "end": 2.8,
    "highlight_text": "脑子里有无数个想法",
    "position": "top",
    "animation": "bounceIn",
    "stickers": [
      { "type": "question", "icon": "?" },
      { "type": "spark", "icon": "✦" }
    ]
  },
  {
    "id": "hl_001",
    "start": 7.3,
    "end": 10.1,
    "highlight_text": "话匣子打开一顿输出",
    "position": "bottom",
    "animation": "fadeIn",
    "stickers": [{ "type": "spark", "icon": "✦" }]
  },
  {
    "id": "hl_002",
    "start": 12.0,
    "end": 14.8,
    "highlight_text": "怎么办呢不会剪辑",
    "position": "top",
    "animation": "slideLeft",
    "stickers": [
      { "type": "question", "icon": "?" },
      { "type": "contrast_arrow", "icon": "↗" }
    ]
  },
  {
    "id": "hl_003",
    "start": 25.4,
    "end": 28.2,
    "highlight_text": "又是加字幕又是删镜头",
    "position": "bottom",
    "animation": "elasticIn",
    "stickers": [
      { "type": "step_badge", "icon": "STEP" },
      { "type": "spark", "icon": "✦" }
    ]
  },
  {
    "id": "hl_004",
    "start": 40.3,
    "end": 43.1,
    "highlight_text": "往里头一扔就出来了",
    "position": "top",
    "animation": "bounceIn",
    "stickers": [
      { "type": "case_tag", "icon": "案例" },
      { "type": "spark", "icon": "✦" }
    ]
  }
]
```
