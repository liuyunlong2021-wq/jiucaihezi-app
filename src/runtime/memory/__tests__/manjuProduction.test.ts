import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { test } from 'node:test'
import {
  MANJU_MODE,
  MANJU_SKILLS,
  WIKI_MEMORY_SKILL,
  restoreManjuSelection,
} from '../manjuProduction'
import { NOVEL_MODE, restoreNovelSelection } from '../novelProduction'

test('the production bundle includes both video routes and excludes the portrait skill', () => {
  assert.equal(MANJU_SKILLS.length, 17)
  assert.ok(MANJU_SKILLS.includes('jc-fuzhuang-prompt'), '服装换装随漫剧白名单内置')
  assert.ok(MANJU_SKILLS.includes('jc-renqun'), '人群群像随漫剧白名单内置')
  assert.ok(!MANJU_SKILLS.includes('jc-duanju'))
  assert.ok(MANJU_SKILLS.includes('h3-prompt-writing'))
  assert.ok(MANJU_SKILLS.includes('jc-seedance'))
  for (const name of ['cinematic-four-panel-frames', 'seedance-storyboard-assets', 'jc-shengyin-sheji', 'jc-shengyin-daoyan']) {
    assert.ok(MANJU_SKILLS.includes(name))
  }
  assert.ok(!MANJU_SKILLS.includes('jc-shuaigemeinv'))
  for (const name of MANJU_SKILLS.filter(name => name !== MANJU_MODE)) assert.ok(existsSync(`public/skills/${name}/SKILL.md`), name)
  const index = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  for (const name of MANJU_SKILLS.filter(name => name !== MANJU_MODE)) assert.ok(index.some((entry: { name: string }) => entry.name === name), name)
})

