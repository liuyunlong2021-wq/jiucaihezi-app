export interface CanvasAssetUrl {
  url: string
  /** True only for a Web object URL owned by this resolver. */
  revoke?: boolean
}

export interface CanvasAssetUrlLease {
  url: string
  release: () => void
}

interface ResolvedUrl extends CanvasAssetUrl {
  references: number
}

export class CanvasAssetUrlResolver {
  private readonly urls = new Map<string, ResolvedUrl>()

  constructor(private readonly revokeObjectUrl: (url: string) => void) {}

  async acquire(
    owner: string,
    path: string,
    create: () => Promise<CanvasAssetUrl>,
  ): Promise<CanvasAssetUrlLease> {
    const key = `${owner}:${path}`
    let entry = this.urls.get(key)
    if (!entry) {
      entry = { ...(await create()), references: 0 }
      this.urls.set(key, entry)
    }
    entry.references++
    let released = false
    return {
      url: entry.url,
      release: () => {
        if (released) return
        released = true
        const current = this.urls.get(key)
        if (!current) return
        current.references--
        if (current.references > 0) return
        this.urls.delete(key)
        if (current.revoke) this.revokeObjectUrl(current.url)
      },
    }
  }

  releaseAll(): void {
    for (const entry of this.urls.values()) {
      if (entry.revoke) this.revokeObjectUrl(entry.url)
    }
    this.urls.clear()
  }

  releaseMatching(owner: string, path: string): void {
    const prefix = `${owner}:${path}`
    for (const [key, entry] of this.urls) {
      if (key !== prefix && !key.startsWith(`${prefix}:`)) continue
      this.urls.delete(key)
      if (entry.revoke) this.revokeObjectUrl(entry.url)
    }
  }
}
