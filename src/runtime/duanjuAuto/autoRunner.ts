/**
 * 短剧全自动·改编（时间账）：模型每轮只读一段章节（默认20章），同时写资产、事件文档并保存回合标注；
 * 程序当场按时间账切集、写切分卡和原文直出的分集剧本。之后模型按切分卡逐集改编（每轮约3集）。
 * 每批：规划×N →（首批）样集 → 等用户确认 → 逐集改编×M → 收尾（造型表回填集号、分集梗概）。
 * 每轮结束读分集清单判断是否完成；未完成重发一次，仍不行就暂停并写明原因。运行状态落盘，可停止续做。
 */
export const DUANJU_AUTO_PATH = '改编方案/全自动运行.json'
export const DUANJU_INTAKE_PREFIX = '【全自动改编·入稿】'

/** 一集的目标时长区间（秒）；程序按它和时间账为事件定集数。 */
export interface DuanjuRhythm {
  name: string
  min: number
  target: number
  max: number
}

/**
 * 三种预设（2026-10-28 调研）：平台规定单集不超过3分钟、建议约90秒（90秒完播率是3分钟以上的2.7倍），
 * 每20–30秒一处情绪节点；AI漫剧一章或半章对应一集、60–120秒。
 */
export const DUANJU_PRESETS = [
  { name: '快节奏爽剧', min: 60, target: 75, max: 90, suits: '逆袭、打脸、都市、系统流：一集一个爽点，切得密' },
  { name: '标准剧情', min: 75, target: 90, max: 120, suits: '多数网文改编、情感、悬疑：冲突与情绪均衡' },
  { name: '大场面奇幻', min: 90, target: 120, max: 150, suits: '玄幻、仙侠、末世、种田进化：一场大战或一次进化可独占一集' },
] as const

export interface DuanjuAutoConfig {
  /** 入稿登记的来源（章节点目录或原文文件），每批开头以 chapter_range 重新登记。 */
  sourcePaths: string[]
  /** 本次改编的章标题，按章号顺序；短篇为 ['全文']。 */
  chapters: string[]
  batchSize: number
  readSize: number
  rhythm: DuanjuRhythm
  /** false 只切分、不改编：分集剧本保持原文直出。 */
  adapt: boolean
  /** 第一批先改样集，等用户确认再批量。 */
  sample: boolean
  /** 每轮改编的集数。 */
  adaptSize: number
}

/** 执行进度.json 中本运行器关心的字段。 */
export interface DuanjuProgress {
  stage: string
  status?: string
  reason?: string
}

/** 分集清单（程序组装结果）中本运行器关心的字段。 */
export interface DuanjuManifest {
  planned_through?: string
  rhythm?: DuanjuRhythm & { pace?: number }
  events: Array<{
    event: string
    unfinished?: boolean
    start?: { chapter_heading: string }
    episodes?: [number, number]
    rounds?: Array<{ tier?: string }>
    plan?: Array<{ episode: number; planned_s: number; rounds: number[] }>
  }>
  /** 已改编（程序校验保存过 adapted）的集号。 */
  adapted?: number[]
  stale?: number[]
}

type Phase = 'plan' | 'sample' | 'review' | 'tune' | 'adapt' | 'finish'
export type SampleDecision = 'continue' | 'faster' | 'slower' | 'stop'

export interface DuanjuRunState {
  version: 3
  runId?: string
  config: DuanjuAutoConfig
  status: 'running' | 'blocked' | 'stopped' | 'review' | 'done'
  reason?: string
  batch: number
  phase: Phase
  /** 本批第几段（从 0 起）。 */
  index: number
  /** 本批第一章在 config.chapters 中的位置。 */
  batchFrom: number
  /** 已组装的集数。 */
  assembled?: number
  /** 已改编的集数。 */
  adapted?: number
  /** 样集已经确认，之后不再暂停。 */
  sampleDone?: boolean
  sampleEpisodes?: number[]
  /** 当前节奏系数，来自分集清单。 */
  pace?: number
  /** 调速回合的目标系数与方向。 */
  tune?: { pace: number; direction: 'faster' | 'slower' }
  /** 全程用时，由宿主累计。 */
  elapsedMs?: number
}

