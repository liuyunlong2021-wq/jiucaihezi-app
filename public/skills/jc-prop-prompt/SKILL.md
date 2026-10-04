---
name: jc-prop-prompt
description: "根据故事素材、项目资料、用户描述或参考图，创作可复用的道具设计提示词、三视图道具设定图和市场化六视图正交转面参考图。用户提到道具设计、道具设定图、道具提示词、道具参考、道具资产、正背侧三视图、六视图、turnaround、武器、工具、饰品、文件或核心剧情道具时使用。"
triggers:
  - 道具设计
  - 道具设定图
  - 道具提示词
  - 道具资产
  - 道具参考
  - 图生图道具
  - 三视图道具
  - 六视图道具
  - 道具转面图
  - prop turnaround
  - prop design
  - 画道具
  - 设计道具
---

## 目标

为单一道具输出可直接用于图像生成的中文提示词。重点是结构可读、材质可信、使用痕迹固定、时代背景匹配、角度信息完整，以及后续镜头可复用。只写道具设计，不扩写剧情。

## 固定格式

始终使用完整六视图版本，模块顺序固定为：`SHEET → MEDIUM → OBJECT → SCENE → LIGHT → LOOK → VIEWS → SHEET_GRAPHICS → CONSISTENCY_LOCK`。只输出这一种格式，不混入其他版本。

## 输入解析

先提取道具名称、时代/地域、用途、人物关系、关键剧情功能、材质、尺寸或比例、组件、方向锚点、预计使用镜头、参考图、画幅比例和必须保留的文字。支持 `16:9` 横屏与 `9:16` 竖屏；用户未指定时默认 `16:9`。缺少尺寸时给出合理的厘米/毫米估值，并标注“可按实物调整”；缺少年代时使用故事设定，不擅自添加时代符号。

固定设计原则：

- 多角度展示按道具特性决定，不为了凑角度堆无效视图。
- `material` 只写由什么制成；`finish` 只写表面如何呈现；`wear` 写清磨损类型、准确位置、颜色、程度和材质反应。
- 时代感通过工艺、字体、连接件、染色、包装和磨损体现，不用泛泛的“复古感”。
- 选择一个跨视图可辨认的固定方向锚点，例如缺口、铆钉、锁扣、印章、铭牌或特殊接缝。
- 同一转面图中道具静止，只有摄影机改变位置；六个视图的比例、组件、材质、颜色、磨损坐标必须一致。

## 六视图输出模板

```text
Render a [16:9 horizontal or 9:16 vertical] prop turnaround reference sheet according to the following specification. Every field describes the finished sheet.

SHEET:
layout: six orthographic views of the SAME object in one sheet, generous even spacing, identical object scale in every view, each view captioned below; for 16:9 use a clean 3×2 grid; for 9:16 use a clean 2×3 grid with front/back/left on the upper row and right/top/bottom on the lower row
aspect: [16:9 horizontal or 9:16 vertical], 4K

MEDIUM:
stock: [摄影媒介、相机或胶片/数字成像规格]
artifact: [细节解析、微反差与材质成像要求]
note: every view is a photographed frame of the physical object, same camera and same lens

OBJECT:
description: [整体结构、形状、组件关系与方向]
dimensions: [整体长宽高/厚度，以及关键组件尺寸，使用cm或mm]
material: [主体材质、组件材质、颜色、连接方式]
finish: [表面光泽、纹理、反光、颗粒、铸造或加工痕迹]
wear: [固定磨损、污渍、划痕、折痕、变形及准确位置]
anchor: [跨视图识别方向的固定视觉锚点]

SCENE:
backdrop: [统一摄影棚背景材质、颜色与色值]
ground: [地面与道具接触关系]
contact_shadow: [六个视图下方接触阴影的范围、软硬与透明度]
subject: the object alone on the studio ground

LIGHT:
key: [主光类型、方向、软硬、照射作用]
fill: [补光类型、方向、强度与阴影开放程度]
rim: [轮廓光类型、位置与提亮边缘]
note: neutral white balance held true, identical lighting in all six views — accurate material reading is the priority

LOOK:
color_grading: [目录级调色、主体与背景分离、材质色彩还原]
authenticity: [焦段、光圈、景深、清晰度、真实摄影或指定媒介]
style: [摄影媒介] × fine detail × studio product photography turnaround × [资产类别] catalog documentation

VIEWS:
front: { camera: eye level, straight on toward the primary front, note: [正面轮廓、主要结构、正面材质与固定磨损], anchor: [锚点位置], label: "FRONT VIEW" }
back: { camera: eye level, 180° opposite the front, note: [背面结构、接缝、后部组件、背面磨损], anchor: [锚点可见或遮挡状态], label: "BACK VIEW" }
left: { camera: eye level, 90° from the designated left side, note: [左侧轮廓、组件排列、连接件与左侧磨损], anchor: [左侧方向关系], label: "LEFT VIEW" }
right: { camera: eye level, 90° from the designated right side, note: [右侧轮廓、内侧结构、连接件与右侧磨损], anchor: [右侧方向关系], label: "RIGHT VIEW" }
top: { camera: directly above along the object's vertical axis, note: [顶部轮廓、开口、内部结构、顶部组件], anchor: [顶部观察到的锚点], label: "TOP VIEW" }
bottom: { camera: directly below along the object's vertical axis, note: [底部结构、底板、连接件、螺丝、承重面与底部磨损], anchor: [底部观察到的锚点], label: "BOTTOM VIEW" }

SHEET_GRAPHICS:
title: "[道具英文名称]" at the top-left safe area in bold condensed sans-serif, [文字颜色] on the [背景颜色] ground
sub_label: "PROP TURNAROUND — 6 VIEWS" beneath the title in thin uppercase sans-serif
captions: small uppercase sans-serif beneath each view, exactly as written in VIEWS labels
text_rendering: every letterform razor-sharp and fully legible at 4K, clean closed counters

CONSISTENCY_LOCK: all six views are the exact same single object — identical proportions, structure, materials, colors, components and fixed wear reproduced in the same object coordinates. The object remains stationary while the camera changes position. Same background, ground, contact shadows, light, medium, white balance, exposure and lens throughout.
```

## 生成约束

- 文字、图案、铭牌或票据内容由用户提供时逐字保留；没有明确文字时不要编造可读品牌、日期或姓名。
- 保留英文模块名和字段结构，字段内容可用中文。
- `SHEET.layout` 与 `SHEET.aspect` 必须明确写出用户指定的比例；9:16 固定采用 2×3 网格，避免六个视图被纵向裁切或缩放失衡。
- 背景必须服务于读物，不抢主体；默认无人物、无手、无角色剪影。
- 不把角色卡、场景卡或道具使用镜头写进道具图本身；只保留能说明比例、方向和材质的必要信息。

## 输出前自检

- 输出必须是完整六视图版本，模块顺序正确。
- 画幅比例与布局匹配：16:9 为 3×2，9:16 为 2×3，六个视图均完整入镜。
- 材质、表面效果、磨损和时代感彼此一致。
- 尺寸含整体规格与关键组件规格；方向锚点可在多视图中追踪。
- 六视图确实是同一件静止道具，只有相机改变位置。
- 固定文字逐字准确；无用户要求时没有凭空品牌或剧情文字。
- 只输出最终道具生图提示词；除非用户要求，不附加设计分析。
