export const MEMORY_RAW_DIRECTORY = '.raw'
export const MEMORY_MEDIA_DIRECTORY = '.raw/jc-media'
export const MEMORY_CONVERSATION_DIRECTORY = '.raw/对话记录'
export const MEMORY_INDEX_DIRECTORY = '.raw/记忆索引'
export const MEMORY_SYNC_DIRECTORY = '.raw/.sync'
export const MEMORY_FILE_TASK_DIRECTORY = '.raw/临时任务'
export const MEMORY_CANVAS_DIRECTORY = 'jc-canvas'

export const MEMORY_MEDIA_DIRECTORIES = {
  document: `${MEMORY_MEDIA_DIRECTORY}/文档`,
  image: `${MEMORY_MEDIA_DIRECTORY}/图片`,
  video: `${MEMORY_MEDIA_DIRECTORY}/视频`,
  audio: `${MEMORY_MEDIA_DIRECTORY}/音频`,
} as const

export const MEMORY_PROJECT_SKELETON_DIRECTORIES = [
  MEMORY_RAW_DIRECTORY,
  MEMORY_MEDIA_DIRECTORY,
  MEMORY_MEDIA_DIRECTORIES.document,
  MEMORY_MEDIA_DIRECTORIES.image,
  MEMORY_MEDIA_DIRECTORIES.video,
  MEMORY_MEDIA_DIRECTORIES.audio,
  MEMORY_CONVERSATION_DIRECTORY,
  MEMORY_INDEX_DIRECTORY,
  MEMORY_SYNC_DIRECTORY,
  MEMORY_CANVAS_DIRECTORY,
] as const

const SKELETON_PATHS = new Set<string>(MEMORY_PROJECT_SKELETON_DIRECTORIES)
const SELECTOR_MANAGED_DIRECTORIES = [
  MEMORY_CONVERSATION_DIRECTORY,
  MEMORY_INDEX_DIRECTORY,
  MEMORY_SYNC_DIRECTORY,
  MEMORY_FILE_TASK_DIRECTORY,
  MEMORY_CANVAS_DIRECTORY,
] as const

function normalizedPath(path: string): string {
  return String(path || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
}

function isSameOrChild(path: string, directory: string): boolean {
  return path === directory || path.startsWith(`${directory}/`)
}

/**
 * 旧画布资产路径 → 现行路径候选（会话附件迁移时漏改了画布文档：jc-media/images → .raw/jc-media/图片）。
 * 调用方用项目文件集合挑第一个存在的候选；没有候选则返回空数组。
 */
export function legacyCanvasMediaCandidates(path: string): string[] {
  const normalized = normalizedPath(path)
  const base = normalized.split('/').pop() || ''
  if (!base) return []
  if (normalized.startsWith('jc-media/images/')) return [`${MEMORY_MEDIA_DIRECTORIES.image}/${base}`]
  if (normalized.startsWith('jc-media/videos/')) return [`${MEMORY_MEDIA_DIRECTORIES.video}/${base}`]
  if (normalized.startsWith('jc-media/audios/')) return [`${MEMORY_MEDIA_DIRECTORIES.audio}/${base}`]
  if (normalized.startsWith('jc-media/uploads/')) {
    return [
      `${MEMORY_MEDIA_DIRECTORIES.image}/${base}`,
      `${MEMORY_MEDIA_DIRECTORIES.video}/${base}`,
      `${MEMORY_MEDIA_DIRECTORIES.audio}/${base}`,
      `${MEMORY_MEDIA_DIRECTORIES.document}/${base}`,
    ]
  }
  return []
}

export function isMemoryConversationPath(path: string): boolean {
  const normalized = normalizedPath(path)
  return isSameOrChild(normalized, MEMORY_CONVERSATION_DIRECTORY)
    || normalized.includes(`/${MEMORY_CONVERSATION_DIRECTORY}/`)
    || normalized.endsWith(`/${MEMORY_CONVERSATION_DIRECTORY}`)
}

export function isAuthorizedMemoryConversationPath(path: string, authorizedPaths: string[] = []): boolean {
  const normalized = normalizedPath(path)
  return isMemoryConversationPath(normalized) && authorizedPaths.some(candidate => normalizedPath(candidate) === normalized)
}

export function memoryMediaDirectoryFor(path: string, mimeType = ''): string {
  const normalized = normalizedPath(path).toLowerCase()
  const mime = String(mimeType || '').toLowerCase()
  if (mime.startsWith('image/') || /\.(?:png|jpe?g|gif|webp|svg|ico|bmp|tiff?)$/.test(normalized)) {
    return MEMORY_MEDIA_DIRECTORIES.image
  }
  if (mime.startsWith('video/') || /\.(?:mp4|mov|avi|webm|mkv|flv|wmv|m4v)$/.test(normalized)) {
    return MEMORY_MEDIA_DIRECTORIES.video
  }
  if (mime.startsWith('audio/') || /\.(?:mp3|wav|ogg|m4a|flac|aac|wma|opus)$/.test(normalized)) {
    return MEMORY_MEDIA_DIRECTORIES.audio
  }
  return MEMORY_MEDIA_DIRECTORIES.document
}

export function isMemoryMediaFilePath(path: string, mimeType: string): boolean {
  const normalized = normalizedPath(path)
  const directory = memoryMediaDirectoryFor(normalized, mimeType)
  return normalized.startsWith(`${directory}/`)
}

export function isMemoryProjectHiddenPath(path: string): boolean {
  const normalized = normalizedPath(path)
  return normalized.split('/').at(-1) === '.DS_Store'
    || SELECTOR_MANAGED_DIRECTORIES.some(directory => isSameOrChild(normalized, directory))
}

export function isMemoryProjectMutationBlocked(
  path: string,
  operation: 'resource' | 'text' | 'directory' = 'resource',
): boolean {
  const normalized = normalizedPath(path)
  if (SKELETON_PATHS.has(normalized)) return true
  if (SELECTOR_MANAGED_DIRECTORIES.some(directory => isSameOrChild(normalized, directory))) return true
  if (!normalized.startsWith(`${MEMORY_MEDIA_DIRECTORY}/`)) return false
  // 文档区的子目录归用户/模型管（Skill 草稿本身就是个目录），骨架目录自己仍然只有 App 能建删。
  // 不这么放：模型建草稿目录时的 mkdir 会被拦下，而且报的是「系统骨架…只能由 App 管理」这种误导文案。
  if (operation === 'directory') return !normalized.startsWith(`${MEMORY_MEDIA_DIRECTORIES.document}/`)
  if (operation === 'text') return !normalized.startsWith(`${MEMORY_MEDIA_DIRECTORIES.document}/`)
  return !Object.values(MEMORY_MEDIA_DIRECTORIES).some(directory => normalized.startsWith(`${directory}/`))
}
