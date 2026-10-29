/**
 * 短剧全自动·改编的桌面控制器：把 duanjuAuto 运行器接到工作台（发送消息、项目文件）。
 * 入稿回合结束后从「改编方案/执行进度.json」读取识别到的章节，用户在确认卡选好预设、点“开始”后才逐轮发指令。
 * 分集剧本与切分卡由程序在保存标注时组装；重切让集数变少时，多出来的旧集号由这里删除对应文件。
 * 第一批的样集改完后暂停，用户在样集卡上选择继续、整体偏快/偏慢或停止（decideSample）。
 */
import { ref } from 'vue'
import { createDuanjuRun, resolveSampleReview, runDuanjuAuto, DUANJU_AUTO_PATH, type DuanjuAutoConfig, type DuanjuManifest, type DuanjuProgress, type DuanjuRunState, type SampleDecision } from '@/runtime/duanjuAuto/autoRunner'
import { readSourceChapters } from '@/runtime/duanjuAuto/sourceChapters'
import { createRuntimeProjectFileService, createSkillDraftFiles } from '@/services/projectFileService'

const PROGRESS_PATH = '改编方案/执行进度.json'
const MANIFEST_PATH = '改编方案/分集清单.json'

export interface DuanjuAutoDraft {
  wikiRoot: string
  /** 入稿登记的来源（章节点目录或原文文件）。 */
  sourcePaths: string[]
  /** 入稿识别到的章标题（短篇为 ['全文']）。 */
  chapters: string[]
  /** 未完成的上一次运行，可续做。 */
  saved?: DuanjuRunState
}

