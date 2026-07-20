import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildMediaReferencePolicy,
  buildRecentTaskReferences,
  buildExplicitMediaReferences,
  createMediaContextSnapshot,
  extractProjectMediaReferencePaths,
  materializeMediaPlanReferences,
  normalizeProjectMediaReferencePath,
  projectResourceForMediaTask,
  reconcileProjectMediaReferences,
  refreshMediaPlanReferenceValues,
  refreshMediaReferenceValues,
  type MediaReference,
} from '../mediaReference'

const projectImage: MediaReference = {
  id: 'ref_project',
  kind: 'image',
  source: 'project',
  label: '人物海报.png',
  value: 'data:image/png;base64,cHJpdmF0ZQ==',
  explicit: true,
  locator: {
    type: 'project',
    runtime: 'web',
    owner: 'project-one',
    path: 'jc-media/images/人物海报.png',
  },
}

const recentImage: MediaReference = {
  id: 'ref_task_1',
  kind: 'image',
  source: 'task',
  label: '本对话生成图 1',
  value: 'https://cdn.example.com/output.png',
  explicit: false,
  locator: { type: 'task', taskId: 'mtask_1' },
}

test('media context keeps explicit references first and hides submission values from the model', () => {
  const snapshot = createMediaContextSnapshot({
    owner: 'project-one',
    sessionId: 'creative_one',
    explicitReferences: [projectImage, projectImage],
    recentReferences: [recentImage],
  })

  assert.deepEqual(
    snapshot.references.map(reference => reference.id),
    ['ref_project', 'ref_task_1'],
  )
  const policy = buildMediaReferencePolicy(snapshot)
  assert.match(policy, /ref_project.*人物海报\.png/)
  assert.match(policy, /ref_task_1.*本对话生成图 1/)
  assert.doesNotMatch(policy, /data:image|cdn\.example|jc-media/)
})

test('materialization always includes explicit references and validates model-selected ids', () => {
  const snapshot = createMediaContextSnapshot({
    owner: 'project-one',
    sessionId: 'creative_one',
    explicitReferences: [projectImage],
    recentReferences: [recentImage],
  })
  const plan = materializeMediaPlanReferences(
    {
      kind: 'video',
      title: '人物转身',
      prompt: '人物缓慢转身',
      modelId: 'newapi/zx/grok-1.5-video-6s',
      referenceIds: ['ref_task_1'],
    },
    snapshot,
  )

  assert.deepEqual(plan.referenceImages, [projectImage.value, recentImage.value])
  assert.equal(plan.mediaOwner, 'project-one')
  assert.deepEqual(
    plan.mediaReferences?.map(reference => reference.id),
    ['ref_project', 'ref_task_1'],
  )
  assert.throws(
    () =>
      materializeMediaPlanReferences(
        { ...plan, referenceImages: undefined, mediaReferences: undefined, referenceIds: ['fake'] },
        snapshot,
      ),
    /未知素材引用：fake/,
  )
})

test('recent task references are limited to the current session and project', () => {
  const references = buildRecentTaskReferences(
    [
      {
        id: 'one',
        type: 'image',
        status: 'success',
        resultUrl: 'https://cdn.example.com/one.png',
        sessionId: 'creative_one',
        directory: '/project-one',
        createdAt: 1,
      },
      {
        id: 'two',
        type: 'image',
        status: 'success',
        resultUrl: 'https://cdn.example.com/two.png',
        sessionId: 'creative_one',
        directory: '/project-one',
        createdAt: 2,
      },
      {
        id: 'running',
        type: 'image',
        status: 'running',
        resultUrl: 'https://cdn.example.com/running.png',
        sessionId: 'creative_one',
        directory: '/project-one',
        createdAt: 3,
      },
      {
        id: 'other-project',
        type: 'image',
        status: 'success',
        resultUrl: 'https://cdn.example.com/private.png',
        sessionId: 'creative_one',
        directory: '/project-two',
        createdAt: 4,
      },
    ],
    { owner: '/project-one', sessionId: 'creative_one' },
  )

  assert.deepEqual(
    references.map(reference => reference.id),
    ['ref_task_one', 'ref_task_two'],
  )
  assert.deepEqual(
    references.map(reference => reference.label),
    ['本对话生成图 1', '本对话生成图 2'],
  )
  assert.equal(
    references.every(reference => reference.explicit === false),
    true,
  )
})

test('completed task locators prefer their persisted project resource', () => {
  assert.deepEqual(
    projectResourceForMediaTask({
      id: 'web-task',
      type: 'image',
      status: 'success',
      createdAt: 1,
      projectId: 'project-one',
      projectPath: 'jc-media/images/result.png',
    }),
    {
      runtime: 'web',
      owner: 'project-one',
      path: 'jc-media/images/result.png',
      name: 'result.png',
      isDirectory: false,
      kind: 'media',
    },
  )
  assert.deepEqual(
    projectResourceForMediaTask({
      id: 'desktop-task',
      type: 'video',
      status: 'success',
      createdAt: 1,
      directory: 'C:\\Users\\me\\project',
      assetUri: 'C:\\Users\\me\\project\\jc-media\\videos\\result.mp4',
    }),
    {
      runtime: 'desktop',
      owner: 'C:\\Users\\me\\project',
      path: 'jc-media/videos/result.mp4',
      name: 'result.mp4',
      isDirectory: false,
      kind: 'media',
    },
  )
  assert.equal(
    projectResourceForMediaTask({
      id: 'remote-task',
      type: 'image',
      status: 'success',
      createdAt: 1,
      resultUrl: 'https://cdn.example.com/result.png',
    }),
    null,
  )
})

