import {
  canvasFilePath,
  copyCanvasDocument,
  createCanvasDocument,
  isCanvasPath,
  nextCanvasFileName,
  parseCanvasDocument,
} from '@/components/canvas/canvasDocument'
import type { CanvasDocumentV3 } from '@/types/canvas'
import type { ProjectResource, ProjectResourceRevision, ProjectTextRead } from '@/utils/projectResource'
import { isMemoryMediaFilePath, MEMORY_MEDIA_DIRECTORY } from '@/utils/memoryProjectPaths'
import type { ImportProjectExternalFilesInput, ProjectFileService, ProjectFileWriteResult } from './projectFileService'
import { appendProjectDirectoryIndex } from './projectFileService'
import wikiContract from '../../public/skills/wiki-artifacts.json'

export const WIKI_TYPES = [
  { id: 'generic', label: '通用 Wiki' },
  { id: 'manju', label: '漫剧制作 Wiki' },
  { id: 'short-drama', label: '短剧写作 Wiki' },
  { id: 'novel', label: '小说创作 Wiki' },
] as const
export type WikiType = typeof WIKI_TYPES[number]['id']

export interface CreateProjectCanvasInput {
  owner: string
}

export interface CreateProjectCanvasAtPathInput extends CreateProjectCanvasInput {
  path: string
  document: CanvasDocumentV3
}

export interface ProjectCanvasOpenResult {
  resource: ProjectResource
  document: CanvasDocumentV3
  revision: ProjectResourceRevision
}

export interface SaveProjectCanvasInput {
  resource: ProjectResource
  document: CanvasDocumentV3
  revision: ProjectResourceRevision
}

export interface ImportProjectMediaInput {
  owner: string
  path: string
  data: Uint8Array
  mimeType: string
}

export interface ImportDesktopProjectPathsInput extends ImportProjectExternalFilesInput {}

export interface ExportProjectResourcesInput {
  resources: ProjectResource[]
  export(resources: ProjectResource[]): Promise<void>
}

function requireCanvasResource(resource: ProjectResource): void {
  if (resource.kind !== 'canvas' || resource.isDirectory || !isCanvasPath(resource.path)) {
    throw new Error('不是有效的项目画布资源')
  }
}

function parseCanvasRead(resource: ProjectResource, read: ProjectTextRead): ProjectCanvasOpenResult {
  if (read.truncated) throw new Error('画布文件超过 30 MB，无法安全读取')
  if (!read.content) throw new Error('画布文件为空')
  return { resource, document: parseCanvasDocument(read.content), revision: read.revision }
}

const CANVAS_MAX_BYTES = 30_000_000
const CANVAS_RECOVERY_MAX_BYTES = 200_000_000

async function recoverOversizedCanvas(
  projectFiles: ProjectFileService,
  resource: ProjectResource,
): Promise<ProjectCanvasOpenResult> {
  const read = await projectFiles.readText(resource, CANVAS_RECOVERY_MAX_BYTES)
  if (read.truncated || !read.content.includes('data:image')) {
    throw new Error('画布文件超过 30 MB，无法安全读取')
  }
  const document = parseCanvasDocument(read.content)
  const content = JSON.stringify(document)
  if (
    new TextEncoder().encode(content).byteLength >= CANVAS_MAX_BYTES ||
    content.includes('data:image')
  ) {
    throw new Error('画布文件超过 30 MB，无法安全修复')
  }

  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  await projectFiles.createText(
    resource.owner,
    `${resource.path}.base64-leak-backup-${stamp}`,
    read.content,
  )
  const saved = await projectFiles.writeText(resource, content, read.revision)
  if (saved.status !== 'saved') throw new Error('画布文件已被外部修改，未执行自动修复')
  return parseCanvasRead(resource, {
    content,
    size: new TextEncoder().encode(content).byteLength,
    truncated: false,
    revision: saved.revision,
  })
}

export function mediaMimeForPath(path: string): string | undefined {
  const extension = path.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return extension && ({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', bmp: 'image/bmp', mp4: 'video/mp4', mov: 'video/quicktime',
    webm: 'video/webm', avi: 'video/x-msvideo', mkv: 'video/x-matroska', mp3: 'audio/mpeg',
    wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  } as Record<string, string>)[extension]
}