test('brainstorm stays independent and is removed from restored production selection', () => {
  assert.ok(!MANJU_SKILLS.includes('jc-manju-brainstorm'))
  assert.ok(MANJU_SKILLS.includes('jc-manju-pipeline'))
  const selected = [MANJU_MODE, 'jc-manju-brainstorm', WIKI_MEMORY_SKILL]
  assert.deepEqual(restoreManjuSelection(selected, { enabled: true }), [MANJU_MODE, WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreManjuSelection(selected, undefined), [MANJU_MODE, WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreManjuSelection(selected, { enabled: false }), [WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreManjuSelection(selected, { enabled: false, wikiMemoryWasSelected: false }), [])
})

test('brainstorm resources and delegated skills resolve inside the production package', () => {
  const root = resolve('public/skills')
  const index = JSON.parse(readFileSync(`${root}/index.json`, 'utf8'))
  const skill = index.find((entry: { name: string }) => entry.name === 'jc-manju-brainstorm')
  assert.ok(skill, 'brainstorm must be indexed')
  const declared = new Set(skill.package.files.map((file: { path: string }) => file.path))
  const pending = ['SKILL.md']
  const visited = new Set<string>()
  while (pending.length) {
    const resource = pending.pop()!
    if (visited.has(resource)) continue
    visited.add(resource)
    assert.ok(declared.has(resource), `unpackaged resource: ${resource}`)
    const path = resolve(root, skill.id, resource)
    const content = readFileSync(path, 'utf8')
    for (const match of content.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const target = resolve(dirname(path), match[1]!)
      assert.ok(existsSync(target), `missing reference: ${target}`)
      const [name, ...parts] = relative(root, target).split(/[\\/]/)
      assert.ok(existsSync(resolve(root, name!, 'SKILL.md')) || name === WIKI_MEMORY_SKILL, `missing independent reference: ${name}`)
      if (name === skill.id) pending.push(parts.join('/'))
    }
  }
  assert.deepEqual([...visited].sort(), [...declared].sort(), 'every brainstorm resource must be reachable')
})



test('character format requests accept existing character text and override ordinary continuation routing', () => {
  const format = readFileSync('public/skills/jc-juese-geshi/SKILL.md', 'utf8')
  assert.match(format, /已有角色文字提示词/)
  assert.match(format, /文字模式.*不要求.*参考图/)
  assert.match(format, /不声称.*看过.*图片/)
  assert.match(format, /不重新设计.*服装/)
  assert.match(format, /H3.*Seedance.*不属于/)
  assert.match(format, /此段身份描述适用于全部三格/)
  assert.match(format, /此段造型描述适用于全部三格/)
  assert.match(format, /不要求先生成单幅角色图/)
  assert.match(format, /不凭空附加参考图/)
  assert.doesNotMatch(format, /缺少参考图时只指出需先选定人物图/)
})


test('the composer retains the production entry without a model selector or model state', () => {
  const source = readFileSync('src/components/memory/MemoryWorkbench.vue', 'utf8')
  // 2026-10-25：按钮改为弹出模式菜单（提示词模式 / 全自动成片 / 退出），菜单项仍走 toggleManjuProduction。
  assert.match(source, /class="memory-manju-button"[^>]*@click="toggleManjuMenu\(\$event\)"/)
  assert.match(source, /function chooseManjuMode[\s\S]*?toggleManjuProduction\(\)/)
  assert.doesNotMatch(source, /memory-manju-model|manjuVideoModel|manjuModelSnapshot|changeManjuVideoModel/)
  for (const file of ['src/services/deepSeekHarness.ts', 'src/services/desktopConversationRuntime.ts']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /manjuVideoModel|ManjuVideoModel/)
  }
})

test('unsent toggle preferences survive reopening without leaking to a new conversation', () => {
  const legacyPreference = { enabled: true, videoModel: 'seedance-2.5' }
  assert.deepEqual(restoreManjuSelection(['wiki-memory'], legacyPreference), [MANJU_MODE, WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreManjuSelection([MANJU_MODE], { enabled: false }), [])
  assert.deepEqual(restoreManjuSelection([], undefined), [])
  assert.deepEqual(restoreManjuSelection(['jc-manju-minimaxh3'], undefined), [MANJU_MODE])
  assert.deepEqual(restoreManjuSelection(['jc-daoyan-fenjing'], undefined), ['jc-seedance'])
  assert.deepEqual(restoreManjuSelection([MANJU_MODE, 'jc-seedance', WIKI_MEMORY_SKILL], undefined), [MANJU_MODE, 'jc-seedance', WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreManjuSelection([MANJU_MODE, WIKI_MEMORY_SKILL], { enabled: false, wikiMemoryWasSelected: false }), [])
  assert.deepEqual(restoreManjuSelection([MANJU_MODE, WIKI_MEMORY_SKILL], { enabled: false, wikiMemoryWasSelected: true }), [WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreNovelSelection([], { enabled: true }), [NOVEL_MODE])
  assert.deepEqual(restoreNovelSelection([MANJU_MODE, WIKI_MEMORY_SKILL], { enabled: true }), [NOVEL_MODE, WIKI_MEMORY_SKILL])
  assert.deepEqual(
    restoreNovelSelection([NOVEL_MODE, 'skill-creator', WIKI_MEMORY_SKILL], { enabled: true }),
    [NOVEL_MODE, WIKI_MEMORY_SKILL],
  )
  assert.deepEqual(restoreNovelSelection([NOVEL_MODE, WIKI_MEMORY_SKILL], { enabled: false, wikiMemoryWasSelected: false }), [])
})


test('short drama restores explicitly selected route skills and removes them on exit', async () => {
  const { SHORT_DRAMA_SKILLS, restoreShortDramaSelection } = await import('../shortDramaProduction')
  const selected = ['production:short-drama', 'jc-duanju-cehua', WIKI_MEMORY_SKILL]
  assert.ok(SHORT_DRAMA_SKILLS.includes('jc-xiangmuziliao'))
  assert.deepEqual(restoreShortDramaSelection(selected, { enabled: true }), selected)
  assert.deepEqual(restoreShortDramaSelection(selected, { enabled: false }), [WIKI_MEMORY_SKILL])
  assert.deepEqual(restoreShortDramaSelection(selected, { enabled: false, wikiMemoryWasSelected: false }), [])
  assert.deepEqual(restoreShortDramaSelection(['jc-duanju', 'jc-seedance']), ['production:short-drama'])
})


test('short drama route resources are packaged and all delegated links resolve inside its scope', () => {
  const skills = JSON.parse(readFileSync('public/skills/production-skills.json', 'utf8'))['short-drama'] as string[]
  const index = JSON.parse(readFileSync('public/skills/index.json', 'utf8'))
  const allowed = new Set([...skills, 'wiki-memory'])
  for (const name of skills) {
    const entry = index.find((item: { name: string }) => item.name === name)
    assert.ok(entry?.package.files.some((file: { path: string }) => file.path === 'SKILL.md'), name)
    const path = resolve('public/skills', name, 'SKILL.md')
    for (const match of readFileSync(path, 'utf8').matchAll(/\]\(([^)]+\.md)\)/g)) {
      const target = resolve(dirname(path), match[1]!)
      assert.ok(existsSync(target), target)
      assert.ok(allowed.has(relative(resolve('public/skills'), target).split(/[\\/]/)[0]), target)
    }
  }
})


test('native Wiki remains independent of all three production Skill selections', async () => {
  const { needsProjectWiki, nativeWikiSelection, PROJECT_WIKI } = await import('../projectWiki')
  const { restoreShortDramaSelection } = await import('../shortDramaProduction')
  assert.deepEqual(nativeWikiSelection(['wiki-memory', PROJECT_WIKI, 'skill-creator']), [PROJECT_WIKI, 'skill-creator'])
  assert.deepEqual(restoreManjuSelection([], { enabled: true }), [MANJU_MODE])
  assert.deepEqual(restoreNovelSelection([], { enabled: true }), [NOVEL_MODE])
  assert.deepEqual(restoreShortDramaSelection([], { enabled: true }), ['production:short-drama'])
  for (const name of [MANJU_MODE, NOVEL_MODE, 'production:short-drama'])
    assert.equal(needsProjectWiki('继续', [name]), false)
  for (const name of [PROJECT_WIKI, 'wiki-memory']) assert.equal(needsProjectWiki('继续', [name]), true)
  assert.equal(needsProjectWiki('你好', []), false)
  assert.equal(needsProjectWiki('查询项目 Wiki', []), true)
})

test('full-auto mode is opt-in from the manju menu and only spends after the confirmation card', () => {
  const workbench = readFileSync('src/components/memory/MemoryWorkbench.vue', 'utf8')
  const panel = readFileSync('src/components/memory/ManjuAutoPanel.vue', 'utf8')
  const controller = readFileSync('src/composables/useManjuAuto.ts', 'utf8')
  assert.match(workbench, /chooseManjuMode\('prompt'\)[\s\S]*提示词模式[\s\S]*chooseManjuMode\('auto'\)[\s\S]*全自动成片/)
  assert.match(workbench, /const manjuAutoMode = ref\(false\)/, '默认提示词模式')
  assert.match(workbench, /autoIntake \? `\$\{AUTO_INTAKE_PREFIX\}/, '全自动模式下用户剧本先入稿拆集')
  assert.match(workbench, /path\.endsWith\('\.json'\)[\s\S]*manjuAuto\.handleArtifactSaved\(path\)/)
  assert.match(workbench, /@start="\(config, resume\) => manjuAuto\.start\(config, resume\)"/)
  // 付费调用只在 start() 里装配；prepare() 只读目录与 Wiki。
  const prepare = controller.slice(controller.indexOf('async function prepare'), controller.indexOf('async function start'))
  assert.doesNotMatch(prepare, /submit|runAuto/)
  assert.match(panel, /emit\('start'/)
  assert.match(panel, /<option value="new">每集有新资产就审（只看新图）<\/option>/)
  assert.match(panel, /reviewMode: reviewMode\.value/)
  // 审图可单独重新生成或改提示词重生成，重生成期间不能确认（2026-10-25 用户要求）。
  assert.match(panel, /emit\('regenerate', id\)/)
  assert.match(panel, /保存并重新生成/)
  assert.match(panel, /:disabled="anyBusy"/)
  assert.match(workbench, /@regenerate="\(id, prompt\) => manjuAuto\.regenerate\(id, prompt\)"/)
  assert.match(controller, /await regenerateAsset\(deps\.wikiRoot, id, deps\.asset, hash\)/)
  // 切换模式时没有分集剧本不弹卡，避免挡住待发送的剧本（2026-10-25 用户反馈）。
  assert.match(workbench, /manjuAuto\.prepare\(\{ onlyIfReady: true \}\)/)
  assert.match(controller, /onlyIfReady && !episodes\.length/)
  assert.match(readFileSync('src/runtime/manjuAuto/autoRunner.ts', 'utf8'), /遵守本对话入稿时用户提出的制作要求/)
  // 模型选项：与 @影音 同一默认顺序、去掉已退出面板的型号、视频只列可收参考图的、Seedance 优先、读全部分页。
  assert.match(controller, /prioritizedCreationModelIds\(kind\)/)
  assert.match(controller, /spec\?\.hidden/)
  assert.match(controller, /inputs\.includes\('image'\) \|\| Boolean\(spec\?\.files\?\.images\?\.max\)/)
  assert.match(controller, /\/seedance\/i/)
  assert.match(controller, /next_cursor/)
  // 目录查询网络超时沿用上次成功目录（dynamic 或 legacy），不把云端模型降级为只允许本机 ComfyUI（2026-10-25 实测）。
  const bridge = readFileSync('src/runtime/creation/creationMcpBridge.ts', 'utf8')
  assert.match(bridge, /lastDynamicCatalogs\.set\(catalogKey, result\)/)
  // 回归（2026-10-25 实测“参数不是 JSON 数据”）：目录缓存键不能把 undefined 交给 canonicalCreationJson。
  assert.doesNotMatch(bridge, /catalogKey = canonicalCreationJson/)
  assert.match(bridge, /params\[name\] \?\? null/)
  assert.match(bridge, /lastDynamicCatalogs\.set\(catalogKey, legacy\)/)
  assert.match(bridge, /!\(error instanceof CreationProtocolError\) && cached/)
  // 回归（2026-10-25 实测重启后“该能力当前不可执行”）：已确认 legacy 的服务端，网络抖动不降级为只允许本机 ComfyUI。
  assert.match(bridge, /const networkOnLegacy = !\(error instanceof CreationProtocolError\) && serverIsLegacy/)
  // 视频依次提交：桥暴露 submitted，桌面适配等上一段交给模型再交下一段。
  assert.match(bridge, /submitted: Boolean\(task\.upstreamTaskId\)/)
  assert.match(readFileSync('src/runtime/manjuAuto/desktopDeps.ts', 'utf8'), /async waitSubmitted\(taskId\)/)
  // 续做按确认卡上新的模型继续（生图线路故障后换模型）。
  assert.match(panel, /@click="startNew\(true\)"/)
  // 暂停原因直接显示，不只藏在悬停提示里（2026-10-25 用户反馈“看到暂停有点懵”）。
  assert.match(panel, /暂停原因：\{\{ episode\.reason \}\}/)
  // 视频分辨率可选、默认最低档，分档价格按所选档参与预算（2026-10-25 用户反馈 wan 无法选 480P）。
  assert.match(panel, /视频分辨率/)
  // H3 路线：确认卡选路线，模型限制（秒数、参考图张数）写进配置与每集指令（2026-10-25）。
  assert.match(panel, /<option value="H3">MiniMax H3 提示词<\/option>/)
  assert.match(panel, /limits: limits\.value/)
  assert.match(controller, /episodeInstruction\(episode, wikiRoot, state\.config\)/)
  assert.match(controller, /checkpointPath\(wikiRoot, state\.config\.videoModel, episode\)/)
  // 每次运行独立停止开关 + runId 落盘守卫：旧运行（含热更新遗留）发现记录属于新运行就退出（2026-10-25 实测两个运行互相覆盖）。
  assert.doesNotMatch(controller, /stopRequested/)
  assert.match(controller, /shouldStop: \(\) => mine\.stopped/)
  assert.match(controller, /onDisk\.runId !== next\.runId/)
  // 回归（2026-10-25 实测新运行把自己判成旧运行）：第一次保存先认领，不检查旧 runId。
  assert.match(controller, /const onDisk = claimed \? await readJson/)
  assert.match(controller, /runId: crypto\.randomUUID\(\)/)
  assert.match(panel, /videoResolution: videoResolution\.value/)
  assert.match(controller, /resolution: state\.config\.videoResolution/)
  // 设计系统没有 --danger，警示色必须用 --jc-error。
  assert.doesNotMatch(panel, /var\(--danger\)/)
  assert.match(workbench, /\.memory-manju-button\.auto \{[^}]*var\(--jc-error\)/)
})
