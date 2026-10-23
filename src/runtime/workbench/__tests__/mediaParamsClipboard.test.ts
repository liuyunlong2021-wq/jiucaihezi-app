import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applyMediaParamsToPlan,
  buildMediaParamsText,
  kindFromLabel,
  matchCreationModelByLabel,
  parseMediaParamsText,
} from '../mediaParamsClipboard'
import { parseMediaPlan } from '../mediaPlan'

test('复制出的文本能被自己解析回来（图片 / 文生图 / 比例 / 价格）', () => {
  const text = buildMediaParamsText({
    kind: 'image',
    modelLabel: 'Midjourney Relax Imagine',
    mode: 'text-to-image',
    ratio: '9:16',
    price: '0.2/张',
  })
  assert.equal(
    text,
    '[创作参数] 图片 | Midjourney Relax Imagine | 文生图 | 比例 9:16 | 价格 0.2/张\n\n提示词：',
  )
  assert.deepEqual(parseMediaParamsText(text), {
    kindLabel: '图片',
    modelLabel: 'Midjourney Relax Imagine',
    modeLabel: '文生图',
    ratio: '9:16',
    price: '0.2/张',
  })
})

test('视频参数带时长与分辨率，且能容错解析', () => {
  const text = buildMediaParamsText({
    kind: 'video',
    modelLabel: 'jc-MiniMax H3 参考生视频',
    mode: 'image-to-video',
    ratio: '16:9',
    resolution: '720p',
    duration: 5,
    price: '0.2/秒',
  })
  const parsed = parseMediaParamsText(text)
  assert.equal(parsed?.ratio, '16:9')
  assert.equal(parsed?.resolution, '720p')
  assert.equal(parsed?.duration, 5)

  // 用户手工改过空格/去掉价格，也照旧认得
  const relaxed = parseMediaParamsText('[创作参数] 视频|jc-MiniMax H3 参考生视频|图生视频 | 时长 8s\n提示词：')
  assert.equal(relaxed?.modelLabel, 'jc-MiniMax H3 参考生视频')
  assert.equal(relaxed?.duration, 8)
  assert.equal(relaxed?.price, undefined)
})

test('没有前缀的普通聊天不做任何解析', () => {
  assert.equal(parseMediaParamsText('帮我生成一张图'), null)
  assert.equal(parseMediaParamsText(''), null)
  assert.equal(parseMediaParamsText('[创作参数]'), null)
})

test('显示名反查只认可见模型', () => {
  assert.equal(matchCreationModelByLabel('Midjourney Relax Imagine'), 'newapi/t8/mj_relax_imagine')
  assert.equal(matchCreationModelByLabel('midjourney relax imagine'), 'newapi/t8/mj_relax_imagine')
  // 隐藏型号（GPT2.0 图生图）不在可见目录里，不能被粘进来
  assert.equal(matchCreationModelByLabel('GPT2.0 图生图'), '')
  assert.equal(matchCreationModelByLabel('不存在的模型'), '')
})

test('★ 粘贴的参数强制覆盖计划：模型、比例、时长都按用户的来', () => {
  const plan = parseMediaPlan('```jc-media-plan\n' + JSON.stringify({
    kind: 'image', title: '女网红写真', prompt: '一个中国女网红',
  }) + '\n```')
  assert.equal(plan.usesProductDefaultModel, true)

  const pinned = applyMediaParamsToPlan(plan, parseMediaParamsText(
    '[创作参数] 图片 | Midjourney Relax Imagine | 文生图 | 比例 9:16\n\n提示词：',
  ))
  assert.equal(pinned.modelId, 'newapi/t8/mj_relax_imagine')
  assert.equal(pinned.ratio, '9:16')
  assert.equal(pinned.usesProductDefaultModel, undefined)
  assert.equal(pinned.prompt, '一个中国女网红')
})

test('类型对不上时只忽略，不把图片计划改成视频', () => {
  const plan = parseMediaPlan('```jc-media-plan\n' + JSON.stringify({
    kind: 'image', title: '主图', prompt: '产品主图',
  }) + '\n```')
  const next = applyMediaParamsToPlan(plan, parseMediaParamsText(
    '[创作参数] 视频 | jc-MiniMax H3 文生视频 | 文生视频 | 比例 16:9\n\n提示词：',
  ))
  assert.equal(next, plan)
  assert.equal(kindFromLabel('图片'), 'image')
  assert.equal(kindFromLabel('3D'), 'model3d')
  assert.equal(kindFromLabel('其它'), undefined)
})