export function createProjectFileActions(projectFiles: ProjectFileService) {
  async function listCanvases(owner: string): Promise<ProjectResource[]> {
    return (await projectFiles.list(owner))
      .filter(resource => resource.kind === 'canvas' && !resource.isDirectory && isCanvasPath(resource.path))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  return {
    async createProductionWiki(input: { owner: string; kind: WikiType }): Promise<ProjectResource> {
      if (!WIKI_TYPES.some(type => type.id === input.kind)) throw new Error('未知 Wiki 类型')
      const resources = await projectFiles.list(input.owner)
      const byPath = new Map(resources.map(resource => [resource.path, resource]))
      const roots: string[] = []
      for (const root of wikiContract.rootCandidates) {
        const children = new Set(resources.filter(resource => resource.path.startsWith(`${root}/`))
          .map(resource => resource.path.slice(root.length + 1).split('/')[0]))
        const signature = wikiContract.excludedRootSignatures.find(item => item.root === root)
        if (signature && byPath.has(`${root}/${signature.path}`)
          && (await projectFiles.readTextAt(input.owner, `${root}/${signature.path}`)).content.startsWith(signature.startsWith)) continue
        if (byPath.has(`${root}/${wikiContract.rootIndex}`)
          || wikiContract.rootMarkers.filter(marker => marker !== wikiContract.rootIndex && children.has(marker)).length >= wikiContract.minimumRootMarkers)
          roots.push(root)
      }
      if (roots.length > 1) throw new Error(`检测到多个 Wiki 根目录：${roots.join('、')}，请先明确选择`)
      const root = roots[0] || wikiContract.rootCandidates[0]
      const directories = new Set([''])
      if (input.kind !== 'generic') {
        for (const [kind, template] of Object.entries(wikiContract.types)) {
          const spec: { path: string; production_routes: readonly string[] } = input.kind === 'manju'
            ? { ...template, ...(wikiContract.manju_layout.types as Record<string, { path: string }>)[kind] } : template
          if (!(spec.production_routes as readonly string[]).includes(input.kind)) continue
          let directory = ''
          for (const part of spec.path.split('/').slice(0, -1)) {
            if (part.includes('{')) break
            directory = directory ? `${directory}/${part}` : part
            directories.add(directory)
          }
        }
        if (input.kind === 'manju') for (const directory of wikiContract.manju_layout.directories) directories.add(directory.path)
      }
      const paths = [...directories].sort((a, b) => a.split('/').length - b.split('/').length)
        .map(directory => directory ? `${root}/${directory}` : root)
      for (const path of paths) {
        if (byPath.has(path) && !byPath.get(path)!.isDirectory) throw new Error(`目标目录被文件占用：${path}`)
        if (byPath.get(`${path}/index.md`)?.isDirectory) throw new Error(`索引被目录占用：${path}/index.md`)
      }
      let result: ProjectResource | undefined
      for (const path of paths) {
        const slash = path.lastIndexOf('/')
        const folder = await this.createWikiFolder({ owner: input.owner,
          parentPath: slash < 0 ? '' : path.slice(0, slash), name: path.slice(slash + 1) })
        result ??= folder
      }
      if (input.kind === 'manju') {
        const path = `${root}/项目风格/影片比例与风格.md`
        if (!(await projectFiles.listDirectory(input.owner, `${root}/项目风格`)).some(file => file.path === path))
          await projectFiles.createText(input.owner, path, '# 影片比例与风格\n\n状态：待填写\n\n画面比例：待填写\n媒介：待填写\n视觉风格：待填写\n色彩与光线：待填写\n声音路线：待填写\n')
        await appendProjectDirectoryIndex(projectFiles, input.owner, `${root}/项目风格`, path)
      }
      return result!
    },
    async createWikiFolder(input: { owner: string; parentPath: string; name: string }): Promise<ProjectResource> {
      const name = input.name.trim()
      if (!name || name === '.' || name === '..' || /[\\/\0\[\]#|]/.test(name)) throw new Error('Wiki 文件夹名称无效')
      const path = input.parentPath ? `${input.parentPath}/${name}` : name
      const folder = await projectFiles.createFolder(input.owner, path)
      try {
        const entries = await projectFiles.listDirectory(input.owner, path)
        if (entries.some(entry => entry.name === 'index.md' && entry.isDirectory)) throw new Error('index.md 已被目录占用')
        if (!entries.some(entry => entry.name === 'index.md'))
          await projectFiles.createText(input.owner, `${path}/index.md`, `# ${name}\n\n## 页面\n`)
        await appendProjectDirectoryIndex(projectFiles, input.owner, input.parentPath, `${path}/index.md`)
      } catch (cause) {
        throw new Error(`文件夹 ${path} 已创建，但索引未完成：${cause instanceof Error ? cause.message : String(cause)}`)
      }
      return folder
    },
    async indexImportedFiles(input: { owner: string; paths: string[] }): Promise<void> {
      let resources: Map<string, ProjectResource>
      try {
        resources = new Map((await projectFiles.list(input.owner)).map(resource => [resource.path, resource]))
      } catch (cause) {
        throw new Error(`上传文件已保存，但索引登记未完成：${cause instanceof Error ? cause.message : String(cause)}`)
      }
      const failures: string[] = []
      for (const path of new Set(input.paths)) {
        try {
          const resource = resources.get(path)
          if (!resource || resource.isDirectory) throw new Error('找不到已导入文件')
          const slash = path.lastIndexOf('/')
          await appendProjectDirectoryIndex(projectFiles, input.owner, slash < 0 ? '' : path.slice(0, slash), path)
        } catch (cause) {
          failures.push(`${path}：${cause instanceof Error ? cause.message : String(cause)}`)
        }
      }
      if (failures.length) throw new Error(`上传文件已保存，但索引登记未完成：${failures.join('；')}`)
    },
    async createCanvas(input: CreateProjectCanvasInput): Promise<ProjectCanvasOpenResult> {
      const name = nextCanvasFileName((await listCanvases(input.owner)).map(resource => resource.name))
      const document = createCanvasDocument({ canvasId: crypto.randomUUID(), scene: [], assets: {} })
      const resource = await projectFiles.createText(input.owner, canvasFilePath(name), JSON.stringify(document))
      const read = await projectFiles.readText(resource)
      return parseCanvasRead(resource, read)
    },
    async createCanvasAtPath(input: CreateProjectCanvasAtPathInput): Promise<ProjectCanvasOpenResult> {
      if (!isCanvasPath(input.path)) throw new Error('画布路径无效')
      const resource = await projectFiles.createText(input.owner, input.path, JSON.stringify(input.document))
      return parseCanvasRead(resource, await projectFiles.readText(resource))
    },
    async importMedia(input: ImportProjectMediaInput): Promise<ProjectResource> {
      if (input.path.startsWith(`${MEMORY_MEDIA_DIRECTORY}/`)) {
        if (!isMemoryMediaFilePath(input.path, input.mimeType)) {
          throw new Error('记忆工作台媒体必须按图片、视频、音频或文档分类保存')
        }
      } else if (!input.path.startsWith('jc-media/')) {
        throw new Error('项目媒体必须保存到项目媒体目录')
      }
      return await projectFiles.importBinary(input)
    },
    async importDesktopPaths(input: ImportDesktopProjectPathsInput): Promise<ProjectResource[]> {
      return await projectFiles.importExternalFiles(input)
    },
    async readMedia(resource: ProjectResource) {
      if (resource.kind !== 'media' || resource.isDirectory) {
        throw new Error('不是有效的项目媒体资源')
      }
      return await projectFiles.readBinary(resource)
    },
    async exportResources(input: ExportProjectResourcesInput): Promise<void> {
      if (!input.resources.length) throw new Error('请先选择项目资源')
      const first = input.resources[0]
      if (!input.resources.every(resource => resource.owner === first.owner && resource.runtime === first.runtime)) {
        throw new Error('导出资源必须来自同一项目')
      }
      await input.export(input.resources)
    },
    async openCanvas(resource: ProjectResource): Promise<ProjectCanvasOpenResult> {
      requireCanvasResource(resource)
      const read = await projectFiles.readText(resource)
      return read.truncated && resource.runtime === 'desktop'
        ? recoverOversizedCanvas(projectFiles, resource)
        : parseCanvasRead(resource, read)
    },
    async saveCanvas(input: SaveProjectCanvasInput): Promise<ProjectFileWriteResult> {
      requireCanvasResource(input.resource)
      return await projectFiles.writeText(input.resource, JSON.stringify(input.document), input.revision)
    },
    async copyCanvas(resource: ProjectResource): Promise<ProjectCanvasOpenResult> {
      const source = await this.openCanvas(resource)
      const name = nextCanvasFileName((await listCanvases(resource.owner)).map(item => item.name))
      const document = copyCanvasDocument(source.document, crypto.randomUUID())
      const copy = await projectFiles.createText(resource.owner, canvasFilePath(name), JSON.stringify(document))
      return parseCanvasRead(copy, await projectFiles.readText(copy))
    },
    listCanvases,
    async rename(resource: ProjectResource, name: string): Promise<ProjectResource> {
      return await projectFiles.rename(resource, name)
    },
    async remove(resource: ProjectResource): Promise<void> {
      await projectFiles.remove(resource)
    },
  }
}
