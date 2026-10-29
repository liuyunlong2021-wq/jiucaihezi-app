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
  assert.equal(MANJU_SKILLS.length, 16)
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
  const format = readFileSync('public/skills/jc-juese-sheji/SKILL.md', 'utf8')
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
  // 2026-10-25：按钮改为弹出模式菜单（2026-10-26 起：自由创作 / 全自动·到提示词 / 全自动·到成片 / 退出），菜单项仍走 toggleManjuProduction。
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
  // 借用的设计Skill只取设计方法，其原有漫剧交接链接（如角色格式）可指向漫剧范围。
  const borrowed = new Set(['jc-juese-sheji', 'jc-fuzhuang-prompt', 'jc-scene-prompt', 'jc-prop-prompt'])
  const manju = new Set(JSON.parse(readFileSync('public/skills/production-skills.json', 'utf8')).manju as string[])
  for (const name of skills) {
    const entry = index.find((item: { name: string }) => item.name === name)
    assert.ok(entry?.package.files.some((file: { path: string }) => file.path === 'SKILL.md'), name)
    const path = resolve('public/skills', name, 'SKILL.md')
    for (const match of readFileSync(path, 'utf8').matchAll(/\]\(([^)]+\.md)\)/g)) {
      const target = resolve(dirname(path), match[1]!)
      assert.ok(existsSync(target), target)
      const owner = relative(resolve('public/skills'), target).split(/[\\/]/)[0]!
      assert.ok(allowed.has(owner) || borrowed.has(name) && manju.has(owner), target)
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
  // 2026-10-26：三种用法——自由创作 / 全自动·到提示词 / 全自动·到成片，默认自由创作。
  assert.match(workbench, /mode: 'free', label: '自由创作'[\s\S]*mode: 'prompts', label: '全自动·到提示词'[\s\S]*mode: 'film', label: '全自动·到成片'/)
  assert.match(workbench, /const manjuMode = ref<'free' \| 'prompts' \| 'film'>\('free'\)/, '默认自由创作')
  // 按钮写明是否全自动，避免把到提示词误当自由创作（2026-10-26 用户要求）。
  assert.match(workbench, /const manjuModeLabels = \{ free: '漫剧·自由', prompts: '全自动·到提示词', film: '全自动·到成片' \}/)
  assert.match(workbench, /:target="manjuMode === 'prompts' \? 'prompts' : 'film'"/)
  // 到提示词不读模型参数、不显示生图与预算；每集标出已有进度能否复用。
  assert.match(controller, /const media = state\.config\.target !== 'prompts'/)
  assert.match(panel, /<label v-if="film && !pureText" class="manju-auto-row"><span>生图模型/)
  // 参考图（2026-10-26 用户确认）：按段决定或纯文生；纯文生即 max_refs 为 0，不选生图模型、不审图。
  assert.match(panel, /return pureText\.value \? \{ \.\.\.base, max_refs: 0 \} : base/)
  assert.match(panel, /pureText\.value = last\.limits\?\.max_refs === 0/)
  // 项目风格里的参考图建议（2026-10-26 用户确认）：确认卡优先按它预选，并显示要生几张图、约多少钱。
  assert.match(controller, /advice: referenceAdvice\(style\)/)
  assert.match(panel, /if \(draft\.advice\.mode\) pureText\.value = draft\.advice\.mode === 'pure'/)
  assert.match(panel, /adviceSummary\(props\.draft\.advice, imageModel\.value\?\.price\)/)
  const style = readFileSync('public/skills/jc-film-style/SKILL.md', 'utf8')
  assert.match(style, /参考图方式：纯文生或按段决定/)
  assert.match(style, /参考图：需要或文字带过/)
  const pipeline = readFileSync('public/skills/jc-manju-pipeline/SKILL.md', 'utf8')
  assert.match(pipeline, /入稿[\s\S]*参考图方式[\s\S]*风险/)
  assert.match(panel, /episodeTextStatus\(props\.draft\?\.checkpoints\[route\.value\]\[episode\], limits\.value\)/)
  // 确认卡默认沿用上一次运行（含已完成的）的模型、路线、分辨率、预算与审图方式。
  assert.match(controller, /last: saved\?\.config/)
  assert.match(panel, /const last = draft\.saved\?\.config \?\? draft\.last/)
  // 审片（2026-10-26 用户要求）：拼接前逐段看，可单段重生成或改提示词，重生成期间不能确认。
  assert.match(panel, /审核第 \{\{ cutReview\.episode \}\} 集视频片段/)
  assert.match(panel, /emit\('regenerateSegment', index\)/)
  assert.match(panel, /:disabled="anyBusy"[^>]*@click="emit\('approveCut'\)"/)
  assert.match(workbench, /@approve-cut="manjuAuto\.approveCut"/)
  assert.match(controller, /await resubmitSegment\(deps\.wikiRoot, checkpoint, index, deps\.video\)/)
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
  // 入稿回合失败或被停止时不弹确认卡，只留错误提示（2026-10-26 用户反馈：500 后仍弹“还没有分集剧本”）。
  assert.match(workbench, /pendingAutoIntake = false\n  if \(activeRun\.value\?\.phase === 'done'\) void manjuAuto\.prepare\(\)/)
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
  // 回归（2026-10-25 实测）：有未完成运行时路线下拉被锁，无法改用 H3 重新开始。
  assert.doesNotMatch(panel, /v-model="route" :disabled/)
  assert.match(controller, /episodeInstruction\(episode, wikiRoot, state\.config, rewrite, undefined, scripts\[episode\]\)/)
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

test('short-drama full-auto adaptation is opt-in from the short-drama menu and drives batches from the confirmation card', () => {
  const workbench = readFileSync('src/components/memory/MemoryWorkbench.vue', 'utf8')
  const panel = readFileSync('src/components/memory/DuanjuAutoPanel.vue', 'utf8')
  const controller = readFileSync('src/composables/useDuanjuAuto.ts', 'utf8')
  // 2026-10-27：自由改编（默认）/ 全自动·改编 / 退出。
  assert.match(workbench, /const duanjuMode = ref<'free' \| 'auto'>\('free'\)/)
  assert.match(workbench, /mode: 'free', label: '自由改编'[\s\S]*mode: 'auto', label: '全自动·改编'/)
  assert.match(workbench, /退出短剧改编/)
  // 全自动模式下发送的原文先走入稿回合，回合结束后弹确认卡。
  assert.match(workbench, /DUANJU_INTAKE_PREFIX/)
  assert.match(workbench, /<DuanjuAutoPanel/)
  assert.match(controller, /runDuanjuAuto/)
  assert.match(controller, /改编方案\/执行进度\.json/)
  // 确认卡：章节范围、每批章数（默认100）、每次读章数（默认20）、续做。
  assert.match(panel, /每批章数/)
  assert.match(panel, /每次读章数/)
  assert.match(panel, /batchSize = ref\(100\)/)
  assert.match(panel, /readSize = ref\(20\)/)
  assert.match(panel, /续做/)
  // 实测修正（2026-10-27）：续做时立即显示运行中、清掉旧原因；同一时间只允许一个运行；暂停提示可以关闭。
  assert.match(controller, /run\.value = \{ \.\.\.state, status: 'running', reason: undefined \}/)
  assert.match(controller, /if \(active\) return/)
  assert.match(panel, /emit\('dismiss'\)/)
  // 2026-10-27 用户要求：进度显示为输入框上方的芯片（同已选 Skill），停止统一用输入框右下角按钮，芯片显示全程用时。
  assert.match(workbench, /class="memory-attachment-chip memory-duanju-chip"/)
  assert.match(workbench, /duanjuAuto\.stop\(\)/)
  assert.match(workbench, /v-if="!sending && duanjuActive"/)
  assert.match(controller, /elapsedMs/)
  assert.doesNotMatch(panel, /class="duanju-auto-progress"/)
  // 一遍标注与程序组装（2026-10-28）：开始前选三种预设之一，不再有风格与分集审阅卡；分集清单保存后删除旧集文件。
  assert.match(panel, /DUANJU_PRESETS/)
  assert.match(panel, /v-model="preset"/)
  assert.doesNotMatch(panel, /请选择项目风格|请决定每个事件切几集/)
  assert.match(controller, /removeStale/)
  assert.match(workbench, /改编方案[\s\S]{0,4}标注[\s\S]{0,40}duanjuAuto\.removeStale\(\)/)
  // 时间账与逐集改编（2026-10-28）：确认卡有样集先行、每轮改编集数、只切分不改编；样集确认卡；删除多余集时一并删切分卡。
  assert.match(panel, /样集先行/)
  assert.match(panel, /每轮改编集数/)
  assert.match(panel, /只切分/)
  assert.match(panel, /整体偏快[\s\S]*整体偏慢/)
  assert.match(panel, /emit\('review'/)
  assert.match(panel, /目标秒数/)
  assert.match(workbench, /@review="decision => duanjuAuto\.decideSample\(decision\)"/)
  assert.match(controller, /decideSample/)
  assert.match(controller, /改编方案\/切分卡\//)
  assert.match(controller, /version === 3/)
  const pipeline = readFileSync('public/skills/jc-duanju-pipeline/SKILL.md', 'utf8')
  assert.match(pipeline, /## 全自动改编/)
  assert.match(pipeline, /【全自动改编·入稿】/)
})

test('缺比例与风格时确认卡给出确认入口，不猜默认比例', () => {
  const workbench = readFileSync('src/components/memory/MemoryWorkbench.vue', 'utf8')
  const panel = readFileSync('src/components/memory/ManjuAutoPanel.vue', 'utf8')
  const controller = readFileSync('src/composables/useManjuAuto.ts', 'utf8')
  // 2026-10-28 实测：短剧路线不产 项目风格/影片比例与风格.md，漫剧全自动却要求它已确认，卡上没有补救入口。
  assert.match(panel, /项目风格里还没有确认影片比例/)
  assert.match(panel, /去确认比例与风格/)
  assert.match(panel, /emit\('confirmStyle'\)/)
  assert.match(controller, /async function confirmStyle/)
  assert.match(controller, /jc-film-style/)
  assert.match(controller, /项目风格\/影片比例与风格\.md/)
  // 指令开头不能带「全自动成片」：模型会当成流水线步骤，转去保存 pipeline_checkpoint（2026-10-28 实测）。
  assert.match(controller, /【项目风格】/)
  assert.match(controller, /不保存 pipeline_checkpoint/)
  assert.doesNotMatch(controller, /【全自动成片·风格】/)
  // 扫不到剧本时把扫描根与命中集数写出来，避免只看到一句「还没有分集剧本」。
  assert.match(panel, /第N集分集剧本\.md/)
  assert.match(panel, /draft\.owner/)
  // dev_list_files 上限 1000 条，大项目的剧本／风格／进度会被截断；prepare 必须按关键字补扫（2026-10-28 E:\1028全自动教程 实测）。
  assert.match(controller, /service\.searchPaths\(owner, query, 2000\)/)
  assert.match(controller, /1000 条/)
  assert.match(workbench, /@confirm-style="manjuAuto\.confirmStyle"/)
  // 比例决定后续所有生图与生视频，必须用户确认，不填默认值。
  assert.doesNotMatch(controller, /ratio \?\?/)
  assert.doesNotMatch(panel, /ratio \?\?/)
})

test('项目文件超过 1000 条时，判定存在不能再依赖整树列表', () => {
  const manju = readFileSync('src/composables/useManjuAuto.ts', 'utf8')
  const duanju = readFileSync('src/composables/useDuanjuAuto.ts', 'utf8')
  // dev_list_files 每条目录也占额度、按目录名深度优先：1010 个文件的项目里
  // 列表止于 wiki/资产/*，项目资料、项目风格全部丢失（2026-10-28 E:\1028全自动教程 实测）。
  assert.match(manju, /service\.searchPaths\(owner, query, 2000\)/)
  assert.doesNotMatch(manju, /const list = await createRuntimeProjectFileService\(\)\.list\(owner\)/)
  // 梗概读不到就会把「收尾已完成」误判成未完成；进度读不到就会重做已完成集。
  assert.doesNotMatch(duanju, /if \(!\(paths \?\? await filePaths\(owner\)\)\.includes\(path\)\) return undefined/)
  assert.doesNotMatch(duanju, /return \(await filePaths\(owner\)\)\.includes\(path\) \? await files\(owner\)\.readText\(path\) : undefined/)
  // 删 stale 集时按父目录列，绕开整树上限。
  assert.match(duanju, /listDirectory\(owner, dir\)/)
})
