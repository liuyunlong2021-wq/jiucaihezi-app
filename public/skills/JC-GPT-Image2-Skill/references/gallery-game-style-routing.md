# 游戏视觉风格路由

将「游戏/动漫风格」的视觉规范整理为一套可路由的模板。当用户说「原神风格、黑神话风格、修仙风格、诡秘之主风格、宝可梦风格、星露谷风格、潜水员戴夫风格」等时，按对应模板组装 prompt。

每个风格含：核心画风、题材锚点、元素池、UI 模式、禁用项、角色边界。

---

## 通用规则

- 默认做「游戏实况截图 / 动画剧集镜头 / 可游玩画面」，不是海报、壁纸、电影概念图
- 默认使用原创角色、原创怪物、原创伙伴或泛化职业
- 只有用户明确点名官方角色时，才写具体官方角色
- UI 模式：全量 UI（像游戏截图）/ 轻量 UI（默认，少量 HUD）/ 无 UI（干净无文字）

---

## 风格路由决策树

| 用户关键词 | 匹配风格 |
|---|---|
| 原神、Genshin、提瓦特、蒙德、璃月、稻妻、须弥、枫丹、纳塔、至冬 | 原神风格 |
| 黑神话、悟空、Black Myth Wukong、中式神话、暗黑西游、动作RPG | 黑神话悟空风格 |
| 凡人修仙传、修仙、仙侠、宗门、炼丹、飞剑、灵根、古风修真 | 凡人修仙传风格 |
| 诡秘之主、Lord of the Mysteries、蒸汽朋克、维多利亚、神秘学、非凡者 | 诡秘之主风格 |
| 宝可梦、Pokemon、精灵、训练家、捕捉、道馆、回合制冒险 | 宝可梦风格 |
| 星露谷、Stardew Valley、农场、像素农场、乡村生活 | 星露谷物语风格 |
| 潜水员戴夫、Dave the Diver、潜水、海底、寿司店、像素海洋 | 潜水员戴夫风格 |

未指定时默认：真实名胜 → 原神风格；暗黑神话题材 → 黑神话悟空风格；修仙/宗门 → 凡人修仙传风格；蒸汽/侦探/神秘学 → 诡秘之主风格；农场/小镇 → 星露谷物语风格；海底 → 潜水员戴夫风格；萌宠/收集 → 宝可梦风格。

---

## 1. 原神风格

**用途**：真实名胜游戏化、开放世界探索、二次元 3D 冒险、明亮幻想场景。

**核心画风**：
```
open-world fantasy adventure game screenshot style; bright cel-shaded anime 3D rendering, clean colors, soft ambient light, exploration vibe; no realistic photography, no dark cinematic CGI, no heavy oil-painting texture
```

**地区锚点**：蒙德（草地风车欧式）、璃月（山水石林港口）、稻妻（海岛神社雷樱）、须弥（雨林学院沙漠）、枫丹（水城剧院机械）、纳塔（火山部族龙形）、至冬（雪原冰宫）。

**元素池**：原创旅行者、传送锚点、元素方碑、宝箱、晶蝶、史莱姆、丘丘人营地、风之翼、元素反应光效、仙灵。

**UI**：全量（地点发现提示、小地图、队伍图标、体力条）/ 轻量（少量地点提示）/ 无 UI。

**真实地点 UI**：`地点 UI 文字：顶部「探索发现」/ 中间「<真实主地名>」/ 底部「<真实上级区域名>」`

**禁止**：不要写游戏内地名（蒙德、璃月港等）进真实地点 UI。

---

## 2. 黑神话悟空风格

**用途**：中式神话、古刹山林、妖怪战斗、暗黑奇幻、动作 RPG。

**核心画风**：
```
dark Chinese mythology action RPG screenshot style; heavy mountain mist, ancient temple ruins, grotto carvings, bronze and wood detail, desaturated gold-amber-gray palette, high-quality 3D with ink-painting sensibility; no modern photography, no Western fantasy, no cyberpunk, no cute cartoon style
```

**题材锚点**：山林古道（雾气松柏石阶）、佛窟寺院（石窟壁画香炉）、妖怪洞府（枯木骨饰法器）、雪山荒寺（风雪破庙）、火焰山（赤岩灰烬炉火）。

**元素池**：原创行者、长棍、葫芦、破旧袈裟、妖怪剪影、山神像、古刹香炉、石窟壁画、符箓、铜铃、残破经幡、金色法术火花。

**UI**：全量（血条/气力条、法术图标、葫芦次数、中文界面）/ 轻量 / 无 UI。

**角色边界**：默认「原创行者」或「持棍修行者」，不自动写官方角色名。

**禁止**：不要西游动画片、可爱猴子、儿童插画、欧美恶魔城。

---

## 3. 凡人修仙传风格

**用途**：东方修仙、宗门山门、炼丹炼器、飞剑遁光、灵石洞府、克制写实的仙侠动画/游戏镜头。

**核心画风**：
```
Eastern xianxia cultivation animation screenshot style; classical Chinese mountain-water landscape, sect pavilions, misty spiritual energy, flying sword trails, alchemy furnace firelight, restrained and grounded xianxia aesthetic, mix of 3D and 2D guofeng rendering between realism and animation; no MMORPG page-game feel, no excessive fairy-dust filters, no modern photography, no exaggerated Western magic
```

**题材锚点**：宗门山门（青山云海石阶）、洞府修炼（石室蒲团灵石）、炼丹炼器（丹炉药柜火焰）、野外斗法（竹林山谷飞剑）、坊市交易（古街摊位灵草）。

