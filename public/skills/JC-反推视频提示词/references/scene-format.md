# 场景设定图输出格式（JSON）

> 阶段 5 输出时读取。产出下游 AI 视频模型可精确参照的场景工程图 JSON。

## JSON 模板

```json
{
  "scene": {
    "name": "场景名称",
    "episode": "集号",
    "timeOfDay": "日/夜/黄昏",
    "era": "时代背景",
    "location": "地域",
    "type": "室内/室外",
    "function": "场景功能",
    "medium": "真人剧/动漫剧/漫剧",
    "genre": "悬疑/爱情/奇幻/...",
    "visualStyle": "偏写实/偏风格化/..."
  },
  "space": {
    "shape": "房间形状·纵深·层高",
    "size": "大致面积或相对尺度",
    "zones": [
      { "name": "功能分区名称", "description": "该区域内容", "keyObjects": ["物件1", "物件2"] }
    ],
    "furnitureLayout": "家具布置逻辑·对称/非对称/中心式/靠墙"
  },
  "surfaces": {
    "walls": "油漆/壁纸/砖/混凝土/木板·颜色·磨损",
    "floor": "木地板/瓷砖/水泥/地毯·颜色·磨损",
    "ceiling": "高度·灯具·管道·裸露结构"
  },
  "objectDensity": "稀疏/适中/密集·物件堆积程度",
  "landmarks": [
    { "object": "关键标志物名称", "description": "为什么一眼认出这个场景", "position": "在空间中的位置" }
  ],
  "lighting": {
    "naturalLight": [
      { "source": "窗户/天窗/门", "position": "位置", "size": "大小", "quality": "直射/漫射/遮挡" }
    ],
    "artificialLight": [
      { "type": "台灯/顶灯/屏幕/霓虹", "position": "位置", "colorTemp": "色温K", "intensity": "亮度" }
    ],
    "dominantSource": "主光源及其方向",
    "colorPalette": { "primary": "主色调", "secondary": "辅助色", "accent": "强调色" }
  },
  "onImageText": {
    "name": { "text": "场景名称", "position": "画面中文字位置", "style": "字号/字重" },
    "subtitle": { "text": "集号·时间·地点", "position": "名字下方" },
    "labels": [
      { "text": "标注文字", "target": "指向哪个区域/物件", "position": "标注位置" }
    ]
  },
  "views": {
    "masterShot": "主镜头·空镜·展示场景全貌的角度和构图",
    "alternateAngles": [
      { "angle": "角度名称", "description": "从这个角度看到什么" }
    ]
  },
  "background": "纯色中性灰（物件/材质特写时）或自然环境的空场景",
  "lighting": "均匀柔光·无人物·无戏剧阴影",
  "layout": "合理排版·主镜头大图+关键区域特写+物件标注·自然视觉流",
  "noHumans": true
}
```

## 字段说明

| 字段 | 用途 |
|------|------|
| `landmarks` | 一眼认出这个场景的关键标志物 |
| `onImageText.labels` | 图片上需渲染的标注文字，指向具体区域/物件 |
| `views.masterShot` | 主镜头——最代表这个场景的空镜构图 |
| `lighting.dominantSource` | 主光源方向——下游打光的核心依据 |
| `zones` | 功能分区——下游知道角色可以在哪里活动 |

## 约束

1. **场景图必须是空镜**——无人物、无角色剪影、无动物。`noHumans` 字段为 `true`
2. `views.masterShot` 和所有物件描述中禁止出现角色名、人称代词
3. 去掉散文性的氛围描述——用结构化字段表达
4. 所有材质/光源用具体描述，不写抽象形容词
