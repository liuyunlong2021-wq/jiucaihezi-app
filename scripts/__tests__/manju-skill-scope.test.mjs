import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const groups = JSON.parse(readFileSync('public/skills/production-skills.json', 'utf8'))
test('production scopes are plain business allowlists with no executable router', () => {
  assert.deepEqual(Object.keys(groups), ['manju', 'short-drama', 'novel'])
  assert.equal(groups.manju.length, 15)
  assert.equal(groups['short-drama'].length, 8)
  assert.ok(groups['short-drama'].includes('jc-shijiancuo-fenjing'), '短剧与漫剧均可使用时间戳分镜')
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

test('costume looks keep the character silhouette anchors from the identity design', () => {
  const costume = readFileSync('public/skills/jc-fuzhuang-prompt/SKILL.md', 'utf8')
  assert.match(costume, /本轮应读[^\n]*角色生图提示词\.md[^\n]*剪影锚点/)
  assert.match(costume, /### 5\. 保留角色的剪影锚点/)
  assert.match(costume, /穿戴类锚点[\s\S]*保留/)
  assert.match(costume, /不得遮挡/)
  assert.match(costume, /身份或性格转变/)
  assert.match(readFileSync('public/skills/jc-juese-sheji/references/silhouette-shape.md', 'utf8'), /换装保留剪影锚点/)
})

test('retired engineering package is absent and shared director references remain packaged', () => {
  assert.equal(existsSync('public/skills/jc-gongchengjuben'), false)
  const index = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  assert.ok(!index.some(skill => skill.name === 'jc-gongchengjuben'))
  assert.ok(index.some(skill => skill.name === 'jc-shijiancuo-fenjing'))
  const seedance = index.find(skill => skill.name === 'jc-seedance')
  for (const name of ['kungfu-duel.md', 'shot-visibility.md', 'character-entrance.md', 'scene-rhythm.md']) {
    const path = `references/director/${name}`
    assert.ok(seedance.files.includes(path))
    assert.ok(existsSync(`public/skills/jc-seedance/${path}`))
  }
})
