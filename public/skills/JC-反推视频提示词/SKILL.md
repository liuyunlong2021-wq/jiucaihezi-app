---
name: JC-反推视频提示词
description: 视频反推分镜提示词。用户发一段视频→逐镜分析→按镜号输出分镜提示词（角色/场景/道具/色卡/风格/镜头语言）+ 跨帧聚合高频角色/场景/道具出设定图提示词。三层降级：①Gemini视频直分析 ②ffmpeg切镜头 ③ffmpeg截首尾帧+逐帧反推+跨帧聚合。触发词：反推视频提示词、分析这个视频、视频转分镜、拆视频镜头、视频反推。
triggers:
  - 反推视频提示词
  - 分析这个视频
  - 视频转分镜
  - 拆视频镜头
  - 视频反推
  - 拆解视频
  - 视频分镜
  - reverse video prompt
---

# 反推视频提示词

## ⛔ 启动闸门

```
🎬 反推视频提示词，报到！

发一段视频给我，我帮你拆三份东西：

① 逐镜分镜提示词 —— 每镜的角色/场景/道具/色卡/镜头/风格
② 高频资产统计 —— 全片出现最多的角色/场景/道具排行
③ 设定图提示词 —— 主角/主场景/关键道具的 JSON 生图提示词

电影片段、广告、MV、动画、短剧、产品视频...啥都行。直接发视频！
```

输出后等用户发视频。

---

## 工作流（三层降级）

### 🥇 第一层：视频直接分析

将视频发给 Gemini 3.5 Flash：

```
Analyze this video shot by shot. For each shot, output:

- shot_id: sequential number
- duration: in seconds
- shot_type: (WIDE/MEDIUM/CLOSE-UP/EXTREME CU/OTS/AERIAL/LOW ANGLE/POV)
- camera_movement: (static/pan/tilt/dolly/zoom/handheld/steadicam)
- characters: describe each visible character (age/gender/clothing/hair/expression/action)
- scene: describe the environment (indoor/outdoor/time of day/architecture/props visible)
- props: list all key objects visible
- color_palette: dominant colors, temperature (warm/cool/neutral), saturation
- lighting: direction/quality/temperature/key light source
- style: visual style references
- composition: framing, depth of field, focus point
- description: one-sentence visual summary

Output as a JSON array.
```

成功 → 跳到「输出格式」。失败 → 降级。

### 🥈 第二层：ffmpeg 切镜头

```bash
ffmpeg -i VIDEO -filter:v "select='gt(scene,0.3)',showinfo" -f null - 2>&1 | grep showinfo
ffmpeg -i VIDEO -ss START -t DURATION -c copy shot_001.mp4
```

每个镜头片段再喂 Gemini，同一指令。成功 → 输出。失败 → 降级。

### 🥉 第三层：截帧 + 逐帧反推 + 跨帧聚合

#### 3a. 截首尾帧

```bash
ffmpeg -i shot_001.mp4 -vframes 1 -q:v 2 shot_001_first.png
ffmpeg -sseof -1 -i shot_001.mp4 -vframes 1 -q:v 2 shot_001_last.png
```

#### 3b. 逐帧反推

每帧执行 `Analyze this image in exhaustive JSON detail.`

**检测到主要人物时**（占据画面主要面积或视觉焦点），JSON 补全：国别、年龄段、五官（眼型/鼻型/唇型/眉型/下颌）、发型（名称/长度/发色/刘海）。

融合首尾帧推断镜头运动，按「中文生图提示词规则」转写中文提示词。不追求字数，追求信息密度。

#### 3c. 跨帧聚合

所有帧反推完毕，统计全片：

- **角色**：按 subject/characters 聚类，>=3 帧 → 高频
- **场景**：按 environment/background 聚类，>=2 帧 → 高频
- **道具**：按 props 聚合，>=3 帧 → 高频

对每个高频资产，读对应格式文件生成设定图 JSON：

| 资产 | 读 | 输出格式 |
|------|----|---------|
| 角色 | `references/character-prompt-format.md` | JSON |
| 场景 | `references/scene-format.md` | JSON |
| 道具 | `references/prop-format.md` | JSON |

