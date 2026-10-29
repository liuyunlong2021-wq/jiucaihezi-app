import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const groups = JSON.parse(readFileSync('public/skills/production-skills.json', 'utf8'))
test('production scopes are plain business allowlists with no executable router', () => {
  assert.deepEqual(Object.keys(groups), ['manju', 'short-drama', 'novel'])
  assert.equal(groups.manju.length, 16)
  assert.equal(groups['short-drama'].length, 10)
  assert.ok(groups['short-drama'].includes('jc-gongchengjuben'), '短剧改编与漫剧共用同一个改编技能')
  assert.ok(!groups['short-drama'].includes('jc-duanju-xiezuo'), 'jc-duanju-xiezuo 已并入工程剧本')
  for (const name of ['jc-juese-sheji', 'jc-fuzhuang-prompt', 'jc-scene-prompt', 'jc-prop-prompt']) assert.ok(groups['short-drama'].includes(name), name)
  assert.deepEqual(groups.novel, ['jc-novel'])
  for (const list of Object.values(groups)) {
    assert.equal(list.length, new Set(list).size)
    for (const name of list) {
      assert.ok(!['jc-manju-zhizuo', 'jc-duanju'].includes(name))
      const file = resolve('public/skills', name, 'SKILL.md')
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/\]\(([^)]+\.md)\)/g)) assert.ok(existsSync(resolve(dirname(file), match[1])), match[1])
    }
  }
  for (const name of ['jc-manju-zhizuo', 'jc-duanju']) assert.equal(existsSync(`public/skills/${name}/SKILL.md`), false)
  const index = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  assert.ok(!index.some(skill => ['jc-manju-zhizuo', 'jc-duanju'].includes(skill.name)))
})

test('props are only plot props and character signature items; everyday objects belong to scene set dressing', () => {
  const read = name => readFileSync(`public/skills/${name}/SKILL.md`, 'utf8')
  const source = read('jc-xiangmuziliao')
  assert.match(source, /道具判定标准（漫剧资产唯一口径）/)
  assert.match(source, /剧情道具[\s\S]*角色标志物/)
  assert.match(source, /茶碗、筷子、桌椅、桌上的菜[\s\S]*场景说明的“陈设”/)
  for (const name of ['jc-prop-prompt', 'jc-manju-pipeline']) assert.match(read(name), /道具判定标准/, name)
  assert.match(read('jc-scene-prompt'), /陈设”中的日常物件/)
  assert.match(read('jc-seedance'), /日常物件属于场景陈设，不占@图/)
  assert.match(read('h3-prompt-writing'), /日常物件属于场景陈设，不占图/)
})

test('crowds are one shared lineup asset per group, referenced with headcount and formation', () => {
  const read = name => readFileSync(`public/skills/${name}/SKILL.md`, 'utf8')
  assert.ok(groups.manju.includes('jc-renqun'))
  assert.match(read('jc-renqun'), /crowd_asset[\s\S]*资产\/人群\/<群体>\/群像生图提示词\.md/)
  assert.match(read('jc-xiangmuziliao'), /场景说明的“人群”[\s\S]*出场人数/)
  assert.match(read('jc-manju-pipeline'), /jc-renqun\/SKILL\.md\) 保存一份 crowd_asset/)
  assert.match(read('jc-seedance'), /太虚宗弟子一千余人站成方阵/)
  assert.match(read('h3-prompt-writing'), /crowd from <Picture 4>/)
})

test('the identity close-up of the character sheet is a 30–35° three-quarter chest-up head shot, not facing the camera', () => {
  for (const file of ['9-16.md', '16-9.md']) {
    const text = readFileSync(`public/skills/jc-juese-sheji/references/${file}`, 'utf8')
    assert.match(text, /约30°至35°斜侧齐胸头部特写/, file)
    assert.match(text, /不正对镜头/, file)
    assert.doesNotMatch(text, /双眼直视镜头/, file)
  }
})

