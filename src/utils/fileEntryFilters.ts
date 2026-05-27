import type { FileEntry } from '@/composables/useFileStore'

export function isChatImageFile(file: Pick<FileEntry, 'metadata'> | any): boolean {
  return file?.metadata?.kind === 'chat-image'
}

export function visibleMediaFiles<T extends Pick<FileEntry, 'metadata'>>(files: T[]): T[] {
  return (files || []).filter(file => !isChatImageFile(file))
}
