import type { FileEntry } from '@/composables/useFileStore'

export const CREATION_GALLERY_SOURCE = 'creation-gallery'

export function isChatImageFile(file: Pick<FileEntry, 'metadata'> | any): boolean {
  return file?.metadata?.kind === 'chat-image'
}

export function visibleMediaFiles<T extends Pick<FileEntry, 'metadata'>>(files: T[]): T[] {
  return (files || []).filter(file => !isChatImageFile(file))
}

export function isCreationGalleryFile(file: Pick<FileEntry, 'metadata'> | any): boolean {
  return file?.metadata?.source === CREATION_GALLERY_SOURCE
}

export function visibleCreationGalleryFiles<T extends Pick<FileEntry, 'metadata'>>(files: T[]): T[] {
  return (files || []).filter(isCreationGalleryFile)
}
