import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const groups = JSON.parse(readFileSync('public/skills/production-skills.json', 'utf8'))
test('production scopes are plain business allowlists with no executable router', () => {
  assert.deepEqual(Object.keys(groups), ['manju', 'short-drama', 'novel'])
  assert.equal(groups.manju.length, 16)
  assert.equal(groups['short-drama'].length, 5)
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
  for (const name of ['jc-gongchengjuben', 'jc-prop-prompt', 'jc-manju-pipeline']) assert.match(read(name), /道具判定标准/, name)
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
  assert.match(read('jc-gongchengjuben'), /群戏另列“人群”/)
  assert.match(read('jc-seedance'), /太虚宗弟子一千余人站成方阵/)
  assert.match(read('h3-prompt-writing'), /crowd from <Picture 4>/)
})

test('the identity close-up of the character sheet is a 30–35° three-quarter chest-up head shot, not facing the camera', () => {
  for (const file of ['9-16.md', '16-9.md']) {
    const text = readFileSync(`public/skills/jc-juese-geshi/references/${file}`, 'utf8')
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
  assert.match(read('jc-gongchengjuben'), /同一段内换装须在换装处切段/)
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
