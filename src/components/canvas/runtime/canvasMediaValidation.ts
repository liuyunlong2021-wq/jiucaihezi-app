import { validateMediaModelInputs } from '../../../data/mediaModelInputValidation'
import type { CanvasImageInputs } from './canvasInputs'

type CanvasMediaNodeData = Record<string, unknown>

function validateByCapability(
  modelId: string,
  prompt: string,
  data: CanvasMediaNodeData,
  inputs: CanvasImageInputs,
  emptyMessage: string,
): void {
  try {
    validateMediaModelInputs({
      modelId,
      prompt,
      data,
      images: inputs.all,
      videos: inputs.videos,
      audios: inputs.audios,
      emptyMessage,
    })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith(`${emptyMessage}：`)) {
      throw new Error(err.message.replace(`${emptyMessage}：`, `${emptyMessage}，缺少：`) + '。')
    }
    throw err
  }
}

export function validateCanvasVideoInputs(
  modelId: string,
  prompt: string,
  data: CanvasMediaNodeData,
  inputs: CanvasImageInputs,
): void {
  validateByCapability(modelId, prompt, data, inputs, '视频生成节点没有输入内容')
}

export function validateCanvasImageInputs(
  modelId: string,
  prompt: string,
  data: CanvasMediaNodeData,
  inputs: CanvasImageInputs,
): void {
  validateByCapability(modelId, prompt, data, inputs, '图片生成节点没有输入内容')
}

export function validateCanvasAudioInputs(
  modelId: string,
  prompt: string,
  data: CanvasMediaNodeData,
  inputs: CanvasImageInputs,
): void {
  validateByCapability(modelId, prompt, data, inputs, '音频生成节点没有输入内容')
}
