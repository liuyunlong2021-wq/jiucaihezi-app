import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkEpisodeVideos, submitEpisodeVideos, videoRegistryPath, type VideoCheckpoint, type VideoSchedulerDeps } from '../videoScheduler'

type FakeTask = { status: string; localPath?: string; error?: string }

function fakeDeps(files: Record<string, string>) {
  const fs = new Map(Object.entries(files))
  const tasks = new Map<string, FakeTask>()
  const submits: Array<{ requestId: string; prompt: string; images: string[]; durationSeconds: number }> = []
  const deps: VideoSchedulerDeps = {
    async readText(path) {
      const text = fs.get(path)
      if (text === undefined) throw new Error(`missing ${path}`)
      return text
    },
    async writeText(path, content) { fs.set(path, content) },
    async exists(path) { return fs.has(path) },
    async submitVideo(input) {
      submits.push(input)
      const id = `v${submits.length}`
      tasks.set(id, { status: 'pending' })
      return id
    },
    async getTask(taskId) { return tasks.get(taskId) },
  }
  return { deps, fs, tasks, submits }
}

const wiki = 'wiki'
const seg1 = 'wiki/剧本/视频提示词/Seedance/第1集001视频提示词.md'
const seg2 = 'wiki/剧本/视频提示词/Seedance/第1集002视频提示词.md'
const prompts = {
  [seg1]: '# 第1集001视频提示词\n石道追问。\n@图1：石道\n@图2：莫甘娜',
  [seg2]: '书房对峙。\n@图1：莫甘娜',
}
const checkpoint: VideoCheckpoint = {
  episode_number: 1,
  video_model: 'Seedance',
  segments: [
    { path: seg1, start_seconds: 0, end_seconds: 27.5, refs: ['场景/石道', '角色/莫甘娜'] },
    { path: seg2, start_seconds: 27.5, end_seconds: 40, refs: ['角色/莫甘娜'] },
  ],
}
const images = { '角色/莫甘娜': '/p/莫甘娜.png', '场景/石道': '/p/石道.png' }
const registry = (fs: Map<string, string>) => JSON.parse(fs.get(`${wiki}/${videoRegistryPath('Seedance', 1)}`)!).segments

test('submits every segment with reference images in @图 order and rounded-up duration, without waiting', async () => {
  const { deps, fs, submits } = fakeDeps(prompts)
  await submitEpisodeVideos(wiki, checkpoint, images, deps)
  assert.equal(submits.length, 2)
  assert.deepEqual(submits[0].images, ['/p/石道.png', '/p/莫甘娜.png'])
  assert.equal(submits[0].prompt, '石道追问。\n@图1：石道\n@图2：莫甘娜')
  assert.equal(submits[0].durationSeconds, 28)
  assert.equal(submits[1].durationSeconds, 13)
  assert.deepEqual(registry(fs).map((s: { status: string }) => s.status), ['pending', 'pending'])
})

test('refuses to submit when a referenced image is missing', async () => {
  const { deps, submits } = fakeDeps(prompts)
  await assert.rejects(submitEpisodeVideos(wiki, checkpoint, { '角色/莫甘娜': '/p/a.png' }, deps), /场景\/石道/)
  assert.equal(submits.length, 0)
})

test('persisted video registry prevents re-submission after restart; changed image resubmits only that segment', async () => {
  const { deps, fs, submits } = fakeDeps(prompts)
  await submitEpisodeVideos(wiki, checkpoint, images, deps)
  const restarted = fakeDeps(Object.fromEntries(fs))
  await submitEpisodeVideos(wiki, checkpoint, images, restarted.deps)
  assert.equal(restarted.submits.length, 0)
  await submitEpisodeVideos(wiki, checkpoint, { ...images, '场景/石道': '/p/石道v2.png' }, restarted.deps)
  assert.equal(restarted.submits.length, 1)
  assert.deepEqual(restarted.submits[0].images, ['/p/石道v2.png', '/p/莫甘娜.png'])
  assert.equal(submits.length, 2)
})

test('single check pass: ready, still pending, one retry for failures, no retry for moderation', async () => {
  const { deps, fs, tasks, submits } = fakeDeps(prompts)
  await submitEpisodeVideos(wiki, checkpoint, images, deps)
  tasks.set('v1', { status: 'success', localPath: '/p/1.mp4' })
  tasks.set('v2', { status: 'failed', error: 'HTTP 500' })
  const first = await checkEpisodeVideos(wiki, checkpoint, deps)
  assert.equal(first.status, 'pending')
  assert.equal(submits.length, 3, '第二段重提一次')
  tasks.set('v3', { status: 'failed', error: 'HTTP 500' })
  const second = await checkEpisodeVideos(wiki, checkpoint, deps)
  assert.equal(second.status, 'failed')
  assert.deepEqual(second.failed, [2])
  assert.equal(submits.length, 3, '视频只重试 1 次')
  assert.equal(registry(fs)[1].attempts, 2)

  const other = fakeDeps(prompts)
  await submitEpisodeVideos(wiki, checkpoint, images, other.deps)
  other.tasks.set('v1', { status: 'success', localPath: '/p/1.mp4' })
  other.tasks.set('v2', { status: 'failed', error: '视频内容审核不通过' })
  const moderated = await checkEpisodeVideos(wiki, checkpoint, other.deps)
  assert.equal(moderated.status, 'failed')
  assert.equal(other.submits.length, 2)
})

test('ready episode returns local videos in segment order', async () => {
  const { deps, tasks } = fakeDeps(prompts)
  await submitEpisodeVideos(wiki, checkpoint, images, deps)
  tasks.set('v2', { status: 'success', localPath: '/p/2.mp4' })
  tasks.set('v1', { status: 'success' })
  assert.equal((await checkEpisodeVideos(wiki, checkpoint, deps)).status, 'pending', '文件未落盘不算完成')
  tasks.set('v1', { status: 'success', localPath: '/p/1.mp4' })
  const done = await checkEpisodeVideos(wiki, checkpoint, deps)
  assert.equal(done.status, 'ready')
  assert.deepEqual(done.videos, ['/p/1.mp4', '/p/2.mp4'])
})

test('model constraint failure on any segment blocks the whole episode before spending', async () => {
  const { deps, submits } = fakeDeps(prompts)
  deps.checkVideo = input => { if (input.durationSeconds > 15) throw new Error('片段 28 秒超过该模型最长 15 秒') }
  await assert.rejects(submitEpisodeVideos(wiki, checkpoint, images, deps), /最长 15/)
  assert.equal(submits.length, 0)
})
