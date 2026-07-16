# 角色工程参考图输出格式（JSON）

> 阶段 5 输出时读取。产出下游 AI 视频模型可精确参照的角色工程图 JSON。包含所有视觉数据 + 图片上需生成的文字标注 + 特写说明。

## JSON 模板

```json
{
  "character": {
    "name": "角色名",
    "alias": "别名或代号",
    "age": 数字,
    "heightCm": 数字,
    "headToBodyRatio": "X头身",
    "bodyType": "体型描述",
    "medium": "真人剧/动漫剧/漫剧",
    "genre": "悬疑/爱情/奇幻/...",
    "visualStyle": "偏写实/偏风格化/..."
  },
  "personality": {
    "coreTraits": ["特质1", "特质2", "特质3"],
    "innerConflict": "想要什么 vs 什么阻碍",
    "behavioralHabits": ["习惯1", "习惯2"],
    "defaultExpression": "默认表情描述"
  },
  "face": {
    "shape": "脸型",
    "skin": "肤色/纹理/瑕疵",
    "eyes": "眼型/大小/间距/颜色",
    "hair": "发型/质地/发色/不完美",
    "undereye": "黑眼圈/眼袋/无",
    "distinctiveFeatures": [
      {
        "type": "scar/mole/asymmetry/missingPart/tattoo",
        "position": "具体位置",
        "description": "外观描述",
        "closeupRequired": true,
        "closeupAnnotation": "生成在特写旁的标注文字"
      }
    ]
  },
  "body": {
    "shoulderWidth": "肩宽描述",
    "posture": "体态",
    "arms": "手臂描述",
    "legs": "腿部描述"
  },
  "clothing": [
    {
      "layer": "内层/中层/外层/下装/鞋履",
      "item": "服装名称",
      "material": "面料",
      "color": "颜色",
      "detail": "磨损/不完美/特殊细节"
    }
  ],
  "props": [
    {
      "name": "道具/配饰名称",
      "position": "佩戴位置",
      "material": "材质",
      "size": "尺寸",
      "function": "功能/说明"
    }
  ],
  "tattoos": [
    {
      "position": "身体位置",
      "design": "图案描述",
      "size": "尺寸",
      "closeupRequired": true,
      "closeupAnnotation": "纹身特写旁的标注文字"
    }
  ],
  "onImageText": {
    "name": { "text": "角色全名", "position": "画面中文字位置", "style": "字号/字重" },
    "subtitle": { "text": "年龄·身高·身份", "position": "名字下方" },
    "traits": { "text": "特质1 / 特质2 / 特质3", "position": "角色信息区" },
    "heightScale": { "text": "XXXcm", "position": "全身图旁", "style": "身高比例尺·以头部为基准" }
  },
  "closeups": [
    {
      "target": "特写对象名称",
      "position": "布局中的位置",
      "annotation": "特写旁标注文字"
    }
  ],
  "views": {
    "front": "正面全身·直立·双臂微开·手掌朝镜头",
    "left45": "左转45°·双手自然下垂·展示侧面轮廓",
    "right45": "右转45°·展示另一侧轮廓",
    "back": "背面全身·展示背面服装结构/发型后部/腰带扣位置",
    "headCloseup": "锁骨以上·正面·中性表情·展示五官和面部不对称"
  },
  "background": "纯色中性灰",
  "lighting": "均匀柔光·无戏剧阴影",
  "layout": "合理排版·5视角+特写小框+文字信息区·非强制对称·自然视觉流"
}
```

## 完整示例：温宁

