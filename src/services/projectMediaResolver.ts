import type { ProjectResource } from '@/utils/projectResource'

export interface MediaDisplayLease {
  url: string
  release(): void
}

interface MediaDisplayDependencies {
  convertDesktopPath(path: string): Promise<string>
  readWebSource(owner: string, path: string): Promise<Blob | string>
  createObjectUrl(blob: Blob): string
  revokeObjectUrl(url: string): void
}

export function absoluteProjectPath(resource: ProjectResource): string {
  return `${resource.owner.replace(/[\\/]+$/, '')}/${resource.path.replace(/^[/\\]+/, '')}`
}

async function defaultDependencies(): Promise<MediaDisplayDependencies> {
  return {
    async convertDesktopPath(path) {
      const { convertFileSrc } = await import('@tauri-apps/api/core')
      return convertFileSrc(path)
    },
    async readWebSource(owner, path) {
      const { webProjectFiles } = await import('@/utils/webProjectFiles')
      try {
        return await webProjectFiles.readBinary(owner, path)
      } catch {
        return (await webProjectFiles.read(owner, path)).content
      }
    },
    createObjectUrl: blob => URL.createObjectURL(blob),
    revokeObjectUrl: url => URL.revokeObjectURL(url),
  }
}

export async function acquireProjectMediaDisplay(
  resource: ProjectResource,
  injected?: MediaDisplayDependencies,
): Promise<MediaDisplayLease> {
  if (resource.isDirectory || resource.kind !== 'media') throw new Error('不是有效的项目媒体资源')
  const dependencies = injected || await defaultDependencies()
  if (resource.runtime === 'desktop') {
    return {
      url: await dependencies.convertDesktopPath(absoluteProjectPath(resource)),
      release() {},
    }
  }

  const source = await dependencies.readWebSource(resource.owner, resource.path)
  if (typeof source === 'string') return { url: source, release() {} }
  const url = dependencies.createObjectUrl(source)
  let released = false
  return {
    url,
    release() {
      if (released) return
      released = true
      dependencies.revokeObjectUrl(url)
    },
  }
}