export interface DuanjuAutoDeps {
  /** 发送一条指令并等待模型回合结束。 */
  send(text: string): Promise<void>
  readProgress(): Promise<DuanjuProgress | undefined>
  readManifest(): Promise<DuanjuManifest | undefined>
  /** 读取分集梗概，用来判断收尾是否完成。 */
  readSummary(): Promise<string | undefined>
  save(state: DuanjuRunState): Promise<void>
  shouldStop(): boolean
}

export function createDuanjuRun(config: DuanjuAutoConfig): DuanjuRunState {
  return { version: 3, config, status: 'running', batch: 0, phase: 'plan', index: 0, batchFrom: 0 }
}

/** 样集确认：继续批量；整体偏快/偏慢则调节奏系数后重出样集；停止。 */
export function resolveSampleReview(state: DuanjuRunState, decision: SampleDecision): DuanjuRunState {
  if (decision === 'stop') return { ...state, status: 'stopped', reason: undefined }
  if (decision === 'continue') return { ...state, status: 'running', reason: undefined, phase: 'adapt', sampleDone: true }
  const pace = Math.round((state.pace ?? 1) * (decision === 'faster' ? 1.2 : 0.85) * 100) / 100
  return { ...state, status: 'running', reason: undefined, phase: 'tune', tune: { pace, direction: decision } }
}

const slices = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))
const batchOf = (state: DuanjuRunState) => state.config.chapters.slice(state.batchFrom, state.batchFrom + state.config.batchSize)
const span = (items: string[]) => `「${items[0]}」至「${items.at(-1)}」`
const assembledCount = (manifest: DuanjuManifest | undefined) => Math.max(0, ...(manifest?.events ?? []).flatMap(item => item.episodes ? [item.episodes[1]] : []))
const pendingEpisodes = (manifest: DuanjuManifest | undefined) => {
  const adapted = new Set(manifest?.adapted ?? [])
  return Array.from({ length: assembledCount(manifest) }, (_, i) => i + 1).filter(episode => !adapted.has(episode))
}
const PIPELINE = '按 jc-duanju-pipeline 的“全自动改编”执行'

/** 样集：第1集，加第一个含细写或决战回合的集（没有则取计划时长最大的集）。 */
function sampleEpisodes(manifest: DuanjuManifest | undefined): number[] {
  const plans = (manifest?.events ?? []).flatMap(event => (event.plan ?? []).map(entry => ({ entry, event })))
  if (!plans.length) return []
  const heavy = plans.find(({ entry, event }) => entry.rounds.some(index => ['细写', '决战'].includes(event.rounds?.[index]?.tier ?? '')))
  const longest = plans.reduce((best, item) => item.entry.planned_s > best.entry.planned_s ? item : best)
  return [...new Set([1, (heavy ?? longest).entry.episode])].sort((a, b) => a - b)
}

/** 梗概是否覆盖 1..total 的每个集号（支持“第3集”和“第3–5集”写法）。 */
function summaryCovers(summary: string | undefined, total: number): boolean {
  if (!summary) return false
  const covered = new Set<number>()
  for (const match of summary.matchAll(/第\s*(\d+)\s*(?:[–—\-~～至到]\s*(\d+)\s*)?集/g)) {
    const from = Number(match[1]), to = Number(match[2] ?? match[1])
    for (let episode = from; episode <= to && episode - from < 1000; episode += 1) covered.add(episode)
  }
  return Array.from({ length: total }, (_, i) => i + 1).every(episode => covered.has(episode))
}

/** 进度芯片文字：第几批、在做什么、已出几集、全程用时。 */
export function duanjuRunLabel(state: DuanjuRunState): string {
  const minutes = Math.floor((state.elapsedMs ?? 0) / 60_000)
  const time = minutes < 60 ? `${minutes}分钟` : `${Math.floor(minutes / 60)}小时${minutes % 60}分钟`
  const done = `已出${state.assembled ?? 0}集`
  if (state.status === 'done') return `全自动·改编 · 已完成 · ${done} · 用时${time}`
  let where = '收尾'
  if (state.phase === 'plan') {
    const part = slices(batchOf(state), Math.max(1, state.config.readSize))[state.index] ?? []
    where = part.length ? `读 ${part[0]} 至 ${part.at(-1)}` : '读'
  } else if (state.phase === 'sample') where = '改样集'
  else if (state.phase === 'review') where = '等你确认样集'
  else if (state.phase === 'tune') where = '调整节奏'
  else if (state.phase === 'adapt') where = `改编 · 已改编${state.adapted ?? 0}/${state.assembled ?? 0}集`
  const prefix = state.status === 'blocked' || state.status === 'stopped' ? '已暂停 · ' : ''
  return `全自动·改编 · ${prefix}第${state.batch + 1}批 · ${where} · ${done} · 用时${time}`
}