test('explicit project and canvas media retain project identity', () => {
  const references = buildExplicitMediaReferences('message_one', [
    {
      name: '项目图.png',
      kind: 'image',
      value: 'data:image/png;base64,cHJvamVjdA==',
      source: 'project',
      resource: {
        runtime: 'web',
        owner: 'project-one',
        path: 'images/项目图.png',
        name: '项目图.png',
        isDirectory: false,
        kind: 'media',
      },
    },
    {
      name: '粘贴图片.png',
      kind: 'image',
      value: 'data:image/png;base64,cGFzdGU=',
      source: 'attachment',
    },
  ])

  assert.deepEqual(references[0].locator, {
    type: 'project',
    runtime: 'web',
    owner: 'project-one',
    path: 'images/项目图.png',
    id: undefined,
  })
  assert.deepEqual(references[1].locator, {
    type: 'attachment',
    messageId: 'message_one',
    index: 1,
  })
  assert.equal(
    references.every(reference => reference.explicit),
    true,
  )
})

test('project media paths require an exact path or explicit reference syntax', () => {
  assert.deepEqual(extractProjectMediaReferencePaths('jc-media/images/人物 海报.png'), [
    'jc-media/images/人物 海报.png',
  ])
  assert.deepEqual(
    extractProjectMediaReferencePaths('请用 @{jc-media/images/人物 海报.png} 生成视频'),
    ['jc-media/images/人物 海报.png'],
  )
  assert.deepEqual(extractProjectMediaReferencePaths('请做一张名为 hero.png 的图片'), [])
})

test('project media paths normalize safely on macOS, Windows and Web', () => {
  assert.equal(
    normalizeProjectMediaReferencePath(
      '/Users/me/project/jc-media/images/人物.png',
      '/Users/me/project',
      'desktop',
    ),
    'jc-media/images/人物.png',
  )
  assert.equal(
    normalizeProjectMediaReferencePath(
      'C:\\Users\\me\\project\\jc-media\\images\\人物.png',
      'c:\\Users\\me\\project',
      'desktop',
    ),
    'jc-media/images/人物.png',
  )
  assert.equal(
    normalizeProjectMediaReferencePath('jc-media/images/人物.png', 'project-one', 'web'),
    'jc-media/images/人物.png',
  )
  assert.equal(
    normalizeProjectMediaReferencePath('/Users/me/other/人物.png', '/Users/me/project', 'desktop'),
    null,
  )
  assert.equal(normalizeProjectMediaReferencePath('../other/人物.png', 'project-one', 'web'), null)
})

test('project rename updates active references and deletion invalidates them', () => {
  const renamed = reconcileProjectMediaReferences([projectImage], {
    type: 'renamed',
    oldResource: {
      runtime: 'web',
      owner: 'project-one',
      path: 'jc-media/images/人物海报.png',
      name: '人物海报.png',
      isDirectory: false,
      kind: 'media',
    },
    resource: {
      runtime: 'web',
      owner: 'project-one',
      path: 'jc-media/images/新名字.png',
      name: '新名字.png',
      isDirectory: false,
      kind: 'media',
    },
  })
  assert.equal(renamed[0].label, '新名字.png')
  assert.equal(
    renamed[0].locator.type === 'project' && renamed[0].locator.path,
    'jc-media/images/新名字.png',
  )

  const deleted = reconcileProjectMediaReferences(renamed, {
    type: 'deleted',
    resource: {
      runtime: 'web',
      owner: 'project-one',
      path: 'jc-media/images/新名字.png',
      name: '新名字.png',
      isDirectory: false,
      kind: 'media',
    },
  })
  assert.equal(deleted[0].invalidReason, '项目素材已删除')
  assert.throws(
    () =>
      materializeMediaPlanReferences(
        {
          kind: 'video',
          title: '不能提交',
          prompt: '生成视频',
          modelId: 'newapi/zx/grok-1.5-video-6s',
          referenceIds: ['ref_project'],
        },
        createMediaContextSnapshot({
          owner: 'project-one',
          sessionId: 'creative_one',
          explicitReferences: deleted,
        }),
      ),
    /项目素材已删除/,
  )
})

test('submission refreshes project and task values from their authoritative sources', async () => {
  const refreshed = await refreshMediaReferenceValues([projectImage, recentImage], {
    readProject: async locator => `project://${locator.owner}/${locator.path}`,
    readTask: async taskId => `task://${taskId}`,
  })

  assert.deepEqual(
    refreshed.map(reference => reference.value),
    ['project://project-one/jc-media/images/人物海报.png', 'task://mtask_1'],
  )
  await assert.rejects(
    () =>
      refreshMediaReferenceValues([recentImage], {
        readProject: async () => '',
        readTask: async () => '',
      }),
    /参考素材已失效：本对话生成图 1/,
  )
})

test('submission preserves legacy plans that predate app-owned media references', async () => {
  const legacy = {
    kind: 'video' as const,
    title: '历史图生视频',
    prompt: '让人物转身',
    modelId: 'newapi/zx/grok-1.5-video-6s',
    referenceImages: ['data:image/png;base64,bGVnYWN5'],
  }

  const refreshed = await refreshMediaPlanReferenceValues(legacy, {
    readProject: async () => {
      throw new Error('legacy plan must not resolve project locators')
    },
    readTask: async () => {
      throw new Error('legacy plan must not resolve task locators')
    },
  })

  assert.equal(refreshed, legacy)
  assert.deepEqual(refreshed.referenceImages, legacy.referenceImages)
})