**元素池**：原创修士、青色道袍、飞剑、储物袋、丹炉、灵石、符箓、阵盘、竹简功法、药草、玉瓶、宗门令牌、洞府石门、护体灵光。

**UI**：全量（境界/法力条、法器栏、灵石数、中文界面）/ 轻量 / 无 UI。

**角色边界**：默认「原创修士、散修、宗门弟子、炼丹师」，不写韩立、南宫婉等。

**禁止**：不要油腻网游广告、夸张神装、满屏金光、现代都市修仙。

---

## 4. 诡秘之主风格

**用途**：维多利亚蒸汽都市、神秘学仪式、侦探调查、教会与秘密组织、克制阴郁的奇幻悬疑。

**核心画风**：
```
Victorian steam-mysticism suspense series shot style; gas lamps, foggy rainy streets, old newspapers, brass machinery, tarot and ritual symbols, church shadows, desaturated blue-gray-brown palette, restrained Lovecraftian undertones; no modern city, no cyberpunk, no gore horror, no bright fairy-tale style
```

**题材锚点**：雾都街巷（煤气灯马车石板路）、侦探事务所（木桌旧报纸打字机）、神秘仪式（烛台银匕首塔罗牌）、教堂钟楼（彩窗长椅阴影）、蒸汽机械（黄铜管道齿轮装置）。

**元素池**：原创侦探、原创非凡者、黑色长风衣、礼帽、怀表、旧报纸、塔罗牌、煤气灯、黄铜齿轮、教堂彩窗、仪式圆环、银匕首、乌鸦剪影、封蜡信件。

**UI**：全量（调查线索栏、理智/灵性状态、物品栏）/ 轻量 / 无 UI。

**角色边界**：默认「原创侦探、原创非凡者、神秘学研究者」，不写克莱恩等。

**禁止**：不要现代都市侦探剧、赛博朋克霓虹、欧美超级英雄。

---

## 5. 宝可梦风格

**用途**：明亮冒险、训练家、可爱生物伙伴、城镇道路、草地森林、道馆、收集养成。

**核心画风**：
```
colorful creature-collection adventure game screenshot style; bright cute stylized 3D/2D game visuals, clean outlines, rounded characters, flat color blocks, lighthearted adventure mood; no realistic photography, no dark horror, no complex cinematic CGI, no hardcore mecha style
```

**场景锚点**：草地道路（高草丛木牌小镇入口）、城镇道馆（彩色屋顶广场）、森林洞穴（矮树蘑菇溪流）、海岛路线（沙滩浅海码头）、雪地路线（积雪小镇松树）。

**元素池**：原创训练家、原创可爱生物伙伴、伙伴球、草丛遭遇、道馆徽章、图鉴式提示、治疗中心式小屋、回合制对战场地、捕捉光效。

**角色边界**：默认「原创训练家」和「原创可爱生物伙伴」，不写皮卡丘等。

**UI**：全量（对战菜单、生命条、伙伴名称栏、中文对话框）/ 轻量 / 无 UI。

---

## 6. 星露谷物语风格

**用途**：农场、乡村生活、小镇、季节作物、像素角色、温暖日常。

**核心画风**：
```
warm pixel-art farm life simulation game screenshot style; top-down or 3/4 view, crisp pixel grid, soft seasonal colors, cute low-resolution pixel characters, cozy countryside atmosphere; no realistic photography, no 3D cinematic quality, no cyberpunk, no dark horror
```

**场景锚点**：春季农场（嫩绿作物木栅栏）、夏季小镇（河流商店广场）、秋季农场（南瓜稻草人金黄树叶）、冬季山谷（雪地木屋烟囱）、矿洞（像素矿石火把）。

**元素池**：原创农夫、作物田、木屋、谷仓、鸡舍、稻草人、浇水壶、锄头、钓鱼竿、像素小动物、镇民、季节花草、矿石、宝箱。

**UI**：全量（像素工具栏、时间日期、金币数、物品栏）/ 轻量 / 无 UI。

---

## 7. 潜水员戴夫风格

**用途**：海底探索、潜水、鱼群、像素水下场景、寿司店经营、幽默冒险。

**核心画风**：
```
pixel-art underwater adventure management game screenshot style; horizontal or light 2.5D pixel visuals, clear layered seawater, abundant fish schools, exaggerated cute characters, bright ocean colors, lighthearted humorous adventure mood; no realistic photography, no horror deep-sea, no cinematic CGI, no heavy oil-painting texture
```

**场景锚点**：浅海珊瑚（阳光水纹热带鱼）、深海遗迹（蓝黑水层发光水母）、海底洞穴（矿石海草窄洞）、寿司店（木质吧台菜单牌暖色灯光）、港口准备区（潜水装备任务板）。

**元素池**：原创潜水员、氧气瓶、鱼叉、相机、热带鱼群、鲨鱼剪影、海龟、珊瑚、发光水母、沉船、海底遗迹、宝箱、寿司吧台、厨师、料理盘。

**UI**：全量（氧气条、深度计、背包容量、鱼类信息弹窗、中文任务提示）/ 轻量 / 无 UI。

---

## 直接出图 prompt 组装规则

1. **用户主体**：地点、产品、人物、物体或场景
2. **选定视觉风格**：按上述模板选一个明确风格
3. **玩法时刻**：角色正在探索、对战、种田、潜水、经营、调查等
4. **风格元素**：自然嵌入 3-7 个
5. **UI 模式**：全量 UI、轻量 UI 或无 UI
6. **禁用项**：不要广告、水印、二维码、乱码

示例组装结构：
```
[核心画风]。[玩法时刻描述]。[场景+主体描述]。[UI模式]。[元素点缀]。Avoid: [禁止项列表]。
```
