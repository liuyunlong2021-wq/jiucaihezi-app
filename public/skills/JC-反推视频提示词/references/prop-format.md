# 道具设定图输出格式（JSON）

> 阶段 5 输出时读取。产出下游 AI 视频模型可精确参照的道具工程图 JSON。

## JSON 模板

```json
{
  "prop": {
    "name": "道具名称",
    "category": "武器/工具/饰品/文件/日常用品/其他",
    "owner": "使用者角色名",
    "era": "时代背景",
    "medium": "真人剧/动漫剧/漫剧",
    "genre": "悬疑/爱情/奇幻/...",
    "visualStyle": "偏写实/偏风格化/..."
  },
  "shape": {
    "silhouette": "整体剪影描述",
    "components": [
      { "name": "组件名称", "description": "外观描述", "proportion": "相对于整体的比例" }
    ],
    "proportion": { "length": "长度cm", "width": "宽度cm", "thickness": "厚度cm" }
  },
  "material": {
    "primary": "主要材质",
    "secondary": ["次要材质1", "次要材质2"],
    "surface": "抛光/哑光/生锈/磨损/做旧",
    "color": "颜色描述",
    "texture": "纹理描述"
  },
  "wearAndTear": {
    "level": "崭新/轻微使用/明显磨损/严重损坏",
    "details": [
      { "type": "缺口/裂纹/褪色/修补/污渍", "position": "位置", "description": "外观描述" }
    ]
  },
  "markings": [
    { "type": "刻字/铭文/logo/图案", "position": "位置", "content": "内容", "style": "字体/风格" }
  ],
  "decorations": [
    { "type": "宝石/雕刻/镶嵌/挂饰", "position": "位置", "material": "材质", "description": "外观描述" }
  ],
  "onImageText": {
    "name": { "text": "道具名称", "position": "画面中文字位置", "style": "字号/字重" },
    "subtitle": { "text": "类别·使用者·尺寸", "position": "名字下方" },
    "labels": [
      { "text": "标注文字", "target": "指向哪个组件/特征", "position": "标注位置" }
    ]
  },
  "closeups": [
    { "target": "特写对象", "position": "布局中的位置", "annotation": "特写旁标注文字" }
  ],
  "views": {
    "front": "正面·展示整体形状和主要标记",
    "side": "侧面·展示厚度和侧面细节",
    "back": "背面·展示背面结构和标记",
    "top": "顶部/俯视·展示顶部细节",
    "detailCloseup": "关键特征特写·刻字/磨损/标记"
  },
  "background": "纯色中性灰",
  "lighting": "均匀柔光·无戏剧阴影",
  "layout": "合理排版·正面大图+多角度小图+特写标注+文字信息区"
}
```

## 完整示例：温宁的镰刀

```json
{
  "prop": {
    "name": "破旧镰刀",
    "category": "工具/武器",
    "owner": "温宁",
    "era": "现代都市·末世感",
    "medium": "真人剧",
    "genre": "男男甜宠腐剧",
    "visualStyle": "韩国爱情浪漫风"
  },
  "shape": {
    "silhouette": "新月形弯刃+直木柄·整体呈L形",
    "components": [
      { "name": "刀刃", "description": "新月形弯刃·单面开刃·刀背厚约3mm", "proportion": "占全长约35%" },
      { "name": "刀柄", "description": "直木柄·圆形截面·直径约3cm", "proportion": "占全长约60%" },
      { "name": "连接处", "description": "铁箍固定·有锈迹和微裂", "proportion": "占全长约5%" }
    ],
    "proportion": { "length": "约45cm", "width": "刃宽约4cm（最宽处）", "thickness": "刀背约3mm" }
  },
  "material": {
    "primary": "铁质刀刃",
    "secondary": ["橡木刀柄", "铁箍"],
    "surface": "哑光·斑驳锈迹·刀刃有密集细微缺口",
    "color": "深灰铁色+暗棕色锈斑+浅棕色木柄",
    "texture": "木柄被常年握持磨得发亮·靠近铁箍处有深色汗渍"
  },
  "wearAndTear": {
    "level": "明显磨损",
    "details": [
      { "type": "缺口", "position": "刀刃中段", "description": "3-4个小缺口·每个约1-2mm深" },
      { "type": "裂纹", "position": "铁箍边缘", "description": "纵向微裂·长约2cm" },
      { "type": "磨损", "position": "木柄中部", "description": "握持区域磨得光滑发亮·与两端粗糙纹理形成对比" },
      { "type": "锈迹", "position": "铁箍+刀刃根部", "description": "不均匀分布的暗棕色锈斑" }
    ]
  },
  "markings": [
    { "type": "刻字", "position": "木柄尾端", "content": "N.W.1998", "style": "手刻·歪斜·已模糊" }
  ],
  "decorations": [
    { "type": "挂饰", "position": "木柄尾端穿孔", "material": "旧麻绳", "description": "一截褪色的红色麻绳·尾端散开·长约8cm" }
  ],
  "onImageText": {
    "name": { "text": "破旧镰刀", "position": "画面左上角", "style": "粗体·中号字" },
    "subtitle": { "text": "工具/武器·温宁·45cm", "position": "名字下方·小号字" },
    "labels": [
      { "text": "手刻N.W.1998", "target": "木柄尾端刻字", "position": "刻字旁" },
      { "text": "握持磨损区", "target": "木柄中部光滑处", "position": "手柄中部旁" }
    ]
  },
  "closeups": [
    { "target": "木柄尾端刻字", "position": "正面大图右下角小框", "annotation": "N.W.1998｜手刻·已模糊" },
    { "target": "刀刃缺口", "position": "正面大图左下角小框", "annotation": "刀刃缺口｜3-4处·长期使用未磨" }
  ],
  "views": {
    "front": "正面·刀刃朝左·展示整体形状+刻字+木柄磨损",
    "side": "侧面·刀刃朝下·展示刀背厚度+铁箍裂缝",
    "back": "背面·展示背面锈斑分布+木柄背面纹理",
    "top": "俯视·展示刀刃弯曲弧度和铁箍结构",
    "detailCloseup": "木柄尾端刻字+刀刃缺口+铁箍裂纹"
  },
  "background": "纯色中性灰",
  "lighting": "均匀柔光·无戏剧阴影",
  "layout": "合理排版·正面大图居中+上下左右四角度小图+2特写框+文字信息区"
}
```

## 字段说明

| 字段 | 用途 |
|------|------|
| `wearAndTear` | 使用痕迹——下游知道这个是新是旧、经历了什么 |
| `markings` | 刻字/logo/铭文——含具体内容和风格 |
| `closeups` | 关键特征特写小框+标注 |
| `views` | 5角度展示——下游知道道具从任何方向看长什么样 |
| `onImageText.labels` | 图片上指向具体特征的标注文字 |
