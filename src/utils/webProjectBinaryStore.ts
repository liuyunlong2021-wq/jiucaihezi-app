export type WebBinarySource = Blob | ReadableStream<Uint8Array>

export interface WebProjectBinaryAdapter {
  write(id: string, source: WebBinarySource): Promise<number>
  read(id: string): Promise<Blob>
  remove(id: string): Promise<void>
  estimate(): Promise<{ quota?: number; usage?: number }>
  persist(): Promise<boolean>
}

const OPFS_DIRECTORY = 'jc-project-files'

type OpfsStorageManager = StorageManager & {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>
}

function opfsStorage(): OpfsStorageManager {
  const storage = globalThis.navigator?.storage as OpfsStorageManager | undefined
  if (!storage || typeof storage.getDirectory !== 'function') {
    throw new Error(
      '当前浏览器不支持本地项目媒体存储（OPFS），请使用最新版 Chrome、Edge 或 Safari 后重试。',
    )
  }
  return storage
}

function fileId(id: string): string {
  const value = String(id || '')
  if (!value || value.includes('/') || value.includes('\\') || value.includes('\0'))
    throw new Error('媒体文件 ID 无效')
  return value
}

function isNotFound(error: unknown): boolean {
  return (error as { name?: unknown } | undefined)?.name === 'NotFoundError'
}

async function projectDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await opfsStorage().getDirectory!()
  return await root.getDirectoryHandle(OPFS_DIRECTORY, { create: true })
}

function browserAdapter(): WebProjectBinaryAdapter {
  return {
    async write(id, source) {
      const handle = await (await projectDirectory()).getFileHandle(fileId(id), { create: true })
      const writable = await handle.createWritable()
      const reader = (source instanceof Blob ? source.stream() : source).getReader()
      let size = 0
      let closed = false
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = new Uint8Array(value.byteLength)
          chunk.set(value)
          await writable.write(chunk)
          size += value.byteLength
        }
        await writable.close()
        closed = true
        return size
      } finally {
        reader.releaseLock()
        if (!closed) await writable.abort().catch(() => {})
      }
    },
    async read(id) {
      try {
        const handle = await (await projectDirectory()).getFileHandle(fileId(id))
        return await handle.getFile()
      } catch (error) {
        if (isNotFound(error)) throw new Error(`二进制文件不存在: ${id}`)
        throw error
      }
    },
    async remove(id) {
      try {
        await (await projectDirectory()).removeEntry(fileId(id))
      } catch (error) {
        if (!isNotFound(error)) throw error
      }
    },
    async estimate() {
      const storage = opfsStorage()
      if (typeof storage.estimate !== 'function') return {}
      const { quota, usage } = await storage.estimate()
      return { quota, usage }
    },
    async persist() {
      const storage = opfsStorage()
      if (typeof storage.persist !== 'function') return false
      try {
        return await storage.persist()
      } catch {
        return false
      }
    },
  }
}

export function createWebProjectBinaryStore(
  adapter: WebProjectBinaryAdapter = browserAdapter(),
): WebProjectBinaryAdapter {
  return adapter
}

export const webProjectBinaryStore = createWebProjectBinaryStore()

export async function ensureWebProjectStorage(expectedBytes?: number): Promise<{
  persisted: boolean
  usage?: number
  quota?: number
}> {
  const persisted = await webProjectBinaryStore.persist()
  const { usage, quota } = await webProjectBinaryStore.estimate()
  const available =
    typeof usage === 'number' && typeof quota === 'number' ? Math.max(0, quota - usage) : undefined
  if (
    typeof expectedBytes === 'number' &&
    expectedBytes > 0 &&
    available !== undefined &&
    expectedBytes > available
  ) {
    throw new Error(
      `本地存储空间不足：可用 ${available} 字节，需要 ${expectedBytes} 字节。请清理浏览器站点数据后重试。`,
    )
  }
  return { persisted, usage, quota }
}