interface Step { label: string; text: string; done: () => Promise<boolean> }

function adaptText(label: '样集' | '改编', episodes: number[]) {
  const list = episodes.join('、')
  const note = label === '样集' ? '这是样集：先改这几集，用户会抽检节奏后再批量。' : ''
  return `【全自动改编·${label}】第${list}集：按 jc-gongchengjuben 的“短剧路线：按时间改编”执行。${note}先读每集的切分卡（改编方案/切分卡/第NNN集.md）、本集原文（项目资料/分集剧本）和出场资产，按切分卡里的时间预算删减、压缩对白、影视化，选改编策略（第1集优先考虑冷开场），逐场写 seconds 和 sources；用 wiki_save_artifact(engineering_script) 以 {"adapted":{…}} 保存，落到剧本/工程剧本/第N集工程剧本.md（漫剧只读这一份），按回执里的警告修正；然后结束本回合。`
}

async function stepFor(state: DuanjuRunState, deps: DuanjuAutoDeps, manifest: DuanjuManifest | undefined): Promise<Step | undefined> {
  const { config } = state
  const batch = batchOf(state)
  if (state.phase === 'plan') {
    const parts = slices(batch, config.readSize), part = parts[state.index], last = state.index === parts.length - 1
    const register = state.index === 0
      ? `先以 chapter_range（source_paths 为 ${JSON.stringify(config.sourcePaths)}，from「${batch[0]}」，to「${batch.at(-1)}」）保存 source 进度；${state.batch > 0 ? '上一批末尾未完的事件，先读它的事件文档，在同一事件里续写；' : ''}`
      : '上一段末尾标为未完的事件，先读它的事件文档，在同一事件里续写，整体重交；'
    const rhythm = JSON.stringify({ name: config.rhythm.name, min: config.rhythm.min, target: config.rhythm.target, max: config.rhythm.max })
    const ending = last ? '这是本批最后一段：仍未完的事件照样标 unfinished，下一批会从它的起始章开始读；如果它从本批第一章就开始，就在自然转折处拆成两个事件。' : ''
    return {
      label: '规划',
      text: `【全自动改编·规划】${span(part)}：${PIPELINE}。${register}只读这几章，一遍完成：写或更新角色（人物小传，含造型表起始行、声音特征、别名）、场景（含陈设、人群、别名）、重要道具（一档一件，不写汇总档）、世界规则（含能力的视觉规则）、故事梗概和项目总纲；按事件写事件文档（含回合表）；最后保存一份 adaptation_annotation（entity_name 写这几章的范围，planned_through 写「${part.at(-1)}」，首次保存带 rhythm ${rhythm}）：每个事件标起止行，并把事件划分成回合 rounds（局势每变化一次是一个回合，标行号、描述、结果、动作单元 units、档位 tier、是否钩子 hook、是否峰值 peak）；细写或决战档要写 why，确属一次连续冲突的长回合标 single；不进剧情的设定、重复、水文用跳过段 skip（必须写 reason）；按 jc-duanju-fenji 的时间账表估 units；段末未完的事件标 unfinished。程序会当场按时间账把已完成的事件切成分集，写切分卡和原文直出的分集剧本。${ending}不改写原文，然后结束本回合。`,
      done: async () => (await deps.readManifest())?.planned_through === part.at(-1),
    }
  }
  if (state.phase === 'sample' || state.phase === 'adapt') {
    const episodes = state.phase === 'sample' ? sampleEpisodes(manifest) : pendingEpisodes(manifest).slice(0, Math.max(1, config.adaptSize))
    state.sampleEpisodes = state.phase === 'sample' ? episodes : state.sampleEpisodes
    if (!episodes.length) return undefined
    const label = state.phase === 'sample' ? '样集' : '改编'
    return {
      label,
      text: adaptText(label, episodes),
      done: async () => { const adapted = new Set((await deps.readManifest())?.adapted ?? []); return episodes.every(episode => adapted.has(episode)) },
    }
  }
  if (state.phase === 'tune') {
    const tune = state.tune!
    return {
      label: '调速',
      text: `【全自动改编·调速】${PIPELINE}：用户觉得样集节奏${tune.direction === 'faster' ? '偏快' : '偏慢'}。保存一份 adaptation_annotation（entity_name 写「调整」）：{"replan":{"pace":${tune.pace}}}，程序会按新的节奏系数重新切集并清掉已改编标记；然后结束本回合。`,
      done: async () => Math.abs(((await deps.readManifest())?.rhythm?.pace ?? 1) - tune.pace) < 1e-6,
    }
  }
  return {
    label: '收尾',
    text: `【全自动改编·收尾】${PIPELINE}：读分集清单（改编方案/分集清单.json），把人物小传造型表里的起始行回填为集号，按每集的内容写本批的分集梗概（每集一条，写明“第N集”，覆盖到目前为止的全部集号），然后结束本回合。`,
    done: async () => summaryCovers(await deps.readSummary(), assembledCount(await deps.readManifest())),
  }
}

