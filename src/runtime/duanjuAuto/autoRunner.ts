/**
 * 短剧全自动·改编：程序按批次逐步发指令，每步一个新回合，模型只做指令里的那一步。
 *
 * 每批：资料 → 规划（按每次读章数分段）→ 审阅（可关）→ 切分 → 逐集写作 → 收尾，然后下一批。
 * 每步结束读「执行进度.json」或本集剧本判断是否完成；未完成重发一次，仍不行就暂停并写明原因。
 * 运行状态落盘，停止后从原步骤续做，已完成的步骤不重做。
 */
export const DUANJU_AUTO_PATH = '改编方案/全自动运行.json'
export const DUANJU_INTAKE_PREFIX = '【全自动改编·入稿】'

export interface DuanjuAutoConfig {
  sourcePath: string
  /** 本次改编的章标题，按原文顺序；短篇为 ['全文']。 */
  chapters: string[]
  batchSize: number
  readSize: number
  /** 每批规划书完成后暂停给用户审阅。 */
  review: boolean
}

/** 执行进度.json 中本运行器关心的字段。 */
export interface DuanjuProgress {
  stage: string
  status?: string
  reason?: string
  chapters?: Array<{ chapter_heading: string }>
  planned_through?: string
  episodes?: number[]
}

type Phase = 'materials' | 'plan' | 'review' | 'cuts' | 'write' | 'finish'

export interface DuanjuRunState {
  version: 1
  runId?: string
  config: DuanjuAutoConfig
  status: 'running' | 'review' | 'blocked' | 'stopped' | 'done'
  reason?: string
  batch: number
  phase: Phase
  /** 规划段号或本批第几集（从 0 起）。 */
  index: number
  nextEpisode: number
  episodes: number[]
}

export interface DuanjuAutoDeps {
  /** 发送一条指令并等待模型回合结束。 */
  send(text: string): Promise<void>
  readProgress(): Promise<DuanjuProgress | undefined>
  readScript(episode: number): Promise<string | undefined>
  save(state: DuanjuRunState): Promise<void>
  /** 审阅卡：用户点确认返回 approved，点停止返回 stopped。 */
  awaitReview(): Promise<'approved' | 'stopped'>
  shouldStop(): boolean
}

export function createDuanjuRun(config: DuanjuAutoConfig): DuanjuRunState {
  return { version: 1, config, status: 'running', batch: 0, phase: 'materials', index: 0, nextEpisode: 1, episodes: [] }
}

const slices = (items: string[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))
const span = (items: string[]) => `「${items[0]}」至「${items.at(-1)}」`

interface Step { label: string; text: string; done: (before?: string) => Promise<boolean>; before?: () => Promise<string | undefined> }

