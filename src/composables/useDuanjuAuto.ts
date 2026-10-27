/**
 * 短剧全自动·改编的桌面控制器：把 duanjuAuto 运行器接到工作台（发送消息、项目文件、审阅卡）。
 * 入稿回合结束后从「改编方案/执行进度.json」读取识别到的章节，用户在确认卡点“开始”后才逐步发指令。
 */
import { ref } from 'vue'
import { createDuanjuRun, runDuanjuAuto, DUANJU_AUTO_PATH, type DuanjuAutoConfig, type DuanjuProgress, type DuanjuRunState } from '@/runtime/duanjuAuto/autoRunner'
import { createRuntimeProjectFileService, createSkillDraftFiles } from '@/services/projectFileService'

const PROGRESS_PATH = '改编方案/执行进度.json'

export interface DuanjuAutoDraft {
  wikiRoot: string
  sourcePath: string
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
  const reviewing = ref(false)
  let session: { stopped: boolean } | undefined
  let reviewResolve: ((value: 'approved' | 'stopped') => void) | undefined

  const service = () => createRuntimeProjectFileService()
  const files = (owner: string) => createSkillDraftFiles(service(), owner)

  async function filePaths(owner: string) {
    return (await service().list(owner)).filter(resource => !resource.isDirectory).map(resource => String(resource.path))
  }
  async function readJson<T>(owner: string, path: string, paths?: string[]): Promise<T | undefined> {
    if (!(paths ?? await filePaths(owner)).includes(path)) return undefined
    return JSON.parse(await files(owner).readText(path)) as T
  }

  /** 入稿回合结束后（或切到全自动时）读取执行进度，弹出确认卡；onlyIfReady 时没有可用原文就不弹。 */
  async function prepare(prepareOptions: { onlyIfReady?: boolean } = {}) {
    const owner = options.owner()
    if (!owner) return
    error.value = ''
    try {
      const paths = await filePaths(owner)
      const wikiRoot = paths.find(path => path.endsWith(`/${PROGRESS_PATH}`))?.slice(0, -PROGRESS_PATH.length - 1)
        || (paths.some(path => path.startsWith('docs/wiki/')) ? 'docs/wiki' : 'wiki')
      const progress = await readJson<DuanjuProgress & { chapters?: Array<{ source_path: string; chapter_heading: string }> }>(owner, `${wikiRoot}/${PROGRESS_PATH}`, paths)
      const saved = await readJson<DuanjuRunState>(owner, `${wikiRoot}/${DUANJU_AUTO_PATH}`, paths)
      const resumable = saved && saved.status !== 'done' ? saved : undefined
      const chapters = progress?.chapters ?? []
      if (!chapters.length && !resumable) {
        if (!prepareOptions.onlyIfReady) error.value = '还没有入库的原文：请在全自动·改编模式下发送原文路径或全文。'
        return
      }
      draft.value = {
        wikiRoot,
        sourcePath: chapters[0]?.source_path ?? resumable?.config.sourcePath ?? '',
        chapters: chapters.length ? chapters.map(item => item.chapter_heading) : resumable?.config.chapters ?? [],
        saved: resumable,
      }
    } catch (cause) {
      error.value = `无法准备全自动改编：${cause instanceof Error ? cause.message : String(cause)}`
    }
  }

  async function start(config: DuanjuAutoConfig, resume = false) {
    const owner = options.owner()
    const current = draft.value
    if (!owner || !current || run.value?.status === 'running' || run.value?.status === 'review') return
    const { wikiRoot } = current
    const state: DuanjuRunState = { ...(resume && current.saved ? current.saved : createDuanjuRun(config)), runId: crypto.randomUUID() }
    const mine = { stopped: false }
    session = mine
    draft.value = null
    error.value = ''
    run.value = state
    try {
      await runDuanjuAuto(state, {
        send: options.sendText,
        readProgress: () => readJson<DuanjuProgress>(owner, `${wikiRoot}/${PROGRESS_PATH}`),
        async readScript(episode) {
          const path = `${wikiRoot}/剧本/第${String(episode).padStart(3, '0')}集/分集剧本.md`
          return (await filePaths(owner)).includes(path) ? await files(owner).readText(path) : undefined
        },
        async save(next) {
          if (session === mine) run.value = { ...next, episodes: [...next.episodes] }
          await files(owner).writeText(`${wikiRoot}/${DUANJU_AUTO_PATH}`, JSON.stringify(next, null, 2) + '\n')
        },
        awaitReview() {
          reviewing.value = true
          return new Promise(resolve => { reviewResolve = resolve })
        },
        shouldStop: () => mine.stopped,
      }).then(final => { if (session === mine) run.value = final })
    } catch (cause) {
      if (session === mine) {
        error.value = `全自动改编已暂停：${cause instanceof Error ? cause.message : String(cause)}`
        if (run.value) run.value = { ...run.value, status: 'stopped' }
      }
    } finally {
      if (session === mine) {
        stopping.value = false
        reviewing.value = false
      }
    }
  }

  function approveReview() {
    reviewing.value = false
    reviewResolve?.('approved')
  }

  function stop() {
    if (!session) return
    session.stopped = true
    if (run.value?.status === 'running') stopping.value = true
    if (reviewing.value) {
      reviewing.value = false
      reviewResolve?.('stopped')
    }
  }

  return { run, draft, error, stopping, reviewing, prepare, start, stop, approveReview, cancelDraft: () => { draft.value = null } }
}