function advance(state: DuanjuRunState, manifest: DuanjuManifest | undefined) {
  const { config } = state
  const batch = batchOf(state)
  if (state.phase === 'plan') {
    if (state.index < slices(batch, config.readSize).length - 1) { state.index += 1; return }
    state.index = 0
    state.phase = !config.adapt ? 'finish' : config.sample && !state.sampleDone && sampleEpisodes(manifest).length ? 'sample' : 'adapt'
    return
  }
  if (state.phase === 'sample') { Object.assign(state, { phase: 'review', status: 'review' }); return }
  if (state.phase === 'tune') { Object.assign(state, { phase: 'sample', tune: undefined }); return }
  if (state.phase === 'adapt') { if (!pendingEpisodes(manifest).length) state.phase = 'finish'; return }
  // 批末有未完事件时，下一批从它的起始章开始读。
  const unfinished = manifest?.events.find(item => item.unfinished)?.start?.chapter_heading
  const carry = unfinished ? config.chapters.indexOf(unfinished, state.batchFrom) : -1
  const next = carry > state.batchFrom ? carry : state.batchFrom + batch.length
  Object.assign(state, { batch: state.batch + 1, phase: 'plan', index: 0, batchFrom: next })
  if (state.batchFrom >= config.chapters.length) state.status = 'done'
}

export async function runDuanjuAuto(initial: DuanjuRunState, deps: DuanjuAutoDeps): Promise<DuanjuRunState> {
  const state: DuanjuRunState = { ...initial, reason: undefined, status: initial.phase === 'review' ? 'review' : 'running' }
  state.batchFrom ??= state.batch * state.config.batchSize
  let manifest = await deps.readManifest()
  while (state.status === 'running') {
    if (deps.shouldStop()) { state.status = 'stopped'; break }
    const step = await stepFor(state, deps, manifest)
    if (!step) { advance(state, manifest); continue }
    let done = false, blocked = ''
    for (let attempt = 0; attempt < 2 && !done && !blocked; attempt += 1) {
      await deps.send(step.text)
      // 产物达标就算完成：模型可能按状态机规则顺手保存 blocked，不能因此丢掉已写好的收尾产物。
      done = await step.done()
      const progress = done ? undefined : await deps.readProgress()
      if (progress?.status === 'blocked') blocked = `${step.label}：${progress.reason || '模型保存了 blocked'}`
    }
    if (!done) {
      Object.assign(state, { status: 'blocked', reason: blocked || `${step.label}未完成：重发一次后仍没有保存对应标注、改编或分集梗概` })
      break
    }
    manifest = await deps.readManifest()
    state.assembled = assembledCount(manifest)
    state.adapted = (manifest?.adapted ?? []).filter(episode => episode <= state.assembled!).length
    state.pace = manifest?.rhythm?.pace ?? state.pace
    // 未完事件从本批第一章就开始时无法再顺延，否则会反复读同一批。
    const unfinished = manifest?.events.find(item => item.unfinished)?.start?.chapter_heading
    if (state.phase === 'finish' && unfinished && state.config.chapters.indexOf(unfinished, state.batchFrom) === state.batchFrom) {
      Object.assign(state, { status: 'blocked', reason: `事件从「${unfinished}」开始超过一整批，无法再顺延：请在自然转折处拆成两个事件后续做` })
      break
    }
    advance(state, manifest)
    await deps.save(state)
  }
  await deps.save(state)
  return state
}
