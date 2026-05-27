import {
  MEDIA_MODEL_CAPABILITIES,
  MEDIA_TASK_LABELS,
  getMediaField,
  getMediaModelsForTask,
  mediaFieldOptions,
  type MediaModelCapability,
  type MediaTaskKind,
} from './mediaModelCapabilities'

export type CreationTask = MediaTaskKind

export const RH_TASK_LABELS = MEDIA_TASK_LABELS

export interface CreationModel {
  label: string
  tasks: CreationTask[]
  provider: 'gateway-image' | 'gateway-video' | 'gateway-suno' | 'runninghub-video' | 'runninghub-audio'
  modelName: string
  capability: MediaModelCapability
  sizes?: string[]
  defSize?: string
  ar?: string[]
  defAr?: string
  res?: string[]
  defRes?: string
  dur?: number[]
  defDur?: number
  maxFiles?: number
  acceptedFiles?: Array<'image' | 'video' | 'audio'>
  sunoMv?: string
}

function valuesFor(model: MediaModelCapability, key: string): string[] {
  return mediaFieldOptions(model, key).map(option => String(option.value))
}

function defaultFor(model: MediaModelCapability, key: string): string {
  const field = getMediaField(model, key)
  return field?.defaultValue !== undefined ? String(field.defaultValue) : valuesFor(model, key)[0] || ''
}

function numberValuesFor(model: MediaModelCapability, key: string): number[] {
  return mediaFieldOptions(model, key)
    .map(option => Number(option.value))
    .filter(value => Number.isFinite(value))
}

function toCreationModel(model: MediaModelCapability): CreationModel {
  const ratioOptions = valuesFor(model, 'aspect_ratio').length
    ? valuesFor(model, 'aspect_ratio')
    : valuesFor(model, 'ratio')
  const ratioDefault = defaultFor(model, 'aspect_ratio') || defaultFor(model, 'ratio')
  const durationOptions = numberValuesFor(model, 'duration')
  const provider = model.provider === 'gateway-audio' ? 'gateway-suno' : model.provider
  return {
    label: model.label,
    tasks: [model.task],
    provider,
    modelName: model.model,
    capability: model,
    sizes: valuesFor(model, 'size'),
    defSize: defaultFor(model, 'size'),
    ar: ratioOptions,
    defAr: ratioDefault,
    res: valuesFor(model, 'resolution'),
    defRes: defaultFor(model, 'resolution'),
    dur: durationOptions,
    defDur: Number(defaultFor(model, 'duration')) || durationOptions[0],
    maxFiles: model.maxFiles,
    acceptedFiles: model.acceptedFiles,
    sunoMv: defaultFor(model, 'mv'),
  }
}

export const RH_CREATION_MODELS: Record<string, CreationModel> = Object.fromEntries(
  MEDIA_MODEL_CAPABILITIES.map(model => [model.id, toCreationModel(model)]),
)

export function getModelsForTask(task: CreationTask): string[] {
  return getMediaModelsForTask(task).map(model => model.id)
}

export function getAspectOptions(model: CreationModel, _task: CreationTask): string[] {
  return model.ar || []
}

export function getDefaultAspect(model: CreationModel, _task: CreationTask): string {
  return model.defAr || getAspectOptions(model, _task)[0] || ''
}

export function getSizeOptions(model: CreationModel): string[] {
  return model.sizes || []
}

export function getDefaultSize(model: CreationModel): string {
  return model.defSize || getSizeOptions(model)[0] || ''
}

export function getResolutionOptions(model: CreationModel): string[] {
  return model.res || []
}

export function getDefaultResolution(model: CreationModel): string {
  return model.defRes || getResolutionOptions(model)[0] || ''
}