function stepFor(state: DuanjuRunState, deps: DuanjuAutoDeps): Step {
  const { config } = state
  const batch = slices(config.chapters, config.batchSize)[state.batch]
  const pipeline = '按 jc-duanju-pipeline 的“全自动改编”执行'
  const progress = deps.readProgress
  if (state.phase === 'materials') return {
    label: '资料',
    text: `【全自动改编·资料】${span(batch)}：${pipeline}。先以 chapter_range（source_path 为 ${config.sourcePath}，from「${batch[0]}」，to「${batch.at(-1)}」）保存 source 进度，再整理这批章节的原作资料并保存 materials 进度，然后结束本回合。`,
    done: async () => { const p = await progress(); return p?.stage === 'materials' && p.chapters?.[0]?.chapter_heading === batch[0] && p.chapters.at(-1)?.chapter_heading === batch.at(-1) },
  }
  if (state.phase === 'plan') {
    const parts = slices(batch, config.readSize), part = parts[state.index], last = state.index === parts.length - 1
    const ending = last
      ? config.review ? '。这是本批最后一段：规划书完成后以 status review 保存 scheme 进度，等待用户审阅' : '。这是本批最后一段：以 running 保存 scheme 进度'
      : ''
    return {
      label: '规划',
      text: `【全自动改编·规划】${span(part)}：${pipeline}。读这几章，筛选事件、编集并追加到分集规划（第一段先写或修订项目总纲），保存 scheme 进度并写 planned_through 为「${part.at(-1)}」${ending}，然后结束本回合。`,
      done: async () => { const p = await progress(); return p?.stage === 'scheme' && p.planned_through === part.at(-1) && (!last || !config.review || p.status === 'review') },
    }
  }
  if (state.phase === 'cuts') return {
    label: '切分',
    text: `【全自动改编·切分】本批规划已确认。${pipeline}：按分集规划切分本批全部集，集号从${state.nextEpisode}起，保存 cuts 进度后结束本回合。`,
    done: async () => { const p = await progress(); return p?.stage === 'cuts' && p.episodes?.[0] === state.nextEpisode },
  }
  if (state.phase === 'write') {
    const episode = state.episodes[state.index]
    return {
      label: `第${episode}集`,
      text: `【全自动改编·第${episode}集】${pipeline}：按 jc-duanju-xiezuo 写第${episode}集剧本并补写本集新出现的改编版资料，保存后结束本回合；不保存 writing 进度。`,
      before: () => deps.readScript(episode),
      done: async before => { const after = await deps.readScript(episode); return after !== undefined && after !== before },
    }
  }
  return {
    label: '收尾',
    text: `【全自动改编·收尾】${pipeline}：保存 writing 进度（登记本批第${state.episodes[0]}–${state.episodes.at(-1)}集剧本，以及写作中改动过的改编版资料），再保存 complete 进度，然后结束本回合。`,
    done: async () => (await progress())?.stage === 'complete',
  }
}

function advance(state: DuanjuRunState, progress: DuanjuProgress | undefined) {
  const { config } = state
  const batch = slices(config.chapters, config.batchSize)[state.batch]
  if (state.phase === 'materials') Object.assign(state, { phase: 'plan', index: 0 })
  else if (state.phase === 'plan') {
    if (state.index < slices(batch, config.readSize).length - 1) state.index += 1
    else Object.assign(state, { phase: config.review ? 'review' : 'cuts', index: 0 })
  } else if (state.phase === 'cuts') Object.assign(state, { phase: 'write', index: 0, episodes: progress?.episodes ?? [] })
  else if (state.phase === 'write') {
    if (state.index < state.episodes.length - 1) state.index += 1
    else Object.assign(state, { phase: 'finish', index: 0 })
  } else if (state.phase === 'finish') {
    Object.assign(state, { nextEpisode: (state.episodes.at(-1) ?? state.nextEpisode - 1) + 1, episodes: [], batch: state.batch + 1, phase: 'materials', index: 0 })
    if (state.batch >= slices(config.chapters, config.batchSize).length) state.status = 'done'
  }
}

export async function runDuanjuAuto(initial: DuanjuRunState, deps: DuanjuAutoDeps): Promise<DuanjuRunState> {
  const state: DuanjuRunState = { ...initial, status: 'running', reason: undefined }
  while (state.status === 'running') {
    if (deps.shouldStop()) { state.status = 'stopped'; break }
    if (state.phase === 'review') {
      state.status = 'review'
      await deps.save(state)
      if (await deps.awaitReview() === 'stopped') { state.status = 'stopped'; break }
      Object.assign(state, { status: 'running', phase: 'cuts', index: 0 })
      continue
    }
    const step = stepFor(state, deps)
    let done = false, blocked = '', progress: DuanjuProgress | undefined
    for (let attempt = 0; attempt < 2 && !done && !blocked; attempt += 1) {
      const before = await step.before?.()
      await deps.send(step.text)
      progress = await deps.readProgress()
      if (progress?.status === 'blocked') blocked = `${step.label}：${progress.reason || '模型保存了 blocked'}`
      else done = await step.done(before)
    }
    if (!done) {
      Object.assign(state, { status: 'blocked', reason: blocked || `${step.label}未完成：重发一次后仍没有保存对应进度或剧本` })
      break
    }
    advance(state, progress)
    await deps.save(state)
  }
  await deps.save(state)
  return state
}
