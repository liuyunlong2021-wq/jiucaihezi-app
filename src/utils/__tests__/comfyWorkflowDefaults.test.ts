import assert from 'node:assert/strict'
import test from 'node:test'
import { detectComfyWorkflowKind } from '../comfyWorkflowDefaults'

test('ComfyUI default workflow intent is deterministic', () => {
  assert.equal(detectComfyWorkflowKind('生成一张人物图片'), 'image')
  assert.equal(detectComfyWorkflowKind('让图1动起来'), 'video')
  assert.equal(detectComfyWorkflowKind('生成一段背景音乐'), 'audio')
  assert.equal(detectComfyWorkflowKind('查询刚才的任务'), undefined)
})
