import type { FileEntry } from '@/composables/useFileStore'

export function fileEntryToDownloadBlob(file: Pick<FileEntry, 'content' | 'mimeType'>): Blob {
  return new Blob([String(file.content || '')], { type: file.mimeType || 'text/plain' })
}
