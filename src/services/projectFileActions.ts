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
import type { ImportProjectExternalFilesInput, ProjectFileService, ProjectFileWriteResult } from './projectFileService'

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

function binaryDataUrl(data: Uint8Array, mimeType?: string): string {
  let binary = ''
  for (let offset = 0; offset < data.length; offset += 0x8000) binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000))
  return `data:${mimeType || 'application/octet-stream'};base64,${btoa(binary)}`
}

export function createProjectFileActions(projectFiles: ProjectFileService) {
  async function listCanvases(owner: string): Promise<ProjectResource[]> {
    return (await projectFiles.list(owner))
      .filter(resource => resource.kind === 'canvas' && !resource.isDirectory && isCanvasPath(resource.path))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }

  return {
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
      if (!input.path.startsWith('jc-media/')) throw new Error('项目媒体必须保存到 jc-media 目录')
      return await projectFiles.importBinary(input)
    },
    async importDesktopPaths(input: ImportDesktopProjectPathsInput): Promise<ProjectResource[]> {
      return await projectFiles.importExternalFiles(input)
    },
    async readMedia(resource: ProjectResource) {
      if (resource.kind !== 'media' || resource.isDirectory || !resource.path.startsWith('jc-media/')) {
        throw new Error('不是有效的项目媒体资源')
      }
      return await projectFiles.readBinary(resource)
    },
    async readMediaDataUrl(resource: ProjectResource): Promise<string> {
      if (resource.kind !== 'media' || resource.isDirectory || !resource.path.startsWith('jc-media/')) {
        throw new Error('不是有效的项目媒体资源')
      }
      const binary = await projectFiles.readBinary(resource)
      return binaryDataUrl(binary.data, binary.mimeType || resource.mimeType)
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
      return parseCanvasRead(resource, await projectFiles.readText(resource))
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