export function useDuanjuAuto(options: {
  owner: () => string | undefined
  /** 等当前回合结束后发送一条消息，并等待它的回合结束。 */
  sendText: (text: string) => Promise<void>
}) {
  const run = ref<DuanjuRunState | null>(null)
  const draft = ref<DuanjuAutoDraft | null>(null)
  const error = ref('')
  const stopping = ref(false)
  let session: { stopped: boolean } | undefined
  /** 同一时间只允许一个运行：续做或重复点击不会再起第二个运行器。 */
  let active = false
  let lastRoot = ''

  const service = () => createRuntimeProjectFileService()
  const files = (owner: string) => createSkillDraftFiles(service(), owner)

  async function filePaths(owner: string) {
    return (await service().list(owner)).filter(resource => !resource.isDirectory).map(resource => String(resource.path))
  }
  // 直接读，不用 list() 预判存在：dev_list_files 最多 1000 条且按目录名深度优先，
  // 20 集以上的项目里 项目资料/ 与 项目风格/ 会被截掉，读不到分集梗概就会误判「收尾未完成」。
  async function readJson<T>(owner: string, path: string): Promise<T | undefined> {
    try {
      return JSON.parse(await files(owner).readText(path)) as T
    } catch {
      return undefined
    }
  }
  async function readText(owner: string, path: string) {
    try {
      return await files(owner).readText(path)
    } catch {
      return undefined
    }
  }
  function wikiRootOf(paths: string[]) {
    const known = paths.find(path => path.endsWith(`/${PROGRESS_PATH}`) || path.endsWith(`/${MANIFEST_PATH}`))
    if (known) return known.slice(0, known.lastIndexOf('/改编方案/'))
    return paths.some(path => path.startsWith('docs/wiki/')) ? 'docs/wiki' : 'wiki'
  }

  /** 重切让集数变少时，删除多出来的旧集（分集剧本与切分），并从分集清单中清掉 stale。 */
  async function removeStale() {
    const owner = options.owner()
    if (!owner) return
    const resources = (await service().list(owner)).filter(resource => !resource.isDirectory)
    const paths = resources.map(resource => String(resource.path))
    const wikiRoot = wikiRootOf(paths)
    const manifest = await readJson<DuanjuManifest>(owner, `${wikiRoot}/${MANIFEST_PATH}`)
    if (!manifest?.stale?.length) return
    for (const episode of manifest.stale) {
      const folder = `第${String(episode).padStart(3, '0')}集`
      for (const path of [`${wikiRoot}/项目资料/分集剧本/第${episode}集分集剧本.md`, `${wikiRoot}/改编方案/分集切分/${folder}原文.md`, `${wikiRoot}/改编方案/切分卡/${folder}.md`]) {
        // 按父目录列，不用整树列表：1000 条上限会把 项目资料/ 截掉，导致 stale 集删不掉。
        const dir = path.slice(0, path.lastIndexOf('/'))
        const resource = (await service().listDirectory(owner, dir).catch(() => [])).find(item => !item.isDirectory && String(item.path) === path)
        if (resource) await service().remove(resource)
      }
    }
    await files(owner).writeText(`${wikiRoot}/${MANIFEST_PATH}`, JSON.stringify({ ...manifest, stale: [] }, null, 2) + '\n')
  }

  /** 入稿回合结束后（或切到全自动时）读取执行进度，弹出确认卡；onlyIfReady 时没有可用原文就不弹。 */
  async function prepare(prepareOptions: { onlyIfReady?: boolean } = {}) {
    const owner = options.owner()
    if (!owner) return
    error.value = ''
    try {
      const paths = await filePaths(owner)
      const wikiRoot = wikiRootOf(paths)
      const progress = await readJson<DuanjuProgress & { chapters?: Array<{ source_path: string; chapter_heading: string }>; source_inputs?: string[] }>(owner, `${wikiRoot}/${PROGRESS_PATH}`)
      const saved = await readJson<DuanjuRunState>(owner, `${wikiRoot}/${DUANJU_AUTO_PATH}`)
      // 早期版本（节拍数、没有时间账）的运行记录不提供续做，需要重新规划。
      const resumable = saved && saved.status !== 'done' && saved.version === 3 ? saved : undefined
      const registered = (progress?.chapters ?? []).map(item => item.chapter_heading)
      if (!registered.length && !resumable) {
        if (!prepareOptions.onlyIfReady) error.value = '还没有入库的原文：请在全自动·改编模式下发送原文路径或全文。'
        return
      }
      const sourcePaths = progress?.source_inputs ?? (progress?.chapters?.[0] ? [progress.chapters[0].source_path] : resumable?.config.sourcePaths ?? [])
      // 章节范围取原文里的全部章：执行进度只登记过首批读到的章，直接拿它会让可选范围越跑越窄。
      const chapters = await readSourceChapters(sourcePaths, {
        listDirectory: async path => await service().listDirectory(owner, path).catch(() => []),
        readText: async path => await files(owner).readText(path).catch(() => undefined),
      }, registered.length ? registered : resumable?.config.chapters ?? [])
      draft.value = { wikiRoot, sourcePaths, chapters, saved: resumable }
    } catch (cause) {
      error.value = `无法准备全自动改编：${cause instanceof Error ? cause.message : String(cause)}`
    }
  }

  async function start(config: DuanjuAutoConfig, resume = false, from?: DuanjuRunState) {
    const owner = options.owner()
    const current = draft.value
    if (active) return
    if (!owner || !(current || from)) return
    active = true
    const wikiRoot = current?.wikiRoot ?? lastRoot
    lastRoot = wikiRoot
    const state: DuanjuRunState = { ...(from ?? (resume && current?.saved ? current.saved : createDuanjuRun(config))), runId: crypto.randomUUID() }
    const mine = { stopped: false }
    session = mine
    draft.value = null
    error.value = ''
    // 全程用时：从点“开始”累计。
    const startedAt = Date.now(), base = state.elapsedMs ?? 0
    // 续做时立即显示运行中并清掉上次的暂停原因，避免误以为仍在暂停而再次点续做。
    run.value = { ...state, status: 'running', reason: undefined }
    try {
      await runDuanjuAuto(state, {
        async send(text) {
          await options.sendText(text)
          await removeStale()
        },
        readProgress: () => readJson<DuanjuProgress>(owner, `${wikiRoot}/${PROGRESS_PATH}`),
        readManifest: () => readJson<DuanjuManifest>(owner, `${wikiRoot}/${MANIFEST_PATH}`),
        readSummary: () => readText(owner, `${wikiRoot}/项目资料/原作/分集梗概.md`),
        async save(next) {
          next.elapsedMs = base + Date.now() - startedAt
          if (session === mine) run.value = { ...next }
          await files(owner).writeText(`${wikiRoot}/${DUANJU_AUTO_PATH}`, JSON.stringify(next, null, 2) + '\n')
        },
        shouldStop: () => mine.stopped,
      }).then(final => { if (session === mine) run.value = final })
    } catch (cause) {
      if (session === mine) {
        error.value = `全自动改编已暂停：${cause instanceof Error ? cause.message : String(cause)}`
        if (run.value) run.value = { ...run.value, status: 'stopped' }
      }
    } finally {
      if (session === mine) stopping.value = false
      active = false
    }
  }

  /** 样集确认：继续批量、整体偏快/偏慢（调节奏系数后重出样集）或停止。 */
  async function decideSample(decision: SampleDecision) {
    const current = run.value
    if (active || !current || current.status !== 'review') return
    const next = resolveSampleReview(current, decision)
    if (decision === 'stop') {
      run.value = next
      const owner = options.owner()
      if (owner && lastRoot) await files(owner).writeText(`${lastRoot}/${DUANJU_AUTO_PATH}`, JSON.stringify(next, null, 2) + '\n')
      return
    }
    await start(next.config, true, next)
  }

  /** 关闭已暂停、已停止或已完成的进度提示。 */
  function dismiss() {
    if (!active) run.value = null
  }

  function stop() {
    if (!session) return
    session.stopped = true
    if (run.value?.status === 'running') stopping.value = true
  }

  return { run, draft, error, stopping, prepare, start, decideSample, stop, dismiss, removeStale, isActive: () => active, cancelDraft: () => { draft.value = null } }
}