跨帧融合规则：
- 同一角色 → 融合所有帧信息，取最清晰角度，**赋予中文名**（如「红衣女子」「白发老人」，不是「角色A」）
- 场景 → 空镜帧优先，有人物帧补充，**赋予中文名**（如「竹林小院」「地下车库」）
- 道具 → 最清晰完整帧为准，**赋予中文名**（如「破旧镰刀」「琥珀吊坠」）
- 信息不足（没正脸/没全身）→ 标注 `[信息不足]`，不编

---

## 输出格式

**严格按此顺序输出：先定风格色卡 → 再定资产名字 → 最后写分镜。分镜中的角色名/场景名/道具名必须引用前面资产已确定的名称。**

### 第一部：风格与色卡

全片整体的视觉 DNA：

```
## 🎨 风格与色卡

- 画幅比例：{16:9 / 9:16 / 2.39:1 / 4:3}
- 光影语言：{对照 style bank 的 6 维度：光影/调色/节奏/机位/质感}
- 全片主色调：{hex} · 辅色 {hex} · 点缀 {hex} · {暖/冷/中性}调
- 风格锚点：{具体到导演/作品/时期的视觉参照}
```

### 第二部：资产设定图

先给每个资产起名，再出 JSON：

```
## 🎭 角色

### {角色中文名}（出现 N 帧）
{按 character-prompt-format.md 输出的完整 JSON}

### {角色中文名}（出现 N 帧）
...

## 🏠 场景

### {场景中文名}（出现 N 帧）
{按 scene-format.md 输出的完整 JSON}

...

## 🔧 道具

### {道具中文名}（出现 N 帧）
{按 prop-format.md 输出的完整 JSON}

...
```

### 第三部：逐镜分镜

分镜中的角色/场景/道具名必须与第二部已确定的名称一致：

```
## 镜 {N} · {时长}s · {景别}

### 🎭 角色
{引用第二部的角色名}：{服装/发型/表情/动作}

### 🏠 场景
{引用第二部的场景名} · {时间} · {补充环境细节}

### 🔧 道具
- {引用第二部的道具名}：{在此镜中的状态}

### 🎥 镜头
{景别} · {角度} · {运动} · {焦段参考}

### 🖼️ 画面描述
{一句话视觉总结}

### 📝 中文生图提示词
{按 9 条规则写}
```

### 第四部：镜头总览

| 镜号 | 时长 | 景别 | 运动 | 角色 | 场景 |
|------|------|------|------|------|------|
| 1 | 3.2s | WIDE | dolly | 红衣女子 | 竹林小院 |

---

## 中文生图提示词规则

1. **画幅和布局放最前面** — `竖屏 3:4`、`横屏 16:9`、`方形 1:1`
2. **精确文字加引号** — `"山川茶事" / "冷泡系列"`，原文不动
3. **场景密度 > 形容词** — 5-12 个具体物件
4. **材质/光线/调色板分开写** — 各一句
5. **风格锚点具体化** — 不说「日系」，说「新海诚风格，高饱和蓝天」
6. **相机语境给真实感** — `85mm f/1.4`、`微距`、`低角度仰拍`
7. **产品/复杂场景用 JSON 结构** — environment / subject / materials / lighting / render_goal 分槽位
8. **海报类加促销层级** — 品名最大→卖点→规格→价格→CTA
9. **加否定约束** — 「不要 CGI 塑料感」「不要假品牌 Logo」「不要乱码」

不追求字数，追求信息密度。每个词都要有视觉产出。

---

## 铁律

1. 没视频不干活
2. 三层降级严格执行
3. 输出严格按顺序：风格色卡 → 资产起名+JSON → 分镜 → 总览
4. 分镜中的角色/场景/道具名必须引用第二部已确定的名称，不得临时编
5. 资产必须起中文名，不是「角色A」「场景B」
6. 色卡要有 hex
7. 第三层必须跨帧聚合再出资产 JSON
8. 信息不足标 `[信息不足]`，不编

## 参考文件

| 文件 | 什么时候读 |
|------|-----------|
| `references/director-style-bank.md` | 输出风格描述时对照 6 维度模板和案例 |
| `references/anime-style-bank.md` | 动漫类视频的风格维度参考 |
| `references/director-notes-format.md` | 镜头术语和长镜分段写法 |
| `references/character-prompt-format.md` | 跨帧聚合后输出角色设定图 JSON |
| `references/scene-format.md` | 跨帧聚合后输出场景设定图 JSON |
| `references/prop-format.md` | 跨帧聚合后输出道具设定图 JSON |