test('costume looks: same face, new outfit, fused from identity sheet + costume sheet', () => {
  const read = name => readFileSync(`public/skills/${name}/SKILL.md`, 'utf8')
  assert.ok(groups.manju.includes('jc-fuzhuang-prompt'))
  const costume = read('jc-fuzhuang-prompt')
  assert.match(costume, /costume_asset[\s\S]*资产\/角色\/<角色名·造型名>\/服装生图提示词\.md/)
  assert.match(costume, /character_look[\s\S]*以参考图1为人物身份[\s\S]*参考图2的整套服装/)
  assert.match(read('jc-xiangmuziliao'), /造型表（换装）/)
  assert.match(read('jc-manju-pipeline'), /同阶段保存 costume_asset 与 character_look/)
  assert.match(read('jc-seedance'), /顾云舟·帝王，龙袍冕旒/)
})

test('engineering script picks shots by scene: dramatic motive and film style first, scene-type references as a method library', () => {
  const dir = 'public/skills/jc-gongchengjuben'
  const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
  assert.match(skill, /## 按戏选镜与节奏/)
  assert.match(skill, /戏剧动机[\s\S]*影片比例与风格/)
  assert.match(skill, /\(references\/dialogue-scenes\.md\)/)
  assert.match(skill, /\(references\/camera-grammar\.md\)/)
  assert.match(skill, /方法库，不是配额/)
  assert.match(skill, /无对白、也没有需要看清的动作[\s\S]*约1秒/)
  assert.match(skill, /单镜一般不超过约5秒/)
  assert.match(skill, /不写过渡镜头/)
  assert.doesNotMatch(skill, /文戏优先克制/)
  assert.doesNotMatch(skill, /空间已清楚时无需建立镜/)
  assert.doesNotMatch(skill, /全景／大全景和固定镜头各1—2个/)

  const dialogue = readFileSync(`${dir}/references/dialogue-scenes.md`, 'utf8')
  for (const section of ['双人对坐', '双人站立', '边走边谈', '车内', '三人', '四人及以上', '一人对众人', '电话与隔空', '冲突与力量对比', '紧张与暗流', '揭示与转折', '暧昧与建立联系', '亲密与吻戏', '情绪爆发', '冷战与疏离']) {
    assert.match(dialogue, new RegExp(`## .*${section}`), section)
  }
  assert.ok((dialogue.match(/短剧切法：/g) || []).length >= 40)
  assert.match(dialogue, /一镜最多一个说话角色/)

  const grammar = readFileSync(`${dir}/references/camera-grammar.md`, 'utf8')
  for (const topic of ['焦段', '机位高度', '距离与景别', '构图', '视线', '轴线', '运镜', '光', '竖屏']) {
    assert.match(grammar, new RegExp(`## .*${topic}`), topic)
  }
  assert.match(grammar, /长焦[\s\S]*压缩/)
  assert.match(grammar, /仰拍[\s\S]*强势/)

  for (const text of [dialogue, grammar]) {
    assert.doesNotMatch(text, /参考影片|《[^》]+》/)
  }
  const index = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  const files = index.find(skill => skill.name === 'jc-gongchengjuben').files
  assert.ok(files.includes('references/dialogue-scenes.md'))
  assert.ok(files.includes('references/camera-grammar.md'))
})

test('character entrances and exits have their own reference, routed from the engineering script', () => {
  const dir = 'public/skills/jc-gongchengjuben'
  assert.match(readFileSync(`${dir}/SKILL.md`, 'utf8'), /\(references\/character-entrance\.md\)/)
  const text = readFileSync(`${dir}/references/character-entrance.md`, 'utf8')
  for (const section of ['突出一个人', '经典登场', '短剧常用登场', '按人物定位', '退场']) {
    assert.match(text, new RegExp(`## .*${section}`), section)
  }
  for (const role of ['主角首次登场', '强者', '反派', '恋爱对象', '再次登场']) assert.match(text, new RegExp(role), role)
  assert.ok((text.match(/短剧切法：/g) || []).length >= 15)
  assert.doesNotMatch(text, /参考影片|《[^》]+》/)
  const index = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  assert.ok(index.find(skill => skill.name === 'jc-gongchengjuben').files.includes('references/character-entrance.md'))
})

test('suspense, dread and scares have their own reference, routed from the engineering script', () => {
  const dir = 'public/skills/jc-gongchengjuben'
  assert.match(readFileSync(`${dir}/SKILL.md`, 'utf8'), /\(references\/suspense-scenes\.md\)/)
  const text = readFileSync(`${dir}/references/suspense-scenes.md`, 'utf8')
  for (const section of ['通用原则', '观众先知道', '看不见的威胁', '惊吓', '搜索与潜伏', '发现与揭示']) {
    assert.match(text, new RegExp(`## .*${section}`), section)
  }
  assert.match(text, /\(dialogue-scenes\.md\)/)
  assert.ok((text.match(/短剧切法：/g) || []).length >= 20)
  assert.doesNotMatch(text, /参考影片|《[^》]+》/)
  const index = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  assert.ok(index.find(skill => skill.name === 'jc-gongchengjuben').files.includes('references/suspense-scenes.md'))
})

test('camera grammar covers shape language, indirect showing, and cross-shot continuity with rising tension', () => {
  const dir = 'public/skills/jc-gongchengjuben/references'
  const grammar = readFileSync(`${dir}/camera-grammar.md`, 'utf8')
  for (const section of ['画面的形状与环境', '间接表现', '镜头衔接与张力递增']) {
    assert.match(grammar, new RegExp(`## .*${section}`), section)
  }
  assert.match(grammar, /视觉焦点接力/)
  assert.match(grammar, /曲线[\s\S]*折线/)
  assert.match(grammar, /只拍结果/)
  assert.match(grammar, /中立机位/)
  assert.doesNotMatch(grammar, /参考影片|《[^》]+》/)
  assert.match(readFileSync(`${dir}/dialogue-scenes.md`, 'utf8'), /环境逐步收紧/)
})

test('every scene is planned beat by beat with a rhythm curve before shot design, and beats stay internal', () => {
  const dir = 'public/skills/jc-gongchengjuben'
  const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
  assert.match(skill, /观看原则[\s\S]*\[场戏节奏设计\]\(references\/scene-rhythm\.md\)[\s\S]*拆节拍[\s\S]*逐镜设计/)
  assert.match(skill, /节拍划分只在内部规划，不写进台本/)
  assert.match(skill, /整场节奏有起伏/)

  const rhythm = readFileSync(`${dir}/references/scene-rhythm.md`, 'utf8')
  for (const section of ['拆节拍', '节奏档位', '节奏曲线', '先建立规律，再打破', '紧与松', '景别的走法', '爽点与钩子', '时长按节拍分配', '检查']) {
    assert.match(rhythm, new RegExp(`## .*${section}`), section)
  }
  assert.match(rhythm, /每一场戏都要/)
  assert.match(rhythm, /节拍边界/)
  assert.doesNotMatch(rhythm, /参考影片|《[^》]+》/)
  const index = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  assert.ok(index.find(skill => skill.name === 'jc-gongchengjuben').files.includes('references/scene-rhythm.md'))
})

test('costume looks keep the character silhouette anchors from the identity design', () => {
  const costume = readFileSync('public/skills/jc-fuzhuang-prompt/SKILL.md', 'utf8')
  assert.match(costume, /本轮应读[^\n]*角色生图提示词\.md[^\n]*剪影锚点/)
  assert.match(costume, /### 5\. 保留角色的剪影锚点/)
  assert.match(costume, /穿戴类锚点[\s\S]*保留/)
  assert.match(costume, /不得遮挡/)
  assert.match(costume, /身份或性格转变/)
  assert.match(readFileSync('public/skills/jc-juese-sheji/references/silhouette-shape.md', 'utf8'), /换装保留剪影锚点/)
})

test('short-drama episode writing carries scene and dialogue craft rules with an on-demand polish reference', () => {
  const main = readFileSync('public/skills/jc-gongchengjuben/SKILL.md', 'utf8')
  assert.match(main, /\[场景与对白打磨\]\(references\/场景与对白打磨\.md\)/)
  assert.match(main, /场景转向/)
  assert.match(main, /晚进早出/)
  assert.match(main, /台词字面与真实情绪不一致时/)
  assert.match(main, /影像顺序/)
  assert.match(main, /一行一个画面/)
  const polish = readFileSync('public/skills/jc-gongchengjuben/references/场景与对白打磨.md', 'utf8')
  for (const rule of [/问答式/, /潜台词/, /说话方式/, /意识到/, /弱词/, /句尾/, /有名字的人物开口/, /只写看得见的/]) assert.match(polish, rule)
})

test('short-drama planning keeps user examples as examples and covers batching, review and deletion checks', () => {
  const read = path => readFileSync(`public/skills/${path}`, 'utf8')
  const cehua = read('jc-duanju-cehua/SKILL.md'), fenji = read('jc-duanju-fenji/references/时间账标注兼容流程.md'), xiezuo = read('jc-gongchengjuben/SKILL.md'), pipeline = read('jc-duanju-pipeline/SKILL.md')
  // 本我、自我、超我是可选的人物设计手法，放在参考文件，不作为必填项或写作必读。
  assert.doesNotMatch(cehua, /\*\*本我、超我、自我\*\*/)
  assert.doesNotMatch(xiezuo, /本我/)
  assert.match(cehua, /\[人物塑造方法\]\(references\/人物塑造方法\.md\)/)
  assert.match(read('jc-duanju-cehua/references/人物塑造方法.md'), /本我[\s\S]*可选/)
  assert.match(read('jc-duanju-cehua/references/人物塑造方法.md'), /说得通原作里他做过的事/)
  // 题材举例不进入规则正文，“前15秒”不是硬性要求。
  assert.doesNotMatch(fenji, /最好两者互相推动（为了活下去/)
  assert.doesNotMatch(cehua, /能力、装备、阵地按集数/)
  assert.doesNotMatch(xiezuo + fenji, /前15秒直接出现/)
  assert.doesNotMatch(xiezuo, /爽点要给到看得见的效果（新能力/)
  assert.doesNotMatch(fenji, /强度（1–5）。然后决定/)
  assert.doesNotMatch(fenji, /并入相邻集或删掉/)
  // 缺口：分批读、每批都审、删减查伏笔、跨批接续、倒叙回到正片。
  assert.match(fenji, /20章一段/)
  assert.match(fenji, /后文会用到的伏笔不删/)
  assert.match(pipeline, /每一批[\s\S]*chapter_range/)
  assert.match(pipeline, /集号与事件序号全书连续/)
  assert.match(xiezuo, /正片演到倒叙/)
})

test('short-drama default is deletion-only: one-pass annotation, program-assembled original-only scripts handed to manju', () => {
  const read = path => readFileSync(`public/skills/${path}`, 'utf8')
  const cehua = read('jc-duanju-cehua/SKILL.md'), fenji = read('jc-duanju-fenji/references/时间账标注兼容流程.md'), pipeline = read('jc-duanju-pipeline/SKILL.md'), xiezuo = read('jc-gongchengjuben/SKILL.md'), ziliao = read('jc-xiangmuziliao/SKILL.md')
  // 项目总纲只给用户看：主题与事件摘要。
  assert.match(cehua, /主题[\s\S]*事件摘要/)
  assert.doesNotMatch(cehua, /卖点发动机|必要设定清单|大结构/)
  // 事件文档与删减标准；分集剧本由程序从标注组装，只含原文。
  assert.match(fenji, /adaptation_event[\s\S]*E03_/)
  assert.match(fenji, /删掉这一句[\s\S]*少知道什么[\s\S]*少感受到什么/)
  assert.match(fenji, /程序[\s\S]*分集剧本/)
  assert.match(fenji, /不新增任何文字/)
  assert.match(xiezuo, /默认/)
  // 对齐漫剧制作：造型表起始章、声音特征、能力视觉规则、场景人群与陈设。
  assert.match(ziliao, /声音特征/)
  assert.match(ziliao, /能力的视觉规则/)
  assert.match(ziliao, /从第几章开始/)
  assert.match(ziliao, /别名[\s\S]*分集剧本文件头/)
  // 跨段续写未完事件，下一批从未完事件起始章开始；超过一整批的事件拆开。
  assert.match(fenji, /未完[\s\S]*续写/)
  assert.match(fenji, /unfinished/)
  assert.match(fenji, /拆成两个事件/)
  assert.match(pipeline, /未完事件的起始章/)
  // 一遍标注（2026-10-28）：只读一遍，同时写资产、事件与结构化标注；程序按预设节奏组装分集剧本。
  assert.match(fenji, /adaptation_annotation/)
  assert.match(fenji, /hook/)
  // 时间账（2026-10-28）：回合、动作单元时间表、重要度档位、跳过段、峰值、可闪回素材；三种风格给秒数区间。
  assert.match(fenji, /回合[\s\S]*局势/)
  assert.match(fenji, /每分钟240字/)
  assert.match(fenji, /快招[\s\S]*攻防[\s\S]*技能[\s\S]*大招[\s\S]*走位[\s\S]*反应[\s\S]*全景[\s\S]*停顿[\s\S]*面板/)
  assert.match(fenji, /压缩[\s\S]*如实[\s\S]*细写[\s\S]*决战/)
  assert.match(fenji, /skip[\s\S]*reason/)
  assert.match(fenji, /peak/)
  assert.match(fenji, /flashback_sources/)
  assert.match(fenji, /single/)
  assert.match(fenji, /replan/)
  assert.match(fenji, /切分卡/)
  assert.match(fenji, /快节奏爽剧[\s\S]*60[\s\S]*90[\s\S]*标准剧情[\s\S]*75[\s\S]*120[\s\S]*大场面奇幻[\s\S]*90[\s\S]*150/)
  assert.doesNotMatch(fenji, /beats_per_episode|重拍|轻拍|"delete"/)
  assert.match(fenji, /recut/)
  assert.match(pipeline, /【全自动改编·规划】[\s\S]*【全自动改编·样集】[\s\S]*【全自动改编·改编】[\s\S]*【全自动改编·调速】[\s\S]*【全自动改编·收尾】/)
  // 逐集改编是默认的第3步：按切分卡的时间预算改编，选策略，逐场标时间和出处，保存 adapted。
  assert.match(xiezuo, /按时间改编/)
  assert.match(xiezuo, /冷开场[\s\S]*悬念开场[\s\S]*闪回[\s\S]*细写扩展/)
})

test('工程剧本自带删减扩写：逐集作业、不管理资产、细度按节拍写', () => {
  const dir = 'public/skills/jc-gongchengjuben'
  const skill = readFileSync(`${dir}/SKILL.md`, 'utf8')
  // 一次只改一集，不能把两集合成一稿
  assert.match(skill, /一次只改编一集/)
  assert.match(skill, /不承担资产整理、设计或维护/)
  assert.match(skill, /不输出整集资产清单/)
  assert.doesNotMatch(skill, /jc-juese-sheji\/SKILL\.md|jc-scene-prompt\/SKILL\.md|jc-prop-prompt\/SKILL\.md|character_bio|scene_research|prop_research/)
  // 删：不推动剧情的删掉，原台词／伏笔／钩子不能删
  assert.match(skill, /不推动剧情[\s\S]{0,120}删/)
  // 扩：动作与打戏写到节拍，禁止用结论词代替动作
  assert.match(skill, /打斗激烈[\s\S]{0,40}结论词|结论词[\s\S]{0,60}打斗激烈/)
  assert.match(skill, /references\/shot-density\.md/)
  assert.match(skill, /references\/adaptation-rewrite\.md/)

  for (const file of ['shot-density.md', 'adaptation-rewrite.md']) {
    assert.ok(existsSync(`${dir}/references/${file}`), file)
  }
  const density = readFileSync(`${dir}/references/shot-density.md`, 'utf8')
  // 细度标尺要落到可执行的四件事：发起、轨迹、反馈、结果
  assert.match(density, /发起[\s\S]*轨迹[\s\S]*反馈[\s\S]*结果/)
  // 打戏与文戏各有正反例，且范例用到 0.5–1.5 秒级的镜内节拍
  assert.match(density, /反例/)
  assert.match(density, /0\.\d–\d\.\d?s/)
  assert.match(density, /朱砂红/)

  const rewrite = readFileSync(`${dir}/references/adaptation-rewrite.md`, 'utf8')
  assert.match(rewrite, /删|压缩/)
  assert.match(rewrite, /伏笔/)
  assert.match(rewrite, /对白电影化|每分钟\s*240\s*字/)

  // 索引必须登记新参考文件，否则打包后在 Agent 里读不到
  const index = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  const files = index.find(s => s.name === 'jc-gongchengjuben').files
  for (const file of ['references/shot-density.md', 'references/adaptation-rewrite.md']) {
    assert.ok(files.includes(file), file)
  }
})

test('漫剧制作只读工程剧本，已有成品台本时复用而不是重写', () => {
  const pipeline = readFileSync('public/skills/jc-manju-pipeline/SKILL.md', 'utf8')
  assert.match(pipeline, /只读工程剧本/)
  assert.match(pipeline, /已有工程剧本[\s\S]{0,60}复用/)
  const skill = readFileSync('public/skills/jc-gongchengjuben/SKILL.md', 'utf8')
  // 短剧路线产物仍是分集剧本，位置不变；工程剧本仍在 剧本/工程剧本/
  assert.match(skill, /项目资料\/分集剧本\/第N集分集剧本\.md/)
  assert.match(skill, /剧本\/工程剧本\/第x集工程剧本\.md/)
})

test('拖节奏的设定说明改用精炼旁白，而不是让人物硬讲或整段删掉', () => {
  const skill = readFileSync('public/skills/jc-gongchengjuben/SKILL.md', 'utf8')
  assert.match(skill, /设定说明/)
  assert.match(skill, /精炼旁白/)
  assert.match(skill, /拖慢节奏/)
  // 旁白口径要与「旁白最后」的原则并存：只作拖节奏设定说明的例外，不是全面放开
  assert.match(skill, /旁白／OS最后[\s\S]{0,80}例外/)
})

test('逐集改编把原文落成引擎可校验的分集剧本', () => {
  const xiezuo = readFileSync('public/skills/jc-gongchengjuben/SKILL.md', 'utf8')
  assert.match(xiezuo, /adapted[\s\S]*seconds[\s\S]*sources/)
  assert.match(xiezuo, /25%/)
  const pipeline = readFileSync('public/skills/jc-duanju-pipeline/SKILL.md', 'utf8')
  const fenji = readFileSync('public/skills/jc-duanju-fenji/references/时间账标注兼容流程.md', 'utf8')
  const ziliao = readFileSync('public/skills/jc-xiangmuziliao/SKILL.md', 'utf8')
  assert.match(pipeline, /样集/)
  assert.match(ziliao, /一档一件[\s\S]*汇总档/)
  assert.doesNotMatch(pipeline, /风格推荐|建议分集】|定集】|切集】/)
  // 分集剧本文件头只放链接（所属事件、出场角色、场景、道具），正文只有原文；漫剧读取时把文件头当资产清单。
  assert.match(fenji, /文件头[\s\S]*event[\s\S]*characters[\s\S]*scenes[\s\S]*props/)
  assert.match(fenji, /正文只有原文/)
  assert.match(readFileSync('public/skills/jc-manju-pipeline/SKILL.md', 'utf8'), /文件头[\s\S]*资产链接[\s\S]*不是剧本/)
  assert.ok(!groups['short-drama'].includes('jc-film-style'))
})

 test('自由切分只读指定章并用现有切片接口归档，兼容标注按需加载', () => {
  const skill = readFileSync('public/skills/jc-duanju-fenji/SKILL.md', 'utf8')
  assert.match(skill, /第一章[\s\S]*下一未切分章/)
  assert.match(skill, /默认保留全部正文/)
  assert.match(skill, /adaptation_episode_plan[\s\S]*adaptation_cut[\s\S]*episode_source_script/)
  assert.match(skill, /from_cut/)
  assert.match(skill, /实际 read 本次保存/)
  assert.match(skill, /不要求用户先建人物、场景、道具档案/)
  assert.match(skill, /references\/时间账标注兼容流程.md/)
  assert.doesNotMatch(skill, /每次只读.*20章/)
})

test('剧本路径直接转逐镜本：先删再扩，显式按场路线不抢占入口', () => {
 const skill = readFileSync('public/skills/jc-gongchengjuben/SKILL.md', 'utf8')
 assert.match(skill, /读取.*[\s\S]*先删无效内容[\s\S]*再扩动作和表演[\s\S]*最后拆镜[\s\S]*保存并读回/)
 assert.match(skill, /不因旁边存在切分卡而改交按场稿/)
 assert.match(skill, /content=完整 Markdown 台本/)
 assert.match(skill, /自由转分镜默认原台词逐字保留/)
 assert.match(skill, /允许补足实现原意必需的表演细节/)
 assert.match(skill, /原文件保持原样/)
 assert.match(skill, /缺少资产档案不阻塞写作/)
})

test('分镜按语义与观看重点拆镜，时间由对白和动作推导，首次登场先读参考', () => {
 const root = 'public/skills/jc-gongchengjuben/'
 const main = readFileSync(root + 'SKILL.md', 'utf8')
 const density = readFileSync(root + 'references/shot-density.md', 'utf8')
 const entrance = readFileSync(root + 'references/character-entrance.md', 'utf8')
 assert.match(main, /先按观看重点拆镜，再计算每镜时长/)
 assert.match(main, /每秒4–5个汉字[\s\S]*每秒3字/)
 assert.match(main, /较大者[\s\S]*先做再说才相加/)
 assert.match(main, /首次登场[\s\S]*必须实际读取.*角色登场与退场/)
 assert.match(main, /严禁附加“资产说明”/)
 assert.match(main, /先推近再拉回[\s\S]*另编号/)
 for (const phrase of ['“干燥、”', '“隐蔽、”', '“全天然采光！”', '“正中间这片地，”', '“就是我的第一块农田！”']) assert.ok(density.includes(phrase))
 const example = density.split('## 正例甲：')[1].split('## 正例乙：')[0]
 const ranges = [...example.matchAll(/镜头(\d+)【(\d+):(\d+(?:\.\d+)?)-(\d+):(\d+(?:\.\d+)?)】/g)]
 assert.equal(ranges.length, 5)
 let end = 0
 for (const m of ranges) {
  const from = Number(m[2]) * 60 + Number(m[3]), to = Number(m[4]) * 60 + Number(m[5])
  assert.equal(from, end)
  assert.ok(to > from && to - from < 3)
  end = to
 }
 assert.doesNotMatch(density, /单镜一般 3–8 秒|保持原始姿态，注视镜头/)
 assert.match(entrance, /动物、怪物、无名角色[\s\S]*必须实际读取/)
 assert.match(entrance, /每项独立编号/)
})