```json
{
  "character": {
    "name": "温宁",
    "alias": "监控兄",
    "age": 27,
    "heightCm": 175,
    "headToBodyRatio": "7头身",
    "bodyType": "偏瘦·轻微驼背·室内生物",
    "medium": "动漫剧",
    "genre": "悬疑",
    "visualStyle": "偏写实·日式anime"
  },
  "personality": {
    "coreTraits": ["极度懒惰", "黑色幽默", "好奇心强"],
    "innerConflict": "想躺平但好奇心不允许",
    "behavioralHabits": ["蜷缩在任何柔软表面上", "手指无意识敲键盘", "眯眼凑近屏幕"],
    "defaultExpression": "半困半专注·嘴角不上扬不下沉·像在思考杀人手法合不合理"
  },
  "face": {
    "shape": "略尖鹅蛋脸·下颌线柔和",
    "skin": "偏白缺血色·嘴唇干燥起皮",
    "eyes": "单眼皮·眼角略下垂·深灰虹膜·长期盯屏幕的死鱼眼",
    "hair": "黑色蓬松碎发·鸡窝头·刘海遮眉但不挡眼·几缕自然翘起",
    "undereye": "明显黑眼圈+轻微浮肿",
    "distinctiveFeatures": [
      {
        "type": "scar",
        "position": "左侧眉尾",
        "description": "一小道淡色旧伤疤·童年磕桌角",
        "closeupRequired": false,
        "closeupAnnotation": ""
      },
      {
        "type": "texture",
        "position": "右手腕外侧",
        "description": "长期打字形成的腱鞘炎凸起·骨节微突",
        "closeupRequired": true,
        "closeupAnnotation": "右手腕腱鞘炎凸起｜长期打字磨损"
      }
    ]
  },
  "body": {
    "shoulderWidth": "略窄",
    "posture": "轻微驼背·长期蜷缩沙发的体态",
    "arms": "偏细·右手腕腱鞘炎凸起",
    "legs": "偏瘦·少走动"
  },
  "clothing": [
    {
      "layer": "外层",
      "item": "卫衣",
      "material": "棉质",
      "color": "褪色深灰",
      "detail": "领口罗纹松垮成荷叶边·左袖口泡面汤汁永久污渍·洗到发白的不均匀褪色"
    },
    {
      "layer": "下装",
      "item": "运动裤",
      "material": "棉混纺",
      "color": "黑色",
      "detail": "膝盖处起球"
    },
    {
      "layer": "鞋履",
      "item": "棉拖鞋",
      "material": "棉布",
      "color": "灰色",
      "detail": "后跟踩扁·鞋底外侧磨损严重"
    }
  ],
  "props": [
    {
      "name": "石英表",
      "position": "左手腕",
      "material": "黑色表盘+不锈钢表带",
      "size": "表盘直径约3.5cm",
      "function": "极简设计·唯一出门才戴·暗示他还保留一条与外界的时间线"
    }
  ],
  "tattoos": [],
  "onImageText": {
    "name": { "text": "温宁", "position": "画面左上角", "style": "粗体·大号字" },
    "subtitle": { "text": "27岁·175cm·网络悬疑小说作者", "position": "名字下方·小号字" },
    "traits": { "text": "极度懒惰 / 黑色幽默 / 好奇心强", "position": "角色信息区·中号字" },
    "heightScale": { "text": "175cm｜7头身", "position": "正面全身图左侧", "style": "身高比例尺·以头部为1单位" }
  },
  "closeups": [
    {
      "target": "右手腕腱鞘炎凸起",
      "position": "头部特写旁独立小框",
      "annotation": "右手腕｜长期打字磨损·骨节微突"
    }
  ],
  "views": {
    "front": "正面全身·直立·双臂微开·手掌朝镜头·卫衣松垮轮廓清晰",
    "left45": "左转45°·驼背侧面轮廓·卫衣后摆长于前摆",
    "right45": "右转45°·右手腕凸起可见",
    "back": "背面全身·卫衣后领褪色标签·头发后部不规则翘起·运动裤后袋磨损",
    "headCloseup": "锁骨以上·正面·中性表情·黑眼圈+干燥嘴唇清晰可见"
  },
  "background": "纯色中性灰",
  "lighting": "均匀柔光·无戏剧阴影·无环境色反光",
  "layout": "合理排版·5视角+1特写小框+文字信息区·自然视觉流·非强制对称"
}
```

## 字段说明

| 字段 | 用途 |
|------|------|
| `personality` | 性格特质——生成图片上的角色信息文字 |
| `distinctiveFeatures[].closeupRequired` | `true` 则需在布局中画独立特写小框 |
| `distinctiveFeatures[].closeupAnnotation` | 特写旁的标注文字 |
| `tattoos` | 纹身——独立数组，含图案描述+特写标志 |
| `onImageText` | **图片上必须渲染的文字**——角色名/身高/性格关键词/比例尺 |
| `closeups` | 特写小框在布局中的位置+标注 |
| `layout` | 排版原则——不硬编码坐标，给「合理排版」方向 |

## 约束

1. 去掉了 `referenceSource`——参考图来源不在 JSON 中体现
2. 去掉了 `光影氛围描述`、`镜头焦段`——下游生图模型不需要
3. 新增了 `onImageText`——明确图片上要生成什么文字
4. 新增了 `closeups[]`——需要特写的部位独立标注
5. 所有尺寸数据用具体数值（cm），不写模糊描述
