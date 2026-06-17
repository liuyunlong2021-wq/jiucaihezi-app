export type CreationTask = 'image' | 'video' | 'audio' | 'digital-human'

export type CreationSource = 'newapi-direct' | 'runninghub'

export type CreationRoute = 'newapi-direct' | 'runninghub-adapter'

export type CreationUpstreamFamily =
  | 't8'
  | 'volcengine'
  | 'worldrouter'
  | 'trump'
  | 'runninghub'
  | 'openai-compatible'
  | 'unknown'

export type CreationApiStyle =
  | 'openai-images'
  | 'openai-image-edits'
  | 'openai-videos'
  | 'newapi-task'
  | 'seedance-task'
  | 'suno-task'
  | 'rh-standard'
  | 'rh-aiapp'

export type CreationMode =
  | 'text-to-image'
  | 'image-to-image'
  | 'text-to-video'
  | 'image-to-video'
  | 'video-edit'
  | 'text-to-audio'
  | 'lyrics'
  | 'digital-human'
  | 'voice-clone'
  | 'voice-design'
  | 'workflow'

export type CreationContractStatus = 'verified' | 'partial' | 'unknown' | 'broken' | 'degraded'

export type CreationPollKind = 'none' | 'newapi-task' | 'rh-task' | 'suno-task' | 'seedance-task'

export type CreationAssetFlow = 'none' | 'newapi-upload' | 'seedance-asset' | 'rh-upload'

export type CreationResultExtractor =
  | 'openai-image'
  | 'openai-video'
  | 'newapi-task'
  | 'suno'
  | 'rh-task'
  | 'generic-media'

export type CreationInputModality = 'text' | 'image' | 'video' | 'audio'

export type CreationOutputModality = 'image' | 'video' | 'audio' | 'text'

export interface CreationFieldOption {
  value: string | number | boolean
  label: string
}

export interface CreationFieldSpec {
  key: string
  label: string
  kind: 'prompt' | 'text' | 'textarea' | 'select' | 'number' | 'boolean' | 'image' | 'images' | 'video' | 'audio'
  required?: boolean
  defaultValue?: string | number | boolean
  options?: CreationFieldOption[]
  min?: number
  max?: number
  step?: number
}

export interface CreationModelSpec {
  id: string
  model: string
  label: string
  task: CreationTask
  source: CreationSource
  route: CreationRoute
  upstreamFamily: CreationUpstreamFamily
  apiStyle: CreationApiStyle
  mode: CreationMode
  contractStatus: CreationContractStatus
  price?: number
  endpoint: string
  poll?: {
    kind: CreationPollKind
    pathTemplate?: string
  }
  files?: {
    images?: { min?: number; max?: number }
    videos?: { min?: number; max?: number }
    audios?: { min?: number; max?: number }
  }
  capabilities: {
    officialAbilityTypes: string[]
    adapterAbilityTypes: string[]
    inputModalities: CreationInputModality[]
    outputModalities: CreationOutputModality[]
    ratios?: string[]
    resolutions?: string[]
    duration?: { min?: number; max?: number; allowedValues?: number[] }
    assetFlow: CreationAssetFlow
    resultExtractor: CreationResultExtractor
  }
  fields: CreationFieldSpec[]
  aliases?: string[]
  notes: string[]
  sourceUrls?: string[]
  verifiedAt?: string
  contractIssues?: string[]
}

export interface ListCreationModelsFilter {
  task?: CreationTask
  source?: 'all' | CreationSource
  mode?: CreationMode
  includeDisabled?: boolean
}

export interface CreationModelListItem {
  id: string
  model: string
  label: string
  task: CreationTask
  source: CreationSource
  upstreamFamily: CreationUpstreamFamily
  mode: CreationMode
  price?: number
  contractStatus: CreationContractStatus
  disabledReason?: string
  badges: string[]
}

export interface CreationPanelModelItem extends CreationModelListItem {
  apiStyle: CreationApiStyle
  route: CreationRoute
  fields: CreationFieldSpec[]
  submitSummaryPreview: string
}

export interface CreationRunPlanInput {
  modelId: string
  params?: Record<string, unknown>
}

export interface CreationRunPlan {
  modelId: string
  model: string
  label: string
  task: CreationTask
  source: CreationSource
  route: CreationRoute
  upstreamFamily: CreationUpstreamFamily
  apiStyle: CreationApiStyle
  mode: CreationMode
  contractStatus: CreationContractStatus
  endpoint: string
  usesRhAdapter: boolean
  pollKind: CreationPollKind
  assetFlow: CreationAssetFlow
  submitSummary: string
  price?: number
  warnings?: string[]
  debug: {
    referenceImageCount: number
    referenceVideoCount: number
    referenceAudioCount: number
    normalizedParams: Record<string, unknown>
  }
}
